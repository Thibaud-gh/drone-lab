# 🚁 Drone Lab

**A free, no-account, no-ads coding game that teaches young kids (≈5–7) to program — by flying a drone.**

Kids snap together friendly picture-blocks; the app turns them into real Python and flies a drone through little challenges. It starts in an in-browser simulator and is built to fly a real **Bitcraze Crazyflie 2.1+** when you have one — the same blocks, the same code.

### ▶ [**Play it now**](https://thibaud-gh.github.io/drone-lab/)

No install, no sign-up, nothing to download. It runs entirely in your browser.

[![Drone Lab — snap blocks together and watch the drone fly](docs/preview.gif)](https://thibaud-gh.github.io/drone-lab/)

---

## Why this exists

I'm building this **with my daughter** on Saturday mornings to teach her to code. The drone is the fun part; the real goal is the core ideas underneath — giving a machine a sequence of steps, planning a route ahead of time, navigating in 3D, repeating actions with loops, and reacting to the world with sensors. Each challenge introduces one of those ideas through play, and the "I wrote that, and it *did* something!" moment does the teaching.

What makes it click is that the blocks are **real code, not pretend**. Today they fly a drone in the simulator; with a Bitcraze Crazyflie 2.1+ on the desk, the *exact same blocks* fly the *exact same drone* across your living-room floor. That leap — from "it works on screen" to "it's flying for real because of what I built" — is the whole point.

It'll always be free, with no ads and no account. If other families enjoy it too, that's more than enough.

## What kids learn

The levels add **one idea at a time**, and crashes are funny, not failures:

- **Move & land** — code makes the drone go.
- **Turning** — directions and sequence.
- **Pick up & deliver** — keeping track of a goal.
- **Over & under** — flying in 3D.
- **Escape the walls** — combining skills.
- **Many paths** — there's more than one right answer.
- **Loops** — "do the same thing again and again."
- **Sensors** — the drone *reacts*: fly until it senses a wall.
- **Sandbox** — every block unlocked, to invent your own flights.

A drawer quietly shows the **real Python** the blocks generate, growing alongside what the kid builds — so the jump from blocks to text feels natural when they're ready.

## For grown-ups / tinkerers

- Plain HTML/CSS/JS, **no build step** — open `crazyflie-blockly/frontend/index.html` or serve it with `python3 -m http.server`.
- The browser runs a local simulator; a small Python bridge (`crazyflie-blockly/bridge/`) will fly a real Crazyflie over `cflib` when the hardware's connected.
- Architecture, design decisions, and how to extend it: [CLAUDE.md](CLAUDE.md).
- Local dev setup (macOS): [SETUP.md](SETUP.md).

## Hardware (optional)

The simulator needs nothing. To fly for real later: a **Crazyflie 2.1+** with a **Flow Deck v2** (position hold) and a **Multi-ranger deck** (distance sensors), driven from a **Crazyradio 2.0** dongle.

---

*Made with love, for a happy Saturday. 🛸*
