"""Drone drivers — abstract surface + the two concrete implementations.

The whole point of this abstraction is that the generated Python looks
identical against either driver. Only the type that the bridge constructs
changes (MockDrone today, CrazyflieDrone once the radio + drone arrive).

State coordinate convention (mirrors the JS sim, so the canvas can render
either local-sim or bridge-driven state without a math change):
  * position is in cm relative to the drone's home (0, 0, 0)
  * heading is radians; -pi/2 = facing canvas-up
  * forward(cm) moves (cos(heading) * cm, sin(heading) * cm)

All driver methods are async so the WebSocket bridge can stream state
between sub-steps. The generated Python (which is sync-looking) gets a
small ``await`` injection in ``server.py`` before exec.
"""

from __future__ import annotations

import asyncio
import math
import time
from abc import ABC, abstractmethod
from typing import Awaitable, Callable


SendFn = Callable[[dict], Awaitable[None]]


class Drone(ABC):
    """Shared surface. The generated user code only sees this.

    Movement methods take **units** (kid-facing). 1 unit = 30 cm in
    the physical world; drivers convert at the boundary.
    """

    @abstractmethod
    async def takeoff(self) -> None: ...

    @abstractmethod
    async def land(self) -> None: ...

    @abstractmethod
    async def forward(self, units: float) -> None: ...

    @abstractmethod
    async def up(self, units: float) -> None: ...

    @abstractmethod
    async def turn_left(self) -> None: ...

    @abstractmethod
    async def turn_right(self) -> None: ...


# -----------------------------------------------------------------------
# MockDrone — used to develop and test the bridge without hardware.
# -----------------------------------------------------------------------

# Animation timing constants, matched to the in-browser JS sim so the
# kid sees the same pacing whether she's in pretend or real-drone mode.
TAKEOFF_MS = 800
LAND_MS = 900
PER_CM_FWD_MS = 28
PER_CM_UP_MS = 26
TURN_MS = 450
EMIT_HZ = 30   # how often we stream state to the browser during a move

CM_PER_UNIT = 30   # 1 unit (kid-facing) = 30 cm in the world


class MockDrone(Drone):
    """Fakes a drone in software. Animates state over time, streams
    updates to the browser, raises kid-friendly errors when commands
    don't make sense (forward without takeoff, etc.). No network."""

    def __init__(self, send: SendFn) -> None:
        self._send = send
        self.stopped = False
        self.last_error: str | None = None
        # state — cm + radians; matches the JS sim's coordinate system
        self.x_cm = 0.0
        self.y_cm = 0.0
        self.height_cm = 0.0
        self.heading = -math.pi / 2   # facing canvas-up
        self.flying = False
        self.rotor_speed = 0          # used for prop-blur on the canvas

    # ------- public API (what generated Python calls) ------------------

    async def takeoff(self) -> None:
        if self._aborted():
            return
        if self.flying:
            await self._fail("already in the air — no need to take off again!")
            return
        self.flying = True
        await self._status("taking off")
        await self._tween(TAKEOFF_MS, self._climb_to(30.0), rotor=30)
        self.rotor_speed = 20

    async def land(self) -> None:
        if self._aborted():
            return
        if not self.flying:
            await self._fail("can't land — the drone is already on the ground!")
            return
        await self._status("landing")
        await self._tween(LAND_MS, self._climb_to(0.0))
        self.flying = False
        self.rotor_speed = 0
        await self._emit()

    async def forward(self, units: float) -> None:
        if self._aborted():
            return
        if not self.flying:
            await self._fail("can't fly forward — take off first!")
            return
        cm = units * CM_PER_UNIT
        label = f"{units:g} unit" if units == 1 else f"{units:g} units"
        await self._status(f"flying forward {label}")
        start_x, start_y = self.x_cm, self.y_cm
        dx = math.cos(self.heading) * cm
        dy = math.sin(self.heading) * cm
        def step(t: float) -> None:
            self.x_cm = start_x + dx * t
            self.y_cm = start_y + dy * t
        await self._tween(30 + cm * PER_CM_FWD_MS, step, rotor=36)
        self.rotor_speed = 20

    async def up(self, units: float) -> None:
        if self._aborted():
            return
        if not self.flying:
            await self._fail("can't climb — take off first!")
            return
        cm = units * CM_PER_UNIT
        label = f"{units:g} unit" if units == 1 else f"{units:g} units"
        await self._status(f"climbing {label}")
        await self._tween(30 + cm * PER_CM_UP_MS, self._climb_by(cm), rotor=32)
        self.rotor_speed = 20

    async def turn_left(self) -> None:
        if self._aborted():
            return
        if not self.flying:
            await self._fail("can't turn — take off first!")
            return
        await self._status("turning left")
        start = self.heading
        target = start - math.pi / 2
        def step(t: float) -> None:
            self.heading = start + (target - start) * t
        await self._tween(TURN_MS, step, rotor=28)
        self.rotor_speed = 20

    async def turn_right(self) -> None:
        if self._aborted():
            return
        if not self.flying:
            await self._fail("can't turn — take off first!")
            return
        await self._status("turning right")
        start = self.heading
        target = start + math.pi / 2
        def step(t: float) -> None:
            self.heading = start + (target - start) * t
        await self._tween(TURN_MS, step, rotor=28)
        self.rotor_speed = 20

    # ------- internals -------------------------------------------------

    def _aborted(self) -> bool:
        return self.stopped or self.last_error is not None

    def _climb_to(self, target: float) -> Callable[[float], None]:
        start = self.height_cm
        def step(t: float) -> None:
            self.height_cm = start + (target - start) * t
        return step

    def _climb_by(self, delta: float) -> Callable[[float], None]:
        start = self.height_cm
        def step(t: float) -> None:
            self.height_cm = start + delta * t
        return step

    async def _tween(self, duration_ms: float, on_step: Callable[[float], None],
                     rotor: int | None = None) -> None:
        """Run ``on_step(t)`` with t in [0, 1] over ``duration_ms``,
        emitting state at ~EMIT_HZ."""
        if rotor is not None:
            self.rotor_speed = rotor
        start = time.monotonic()
        duration = duration_ms / 1000.0
        # easeInOutQuad — same curve the JS sim uses
        def ease(t: float) -> float:
            return 2 * t * t if t < 0.5 else 1 - (-2 * t + 2) ** 2 / 2
        while True:
            if self.stopped:
                on_step(1.0)
                await self._emit()
                return
            elapsed = time.monotonic() - start
            t = min(1.0, elapsed / duration) if duration > 0 else 1.0
            on_step(ease(t))
            await self._emit()
            if t >= 1.0:
                return
            await asyncio.sleep(1.0 / EMIT_HZ)

    async def _emit(self, status: str | None = None) -> None:
        msg: dict = {
            "op": "state",
            "x_cm": self.x_cm,
            "y_cm": self.y_cm,
            "height_cm": self.height_cm,
            "heading": self.heading,
            "flying": self.flying,
            "rotor_speed": self.rotor_speed,
        }
        if status is not None:
            msg["status"] = status
        await self._send(msg)

    async def _status(self, text: str) -> None:
        await self._send({"op": "status", "text": text, "mode": "flying"})

    async def _fail(self, message: str) -> None:
        self.last_error = message
        await self._send({"op": "error", "message": message})


# -----------------------------------------------------------------------
# CrazyflieDrone — stub. Lands when the radio + drone arrive.
# -----------------------------------------------------------------------

class CrazyflieDrone(Drone):
    """Real drone via cflib. Pattern will mirror the multiranger_push.py
    example (``MotionCommander`` for movement, ``Multiranger`` for sensors).
    Stub for now so the import in server.py doesn't break if anyone flips
    the toggle without a drone in hand."""

    URI_DEFAULT = "radio://0/80/2M/E7E7E7E7E7"

    def __init__(self, send: SendFn, uri: str = URI_DEFAULT) -> None:
        raise NotImplementedError(
            "CrazyflieDrone lands when the Crazyflie + radio arrive. "
            "Use MockDrone until then."
        )

    async def takeoff(self) -> None: ...
    async def land(self) -> None: ...
    async def forward(self, units: float) -> None: ...
    async def up(self, units: float) -> None: ...
    async def turn_left(self) -> None: ...
    async def turn_right(self) -> None: ...
