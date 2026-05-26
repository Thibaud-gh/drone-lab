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

function pluralUnits(n) {
  return n === 1 ? '1 unit' : `${n} units`;
}

// Drone "home" — bottom-centre of the canvas in pixels. Cached on each
// _draw call since it depends on canvas size.
function droneHomeXY(canvas) {
  const w = canvas._cssW || canvas.width;
  const h = canvas._cssH || canvas.height;
  return { x: w / 2, y: h - HOME_BOTTOM_INSET };
}

class SimDrone {
  constructor(canvas, hudEls) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.hud = hudEls; // { height, status, statusText, statusBox }
    this._zoom = 1.0;
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
    return droneHomeXY(this.canvas).x + x_cm * PX_PER_CM * this._zoom;
  }
  _pxY(y_cm) {
    return droneHomeXY(this.canvas).y + y_cm * PX_PER_CM * this._zoom;
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
    const target = Math.max(0, this.height - cm);
    this._setStatus(`going down ${pluralUnits(units)}`, 'flying');
    this._rotorSpeed = 24;
    await this._tween(this.height, target, 30 + cm * 26, (v) => {
      this.height = v;
      this._checkCrash();
    });
    if (gen !== this._gen) return;
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

    // grid — every 30cm (same as the scale bar), so it scales with zoom
    ctx.save();
    ctx.strokeStyle = 'rgba(26,42,64,0.07)';
    ctx.lineWidth = 1;
    const step = 30 * PX_PER_CM * this._zoom;
    const home = droneHomeXY(this.canvas);
    ctx.beginPath();
    for (let x = home.x % step; x < w; x += step) { ctx.moveTo(x, 0); ctx.lineTo(x, h); }
    for (let y = home.y % step; y < h; y += step) { ctx.moveTo(0, y); ctx.lineTo(w, y); }
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
      ctx.strokeStyle = 'rgba(26,42,64,0.22)';
      ctx.lineWidth = 1.4;
      ctx.setLineDash([3, 4]);
      ctx.beginPath();
      ctx.moveTo(px, py_ground - 2);
      ctx.lineTo(px, py_drone + 16 * this._zoom);
      ctx.stroke();
      ctx.restore();
    }

    // 3. Drone marker.
    this._drawDrone(ctx, px, py_drone);

    // 4. Beams — drawn after the drone so when the drone flies UNDER,
    //    the beam visually occludes it (it's above).
    this._drawBeams(ctx);

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
      else if (kind === 'wall')   this._drawWallFootprint(ctx, cx, cy, w, h);
      else if (kind === 'beam')   this._drawBeamShadow(ctx, cx, cy, w, h);
    }
  }

  // 2nd pass — walls. Drawn after the trail but before the drone, so a
  // drone flying OVER the wall passes visually over (drawn on top).
  _drawWalls(ctx) {
    if (!this._level || !this._level.zones?.length) return;
    for (const z of this._level.zones) {
      if (z.kind !== 'wall') continue;
      const cx = this._pxX(z.x_cm ?? 0);
      const cy = this._pxY(z.y_cm ?? 0);
      const w  = (z.w_cm ?? 30) * PX_PER_CM * this._zoom;
      const h  = (z.h_cm ?? 30) * PX_PER_CM * this._zoom;
      this._drawWall(ctx, cx, cy, w, h, z);
    }
  }

  // 3rd pass — beams. Drawn after the drone so when the drone flies
  // UNDER the beam, the beam visually occludes the drone (it's above).
  _drawBeams(ctx) {
    if (!this._level || !this._level.zones?.length) return;
    for (const z of this._level.zones) {
      if (z.kind !== 'beam') continue;
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

  // Faint dashed rectangle on the floor showing where the wall stands.
  // The brick body (in _drawWall) overlaps this on the canvas — the
  // visible part is just enough to hint at the wall's footprint.
  _drawWallFootprint(ctx, cx, cy, w, h) {
    ctx.save();
    ctx.strokeStyle = 'rgba(26,42,64,0.30)';
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 4]);
    this._roundRect(ctx, cx - w/2, cy - h/2, w, h, 3);
    ctx.stroke();
    ctx.setLineDash([]);
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
  // visually (same thickness, just a different texture + label). The
  // dashed footprint on the floor (drawn in the floor pass) plus
  // dashed "post" lines from the footprint sides up to the slab
  // anchor it to the ground.
  _drawWall(ctx, cx, cy, w, h, z) {
    const heightCm = z.over_height_cm ?? 30;
    const liftPx   = heightCm * ALTITUDE_PX_PER_CM * this._zoom;
    const units    = +(heightCm / CM_PER_UNIT).toFixed(1);
    const ySlabMid = cy - liftPx;

    // dashed "posts" from footprint side edges up to the slab sides —
    // says "this wall stands on the floor and reaches up to here"
    ctx.save();
    ctx.strokeStyle = 'rgba(92,58,36,0.55)';
    ctx.lineWidth = 1.2;
    ctx.setLineDash([3, 4]);
    ctx.beginPath();
    ctx.moveTo(cx - w/2, cy);
    ctx.lineTo(cx - w/2, ySlabMid);
    ctx.moveTo(cx + w/2, cy);
    ctx.lineTo(cx + w/2, ySlabMid);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();

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
