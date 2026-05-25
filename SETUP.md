# Drone Lab — local development setup (macOS)

This is the one-shot install path from a fresh macOS machine to a working dev environment, including the **CrazySim** software-in-the-loop simulator so you can develop the bridge without owning a Crazyflie.

> **Status:** Linux is the well-trodden path for CrazySim; macOS is unofficial. We'll patch any rough edges and write the fix back into this file as we hit them. **Track every deviation here.** Anyone else who tries this should be able to follow line-by-line.

---

## 0. Prerequisites (once per machine)

```sh
xcode-select --install                              # C/C++ toolchain
brew install cmake uv git pkg-config                 # build system, Python env manager, git, cmake helper
```

- `cmake` + `pkg-config` build the SITL firmware (pkg-config is needed by CrazySim's CMakeLists)
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

## 2. Build the SITL firmware — **not viable natively on macOS**

> The Crazyflie firmware uses GCC/ELF-only `__attribute__((section(...)))` for its parameter and log registration, plus a custom `log_param_linker.ld` script that only works with GNU `ld`. Apple Clang on macOS uses Mach-O object files which require a different section-attribute syntax (`__SEGMENT,__section`) and a completely different linker. Porting this would take days and diverge us from upstream.
>
> **Use one of the workarounds in section 2.5 instead.**

For reference, on **Linux** the build is:
```sh
cd ~/projects/CrazySim/crazyflie-firmware
mkdir -p sitl_make/build && cd $_
cmake ..
make all -j8
```

---

## 2.5. Workarounds on macOS — pick one

| Option | Fidelity | Setup cost | Visual feedback |
|---|---|---|---|
| **A. Docker (headless CrazySim)** | High — real firmware, real cflib | ~30 min | None (cflib log telemetry only) |
| **B. OrbStack / UTM Linux VM** | High — real firmware + MuJoCo viewer | ~1 hour | Yes, GUI passthrough |
| **C. Skip simulator, MockDrone in Python** | Low — wrapper-level only, not real firmware | minutes | None |

Recommendation: **B (OrbStack)** if you want to see a virtual drone fly; **A (Docker)** if you just want cflib parity; **C** if neither is worth the time right now.

Concrete steps for each option will land in this file as we pick one and walk through it.

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

> macOS-specific patches and workarounds.

- **`cmake ..` fails with `Could NOT find PkgConfig`.** Fix: `brew install pkg-config`. (Now in step 0 prereqs.)
- **`make all` fails with `argument to 'section' attribute is not valid for this target: mach-o section specifier requires a segment and section separated by a comma`.** Root cause: Crazyflie firmware uses GCC ELF-only `__attribute__((section(".param.NAME")))` macros (`PARAM_GROUP_START`, `LOG_GROUP_START`, etc.) + a custom GNU-ld linker script (`sitl_make/log_param_linker.ld`). Mach-O / Apple Clang require different syntax. **Not patchable in a reasonable time** — use the workarounds in section 2.5.
