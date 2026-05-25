"""Drone Lab — WebSocket bridge (skeleton).

Receives generated Python from the browser, executes it against
the active Drone driver (Sim or Crazyflie). This file is a stub —
the frontend doesn't talk to it yet. We wire it up in the next
slice once the in-browser sim is validated end-to-end.

Run:
    pip install -r requirements.txt
    python server.py
"""

from __future__ import annotations

import asyncio
import json
import logging

import websockets

from drone import SimDrone

logging.basicConfig(level=logging.INFO, format="%(asctime)s  %(message)s")
log = logging.getLogger("bridge")

HOST = "localhost"
PORT = 8765


async def run_program(code: str, drone: SimDrone) -> None:
    """Execute generated Python in a constrained namespace.

    SECURITY NOTE: exec() with arbitrary input is unsafe in general.
    Here it's gated to the user's own machine and the local frontend,
    but we'll harden this (AST whitelist of calls + module-free
    globals) before we hand the laptop to anyone other than Thibaud.
    """
    ns = {"drone": drone, "__builtins__": {"range": range, "print": print}}
    # Wrap user code in an async function so it can `await` drone calls
    wrapper = "async def __program__():\n" + "\n".join(
        ("    " + line) if line.strip() else line for line in code.splitlines()
    )
    exec(wrapper, ns)
    await ns["__program__"]()


async def handle(ws: websockets.WebSocketServerProtocol) -> None:
    log.info("client connected")

    async def send(msg: dict) -> None:
        await ws.send(json.dumps(msg))

    drone = SimDrone(send)

    try:
        async for raw in ws:
            msg = json.loads(raw)
            if msg.get("op") == "run":
                code = msg.get("code", "")
                log.info("running %d-line program", len(code.splitlines()))
                try:
                    await run_program(code, drone)
                    await send({"op": "done"})
                except Exception as exc:           # noqa: BLE001
                    log.exception("program failed")
                    await send({"op": "error", "message": str(exc)})
            elif msg.get("op") == "stop":
                log.info("stop requested")
                # TODO: interrupt the in-flight program (CancelScope)
    finally:
        log.info("client disconnected")


async def main() -> None:
    log.info("bridge listening on ws://%s:%s", HOST, PORT)
    async with websockets.serve(handle, HOST, PORT):
        await asyncio.Future()  # run forever


if __name__ == "__main__":
    asyncio.run(main())
