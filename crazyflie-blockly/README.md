# Drone Lab

A block-coding app for flying a Bitcraze Crazyflie 2.1+ — built for a 5-to-7-year-old. See [../blockly_handoff.md](../blockly_handoff.md) for the full project brief.

## Running

```sh
# 1. Open the frontend (no build step)
open frontend/index.html

# 2. Later — the Python bridge that talks to the real drone
pip install -r bridge/requirements.txt
python bridge/server.py
```

For now the frontend runs the simulator entirely in the browser. The bridge is stubbed and not wired in yet.

## Layout

```
frontend/   # Blockly UI + 2D simulator
bridge/     # Python WebSocket server (cflib glue)
examples/   # Saved block programs (one per curriculum project)
```
