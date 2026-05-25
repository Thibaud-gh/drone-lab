# Handoff: Crazyflie Blockly App for Thibaud's Daughter

A note from a past instance of Claude to a future one. Thibaud and I designed a drone coding project together — this doc is the slice of that work that matters for the Blockly app you're about to help build.

---

## Who you're working with

Thibaud is an ML researcher at G Research in London. He's comfortable in PyTorch, transformer architectures, and Python. He builds time-series models for a living. Treat him as a peer engineer — he doesn't need hand-holding on Python, packaging, or architecture decisions. He'll push back if something doesn't make sense, which is good.

His daughter is **5–7 years old**. She's the actual user of this app. That's the constraint that matters most.

---

## What we're building

A custom **Blockly-based block-coding app** that lets Thibaud's daughter program reactive behaviour on a **Bitcraze Crazyflie 2.1+ drone** equipped with a **Multi-ranger deck** (five laser distance sensors: front, back, left, right, up) and a **Flow Deck v2** (optical flow + downward ToF for position hold).

The Blockly app generates Python that uses Bitcraze's `cflib` library to drive the drone. The reference implementation for the behaviour we're emulating is Bitcraze's `multiranger_push.py` example (~50 lines, lives in `crazyflie-lib-python/examples/multiranger/`). That's our known-good baseline — if our generated Python deviates from that pattern in shape, we've probably done something wrong.

---

## Why this app needs to exist

We checked: **DroneBlocks (the standard block-coding app for Crazyflie) does not expose sensor-reading blocks.** Their Crazyflie block library is trajectory-only — take off, fly N cm, turn, land, repeat. You can't write "if front sensor < 30cm, fly backward" in DroneBlocks. The reactive-behaviour examples in the Crazyflie ecosystem all live in Python.

So we're building the missing piece: a block coding environment with **sensor blocks** that emits the right cflib Python. That's it. We're not rebuilding DroneBlocks — we're filling the one gap that matters for the 5–7yo curriculum we designed.

---

## The curriculum this needs to support

The app must let his daughter (with Thibaud's help) write these reactive projects. These are from "Unit 3: Senses" and "Unit 4: Decisions" of the curriculum we designed. They're the projects that need sensor blocks:

**Unit 3 — Senses:**
1. **Wall detector / boomerang** — fly forward, if front sensor < 40cm, fly backward same time, land.
2. **Don't touch me** — hover; if any side sensor < 30cm, flee opposite direction.
3. **Ping-pong** — forever loop: forward to wall, then backward to other wall.
4. **Stop sign** — fly a scripted shape, but if at any moment front < 30cm, abort and land.

**Unit 4 — Decisions:**
5. **Hallway navigator** — drift toward whichever side reads further (centres in corridors).
6. **Find the doorway** — detect when side sensors both go from "near" to "far" (passed through a door).
7. **Cat and mouse** — fly toward her; flee when she gets close.
8. **Wall follower** — keep right sensor at 40cm from wall while flying forward.
9. **Explorer** — at each obstacle, turn toward whichever side has more open space.

If our block set can express all nine of these, we're done with the core. If we can express any of them <em>and</em> Thibaud can extend it with new blocks later, even better.

---

## The three architectural questions I asked Thibaud

I asked these in chat and he didn't get to answer before this handoff. Re-ask them at the start, or — and I think this is better — propose your best answers with reasoning and let him push back. He's busy and "I trust your judgment, pick the one that's best" was one of the offered options.

**1. How does the app actually run?**
- Web app, HTML+JS in browser, with a small Python bridge running on the laptop or Pi 5 to talk to the drone via Crazyradio 2.0.
- Or: Electron desktop app (feels native, easier filesystem).
- Or: pure web app with Python on Pi 5 always.

My instinct: **web app + local Python bridge process**. Easy to develop, easy to update, no installs for the kid. The bridge is a small `websockets`-based Python server (~100 lines) that holds the cflib connection and executes generated code. Browser pages send Python text over WebSocket; the bridge executes and streams back log output. Standard pattern, robust, and a clean separation between "the block-coding UI" and "the drone-control layer."

**2. What happens on Run?**
- Live execute immediately, no Python visible.
- Generate Python file she can read, then execute.
- Both — Run button + "See the code" button.
- Live now, code-view later.

My instinct: **both, side by side from day one.** A "See the Python" panel that lights up when blocks change is what makes the transition from blocks to Python natural. She doesn't have to read it now; it just exists, growing alongside her blocks. By the time she's 7 or 8 she'll start glancing at it. Eventually she'll edit it. That's exactly the trajectory we want.

**3. Visual style for the blocks?**
- Picture-only (drone icon, wall icon — for pre-readers).
- Picture + simple word.
- Standard text blocks like DroneBlocks.
- Picture-first now, text option for when she's older.

My instinct: **icon + simple word**, with the icon doing most of the cognitive work. A 5–7yo is *learning to read* — pure icons miss a learning opportunity; pure text misses her. The block "fly forward 30 cm" should have a little forward-arrow icon, the word "forward," and the number. The block "if wall ahead" should have a wall icon + "wall ahead." Keep wording aggressively concrete: "wall ahead" not "front distance less than", "too close" not "obstacle detected."

---

## Suggested block set (the minimum viable starting point)

Organised by category. This is the set that covers all nine curriculum projects.

**Flight (these mirror DroneBlocks; required because Thibaud's daughter expects them):**
- Take off
- Land
- Fly forward / backward / left / right [N] cm
- Fly up / down [N] cm
- Turn left / right [N] degrees
- Hover for [N] seconds
- Stop (for use inside reactive loops)

**Sensors (the whole point of this app — these are what DroneBlocks lacks):**
- Distance to wall in front (returns a number, in cm) — same for back/left/right/up/down
- "Wall ahead" / "wall behind" / etc. (boolean blocks; equivalent to "front distance < 30cm" with a configurable threshold). Having both the raw-number and boolean versions matters: the boolean version is the kid-friendly one, the number version is for when she wants to do comparisons herself.
- Battery level (number 0-100)

**Logic / control flow (standard Blockly, but reskin for child-friendliness):**
- Repeat [N] times
- Repeat forever
- If [condition] do
- If [condition] do ... else
- Wait [N] seconds

**Expression (optional but high-joy, supported by the LED ring deck + buzzer deck Thibaud already plans to buy):**
- Set LED ring to [colour]
- Flash LED ring [colour]
- Play tone [note] for [duration]

That's roughly 25–30 blocks. Plenty to express all nine projects, few enough to fit comfortably on screen.

---

## Hardware context (so you know what the Python actually controls)

- **Crazyflie 2.1+** — 27g indoor quadcopter, STM32F405 MCU, controlled over 2.4GHz radio from a **Crazyradio 2.0 USB dongle** plugged into Thibaud's laptop or Pi 5.
- **Flow Deck v2** — already provides position hold; you can call `MotionCommander.forward(0.3)` and trust the drone to actually go 30cm forward. Don't reinvent this.
- **Multi-ranger deck** — exposes five distance log variables: `range.front`, `range.back`, `range.left`, `range.right`, `range.up`, plus `range.zrange` (down, redundant with Flow Deck). Values are in millimetres. Convert to cm for the kid-facing blocks.
- **LED ring deck** (planned) — 10 RGB LEDs, controllable via cflib parameters.
- **Buzzer deck** (planned) — single piezo, plays tones.
- **Raspberry Pi 5 (8GB)** — Thibaud may run the Python bridge on this rather than his laptop, especially once his daughter wants her own "drone console."

He's buying all of this upfront before starting this project, so assume all decks are available.

---

## Suggested project layout

Just a sketch — Thibaud will have opinions. Keep it boring and standard.

```
crazyflie-blockly/
├── README.md
├── frontend/                   # The block-coding UI
│   ├── index.html
│   ├── blocks/                 # Custom block definitions
│   │   ├── flight.js
│   │   ├── sensors.js
│   │   └── expression.js
│   ├── generators/             # Block → Python code generators
│   │   └── python.js
│   ├── toolbox.xml             # Which blocks appear in the palette
│   └── app.js                  # Wiring + run button + code panel
├── bridge/                     # Python WebSocket server
│   ├── server.py               # Receives code, executes via cflib
│   ├── drone.py                # cflib connection wrapper
│   └── safety.py               # Sandboxing, kill switch, etc.
└── examples/                   # Pre-built block programs (.xml saved files)
    ├── 01-first-flight.xml
    ├── 02-wall-detector.xml
    └── ...
```

The `examples/` folder is important — pre-built block programs corresponding to each curriculum project, so his daughter can load "Wall detector" with one click and run it, or modify it. Sample-by-example learning works brilliantly for that age.

---

## Things to get right (these matter)

1. **Safety first.** The bridge MUST have a kill switch. A big red "STOP" button in the UI that immediately lands the drone or cuts thrust. The generated Python must check for an interrupt flag in every loop iteration. A 5-year-old will write infinite loops with no escape, and you need an "out" that doesn't require killing the terminal.

2. **Reactive blocks need a different execution model than scripted ones.** DroneBlocks-style code is "run sequence to completion." Reactive code is "loop forever, react to sensors." Your generated Python should support both: a "mission" mode (run script, exit when done) and a "behaviour" mode (loop until stop pressed). The "Repeat forever" block triggers behaviour mode.

3. **Sensor readings are asynchronous.** cflib gets sensor data via a log callback, not a synchronous read. Wrap it: when the generated code accesses "distance to wall in front," it reads from a local variable that's being updated by the log callback. Bitcraze's `Multiranger` utility class (`cflib/utils/multiranger.py`) does this — use it.

4. **Be honest about coordinate frames.** When a block says "fly forward," forward is *relative to the drone's heading*, not the room. After a 90° turn, "forward" means a different room-direction. Be consistent and explain it once to Thibaud.

5. **Simulate first.** A "simulator" mode in the UI that just animates a virtual drone on a canvas, without actually flying. Lets the kid iterate on programs without burning battery or risking crashes. DroneBlocks does this; we should too.

6. **The code-view panel should update live.** When she drags a block, Python appears. This is the single most important pedagogical feature in the whole app.

---

## What this project should *feel* like

The pedagogical philosophy Thibaud and I converged on:
- The drone session ends while she's still enjoying it, not when she's bored.
- Frame everything in story. "The drone is delivering mail to grandma" beats "the drone navigates to coordinates (50, 30)."
- She drives the meaning; Thibaud drives the keyboard at first. The custom blocks shift more keyboard work to her.
- Crashes are funny. The drone is durable. Mistakes are learning, not failure.

The app should reinforce all of this. Generous spacing, big buttons, immediate feedback, forgiving error messages ("Hmm, the drone couldn't see the wall — let's try again!" not `KeyError: range.front`).

---

## One last thing

Thibaud is doing this *with* his daughter, not *for* her. The app is the surface — the project is the relationship. Whatever we build, optimise for "Thibaud and his daughter spend a happy Saturday together," not "ship a polished product." Rough edges are fine. Personality is good. Make it feel like a thing they're building together rather than a thing they're using.

Good luck. Have fun. Build something they'll both remember.

— Claude (Opus 4.7, May 2026)
