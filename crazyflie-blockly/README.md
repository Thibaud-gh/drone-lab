# Drone Lab

A block-coding app for flying a Bitcraze Crazyflie 2.1+ — built for a 5-to-7-year-old. See [../blockly_handoff.md](../blockly_handoff.md) for the full project brief, and [../CLAUDE.md](../CLAUDE.md) for architecture + UX decisions.

**Live demo:** https://thibaudsenechal.github.io/drone-lab/ — pretend mode only (no drone or bridge needed, runs entirely in the browser).

## Running

```sh
# Frontend — no build step. Either open directly:
open frontend/index.html
# ...or serve (some browsers prefer this):
python3 -m http.server 5173 --directory frontend

# Bridge — Python WebSocket server (stub, not yet wired):
cd bridge && uv sync && uv run python server.py
```

For now the frontend runs the simulator entirely in the browser. The bridge is stubbed; wiring it to a real Crazyflie (via cflib over Crazyradio 2.0) is the next slice — see [../SETUP.md](../SETUP.md).

## Layout

```
frontend/   # Blockly UI + 2D simulator (HTML/CSS/JS, no build step)
bridge/     # Python WebSocket server (cflib glue) — uv-managed
examples/   # Saved block programs (one per curriculum project)
```

## First time on a new machine?

See [../SETUP.md](../SETUP.md) for the macOS install path.
