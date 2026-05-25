"""Drone Lab — WebSocket bridge.

Receives generated Python from the browser, executes it against the
active Drone driver (MockDrone today, CrazyflieDrone once hardware
arrives). Streams state updates back to the browser canvas as the
drone moves.

Protocol
--------
Browser → Bridge:
    {"op": "run", "code": "drone.takeoff()\\n..."}
    {"op": "stop"}

Bridge → Browser:
    {"op": "state",  x_cm, y_cm, height_cm, heading, flying, rotor_speed}
    {"op": "status", "text": "flying forward 30 cm", "mode": "flying"}
    {"op": "error",  "message": "can't fly forward — take off first!"}
    {"op": "done"}

Run:
    uv run python server.py
"""

from __future__ import annotations

import asyncio
import json
import logging
import re

import websockets

from drone import MockDrone

logging.basicConfig(level=logging.INFO, format="%(asctime)s  %(message)s")
log = logging.getLogger("bridge")

HOST = "localhost"
PORT = 8765


# The generated Python looks synchronous to keep it kid-readable (matches
# cflib's MotionCommander API). The driver methods are async so we can
# stream state between steps — inject ``await`` before each ``drone.*``
# call right before exec.
_DRONE_CALL = re.compile(r"^(\s*)(drone\.\w+\()")


def _to_async(code: str) -> str:
    """Prepend ``await`` to lines calling ``drone.<method>(...)``."""
    out: list[str] = []
    for line in code.splitlines():
        m = _DRONE_CALL.match(line)
        if m:
            indent, call = m.group(1), m.group(2)
            out.append(f"{indent}await {call}{line[m.end():]}")
        else:
            out.append(line)
    return "\n".join(out)


async def _run_program(code: str, drone: MockDrone) -> None:
    """exec() the user's Python in a constrained namespace.

    SECURITY NOTE: exec() of arbitrary input is unsafe in general. This
    bridge is bound to ``localhost`` and only this project's frontend
    talks to it. We'll harden (AST whitelist) before this ships anywhere
    that isn't Thibaud's laptop.
    """
    transformed = _to_async(code)
    # Wrap in an async function so ``await`` is legal.
    wrapper = "async def __program__():\n" + "\n".join(
        ("    " + ln) if ln.strip() else ln for ln in transformed.splitlines()
    )
    # If the user wrote no statements (only comments), Python complains
    # about an empty function body — add a pass line for safety.
    if "drone." not in transformed:
        wrapper += "\n    pass\n"
    ns: dict = {"drone": drone, "__builtins__": {
        "range": range, "len": len, "abs": abs, "min": min, "max": max,
        "True": True, "False": False, "None": None, "print": print,
    }}
    exec(wrapper, ns)
    await ns["__program__"]()


async def handle(ws: websockets.WebSocketServerProtocol) -> None:
    log.info("client connected")

    async def send(msg: dict) -> None:
        try:
            await ws.send(json.dumps(msg))
        except websockets.ConnectionClosed:
            pass

    drone = MockDrone(send)
    program_task: asyncio.Task | None = None

    try:
        async for raw in ws:
            try:
                msg = json.loads(raw)
            except json.JSONDecodeError:
                log.warning("non-JSON message dropped: %r", raw[:80])
                continue

            op = msg.get("op")

            if op == "run":
                if program_task and not program_task.done():
                    log.info("ignoring run — program already in flight")
                    continue
                # Fresh drone state for each run
                drone = MockDrone(send)
                code = msg.get("code", "")
                log.info("running %d-line program", len(code.splitlines()))

                async def _go(code: str = code, drone: MockDrone = drone) -> None:
                    try:
                        await _run_program(code, drone)
                        if drone.last_error is None and not drone.stopped:
                            await send({"op": "done"})
                    except Exception as exc:           # noqa: BLE001
                        log.exception("program failed")
                        await send({"op": "error", "message": str(exc)})

                program_task = asyncio.create_task(_go())

            elif op == "stop":
                log.info("stop requested")
                drone.stopped = True
                if program_task and not program_task.done():
                    program_task.cancel()
                await send({"op": "status", "text": "stopped", "mode": "stopped"})

    finally:
        log.info("client disconnected")
        if program_task and not program_task.done():
            program_task.cancel()


async def main() -> None:
    log.info("bridge listening on ws://%s:%s", HOST, PORT)
    async with websockets.serve(handle, HOST, PORT):
        await asyncio.Future()  # run forever


if __name__ == "__main__":
    asyncio.run(main())
