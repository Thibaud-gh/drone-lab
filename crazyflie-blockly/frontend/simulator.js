/* Drone Lab — 2D top-down simulator
   ---------------------------------------------------------
   SimDrone implements the same surface area as the real
   CrazyflieDrone will, so the generated code is identical
   in both modes. Animations are awaitable so the generated
   JS (await drone.forward(30)) reads sequentially.

   State is stored in **cm relative to home**. Drawing
   converts cm→px at render time using the current canvas
   dimensions × the current zoom factor — so browser zoom
   and the in-canvas +/- zoom buttons both just work without
   touching stored state.
   ========================================================= */

const PX_PER_CM = 3.2;             // base canvas scale at zoom 1.0
const CM_PER_UNIT = 30;             // 1 unit (kid-facing) = 30 cm in the world
const HOME_BOTTOM_INSET = 70;       // px from canvas bottom edge where the drone sits at home
const ALTITUDE_PX_PER_CM = 52 / 90; // shared between drone-lift and obstacle perspective
const DRONE_RADIUS_CM = 8;          // for collision — crash when the drone's edge meets the obstacle's edge
const WALL_AHEAD_CM = 15;           // "wall ahead" trips ~half a unit before the wall face
const SENSE_RANGE_CM = 30;          // the kid-facing sensor "sees" one block ahead
const UNTIL_MAX_UNITS = 25;         // fly-until fails past this — never fly forever
const BARRIER_LIFT_CM = 24;         // fixed slab lift for solid "can't fly over" barriers

function pluralUnits(n) {
  return n === 1 ? '1 unit' : `${n} units`;
}

// Ray vs axis-aligned box. Origin (ox,oy), unit direction (dx,dy), box
// [minX..maxX]×[minY..maxY]. Returns the forward distance to the first
// hit (≥ 0), or null if the ray misses. (dx,dy) must be unit length so
// the returned t is a distance in the same units as the coords.
function rayBoxDistance(ox, oy, dx, dy, minX, maxX, minY, maxY) {
  let tmin = -Infinity, tmax = Infinity;
  if (Math.abs(dx) < 1e-9) {
    if (ox < minX || ox > maxX) return null;
  } else {
    let t1 = (minX - ox) / dx, t2 = (maxX - ox) / dx;
    if (t1 > t2) { const s = t1; t1 = t2; t2 = s; }
    tmin = Math.max(tmin, t1); tmax = Math.min(tmax, t2);
  }
  if (Math.abs(dy) < 1e-9) {
    if (oy < minY || oy > maxY) return null;
  } else {
    let t1 = (minY - oy) / dy, t2 = (maxY - oy) / dy;
    if (t1 > t2) { const s = t1; t1 = t2; t2 = s; }
    tmin = Math.max(tmin, t1); tmax = Math.min(tmax, t2);
  }
  if (tmax < tmin || tmax < 0) return null;
  return tmin >= 0 ? tmin : 0;
}

// Turn easing with personality: a tiny wind-up the other way, then the
// swing, with a small overshoot that settles exactly on the 90°. Heading
// overshoot is collision-safe (unlike position overshoot, which could
// clip a wall the kid legitimately stopped next to).
function turnEase(t) {
  if (t < 0.2) return -0.07 * Math.sin((t / 0.2) * Math.PI / 2);
  const s = (t - 0.2) / 0.8;
  const k = 0.8;
  const back = 1 + (k + 1) * Math.pow(s - 1, 3) + k * Math.pow(s - 1, 2);
  return -0.07 + 1.07 * back;
}

// Drone "home" — bottom-centre of the canvas in pixels. Cached on each
// _draw call since it depends on canvas size.
function droneHomeXY(canvas, level) {
  const w = canvas._cssW || canvas.width;
  const h = canvas._cssH || canvas.height;
  // Per-level horizontal anchor: 0 = left edge, 1 = right edge, default = centre.
  const xFrac = (level && typeof level.home_x_frac === 'number') ? level.home_x_frac : 0.5;
  // Per-level bottom inset (px). Levels with a tall vertical extent can
  // push the drone up a bit so the corridor doesn't run off the top.
  const yInset = (level && typeof level.home_y_inset_px === 'number')
    ? level.home_y_inset_px : HOME_BOTTOM_INSET;
  return { x: w * xFrac, y: h - yInset };
}

class SimDrone {
  constructor(canvas, hudEls) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.hud = hudEls; // { height, status, statusText, statusBox }
    this._zoom = 1.0;
    this._panX = 0;
    this._panY = 0;
    this.reset();

    this._lastT = performance.now();
    this._rotorAngle = 0;
    this._stopped = false;
    this._loop();
  }

  reset() {
    this.x_cm = 0;                  // cm relative to home
    this.y_cm = 0;
    this.heading = -Math.PI / 2;    // facing "north" on the canvas
    this.height = 0;                // cm — name preserved for HUD code
    this.flying = false;
    this._rotorSpeed = 0;
    this._stopped = false;
    this._lastError = null;
    // Each reset bumps the generation; in-flight tweens read this and bail
    // without writing state. This is how mid-flight reset works cleanly.
    this._gen = (this._gen ?? 0) + 1;
    // Set of zone indices the drone has landed inside (for pickup levels).
    // Persists across the whole flight; cleared only on reset.
    this._pickedUpZones = new Set();
    this._untilStart = null;   // origin of the current fly-until (for distanceGone)
    // Face + crash theater. The face normally derives from `flying`
    // (neutral on the ground, happy in the air) so real-drone mode gets it
    // for free; events set an override (dizzy / confused / win) that
    // persists until the next reset. `_crash` holds the timestamp + tilt
    // direction of a PHYSICAL crash — all the tumble/dust/stars animation
    // is computed from elapsed time in _draw, never from tweens, so the
    // _gen cancellation pattern is untouched.
    this._faceOverride = null;
    this._crash = null;
    this._win = null;
    this._blinkOffset = Math.random() * 4000;
    // Sensor-beam state: wallAhead() stamps each read so _draw can show
    // the sense cone exactly while the program is looking (and nothing
    // else — a "gone N units" leg never reads the sensor, so no beam).
    this._senseAt = null;
    this._senseDist = Infinity;
    this._ping = null;
    this._dust = null;       // one short ground puff on takeoff / touchdown
    // Visual lean spring (forward "pitch") — underdamped, integrated in
    // _loop, applied as a squash in _drawDrone. Target is set by the
    // forward moves; the release wobble is the overshoot-settle feel.
    this._leanTarget = 0;
    this._leanX = 0;
    this._leanV = 0;
    window.DroneSound?.stopAll();
    this._setStatus('ready when you are', 'idle');
    this._updateHud();
    this._trail = [];
  }

  // Set the current level. Stored so _draw can render zones.
  setLevel(level) {
    this._level = level;
  }

  // Set the canvas zoom factor. 1.0 is the base scale; higher = bigger
  // distances on the canvas. Trail/zones/grid scale with this; the drone
  // marker stays a constant pixel size (map-marker convention).
  setZoom(z) {
    this._zoom = Math.max(0.4, Math.min(2.5, z));
  }

  // Pan offset in canvas pixels — added to the home position when
  // converting cm → px. Lets the kid drag the canvas around.
  setPan(x, y) {
    this._panX = x;
    this._panY = y;
  }
  panBy(dx, dy) {
    this._panX += dx;
    this._panY += dy;
  }

  stop() { this._stopped = true; }

  // Set when a flight rule is broken (e.g. forward without takeoff). Persists
  // through the rest of the program so the kid sees a single clear message
  // at the end, not the last successful step. Rule errors get a confused
  // face — the drone didn't hit anything, it just doesn't understand.
  _fail(msg) {
    this._lastError = msg;
    this._faceOverride = 'confused';
    this._setStatus(msg, 'stopped');
  }

  // A PHYSICAL crash (wall / beam / barrier / floor) — unlike a rule error
  // it gets the full slapstick: rotors cut, the drone tips over, falls out
  // of the sky, dust puffs, dizzy stars. Crashes are funny; rule errors
  // are just confusing.
  _crashFail(msg) {
    if (this._lastError) return;
    this._fail(msg);
    this._faceOverride = 'dizzy';
    this._rotorSpeed = 0;
    this._crash = {
      at: performance.now(),
      dir: Math.random() < 0.5 ? -1 : 1,   // which way it tips
    };
    window.DroneSound?.crash();
  }

  // Sim-only visual: lets app.js light up the face on a win. Not part of
  // the Drone driver surface — nothing kid-codeable maps to it.
  setFace(name) {
    this._faceOverride = name;
  }

  // Sim-only visual: the on-canvas win celebration — happy hop, one
  // pirouette, a sparkle burst from the drone, sage ripples rolling out
  // from the landing spot, and the pad breathing. Fired by app.js right
  // before the win stamp; time-driven from _draw and cleared by reset(),
  // same pattern as the crash theater.
  celebrate() {
    this._faceOverride = 'win';
    this._win = { at: performance.now() };
    window.DroneSound?.win();
  }

  // Collision against wall/beam zones, evaluated against the drone's
  // current (x_cm, y_cm, height). Returns true if a crash was triggered
  // so the caller can short-circuit the rest of its work.
  _checkCrash() {
    if (this._lastError) return true;
    if (!this._level || !this._level.zones?.length) return false;
    for (const z of this._level.zones) {
      // Expand the obstacle's half-bounds by the drone's radius so a
      // crash fires the moment the drone's BODY touches the obstacle,
      // not when its center has already crossed in.
      const hw = (z.w_cm ?? 30) / 2 + DRONE_RADIUS_CM;
      const hh = (z.h_cm ?? 30) / 2 + DRONE_RADIUS_CM;
      const inX = Math.abs(this.x_cm - (z.x_cm ?? 0)) <= hw;
      const inY = Math.abs(this.y_cm - (z.y_cm ?? 0)) <= hh;
      if (!inX || !inY) continue;
      // Barrier: a solid, full-height wall you cannot fly over at ANY
      // altitude — touching its footprint is always a crash.
      if (z.kind === 'barrier') {
        this._crashFail("ouch — that wall is too tall to fly over!");
        return true;
      }
      // Strict: at the wall's height (or below) → touches its top; at the
      // beam's height (or above) → touches its underside. Either is a crash.
      if (z.kind === 'wall' && this.height <= (z.over_height_cm ?? 30)) {
        this._crashFail('ouch — you needed to fly higher over the wall!');
        return true;
      }
      if (z.kind === 'beam' && this.height >= (z.under_height_cm ?? 60)) {
        this._crashFail('ouch — you needed to fly lower under the beam!');
        return true;
      }
    }
    return false;
  }

  // ---- cm → pixel helpers --------------------------------------------

  _pxX(x_cm) {
    return droneHomeXY(this.canvas, this._level).x + this._panX + x_cm * PX_PER_CM * this._zoom;
  }
  _pxY(y_cm) {
    return droneHomeXY(this.canvas, this._level).y + this._panY + y_cm * PX_PER_CM * this._zoom;
  }

  // -----------------------------------------------------
  // Drone API (mirrors what CrazyflieDrone will expose)
  // -----------------------------------------------------

  async takeoff() {
    if (this._stopped || this._lastError) return;
    const gen = this._gen;
    if (this.flying) {
      this._fail("already in the air — no need to take off again!");
      return;
    }
    this.flying = true;
    this._setStatus('taking off', 'flying');
    this._dustPuff();   // rotor wash kicks up the ground
    await this._tween(this.height, 30, 800, (v) => {
      this.height = v;
      this._checkCrash();
    }, () => this._rotorSpeed = 30);
    if (gen !== this._gen) return;
    this._rotorSpeed = 20;
  }

  async land() {
    if (this._stopped || this._lastError) return;
    const gen = this._gen;
    if (!this.flying) {
      this._fail("can't land — the drone is already on the ground!");
      return;
    }
    this._setStatus('landing', 'flying');
    await this._tween(this.height, 0, 900, (v) => {
      this.height = v;
      this._checkCrash();
    });
    if (gen !== this._gen) return;
    this.flying = false;
    this._rotorSpeed = 0;
    this._dustPuff();   // touchdown puff
    // If we landed inside any pickup zone, remember it — pickup-and-deliver
    // levels read this in evaluateWin to confirm the package was collected.
    if (this._level?.zones?.length) {
      this._level.zones.forEach((z, i) => {
        if (z.kind !== 'pickup') return;
        const hw = (z.w_cm ?? 30) / 2;
        const hh = (z.h_cm ?? 30) / 2;
        if (Math.abs(this.x_cm - (z.x_cm ?? 0)) <= hw &&
            Math.abs(this.y_cm - (z.y_cm ?? 0)) <= hh) {
          this._pickedUpZones.add(i);
        }
      });
    }
  }

  async forward(units) {
    if (this._stopped || this._lastError) return;
    const gen = this._gen;
    if (!this.flying) {
      this._fail("can't fly forward — take off first!");
      return;
    }
    const cm = units * CM_PER_UNIT;
    this._setStatus(`flying forward ${pluralUnits(units)}`, 'flying');
    const startXcm = this.x_cm, startYcm = this.y_cm;
    const dx_cm = Math.cos(this.heading) * cm;
    const dy_cm = Math.sin(this.heading) * cm;
    const duration = 30 + cm * 28;
    this._rotorSpeed = 36;
    this._leanTarget = 1;
    await this._tween(0, 1, duration, (t) => {
      if (gen !== this._gen) return;
      this.x_cm = startXcm + dx_cm * t;
      this.y_cm = startYcm + dy_cm * t;
      if (this._checkCrash()) return;
      this._trailMark();
    });
    this._leanTarget = 0;
    if (gen !== this._gen) return;
    this._rotorSpeed = 20;
  }

  // Append the current position to the trail once it has moved ≥2 cm
  // since the last point — faithful corners (the old random sampling
  // clipped them) and bounded memory. Height rides along so the draw
  // pass can fade segments flown up high.
  _trailMark() {
    const last = this._trail[this._trail.length - 1];
    if (last && Math.hypot(this.x_cm - last.x_cm, this.y_cm - last.y_cm) < 2) return;
    this._trail.push({ x_cm: this.x_cm, y_cm: this.y_cm, h: this.height });
    if (this._trail.length > 2000) this._trail.shift();
  }

  // ---- Reactive flight + sensors -------------------------------------

  // Distance (cm) the drone has travelled since the current fly-until
  // started — kid-facing units. Used by the gone_units condition.
  distanceGone() {
    if (this._untilStart == null) return 0;
    return Math.hypot(this.x_cm - this._untilStart.x, this.y_cm - this._untilStart.y) / CM_PER_UNIT;
  }

  // Distance (cm) straight ahead to the nearest wall the drone would hit
  // at its current altitude, or Infinity if the path is clear. Walls
  // shorter than the drone are flown over and ignored.
  _distanceAheadCm() {
    if (!this._level || !this._level.zones?.length) return Infinity;
    const dx = Math.cos(this.heading), dy = Math.sin(this.heading);
    let best = Infinity;
    for (const z of this._level.zones) {
      if (z.kind !== 'wall' && z.kind !== 'barrier') continue;
      // Barriers block at any altitude; plain walls only while we're at
      // or below their top.
      if (z.kind === 'wall' && (z.over_height_cm ?? 30) < this.height) continue;
      const hw = (z.w_cm ?? 30) / 2, hh = (z.h_cm ?? 30) / 2;
      const t = rayBoxDistance(this.x_cm, this.y_cm, dx, dy,
        (z.x_cm ?? 0) - hw, (z.x_cm ?? 0) + hw, (z.y_cm ?? 0) - hh, (z.y_cm ?? 0) + hh);
      if (t != null && t < best) best = t;
    }
    return best;
  }

  // Sensor: true when a wall is close in front (front Multi-ranger).
  // Each read is timestamped so _draw shows the sense beam while the
  // program is actively looking, and the sound engine blips like a
  // parking sensor as the wall gets closer.
  wallAhead() {
    const d = this._distanceAheadCm();
    this._senseAt = performance.now();
    this._senseDist = d;
    window.DroneSound?.sense(d);
    return d <= WALL_AHEAD_CM;
  }

  // Fly forward, polling `predicate()` each frame, stopping when it
  // returns true. Also bails on a crash, a mid-flight reset, or — if the
  // condition never trips — a safety cap that fails the flight rather
  // than flying forever.
  //
  // When a wall lies straight ahead we don't creep up to ~15 cm and then
  // snap onto the grid (that made the drone overshoot the grid line and
  // visibly pop backward). Instead we work out, up front, the grid line in
  // the last clear cell before the wall and stop the drone *exactly* there
  // as it flies past it — so "fly until wall" halts cleanly on a whole unit
  // with no backward jitter. (The leg is a straight axis-aligned line, so
  // one ray-cast at the start is enough.)
  async forwardUntil(predicate) {
    if (this._stopped || this._lastError) return;
    const gen = this._gen;
    if (!this.flying) {
      this._fail("can't fly forward — take off first!");
      return;
    }
    this._setStatus('flying forward…', 'flying');
    this._untilStart = { x: this.x_cm, y: this.y_cm };
    const dx = Math.cos(this.heading), dy = Math.sin(this.heading);
    const SPEED_MAX = 95;  // cm per second, cruising
    const SPEED_MIN = 18;  // arrival creep — slow enough to stop gently
    this._rotorSpeed = 36;

    // Grid line to stop on if there's a wall dead ahead.
    const onX  = Math.abs(dx) >= Math.abs(dy);     // travelling along x?
    const sign = onX ? Math.sign(dx) : Math.sign(dy);
    let gridStop = null;                            // world coord on the travel axis
    const wallDist = this._distanceAheadCm();       // to the wall's near face
    if (Number.isFinite(wallDist)) {
      const startCoord = onX ? this.x_cm : this.y_cm;
      const clearEdge  = startCoord + sign * (wallDist - DRONE_RADIUS_CM);
      gridStop = (sign > 0)
        ? Math.floor(clearEdge / CM_PER_UNIT) * CM_PER_UNIT
        : Math.ceil(clearEdge / CM_PER_UNIT) * CM_PER_UNIT;
      // Only honour it if it's actually ahead of us (never nudge backward).
      const ahead = (sign > 0) ? gridStop >= startCoord : gridStop <= startCoord;
      if (!ahead) gridStop = null;
    }

    let outcome = 'met';
    await new Promise((resolve) => {
      let last = performance.now();
      const step = (now) => {
        if (this._gen !== gen)    { outcome = 'cancel';  resolve(); return; }
        if (this._stopped)        { outcome = 'stopped'; resolve(); return; }
        if (this._lastError)      { outcome = 'crash';   resolve(); return; }
        // Reached the grid line just before a wall? Stop exactly there.
        if (gridStop !== null) {
          const coord = onX ? this.x_cm : this.y_cm;
          if ((sign > 0 && coord >= gridStop) || (sign < 0 && coord <= gridStop)) {
            if (onX) this.x_cm = gridStop; else this.y_cm = gridStop;
            outcome = 'met'; resolve(); return;
          }
        }
        // Stop as soon as the condition is met (checked before advancing).
        let met = false;
        try { met = !!predicate(); } catch (_) { met = true; }
        if (met) { outcome = 'met'; resolve(); return; }
        if (this.distanceGone() >= UNTIL_MAX_UNITS) { outcome = 'toofar'; resolve(); return; }
        const dt = Math.min(0.05, (now - last) / 1000); last = now;
        // Brake on approach: when we know where the leg will stop (a wall
        // ahead → gridStop), ease from cruise down to a gentle creep over
        // the last two blocks, so arriving reads as braking — not as
        // slamming into an invisible wall.
        let v = SPEED_MAX;
        if (gridStop !== null) {
          const remaining = Math.abs(gridStop - (onX ? this.x_cm : this.y_cm));
          v = SPEED_MIN + (SPEED_MAX - SPEED_MIN) * Math.min(1, remaining / 60);
        }
        this._leanTarget = v / SPEED_MAX;   // lean eases off as it brakes
        const adv = v * dt;
        this.x_cm += dx * adv;
        this.y_cm += dy * adv;
        if (this._checkCrash()) { outcome = 'crash'; resolve(); return; }
        this._trailMark();
        requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    });
    this._leanTarget = 0;
    if (this._gen !== gen) return;
    if (outcome === 'toofar') {
      this._fail("the drone kept flying and flying — it never found what it was looking for!");
      return;
    }
    if (outcome === 'met') {
      // "Found it!" — ring + chirp at the nose, but only when the wall
      // sensor was actually being read this leg (beam visible). A gone-N
      // stop ends quietly.
      if (this._senseAt && performance.now() - this._senseAt < 250) {
        this._ping = { at: performance.now() };
        window.DroneSound?.found();
      }
      // Tidy onto the grid. With a wall stop the travel axis is already on a
      // whole unit (so this only cleans up sub-cm drift on the other axis);
      // for a "gone N units" stop it snaps both. Revert if it would crash.
      const snap = (v) => Math.round(v / CM_PER_UNIT) * CM_PER_UNIT;
      const ox = this.x_cm, oy = this.y_cm;
      this.x_cm = snap(ox); this.y_cm = snap(oy);
      if (this._checkCrash()) {
        this._lastError = null;
        this.x_cm = ox; this.y_cm = oy;
        this._setStatus('flying forward…', 'flying');
      }
    }
    this._rotorSpeed = 20;
  }

  async up(units) {
    if (this._stopped || this._lastError) return;
    const gen = this._gen;
    if (!this.flying) {
      this._fail("can't climb — take off first!");
      return;
    }
    const cm = units * CM_PER_UNIT;
    this._setStatus(`climbing ${pluralUnits(units)}`, 'flying');
    this._rotorSpeed = 32;
    await this._tween(this.height, this.height + cm, 30 + cm * 26, (v) => {
      this.height = v;
      this._checkCrash();
    });
    if (gen !== this._gen) return;
    this._rotorSpeed = 20;
  }

  async down(units) {
    if (this._stopped || this._lastError) return;
    const gen = this._gen;
    if (!this.flying) {
      this._fail("can't go down — take off first!");
      return;
    }
    const cm = units * CM_PER_UNIT;
    // Going down far enough to reach the floor is a crash — only `land`
    // brings the drone safely to the ground.
    const hitsFloor = this.height - cm <= 0;
    const target = Math.max(0, this.height - cm);
    this._setStatus(`going down ${pluralUnits(units)}`, 'flying');
    this._rotorSpeed = 24;
    await this._tween(this.height, target, 30 + cm * 26, (v) => {
      this.height = v;
      this._checkCrash();
    });
    if (gen !== this._gen) return;
    if (hitsFloor && !this._lastError) {
      this._crashFail('crash! the drone fell to the floor — use land to come down gently!');
      return;
    }
    this._rotorSpeed = 20;
  }

  async turn_left() {
    if (this._stopped || this._lastError) return;
    const gen = this._gen;
    if (!this.flying) {
      this._fail("can't turn — take off first!");
      return;
    }
    this._setStatus('turning left', 'flying');
    const start = this.heading;
    const target = start - Math.PI / 2;
    this._rotorSpeed = 28;
    await this._tween(0, 1, 450, (t) => {
      if (gen !== this._gen) return;
      this.heading = start + (target - start) * turnEase(t);
    });
    if (gen !== this._gen) return;
    this._rotorSpeed = 20;
  }

  async turn_right() {
    if (this._stopped || this._lastError) return;
    const gen = this._gen;
    if (!this.flying) {
      this._fail("can't turn — take off first!");
      return;
    }
    this._setStatus('turning right', 'flying');
    const start = this.heading;
    const target = start + Math.PI / 2;
    this._rotorSpeed = 28;
    await this._tween(0, 1, 450, (t) => {
      if (gen !== this._gen) return;
      this.heading = start + (target - start) * turnEase(t);
    });
    if (gen !== this._gen) return;
    this._rotorSpeed = 20;
  }

  // -----------------------------------------------------
  // Internals
  // -----------------------------------------------------

  _tween(from, to, duration, onUpdate, onStart) {
    return new Promise((resolve) => {
      if (onStart) onStart();
      const startGen = this._gen;
      const start = performance.now();
      const step = (now) => {
        if (this._gen !== startGen) { resolve(); return; }
        if (this._stopped) { onUpdate(to); resolve(); return; }
        if (this._lastError) { resolve(); return; }    // crash detected
        const t = Math.min(1, (now - start) / duration);
        const eased = t < 0.5 ? 2*t*t : 1 - Math.pow(-2*t + 2, 2) / 2;
        onUpdate(from + (to - from) * eased);
        if (this._lastError) { resolve(); return; }    // onUpdate just set it
        if (t < 1) requestAnimationFrame(step);
        else resolve();
      };
      requestAnimationFrame(step);
    });
  }

  _setStatus(text, mode) {
    if (!this.hud) return;
    this.hud.statusText.textContent = text;
    this.hud.statusBox.classList.toggle('is-flying',  mode === 'flying');
    this.hud.statusBox.classList.toggle('is-stopped', mode === 'stopped');
  }

  _updateHud() {
    if (!this.hud) return;
    // height stored in cm; HUD shows units (1 unit = 30 cm). Uses the
    // visual height so the readout falls to 0 with the crash tumble.
    this.hud.height.firstChild.textContent = (this._visualHeight() / CM_PER_UNIT).toFixed(1);
  }

  // Draw-only height: after a crash the drone visually falls out of the
  // sky over ~half a second while the state height stays untouched (the
  // theater never mutates flight state — reset() just clears _crash).
  _visualHeight() {
    if (!this._crash) return this.height;
    const e = performance.now() - this._crash.at;
    const fallT = Math.min(1, Math.max(0, (e - 60) / 450));
    return this.height * (1 - fallT * fallT);
  }

  _loop() {
    const now = performance.now();
    const dt = (now - this._lastT) / 1000;
    this._lastT = now;
    this._rotorAngle += this._rotorSpeed * dt;
    // Integrate the lean spring (clamped dt — rAF can gap when the tab is
    // backgrounded and a huge step would make the spring explode).
    const sdt = Math.min(dt, 0.05);
    this._leanV += (60 * (this._leanTarget - this._leanX) - 8 * this._leanV) * sdt;
    this._leanX += this._leanV * sdt;
    window.DroneSound?.update(this._rotorSpeed);
    this._updateHud();
    this._draw();
    requestAnimationFrame(() => this._loop());
  }

  _draw() {
    const ctx = this.ctx;
    const w = this.canvas._cssW || this.canvas.width;
    const h = this.canvas._cssH || this.canvas.height;

    ctx.clearRect(0, 0, w, h);

    // Crash screen-shake — one short decaying jolt of the whole scene the
    // moment the drone hits something. Deterministic (sin/cos of elapsed),
    // so no per-frame randomness to clean up.
    const crashE = this._crash ? performance.now() - this._crash.at : null;
    const shaking = crashE !== null && crashE < 340;
    if (shaking) {
      const mag = 5 * (1 - crashE / 340);
      ctx.save();
      ctx.translate(Math.sin(crashE * 0.085) * mag,
                    Math.cos(crashE * 0.11) * mag * 0.7);
    }

    // grid — every 30cm (same as the scale bar), so it scales with zoom.
    // Anchored to home + current pan so the grid drifts with the canvas
    // when the kid drags it around.
    ctx.save();
    ctx.strokeStyle = 'rgba(26,42,64,0.07)';
    ctx.lineWidth = 1;
    const step = 30 * PX_PER_CM * this._zoom;
    const home = droneHomeXY(this.canvas, this._level);
    const ox = ((home.x + this._panX) % step + step) % step;
    const oy = ((home.y + this._panY) % step + step) % step;
    ctx.beginPath();
    for (let x = ox; x < w; x += step) { ctx.moveTo(x, 0); ctx.lineTo(x, h); }
    for (let y = oy; y < h; y += step) { ctx.moveTo(0, y); ctx.lineTo(w, y); }
    ctx.stroke();
    ctx.restore();

    // Layered draw, back-to-front, so altitude reads correctly:
    //   floor → trail → walls → drone → beams
    // 1. Floor: target outlines, wall footprints, beam ground-shadows.
    this._drawZonesFloor(ctx);

    // trail — persists until drone.reset() clears it. Drawn in runs of
    // similar altitude: segments flown up high are fainter and thinner,
    // so an over-the-wall hop stays readable in the trail afterwards.
    if (this._trail.length > 1) {
      ctx.save();
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      const bucketOf = (p) => Math.round((p.h ?? 0) / 15);
      let i = 0;
      while (i < this._trail.length - 1) {
        const bucket = bucketOf(this._trail[i]);
        let j = i + 1;
        while (j < this._trail.length && bucketOf(this._trail[j]) === bucket) j++;
        // 0 at cruise height (1 unit) and below → full trail; fades as the
        // run was flown higher (full fade by ~2.5 units).
        const t = Math.min(1, Math.max(0, (bucket * 15 - 30) / 45));
        ctx.strokeStyle = `rgba(231,111,81,${0.55 - t * 0.3})`;
        ctx.lineWidth = (2.5 - t * 0.9) * this._zoom;
        ctx.beginPath();
        ctx.moveTo(this._pxX(this._trail[i].x_cm), this._pxY(this._trail[i].y_cm));
        const end = Math.min(j, this._trail.length - 1);
        for (let k = i + 1; k <= end; k++) {
          ctx.lineTo(this._pxX(this._trail[k].x_cm), this._pxY(this._trail[k].y_cm));
        }
        ctx.stroke();
        i = j;
      }
      ctx.restore();
    }

    // shadow + drone. Shadow stays anchored to the world position; the
    // drone is lifted up the canvas by an amount proportional to altitude.
    // This is the perspective cue that says "it's hovering, not driving".
    const px        = this._pxX(this.x_cm);
    const py_ground = this._pxY(this.y_cm);
    // After a crash the drone visually falls out of the sky (see
    // _visualHeight — draw-only, state height is untouched).
    const visH = this._visualHeight();
    // Same altitude-to-px factor obstacles use, so the drone visually
    // clears a wall when its height >= wall.over_height_cm and is below
    // the beam when its height <= beam.under_height_cm.
    const lift      = visH * ALTITUDE_PX_PER_CM * this._zoom;
    // Win hop — a happy little bounce at the start of the celebration
    // (draw-only px offset, like the crash fall).
    const winE = this._win ? performance.now() - this._win.at : null;
    let hopPx = 0;
    if (winE !== null && winE < 650) {
      hopPx = Math.sin(Math.PI * (winE / 650)) * 14 * this._zoom;
    }
    // Idle hover-bob — a gentle sinusoid while airborne. Fades in with
    // height so takeoff/touchdown don't pop, and a crashed drone lies still.
    let bobPx = 0;
    if (this.flying && !this._crash) {
      bobPx = Math.sin(performance.now() * 0.004) * 2.5 * this._zoom *
              Math.min(1, visH / 20);
    }
    const py_drone  = py_ground - lift - hopPx - bobPx;

    this._drawShadow(ctx, px, py_ground, visH);

    // Ground dust from takeoff / touchdown — floor-level, so before walls.
    this._drawDust(ctx);

    // 2. Walls — solid brick bodies, drawn after the trail but before
    //    the drone, so a drone flying OVER appears in front of them.
    this._drawWalls(ctx);

    // faint dashed tether from the shadow up to the drone — only when
    // we're actually lifted, otherwise it just looks like a stray line
    if (lift > 6) {
      ctx.save();
      ctx.strokeStyle = 'rgba(231,111,81,0.6)';
      ctx.lineWidth = 2;
      ctx.setLineDash([4, 3]);
      ctx.beginPath();
      ctx.moveTo(px, py_ground - 2);
      ctx.lineTo(px, py_drone + 16 * this._zoom);
      ctx.stroke();
      ctx.restore();
    }

    // 3. Beams the drone is NOT under — drawn before it so the drone
    //    (the star) stays visible up high instead of vanishing behind a
    //    beam it hasn't reached.
    this._drawBeams(ctx, false);

    // 3b. Sensor beam — over the walls (the cone visibly touches the slab
    //     it sees) but under the drone. Drawn only while the program is
    //     actively reading the wall sensor; also hosts the found-it ping.
    this._drawSenseBeam(ctx, px, py_drone);

    // 4. Drone marker.
    this._drawDrone(ctx, px, py_drone, visH);

    // 5. Beams the drone is genuinely flying UNDER — drawn after it so
    //    the beam occludes the drone (it's above). See _beamOccludesDrone.
    this._drawBeams(ctx, true);

    // 6. Crash theater on top of everything: impact dust + dizzy stars.
    if (crashE !== null) this._drawCrashFX(ctx, crashE, px, py_ground, py_drone);

    // 6b. Win celebration: landing-spot ripples + sparkle burst.
    if (winE !== null) this._drawWinFX(ctx, winE, px, py_ground, py_drone);

    // 6c. "Found it!" ping — two sage rings expanding from the drone when
    //     a sensed fly-until leg stops at its wall. Drawn over the drone
    //     (and starting outside its body) so it actually reads.
    if (this._ping) {
      for (const delay of [0, 140]) {
        const pt = (performance.now() - this._ping.at - delay) / 550;
        if (pt <= 0 || pt >= 1) continue;
        ctx.save();
        ctx.strokeStyle = `rgba(127,168,119,${0.9 * (1 - pt)})`;
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(px, py_drone, (20 + pt * 34) * this._zoom, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }
    }

    if (visH > 1) this._drawHeightBadge(ctx, px, py_drone, visH);
    if (shaking) ctx.restore();
  }

  // 1st pass — things that live on the floor (target outlines + beam
  // ground-shadows + wall footprint outlines). Drawn before trail/drone
  // so they sit at the back.
  _drawZonesFloor(ctx) {
    if (!this._level || !this._level.zones?.length) return;
    for (const z of this._level.zones) {
      const cx = this._pxX(z.x_cm ?? 0);
      const cy = this._pxY(z.y_cm ?? 0);
      const w  = (z.w_cm ?? 30) * PX_PER_CM * this._zoom;
      const h  = (z.h_cm ?? 30) * PX_PER_CM * this._zoom;
      const kind = z.kind || 'target';
      if      (kind === 'target') this._drawTarget(ctx, cx, cy, w, h, z);
      else if (kind === 'pickup') this._drawPickup(ctx, cx, cy, w, h, z, this._level.zones.indexOf(z));
      else if (kind === 'beam')   this._drawBeamShadow(ctx, cx, cy, w, h);
    }
  }

  // 2nd pass — walls. Drawn after the trail but before the drone, so a
  // drone flying OVER the wall passes visually over (drawn on top).
  //
  // Walls with a matching `group` field are merged into one visual
  // shape (the L6 corridor uses this so the 18 rectangles read as a
  // single staircase, not stacked sticks). Solo walls go through the
  // existing per-wall renderer.
  _drawWalls(ctx) {
    if (!this._level || !this._level.zones?.length) return;
    // Flyable walls (kind 'wall'): solo → labelled cabinet wall, grouped
    // → merged shape, lifted by their own over_height.
    const wallGroups = new Map();
    let soloIdx = 0;
    for (const z of this._level.zones) {
      if (z.kind !== 'wall') continue;
      const gid = z.group ?? `__solo_${soloIdx++}`;
      if (!wallGroups.has(gid)) wallGroups.set(gid, []);
      wallGroups.get(gid).push(z);
    }
    for (const walls of wallGroups.values()) {
      if (walls.length === 1) {
        const z = walls[0];
        const cx = this._pxX(z.x_cm ?? 0);
        const cy = this._pxY(z.y_cm ?? 0);
        const w  = (z.w_cm ?? 30) * PX_PER_CM * this._zoom;
        const h  = (z.h_cm ?? 30) * PX_PER_CM * this._zoom;
        this._drawWall(ctx, cx, cy, w, h, z);
      } else {
        this._drawWallGroup(ctx, walls, walls[0].over_height_cm ?? 30);
      }
    }
    // Barriers (kind 'barrier'): solid, unflyable, no number. Always go
    // through the merged renderer (no label) at a small fixed lift, so
    // they read as solid brick walls regardless of being solo or grouped.
    const barrierGroups = new Map();
    let bSolo = 0;
    for (const z of this._level.zones) {
      if (z.kind !== 'barrier') continue;
      const gid = z.group ?? `__bsolo_${bSolo++}`;
      if (!barrierGroups.has(gid)) barrierGroups.set(gid, []);
      barrierGroups.get(gid).push(z);
    }
    for (const bs of barrierGroups.values()) {
      this._drawWallGroup(ctx, bs, BARRIER_LIFT_CM);
    }
  }

  // Render a group of walls as one merged shape — used by L6's corridor
  // so the staircase reads as a single contiguous wall rather than a
  // pile of overlapping rectangles.
  //
  // Technique ("inflated fill"):
  //   1. For each member rect, fill an inflated version (+2 px on each
  //      side) in the stroke colour. Where two rects abut, the next
  //      rect's fill (step 2) covers its halo and the seam disappears.
  //      Outer edges keep the halo, which becomes the merged outline.
  //   2. Fill each rect at its normal size in the slab colour.
  //   3. Brick texture, clipped to the union, so brick lines span the
  //      whole shape uniformly.
  // No individual posts / footprint / labels per member rect — the
  // shape speaks for itself.
  _drawWallGroup(ctx, walls, liftCm) {
    const heightCm = liftCm ?? (walls[0].over_height_cm ?? 30);
    const liftPx   = heightCm * ALTITUDE_PX_PER_CM * this._zoom;
    const rects = walls.map(z => {
      const cx = this._pxX(z.x_cm ?? 0);
      const cy = this._pxY(z.y_cm ?? 0) - liftPx;
      const w  = (z.w_cm ?? 30) * PX_PER_CM * this._zoom;
      const h  = (z.h_cm ?? 30) * PX_PER_CM * this._zoom;
      return { x: cx - w/2, y: cy - h/2, w, h };
    });

    ctx.save();
    // Halo (outline) — sharp corners so internal seams cancel cleanly.
    const halo = 2;
    ctx.fillStyle = '#5C3A24';
    for (const r of rects) {
      ctx.fillRect(r.x - halo, r.y - halo, r.w + 2*halo, r.h + 2*halo);
    }
    // Slab interior.
    ctx.fillStyle = '#A0704D';
    for (const r of rects) {
      ctx.fillRect(r.x, r.y, r.w, r.h);
    }
    // Brick texture clipped to the union of all member rects.
    ctx.save();
    ctx.beginPath();
    for (const r of rects) ctx.rect(r.x, r.y, r.w, r.h);
    ctx.clip();
    ctx.strokeStyle = 'rgba(92,58,36,0.6)';
    ctx.lineWidth = 1.2;
    const brickH = Math.max(8, 9 * this._zoom);
    const brickW = brickH * 2.5;
    const minX = Math.min(...rects.map(r => r.x));
    const maxX = Math.max(...rects.map(r => r.x + r.w));
    const minY = Math.min(...rects.map(r => r.y));
    const maxY = Math.max(...rects.map(r => r.y + r.h));
    let row = 0;
    for (let y = maxY - brickH; y > minY; y -= brickH, row++) {
      ctx.beginPath();
      ctx.moveTo(minX, y); ctx.lineTo(maxX, y);
      ctx.stroke();
      const startX = (row % 2 === 0) ? minX + brickW / 2 : minX;
      for (let x = startX; x < maxX; x += brickW) {
        ctx.beginPath();
        ctx.moveTo(x, y); ctx.lineTo(x, Math.min(y + brickH, maxY));
        ctx.stroke();
      }
    }
    ctx.restore();
    ctx.restore();
  }

  // True when the beam should paint over the drone. Purely a draw-order
  // cue — the crash rule lives in _checkCrash and is left untouched.
  //
  // Two conditions:
  //  1. the drone is below the beam's underside (at/above it → always on
  //     top; default 60 matches _checkCrash);
  //  2. the drone's icon actually overlaps the lifted slab ON SCREEN.
  // We test screen overlap, not the world footprint, because the slab is
  // drawn high up (lifted by the beam's height) and is far thinner than
  // the drone is tall — a footprint test flips occlusion while their
  // pixels still overlap, popping the drone on top mid-pass. Pixel overlap
  // flips exactly at the slab's edge, so the hand-off is seamless.
  _beamOccludesDrone(z) {
    if (this.height >= (z.under_height_cm ?? 60)) return false;
    const zoom = this._zoom;
    const altRatio = Math.min(1, this.height / 80);
    const dr = 36 * (1 + altRatio * 0.18) * zoom;        // drone icon half-extent
    const px = this._pxX(this.x_cm);
    const py = this._pxY(this.y_cm) - this.height * ALTITUDE_PX_PER_CM * zoom;
    const cx = this._pxX(z.x_cm ?? 0);
    // Slab geometry mirrors _drawBeam (note its `?? 30` default lift).
    const liftPx = ((z.under_height_cm ?? 30) * ALTITUDE_PX_PER_CM + 14) * zoom;
    const ySlab  = this._pxY(z.y_cm ?? 0) - liftPx;
    const halfW  = (z.w_cm ?? 30) * PX_PER_CM * zoom / 2;
    const halfH  = (z.h_cm ?? 30) * PX_PER_CM * zoom / 2;
    return Math.abs(px - cx) <= halfW + dr &&
           Math.abs(py - ySlab) <= halfH + dr;
  }

  // 3rd pass — beams. Drawn around the drone so when it flies UNDER a
  // beam, the beam visually occludes the drone (it's above), but a beam
  // the drone hasn't reached doesn't paint over it up high.
  // `inFront` selects which layer to draw: false = beams behind the drone,
  // true = beams that occlude it (the ones it's genuinely flying under).
  _drawBeams(ctx, inFront) {
    if (!this._level || !this._level.zones?.length) return;
    for (const z of this._level.zones) {
      if (z.kind !== 'beam') continue;
      if (this._beamOccludesDrone(z) !== inFront) continue;
      const cx = this._pxX(z.x_cm ?? 0);
      const cy = this._pxY(z.y_cm ?? 0);
      const w  = (z.w_cm ?? 30) * PX_PER_CM * this._zoom;
      const h  = (z.h_cm ?? 30) * PX_PER_CM * this._zoom;
      this._drawBeam(ctx, cx, cy, w, h, z);
    }
  }

  _drawTarget(ctx, cx, cy, w, h /*, z */) {
    // During a win celebration the pad breathes — the fill swells gently
    // until the next reset.
    let alpha = 0.32;
    if (this._win) {
      alpha = 0.38 + 0.16 * Math.sin((performance.now() - this._win.at) * 0.005);
    }
    ctx.save();
    ctx.fillStyle = `rgba(127,168,119,${alpha})`;
    ctx.strokeStyle = '#5C8657';
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 5]);
    this._roundRect(ctx, cx - w/2, cy - h/2, w, h, 10);
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }

  // Pickup zone — marigold square with a 📦 emoji. When already collected,
  // it fades out so the kid sees the package is gone.
  _drawPickup(ctx, cx, cy, w, h, _z, idx) {
    const collected = idx >= 0 && this._pickedUpZones?.has(idx);
    ctx.save();
    ctx.globalAlpha = collected ? 0.25 : 1;
    ctx.fillStyle = 'rgba(233,180,76,0.32)';
    ctx.strokeStyle = '#B07A18';
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 5]);
    this._roundRect(ctx, cx - w/2, cy - h/2, w, h, 10);
    ctx.fill();
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.font = `${Math.min(w, h) * 0.6}px "Apple Color Emoji", "Segoe UI Emoji", sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('📦', cx, cy);
    ctx.restore();
  }

  // Beam casts a shadow on the floor at its world position. Drawn in
  // the floor pass so trail + drone paint over it naturally. Soft edge
  // faked with an inflated fainter pass (no ctx.filter — see _drawShadow).
  _drawBeamShadow(ctx, cx, cy, w, h) {
    const z = this._zoom;
    ctx.save();
    ctx.fillStyle = 'rgba(26,42,64,0.10)';
    this._roundRect(ctx, cx - w/2 + 2 * z - 3 * z, cy - h/2 + 1 * z - 3 * z,
                    w + 6 * z, h + 6 * z, 8);
    ctx.fill();
    ctx.fillStyle = 'rgba(26,42,64,0.16)';
    this._roundRect(ctx, cx - w/2 + 2 * z, cy - h/2 + 1 * z, w, h, 6);
    ctx.fill();
    ctx.restore();
  }

  // Wall body = a brick slab at the wall's height, mirroring the beam
  // visually (same thickness, just a different texture + label).
  _drawWall(ctx, cx, cy, w, h, z) {
    const heightCm = z.over_height_cm ?? 30;
    const liftPx   = heightCm * ALTITUDE_PX_PER_CM * this._zoom;
    const units    = +(heightCm / CM_PER_UNIT).toFixed(1);
    const ySlabMid = cy - liftPx;

    // brick slab at altitude
    ctx.save();
    ctx.fillStyle = '#A0704D';
    ctx.strokeStyle = '#5C3A24';
    ctx.lineWidth = 2;
    this._roundRect(ctx, cx - w/2, ySlabMid - h/2, w, h, 4);
    ctx.fill();
    ctx.stroke();
    // staggered brick pattern, clipped to the slab
    ctx.save();
    ctx.beginPath();
    this._roundRect(ctx, cx - w/2, ySlabMid - h/2, w, h, 4);
    ctx.clip();
    ctx.strokeStyle = 'rgba(92,58,36,0.6)';
    ctx.lineWidth = 1.2;
    const brickH = Math.max(8, 9 * this._zoom);
    const brickW = brickH * 2.5;
    let row = 0;
    for (let y = ySlabMid + h/2 - brickH; y > ySlabMid - h/2; y -= brickH, row++) {
      ctx.beginPath();
      ctx.moveTo(cx - w/2, y); ctx.lineTo(cx + w/2, y);
      ctx.stroke();
      const startX = (row % 2 === 0) ? cx - w/2 + brickW / 2 : cx - w/2;
      for (let x = startX; x < cx + w/2; x += brickW) {
        ctx.beginPath();
        ctx.moveTo(x, y); ctx.lineTo(x, Math.min(y + brickH, ySlabMid + h/2));
        ctx.stroke();
      }
    }
    ctx.restore();
    // ▲ N label centered on the slab
    ctx.fillStyle = '#FFFBEE';
    ctx.font = `700 ${Math.round(14 * this._zoom)}px "Lexend", system-ui, sans-serif`;
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'center';
    ctx.fillText(`▲ ${units}`, cx, ySlabMid);
    ctx.restore();
  }

  // Beam body = the hazard-striped slab itself, lifted straight up
  // from its world position. The shadow on the floor is drawn in the
  // floor pass (_drawBeamShadow) so the trail and drone paint over
  // it naturally. A faint dashed tether connects the two so the kid
  // reads them as the same thing at different heights.
  _drawBeam(ctx, cx, cy, w, h, z) {
    const heightCm = z.under_height_cm ?? 30;
    const liftPx   = (heightCm * ALTITUDE_PX_PER_CM + 14) * this._zoom;
    const units    = +(heightCm / CM_PER_UNIT).toFixed(1);

    const yShadowMid = cy;
    const ySlabMid   = cy - liftPx;

    // tether dashes from shadow edges up to slab edges
    ctx.save();
    ctx.strokeStyle = 'rgba(26,42,64,0.32)';
    ctx.lineWidth = 1.2;
    ctx.setLineDash([3, 4]);
    ctx.beginPath();
    ctx.moveTo(cx - w/2, yShadowMid);
    ctx.lineTo(cx - w/2, ySlabMid);
    ctx.moveTo(cx + w/2, yShadowMid);
    ctx.lineTo(cx + w/2, ySlabMid);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();

    // the slab itself
    ctx.save();
    ctx.fillStyle = '#F0A93B';
    ctx.strokeStyle = '#1A2A40';
    ctx.lineWidth = 2;
    this._roundRect(ctx, cx - w/2, ySlabMid - h/2, w, h, 4);
    ctx.fill();
    ctx.stroke();
    // hazard stripes
    ctx.save();
    ctx.beginPath();
    this._roundRect(ctx, cx - w/2, ySlabMid - h/2, w, h, 4);
    ctx.clip();
    ctx.strokeStyle = 'rgba(26,42,64,0.42)';
    ctx.lineWidth = Math.max(4, 6 * this._zoom);
    const step = Math.max(12, 18 * this._zoom);
    for (let x = cx - w/2 - h; x < cx + w/2 + h; x += step) {
      ctx.beginPath();
      ctx.moveTo(x,       ySlabMid + h/2);
      ctx.lineTo(x + h,   ySlabMid - h/2);
      ctx.stroke();
    }
    ctx.restore();
    // ▼ N label centered on the slab
    ctx.fillStyle = '#1A2A40';
    ctx.font = `700 ${Math.round(14 * this._zoom)}px "Lexend", system-ui, sans-serif`;
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'center';
    ctx.fillText(`▼ ${units}`, cx, ySlabMid);
    ctx.restore();
  }

  _drawShadow(ctx, px, py_ground, visH) {
    // The drone is now visually lifted upward (see _draw), so the shadow
    // stays anchored at the world position. It grows + softens with
    // altitude so the kid sees "higher = bigger, fuzzier shadow".
    // Softness comes from a radial gradient, not ctx.filter blur — the
    // filter is unsupported on Safari < 18 and costly to run per frame.
    const altRatio = Math.min(1, (visH ?? this.height) / 90);
    const z = this._zoom;
    const rx = (16 + altRatio * 14) * z;
    const ry = (7  + altRatio * 6)  * z;
    const alpha = 0.45 - altRatio * 0.22;
    const solid = Math.max(0.1, 0.6 - altRatio * 0.35);   // higher = fuzzier
    ctx.save();
    ctx.translate(px + 2 * z, py_ground + 1 * z);    // tiny tilt
    ctx.scale(1, ry / rx);                           // ellipse via scale
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, rx);
    g.addColorStop(0, `rgba(26,42,64,${alpha})`);
    g.addColorStop(solid, `rgba(26,42,64,${alpha * 0.85})`);
    g.addColorStop(1, 'rgba(26,42,64,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(0, 0, rx, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  _drawDrone(ctx, px, py, visH) {
    // The drone scales with the canvas zoom — same convention as everything
    // else on the canvas (grid, trail, zones, shadow). Altitude still gives
    // a small extra bump for perspective.
    const altRatio = Math.min(1, (visH ?? this.height) / 80);
    const scale = (1 + altRatio * 0.18) * this._zoom;
    const r = 16 * scale;
    const arm = 26 * scale;
    const propR = 11 * scale;

    ctx.save();
    ctx.translate(px, py);
    ctx.rotate(this.heading + Math.PI / 2);

    // Crash tumble — tip over with a springy overshoot (ease-out-back),
    // like a thunk onto one side. Direction was rolled at crash time.
    if (this._crash) {
      const t = Math.min(1, (performance.now() - this._crash.at) / 650);
      const k = 1.7;
      const back = 1 + (k + 1) * Math.pow(t - 1, 3) + k * Math.pow(t - 1, 2);
      ctx.rotate(this._crash.dir * 1.85 * back);
    }

    // Win pirouette — one full spin during the hop. Visual only: it ends
    // exactly back at 2π, so the heading the kid programmed is untouched.
    if (this._win) {
      const t = Math.min(1, (performance.now() - this._win.at) / 700);
      const eased = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
      ctx.rotate(eased * Math.PI * 2);
    }

    // Forward lean — a slight squash along the travel axis (nose is -y in
    // this frame, so shrinking y reads as pitching into the motion). The
    // spring's release wobble gives the overshoot-settle feel at each stop.
    if (Math.abs(this._leanX) > 0.01) {
      ctx.scale(1 + 0.05 * this._leanX, 1 - 0.09 * this._leanX);
    }

    ctx.lineCap = 'round';
    ctx.lineWidth = 4 * scale;
    ctx.strokeStyle = '#1A2A40';
    ctx.beginPath();
    for (const a of [Math.PI/4, -Math.PI/4]) {
      const cx = Math.cos(a) * arm, cy = Math.sin(a) * arm;
      ctx.moveTo(-cx, -cy);
      ctx.lineTo(cx, cy);
    }
    ctx.stroke();

    for (const a of [Math.PI/4, 3*Math.PI/4, -Math.PI/4, -3*Math.PI/4]) {
      const cx = Math.cos(a) * arm;
      const cy = Math.sin(a) * arm;

      ctx.save();
      ctx.translate(cx, cy);

      ctx.fillStyle = '#1A2A40';
      ctx.beginPath();
      ctx.arc(0, 0, 4 * scale, 0, Math.PI * 2);
      ctx.fill();

      ctx.rotate(this._rotorAngle * (this._rotorSpeed > 0 ? 1 : 0));
      const speedBlur = Math.min(0.55, this._rotorSpeed / 60);
      ctx.fillStyle = `rgba(255,251,238,${0.25 + speedBlur})`;
      ctx.beginPath();
      ctx.arc(0, 0, propR, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = `rgba(26,42,64,${0.35 - speedBlur * 0.2})`;
      ctx.lineWidth = 1.2 * scale;
      ctx.stroke();

      if (this._rotorSpeed < 10) {
        ctx.strokeStyle = '#1A2A40';
        ctx.lineWidth = 1.4 * scale;
        ctx.beginPath();
        ctx.moveTo(-propR * 0.85, 0);
        ctx.lineTo(propR * 0.85, 0);
        ctx.stroke();
      }
      ctx.restore();
    }

    ctx.fillStyle = '#E76F51';
    ctx.strokeStyle = '#1A2A40';
    ctx.lineWidth = 2.2 * scale;
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    this._drawFace(ctx, r, scale);

    ctx.fillStyle = '#F0A93B';
    ctx.beginPath();
    ctx.moveTo(0, -r - 5 * scale);
    ctx.lineTo(-r * 0.4, -r * 0.4);
    ctx.lineTo(r * 0.4, -r * 0.4);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = '#1A2A40';
    ctx.lineWidth = 1.4 * scale;
    ctx.stroke();

    ctx.restore();
  }

  // The face — two eyes + a mouth on the body, looking toward the nose
  // (replaces the old single front-dot; the marigold nose triangle still
  // marks heading). With no override the expression derives from `flying`,
  // so bridge-driven real-drone state gets a face for free; events set
  // dizzy / confused / win overrides that persist until the next reset.
  _drawFace(ctx, r, scale) {
    const face = this._faceOverride || (this.flying ? 'happy' : 'neutral');
    const ex = r * 0.34, ey = -r * 0.18, er = r * 0.15;
    ctx.save();
    ctx.strokeStyle = '#1A2A40';
    ctx.fillStyle = '#1A2A40';
    ctx.lineCap = 'round';
    ctx.lineWidth = Math.max(1.2, 1.6 * scale);

    if (face === 'dizzy') {
      // X eyes + a wobbly frown.
      const s = er * 1.1;
      for (const sx of [-ex, ex]) {
        ctx.beginPath();
        ctx.moveTo(sx - s, ey - s); ctx.lineTo(sx + s, ey + s);
        ctx.moveTo(sx + s, ey - s); ctx.lineTo(sx - s, ey + s);
        ctx.stroke();
      }
      ctx.beginPath();
      ctx.arc(0, r * 0.62, r * 0.30, Math.PI * 1.15, Math.PI * 1.85);
      ctx.stroke();
    } else if (face === 'win') {
      // Closed happy eyes (^ ^) + the biggest smile.
      for (const sx of [-ex, ex]) {
        ctx.beginPath();
        ctx.arc(sx, ey + er, er * 1.25, Math.PI * 1.15, Math.PI * 1.85);
        ctx.stroke();
      }
      ctx.beginPath();
      ctx.arc(0, r * 0.18, r * 0.34, Math.PI * 0.15, Math.PI * 0.85);
      ctx.stroke();
    } else if (face === 'confused') {
      // Uneven eyes + a flat, slightly slanted mouth — "huh?"
      ctx.beginPath(); ctx.arc(-ex, ey, er, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(ex, ey - er * 0.6, er * 0.7, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath();
      ctx.moveTo(-r * 0.30, r * 0.42); ctx.lineTo(r * 0.30, r * 0.34);
      ctx.stroke();
    } else {
      // neutral / happy — round eyes with a periodic blink. Time-based so
      // it costs nothing; _blinkOffset desyncs it from the page load.
      const blink = ((performance.now() + this._blinkOffset) % 4200) < 130;
      for (const sx of [-ex, ex]) {
        if (blink) {
          ctx.beginPath();
          ctx.moveTo(sx - er, ey); ctx.lineTo(sx + er, ey);
          ctx.stroke();
        } else {
          ctx.beginPath(); ctx.arc(sx, ey, er, 0, Math.PI * 2); ctx.fill();
        }
      }
      ctx.beginPath();
      if (face === 'happy') ctx.arc(0, r * 0.18, r * 0.32, Math.PI * 0.15, Math.PI * 0.85);
      else                  ctx.arc(0, r * 0.30, r * 0.22, Math.PI * 0.25, Math.PI * 0.75);
      ctx.stroke();
    }
    ctx.restore();
  }

  // One short puff of rotor-wash dust at the drone's ground position —
  // fired on takeoff and on touchdown (the crash has its own, bigger one).
  _dustPuff() {
    this._dust = { at: performance.now(), x: this.x_cm, y: this.y_cm };
  }

  _drawDust(ctx) {
    if (!this._dust) return;
    const p = (performance.now() - this._dust.at) / 700;
    if (p >= 1) return;
    const z = this._zoom;
    const dpx = this._pxX(this._dust.x), dpy = this._pxY(this._dust.y);
    ctx.save();
    ctx.fillStyle = `rgba(122,110,90,${0.5 * (1 - p)})`;
    const puffs = [[-1, -0.2, 0.8], [1, -0.3, 0.7], [-0.6, 0.25, 0.6],
                   [0.7, 0.2, 0.75], [0, 0.45, 0.5], [0, -0.5, 0.55]];
    for (const [dx, dy, s] of puffs) {
      const dist = (8 + p * 22) * z;
      ctx.beginPath();
      ctx.arc(dpx + dx * dist, dpy + dy * dist * 0.6, (4 + p * 7) * s * z, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  // Crash theater overlays — dust kicked up at the impact point and dizzy
  // stars orbiting the (now grounded) drone. Pure functions of elapsed
  // time; reset() clears _crash and they vanish.
  _drawCrashFX(ctx, e, px, py_ground, py_drone) {
    const z = this._zoom;
    // Dust puffs — appear as the drone thumps down, drift out + fade.
    if (e > 420 && e < 1500) {
      const p = (e - 420) / 1080;
      ctx.save();
      ctx.fillStyle = `rgba(122,110,90,${0.4 * (1 - p)})`;
      const puffs = [[-1, -0.25, 1], [1, -0.35, 0.8], [-0.55, 0.18, 0.7],
                     [0.7, 0.22, 0.9], [0, -0.55, 0.6]];
      for (const [dx, dy, s] of puffs) {
        const dist = (10 + p * 26) * z;
        ctx.beginPath();
        ctx.arc(px + dx * dist, py_ground + dy * dist * 0.6,
                (4 + p * 9) * s * z, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }
    // Dizzy stars — three marigold sparks orbiting over the body, forever
    // (until reset). The slow ellipse + size wobble reads as circling.
    if (e > 380) {
      ctx.save();
      ctx.globalAlpha = Math.min(1, (e - 380) / 250);
      ctx.fillStyle = '#E9B44C';
      ctx.strokeStyle = '#1A2A40';
      ctx.lineWidth = 1;
      for (let i = 0; i < 3; i++) {
        const ang = e * 0.0035 + (i * Math.PI * 2) / 3;
        const sx = px + Math.cos(ang) * 26 * z;
        const sy = py_drone - 30 * z + Math.sin(ang) * 9 * z;
        const sc = (0.8 + 0.25 * Math.sin(ang * 2)) * z;
        this._drawStar(ctx, sx, sy, 6 * sc);
      }
      ctx.restore();
    }
  }

  // The wall sensor, made visible — as a short whisker, because the
  // kid-facing model is "the drone sees one block ahead" (SENSE_RANGE_CM).
  // A small sage cone scans off the nose while the program is reading the
  // sensor; when a wall comes inside the block, the cone snaps to the wall
  // face, brightens, and a bracket marks what it sees. Drawn only while
  // the last wallAhead() read is fresh (~one polled frame), so it appears
  // for "fly until wall ahead" and never for "gone N units" — and will
  // light up for free under a future "if wall ahead" block.
  _drawSenseBeam(ctx, px, py) {
    const now = performance.now();
    if (!this._senseAt || now - this._senseAt > 120) return;
    const z = this._zoom;
    const dx = Math.cos(this.heading), dy = Math.sin(this.heading);
    const hit  = Number.isFinite(this._senseDist) && this._senseDist <= SENSE_RANGE_CM;
    const seen = Math.min(this._senseDist, SENSE_RANGE_CM);
    const nose = 20 * z;                               // start past the body
    const len  = seen * PX_PER_CM * z;
    const sx = px + dx * nose, sy = py + dy * nose;
    const ex = px + dx * (nose + len), ey = py + dy * (nose + len);
    const pxn = -dy, pyn = dx;                         // beam-perpendicular
    // A wide detection fan (~40° full angle) — reads as "looking", not a
    // laser pointer. Width grows with reach so the mouth sits at the wall.
    // (`len` is already in zoomed px, so only the base gets the z factor.)
    const halfW = 4 * z + len * 0.36;

    ctx.save();
    // scanning cone, breathing slightly so it reads as "active"; brighter
    // the moment something is actually in range
    const pulse = 0.18 + 0.06 * Math.sin(now * 0.012);
    ctx.fillStyle = `rgba(127,168,119,${hit ? pulse + 0.14 : pulse})`;
    ctx.beginPath();
    ctx.moveTo(sx + pxn * 4 * z, sy + pyn * 4 * z);
    ctx.lineTo(ex + pxn * halfW, ey + pyn * halfW);
    ctx.lineTo(ex - pxn * halfW, ey - pyn * halfW);
    ctx.lineTo(sx - pxn * 4 * z, sy - pyn * 4 * z);
    ctx.closePath();
    ctx.fill();
    // dashed centre ray, marching outward
    ctx.strokeStyle = 'rgba(92,134,87,0.85)';
    ctx.lineWidth = 1.6 * z;
    ctx.setLineDash([4 * z, 4 * z]);
    ctx.lineDashOffset = -((now * 0.02 * z) % (8 * z));
    ctx.beginPath();
    ctx.moveTo(sx, sy);
    ctx.lineTo(ex, ey);
    ctx.stroke();
    ctx.setLineDash([]);
    // bracket on the wall face the moment it enters the sensed block
    if (hit) {
      ctx.strokeStyle = '#5C8657';
      ctx.lineWidth = 2.5 * z;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(ex + pxn * (halfW + 3 * z), ey + pyn * (halfW + 3 * z));
      ctx.lineTo(ex - pxn * (halfW + 3 * z), ey - pyn * (halfW + 3 * z));
      ctx.stroke();
    }
    ctx.restore();
  }

  // Win celebration overlays — sage ripples rolling out from the landing
  // spot and a burst of sparks (the block-category colours) flying out of
  // the drone. One-shot, time-driven; reset() clears _win.
  _drawWinFX(ctx, e, px, py_ground, py_drone) {
    const z = this._zoom;
    // Ripples — three flattened rings, floor-perspective like the shadow.
    for (let k = 0; k < 3; k++) {
      const rt = (e - k * 200) / 850;
      if (rt <= 0 || rt >= 1) continue;
      ctx.save();
      ctx.strokeStyle = `rgba(127,168,119,${0.7 * (1 - rt)})`;
      ctx.lineWidth = 2.5 * z;
      ctx.beginPath();
      ctx.ellipse(px, py_ground, (10 + rt * 46) * z, (10 + rt * 46) * 0.55 * z,
                  0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
    // Sparkle burst — a ring of sparks racing out from the drone.
    if (e < 950) {
      const colors = ['#E9B44C', '#7FA877', '#E76F51', '#C9486A'];
      const t = e / 950;
      const fly = 1 - Math.pow(1 - t, 3);
      ctx.save();
      ctx.globalAlpha = 1 - t;
      ctx.strokeStyle = '#1A2A40';
      ctx.lineWidth = 1;
      for (let i = 0; i < 12; i++) {
        const ang = (i * Math.PI * 2) / 12 + 0.4;
        const dist = (14 + (26 + (i % 3) * 9) * fly) * z;
        const sx = px + Math.cos(ang) * dist;
        const sy = py_drone + Math.sin(ang) * dist * 0.85;
        ctx.fillStyle = colors[i % 4];
        this._drawStar(ctx, sx, sy, (4 + (i % 3) * 1.6) * z);
      }
      ctx.restore();
    }
  }

  // 4-point sparkle (same silhouette as the win-stamp sparks in app.js).
  _drawStar(ctx, x, y, s) {
    ctx.beginPath();
    ctx.moveTo(x, y - s);
    ctx.lineTo(x + s * 0.27, y - s * 0.27);
    ctx.lineTo(x + s, y);
    ctx.lineTo(x + s * 0.27, y + s * 0.27);
    ctx.lineTo(x, y + s);
    ctx.lineTo(x - s * 0.27, y + s * 0.27);
    ctx.lineTo(x - s, y);
    ctx.lineTo(x - s * 0.27, y - s * 0.27);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }

  _drawHeightBadge(ctx, px, py, visH) {
    const z = this._zoom;
    const units = ((visH ?? this.height) / CM_PER_UNIT).toFixed(1);
    const label = `↑ ${units}`;
    ctx.save();
    ctx.font = `500 ${Math.round(12 * z)}px "Lexend", system-ui, sans-serif`;
    const padX = 8 * z;
    const w = ctx.measureText(label).width + padX * 2;
    const x = px + 32 * z;
    const y = py - 8 * z;
    ctx.fillStyle = 'rgba(255,251,238,0.92)';
    ctx.strokeStyle = '#1A2A40';
    ctx.lineWidth = 1.5;
    this._roundRect(ctx, x, y - 12 * z, w, 18 * z, 9 * z);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#1A2A40';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, x + padX, y - 3 * z);
    ctx.restore();
  }

  _roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y,     x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x,     y + h, r);
    ctx.arcTo(x,     y + h, x,     y,     r);
    ctx.arcTo(x,     y,     x + w, y,     r);
    ctx.closePath();
  }
}

window.SimDrone = SimDrone;
