/* Drone Lab — 2D top-down simulator
   ---------------------------------------------------------
   SimDrone implements the same surface area as the real
   CrazyflieDrone will, so the generated code is identical
   in both modes. Animations are awaitable so the generated
   JS (await drone.forward(30)) reads sequentially.
   ========================================================= */

const PX_PER_CM = 3.2;             // canvas scale
const FLOOR_Y_FRAC = 0.78;          // where "the ground" sits on the canvas (for shadow logic)

class SimDrone {
  constructor(canvas, hudEls) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.hud = hudEls; // { height, status, statusText, statusBox }
    this.reset();

    this._lastT = performance.now();
    this._rotorAngle = 0;
    this._stopped = false;
    this._loop();
  }

  reset() {
    const w = this.canvas._cssW || this.canvas.width;
    const h = this.canvas._cssH || this.canvas.height;
    this.x = w / 2;
    this.y = h / 2 + 30;
    this.heading = -Math.PI / 2; // facing up on the canvas
    this.height = 0;
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

  stop() { this._stopped = true; }

  // Set when a flight rule is broken (e.g. forward without takeoff). Persists
  // through the rest of the program so the kid sees a single clear message
  // at the end, not the last successful step.
  _fail(msg) {
    this._lastError = msg;
    this._setStatus(msg, 'stopped');
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
    await this._tween(this.height, 30, 800, (v) => this.height = v, () => this._rotorSpeed = 30);
    if (gen !== this._gen) return;   // reset happened mid-tween
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
    await this._tween(this.height, 0, 900, (v) => this.height = v);
    if (gen !== this._gen) return;
    this.flying = false;
    this._rotorSpeed = 0;
  }

  async forward(cm) {
    if (this._stopped || this._lastError) return;
    const gen = this._gen;
    if (!this.flying) {
      this._fail("can't fly forward — take off first!");
      return;
    }
    this._setStatus(`flying forward ${cm} cm`, 'flying');
    const startX = this.x, startY = this.y;
    const dx = Math.cos(this.heading) * cm * PX_PER_CM;
    const dy = Math.sin(this.heading) * cm * PX_PER_CM;
    const duration = 30 + cm * 28;
    this._rotorSpeed = 36;
    await this._tween(0, 1, duration, (t) => {
      if (gen !== this._gen) return;   // reset mid-tween — don't keep extending the trail
      this.x = startX + dx * t;
      this.y = startY + dy * t;
      if (Math.random() < 0.5) this._trail.push({ x: this.x, y: this.y });
      if (this._trail.length > 2000) this._trail.shift();
    });
    if (gen !== this._gen) return;
    this._rotorSpeed = 20;
  }

  async up(cm) {
    if (this._stopped || this._lastError) return;
    const gen = this._gen;
    if (!this.flying) {
      this._fail("can't climb — take off first!");
      return;
    }
    this._setStatus(`climbing ${cm} cm`, 'flying');
    this._rotorSpeed = 32;
    await this._tween(this.height, this.height + cm, 30 + cm * 26, (v) => this.height = v);
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
        // Reset during a tween — leave state alone, the caller's reset()
        // already wrote the target visual state.
        if (this._gen !== startGen) { resolve(); return; }
        // Stop button — snap to the target so the in-flight move completes
        // instantly (preserves existing stop UX).
        if (this._stopped) { onUpdate(to); resolve(); return; }
        const t = Math.min(1, (now - start) / duration);
        const eased = t < 0.5 ? 2*t*t : 1 - Math.pow(-2*t + 2, 2) / 2; // easeInOutQuad
        onUpdate(from + (to - from) * eased);
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
    this.hud.height.firstChild.textContent = Math.round(this.height);
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

    // soft grid (very faint)
    ctx.save();
    ctx.strokeStyle = 'rgba(26,42,64,0.07)';
    ctx.lineWidth = 1;
    const step = 36;
    ctx.beginPath();
    for (let x = step; x < w; x += step) { ctx.moveTo(x, 0); ctx.lineTo(x, h); }
    for (let y = step; y < h; y += step) { ctx.moveTo(0, y); ctx.lineTo(w, y); }
    ctx.stroke();
    ctx.restore();

    // trail — persists until drone.reset() clears it (cleared on next fly!
    // or when the kid presses reset). Capped at 2000 points upstream.
    if (this._trail.length > 1) {
      ctx.save();
      ctx.lineWidth = 2.5;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.strokeStyle = 'rgba(231,111,81,0.55)';
      ctx.beginPath();
      ctx.moveTo(this._trail[0].x, this._trail[0].y);
      for (let i = 1; i < this._trail.length; i++) {
        ctx.lineTo(this._trail[i].x, this._trail[i].y);
      }
      ctx.stroke();
      ctx.restore();
    }

    // shadow — sized & blurred by altitude
    this._drawShadow(ctx);

    // drone
    this._drawDrone(ctx);

    // height tape next to the drone (only when in the air)
    if (this.height > 1) this._drawHeightBadge(ctx);
  }

  _drawShadow(ctx) {
    const altRatio = Math.min(1, this.height / 80);
    const offset = 6 + altRatio * 18;
    const rx = 22 + altRatio * 18;
    const ry = 9  + altRatio * 7;
    ctx.save();
    ctx.translate(this.x + offset * 0.4, this.y + offset);
    ctx.filter = `blur(${4 + altRatio * 6}px)`;
    ctx.fillStyle = `rgba(26,42,64,${0.42 - altRatio * 0.22})`;
    ctx.beginPath();
    ctx.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  _drawDrone(ctx) {
    const altRatio = Math.min(1, this.height / 80);
    const scale = 1 + altRatio * 0.18; // a touch bigger when higher (perspective hint)
    const r = 16 * scale;       // body radius
    const arm = 26 * scale;     // arm length
    const propR = 11 * scale;   // prop radius

    ctx.save();
    ctx.translate(this.x, this.y);
    ctx.rotate(this.heading + Math.PI / 2);

    // arms (X-frame)
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

    // props — translucent disc + spinning tri-blade
    for (const a of [Math.PI/4, 3*Math.PI/4, -Math.PI/4, -3*Math.PI/4]) {
      const cx = Math.cos(a) * arm;
      const cy = Math.sin(a) * arm;

      ctx.save();
      ctx.translate(cx, cy);

      // motor hub
      ctx.fillStyle = '#1A2A40';
      ctx.beginPath();
      ctx.arc(0, 0, 4 * scale, 0, Math.PI * 2);
      ctx.fill();

      // spinning prop blur
      ctx.rotate(this._rotorAngle * (this._rotorSpeed > 0 ? 1 : 0));
      const speedBlur = Math.min(0.55, this._rotorSpeed / 60);
      ctx.fillStyle = `rgba(255,251,238,${0.25 + speedBlur})`;
      ctx.beginPath();
      ctx.arc(0, 0, propR, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = `rgba(26,42,64,${0.35 - speedBlur * 0.2})`;
      ctx.lineWidth = 1.2 * scale;
      ctx.stroke();

      // blade hint (only visible at low speed)
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

    // body
    ctx.fillStyle = '#E76F51';
    ctx.strokeStyle = '#1A2A40';
    ctx.lineWidth = 2.2 * scale;
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // "eye" — front-facing marker
    ctx.fillStyle = '#1A2A40';
    ctx.beginPath();
    ctx.arc(0, -r * 0.45, r * 0.18, 0, Math.PI * 2);
    ctx.fill();

    // front triangle (so kid knows facing direction)
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

  _drawHeightBadge(ctx) {
    const label = `↑ ${Math.round(this.height)}cm`;
    ctx.save();
    ctx.font = '500 12px "Lexend", system-ui, sans-serif';
    const padX = 8, padY = 4;
    const w = ctx.measureText(label).width + padX * 2;
    const x = this.x + 32;
    const y = this.y - 8;
    ctx.fillStyle = 'rgba(255,251,238,0.92)';
    ctx.strokeStyle = '#1A2A40';
    ctx.lineWidth = 1.5;
    this._roundRect(ctx, x, y - 12, w, 18, 9);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#1A2A40';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, x + padX, y - 3);
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
