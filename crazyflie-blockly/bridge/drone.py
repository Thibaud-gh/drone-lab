"""Drone driver interface.

Two implementations: SimDrone (sends state updates back to the
browser canvas) and CrazyflieDrone (cflib stub). Both expose the
same method names so the generated Python is identical.

Wiring to the WebSocket server happens in server.py — this turn
we only sketch the surface so we have something to attach the
frontend to in the next slice.
"""

from __future__ import annotations

import asyncio
from abc import ABC, abstractmethod
from typing import Callable, Awaitable


SendFn = Callable[[dict], Awaitable[None]]


class Drone(ABC):
    """Shared drone surface. The generated code only sees this."""

    @abstractmethod
    async def takeoff(self) -> None: ...

    @abstractmethod
    async def land(self) -> None: ...

    @abstractmethod
    async def forward(self, cm: float) -> None: ...

    @abstractmethod
    async def up(self, cm: float) -> None: ...


class SimDrone(Drone):
    """Sends state updates to the connected browser; the canvas
    in the browser renders them. Keeps the real drone's API shape."""

    def __init__(self, send: SendFn) -> None:
        self._send = send

    async def takeoff(self) -> None:
        await self._send({"op": "takeoff"})

    async def land(self) -> None:
        await self._send({"op": "land"})

    async def forward(self, cm: float) -> None:
        await self._send({"op": "forward", "cm": float(cm)})

    async def up(self, cm: float) -> None:
        await self._send({"op": "up", "cm": float(cm)})


class CrazyflieDrone(Drone):
    """Real drone via Bitcraze cflib. Implementation lands once the
    hardware arrives — pattern will mirror cflib's multiranger_push.py
    (MotionCommander.forward(m), .up(m), etc.). For now this is a
    stub so the server import doesn't break."""

    def __init__(self) -> None:
        raise NotImplementedError(
            "Real drone driver lands when the Crazyflie arrives. "
            "Use SimDrone for now."
        )

    async def takeoff(self) -> None: ...
    async def land(self) -> None: ...
    async def forward(self, cm: float) -> None: ...
    async def up(self, cm: float) -> None: ...
