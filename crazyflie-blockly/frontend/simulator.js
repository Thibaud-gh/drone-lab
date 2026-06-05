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
  // at the end, not the last successful step.
  _fail(msg) {
    this._lastError = msg;
    this._setStatus(msg, 'stopped');
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
        this._fail("ouch — that wall is too tall to fly over!");
        return true;
      }
      // Strict: at the wall's height (or below) → touches its top; at the
      // beam's height (or above) → touches its underside. Either is a crash.
      if (z.kind === 'wall' && this.height <= (z.over_height_cm ?? 30)) {
        this._fail('ouch — you needed to fly higher over the wall!');
        return true;
      }
      if (z.kind === 'beam' && this.height >= (z.under_height_cm ?? 60)) {
        this._fail('ouch — you needed to fly lower under the beam!');
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
    await this._tween(0, 1, duration, (t) => {
      if (gen !== this._gen) return;
      this.x_cm = startXcm + dx_cm * t;
      this.y_cm = startYcm + dy_cm * t;
      if (this._checkCrash()) return;
      if (Math.random() < 0.5) this._trail.push({ x_cm: this.x_cm, y_cm: this.y_cm });
      if (this._trail.length > 2000) this._trail.shift();
    });
    if (gen !== this._gen) return;
    this._rotorSpeed = 20;
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
  wallAhead() {
    return this._distanceAheadCm() <= WALL_AHEAD_CM;
  }

  // Fly forward, polling `predicate()` each frame, stopping when it
  // returns true. Also bails on a crash, a mid-flight reset, or — if the
  // condition never trips — a safety cap that fails the flight rather
  // than flying forever. On a clean stop the drone snaps onto the grid
  // so "fly until wall" lands tidily (wall at a half-unit → drone on the
  // whole unit just before it).
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
    const speed = 95; // cm per second
    this._rotorSpeed = 36;
    let outcome = 'met';
    await new Promise((resolve) => {
      let last = performance.now();
      const step = (now) => {
        if (this._gen !== gen)    { outcome = 'cancel';  resolve(); return; }
        if (this._stopped)        { outcome = 'stopped'; resolve(); return; }
        if (this._lastError)      { outcome = 'crash';   resolve(); return; }
        // Stop as soon as the condition is met (checked before advancing).
        let met = false;
        try { met = !!predicate(); } catch (_) { met = true; }
        if (met) { outcome = 'met'; resolve(); return; }
        if (this.distanceGone() >= UNTIL_MAX_UNITS) { outcome = 'toofar'; resolve(); return; }
        const dt = Math.min(0.05, (now - last) / 1000); last = now;
        const adv = speed * dt;
        this.x_cm += dx * adv;
        this.y_cm += dy * adv;
        if (this._checkCrash()) { outcome = 'crash'; resolve(); return; }
        if (Math.random() < 0.5) this._trail.push({ x_cm: this.x_cm, y_cm: this.y_cm });
        if (this._trail.length > 2000) this._trail.shift();
        requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    });
    if (this._gen !== gen) return;
    if (outcome === 'toofar') {
      this._fail("the drone kept flying and flying — it never found what it was looking for!");
      return;
    }
    if (outcome === 'met') {
      // Tidy the landing spot onto the grid. If snapping would nudge the
      // drone into an obstacle, keep the (safe) pre-snap position.
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
      this._fail('crash! the drone fell to the floor — use land to come down gently!');
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
      this.heading = start + (target - start) * t;
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
      this.heading = start + (target - start) * t;
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
    // height stored in cm; HUD shows units (1 unit = 30 cm)
    this.hud.height.firstChild.textContent = (this.height / CM_PER_UNIT).toFixed(1);
  }

  _loop() {
    const now = performance.now();
    const dt = (now - this._lastT) / 1000;
    this._lastT = now;
    this._rotorAngle += this._rotorSpeed * dt;
    this._updateHud();
    this._draw();
    requestAnimationFrame(() => this._loop());
  }

  _draw() {
    const ctx = this.ctx;
    const w = this.canvas._cssW || this.canvas.width;
    const h = this.canvas._cssH || this.canvas.height;

    ctx.clearRect(0, 0, w, h);

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

    // trail — persists until drone.reset() clears it
    if (this._trail.length > 1) {
      ctx.save();
      ctx.lineWidth = 2.5 * this._zoom;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.strokeStyle = 'rgba(231,111,81,0.55)';
      ctx.beginPath();
      ctx.moveTo(this._pxX(this._trail[0].x_cm), this._pxY(this._trail[0].y_cm));
      for (let i = 1; i < this._trail.length; i++) {
        ctx.lineTo(this._pxX(this._trail[i].x_cm), this._pxY(this._trail[i].y_cm));
      }
      ctx.stroke();
      ctx.restore();
    }

    // shadow + drone. Shadow stays anchored to the world position; the
    // drone is lifted up the canvas by an amount proportional to altitude.
    // This is the perspective cue that says "it's hovering, not driving".
    const px        = this._pxX(this.x_cm);
    const py_ground = this._pxY(this.y_cm);
    // Same altitude-to-px factor obstacles use, so the drone visually
    // clears a wall when its height >= wall.over_height_cm and is below
    // the beam when its height <= beam.under_height_cm.
    const lift      = this.height * ALTITUDE_PX_PER_CM * this._zoom;
    const py_drone  = py_ground - lift;

    this._drawShadow(ctx, px, py_ground);

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

    // 4. Drone marker.
    this._drawDrone(ctx, px, py_drone);

    // 5. Beams the drone is genuinely flying UNDER — drawn after it so
    //    the beam occludes the drone (it's above). See _beamOccludesDrone.
    this._drawBeams(ctx, true);

    if (this.height > 1) this._drawHeightBadge(ctx, px, py_drone);
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
    ctx.save();
    ctx.fillStyle = 'rgba(127,168,119,0.32)';
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
  // the floor pass so trail + drone paint over it naturally.
  _drawBeamShadow(ctx, cx, cy, w, h) {
    ctx.save();
    ctx.fillStyle = 'rgba(26,42,64,0.22)';
    ctx.filter = `blur(${3 * this._zoom}px)`;
    this._roundRect(ctx, cx - w/2 + 2 * this._zoom, cy - h/2 + 1 * this._zoom, w, h, 6);
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

  _drawShadow(ctx, px, py_ground) {
    // The drone is now visually lifted upward (see _draw), so the shadow
    // stays anchored at the world position. It grows + softens with
    // altitude so the kid sees "higher = bigger, fuzzier shadow".
    const altRatio = Math.min(1, this.height / 90);
    const z = this._zoom;
    const rx = (16 + altRatio * 14) * z;
    const ry = (7  + altRatio * 6)  * z;
    ctx.save();
    ctx.translate(px + 2 * z, py_ground + 1 * z);    // tiny tilt
    ctx.filter = `blur(${(2 + altRatio * 6) * z}px)`;
    ctx.fillStyle = `rgba(26,42,64,${0.45 - altRatio * 0.22})`;
    ctx.beginPath();
    ctx.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  _drawDrone(ctx, px, py) {
    // The drone scales with the canvas zoom — same convention as everything
    // else on the canvas (grid, trail, zones, shadow). Altitude still gives
    // a small extra bump for perspective.
    const altRatio = Math.min(1, this.height / 80);
    const scale = (1 + altRatio * 0.18) * this._zoom;
    const r = 16 * scale;
    const arm = 26 * scale;
    const propR = 11 * scale;

    ctx.save();
    ctx.translate(px, py);
    ctx.rotate(this.heading + Math.PI / 2);

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

    ctx.fillStyle = '#1A2A40';
    ctx.beginPath();
    ctx.arc(0, -r * 0.45, r * 0.18, 0, Math.PI * 2);
    ctx.fill();

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

  _drawHeightBadge(ctx, px, py) {
    const z = this._zoom;
    const units = (this.height / CM_PER_UNIT).toFixed(1);
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
