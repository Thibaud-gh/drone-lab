# Drone Lab — local development setup (macOS)

From a fresh macOS machine to a working dev environment.

> **Track any deviation** (errors hit, workarounds applied) in the [Known issues](#known-issues) section at the bottom — anyone else who tries this should be able to follow line-by-line.

---

## 0. Prerequisites (once per machine)

```sh
xcode-select --install                               # C/C++ toolchain (cflib has some native bits)
brew install uv git                                  # Python env manager + git (if missing)
```

[`uv`](https://github.com/astral-sh/uv) manages the bridge's Python environment.

---

## 1. Install the bridge's Python environment

```sh
cd ~/projects/Drone/crazyflie-blockly/bridge        # or wherever you cloned this repo
uv sync
```

`uv` reads `pyproject.toml`, creates `.venv/`, and installs:

- `cflib` — from git (PyPI's release lags). The library that drives the real Crazyflie.
- `websockets` — protocol between the browser and the bridge.

---

## 2. Run the bridge (not yet wired to the UI)

```sh
cd ~/projects/Drone/crazyflie-blockly/bridge
uv run python server.py
```

Eventually the frontend connects to this in **real drone** mode. For now it's a stub.

---

## Quick reference

| Terminal | What's running | Command |
| --- | --- | --- |
| 1 | Drone Lab bridge | `uv run python server.py` (from `bridge/`) |
| 2 | Frontend (static server) | `python3 -m http.server 5173 --directory crazyflie-blockly/frontend` |

When the real drone arrives, set the URI to `radio://0/80/2M/E7E7E7E7E7` (with the Crazyradio 2.0 dongle plugged in) and that's the only change.

Until then, the bridge talks to a `MockDrone` that logs calls without connecting to anything — enough to validate the bridge protocol and the frontend integration. `CrazyflieDrone` is written against cflib's documented API and gets exercised the first time the radio is plugged in.

---

## Known issues

> macOS-specific patches and workarounds.

- *(none currently)*
