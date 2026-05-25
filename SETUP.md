# Drone Lab — local development setup (macOS)

This is the one-shot install path from a fresh macOS machine to a working dev environment, including the **CrazySim** software-in-the-loop simulator so you can develop the bridge without owning a Crazyflie.

> **Status:** Linux is the well-trodden path for CrazySim; macOS is unofficial. We'll patch any rough edges and write the fix back into this file as we hit them. **Track every deviation here.** Anyone else who tries this should be able to follow line-by-line.

---

## 0. Prerequisites (once per machine)

```sh
xcode-select --install                              # C/C++ toolchain
brew install cmake uv git                            # build system, Python env manager, git (if missing)
```

- `cmake` builds the SITL firmware
- [`uv`](https://github.com/astral-sh/uv) manages the bridge's Python environment

---

## 1. Clone CrazySim beside this repo

CrazySim is a substantial native project (firmware + simulator). It lives **outside** this repo, as a sibling directory. The bridge only depends on its UDP API — no source-level coupling.

```sh
cd ~/projects                                        # or wherever this repo lives
git clone https://github.com/gtfactslab/CrazySim.git --recursive
```

After this you should have:

```
~/projects/
├── Drone/          ← this repo
└── CrazySim/       ← cloned just now
```

---

## 2. Build the SITL firmware

This compiles the actual Crazyflie firmware as a native executable that runs on your laptop instead of being flashed to a real STM32. Same code path the real drone runs — that's why testing against this is meaningful.

```sh
cd ~/projects/CrazySim/crazyflie-firmware
mkdir -p sitl_make/build && cd $_
cmake ..
make all -j8
```

> **macOS rough-edge log:** the firmware is primarily tested on Linux. Record any `make` failures + workarounds in the [Known issues](#known-issues) section below.

---

## 3. Install the bridge's Python environment

```sh
cd ~/projects/Drone/crazyflie-blockly/bridge
uv sync
```

`uv` reads `pyproject.toml`, creates `.venv/`, and installs:

- `cflib` — from git (PyPI's release lags behind CrazySim's UDP backend)
- `websockets` — the protocol between the browser and the bridge
- `mujoco` — physics engine (Python bindings)
- `numpy` — used by both cflib and mujoco

---

## 4. Smoke-test the cflib → CrazySim connection

First launch CrazySim in **terminal 1** and leave it running. A MuJoCo window opens with a virtual Crazyflie hovering above a ground plane.

```sh
cd ~/projects/CrazySim/crazyflie-firmware
bash tools/crazyflie-simulation/simulator_files/mujoco/launch/sitl_singleagent.sh \
    -m cf2x_T350 -x 0 -y 0
```

Then in **terminal 2**, verify cflib can talk to it:

```sh
cd ~/projects/Drone/crazyflie-blockly/bridge
uv run python -c "
import cflib.crtp
from cflib.crazyflie.syncCrazyflie import SyncCrazyflie
cflib.crtp.init_drivers()
with SyncCrazyflie('udp://127.0.0.1:19850') as scf:
    print('connected:', scf.cf.link_uri)
"
```

If you see `connected: udp://127.0.0.1:19850` — the simulator + cflib are talking. You're done with setup.

---

## 5. Run the Drone Lab bridge (later — not wired to the UI yet)

```sh
cd ~/projects/Drone/crazyflie-blockly/bridge
uv run python server.py
```

This will eventually be the WebSocket server the frontend connects to in **real drone** mode. For now it's a stub.

---

## Quick reference

| Terminal | What's running | Command |
| --- | --- | --- |
| 1 | CrazySim (MuJoCo) | `bash sitl_singleagent.sh -m cf2x_T350 -x 0 -y 0` |
| 2 | Drone Lab bridge | `uv run python server.py` |
| 3 | Frontend (any static server) | `python3 -m http.server 5173 --directory crazyflie-blockly/frontend` |

CrazySim URI: `udp://127.0.0.1:19850`. Real drone URI: `radio://0/80/2M/E7E7E7E7E7`. Only this string differs.

---

## Known issues

> Add macOS-specific patches and workarounds here as we hit them.

- *(none yet)*
