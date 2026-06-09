/* Drone Lab — sound engine
   ---------------------------------------------------------
   All synthesized with WebAudio — no assets. One engine,
   exposed as window.DroneSound; everything else talks to it
   through optional-chained calls so the app works fine if
   audio is unavailable.

   Browser autoplay policy: the AudioContext only runs after
   a user gesture, so unlock() is called from the fly! button
   and the mute toggle (see app.js). Until then every call is
   a silent no-op.
   ========================================================= */

(function () {
  const MUTE_KEY = 'drone_lab.muted';

  class SoundEngine {
    constructor() {
      this.ctx = null;
      this.master = null;
      this.hum = null;
      this.muted = false;
      try { this.muted = localStorage.getItem(MUTE_KEY) === '1'; } catch (_) {}
      this._lastBlip = 0;
      this._scheduled = [];
    }

    // Must be called from a user gesture (fly! / mute click).
    unlock() {
      if (!this.ctx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return;
        this.ctx = new AC();
        this.master = this.ctx.createGain();
        this.master.gain.value = this.muted ? 0 : 0.4;
        this.master.connect(this.ctx.destination);
      }
      if (this.ctx.state === 'suspended') this.ctx.resume();
    }

    setMuted(m) {
      this.muted = m;
      try { localStorage.setItem(MUTE_KEY, m ? '1' : '0'); } catch (_) {}
      if (this.master) {
        this.master.gain.setTargetAtTime(m ? 0 : 0.4, this.ctx.currentTime, 0.02);
      }
    }

    _ready() { return this.ctx && this.ctx.state === 'running' && !this.muted; }

    // One enveloped oscillator note; tracked so stopAll can cut it.
    _tone(freq, t0, dur, { type = 'triangle', gain = 0.18, glideTo = null } = {}) {
      const o = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      o.type = type;
      o.frequency.setValueAtTime(freq, t0);
      if (glideTo) o.frequency.exponentialRampToValueAtTime(glideTo, t0 + dur);
      g.gain.setValueAtTime(0, t0);
      g.gain.linearRampToValueAtTime(gain, t0 + 0.015);
      g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
      o.connect(g);
      g.connect(this.master);
      o.start(t0);
      o.stop(t0 + dur + 0.05);
      this._scheduled.push(o);
      o.onended = () => {
        const i = this._scheduled.indexOf(o);
        if (i >= 0) this._scheduled.splice(i, 1);
      };
      return o;
    }

    // Rotor hum — two detuned triangles through a lowpass. Pitch and
    // volume track the sim's rotor speed (0 = silent, hover ≈ 20,
    // manoeuvres ≈ 24–36); called every frame from SimDrone._loop.
    update(rotorSpeed) {
      if (!this.ctx || this.ctx.state !== 'running') return;
      const t = this.ctx.currentTime;
      if (!this.hum) {
        const gain = this.ctx.createGain();
        gain.gain.value = 0;
        const filter = this.ctx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.value = 420;
        const osc1 = this.ctx.createOscillator();
        const osc2 = this.ctx.createOscillator();
        osc1.type = 'triangle';
        osc2.type = 'triangle';
        osc1.connect(filter);
        osc2.connect(filter);
        filter.connect(gain);
        gain.connect(this.master);
        osc1.start();
        osc2.start();
        this.hum = { osc1, osc2, gain };
      }
      const f = 58 + rotorSpeed * 2.6;
      this.hum.osc1.frequency.setTargetAtTime(f, t, 0.09);
      this.hum.osc2.frequency.setTargetAtTime(f * 1.013, t, 0.09);
      const g = rotorSpeed <= 0 ? 0 : 0.05 + rotorSpeed * 0.0016;
      this.hum.gain.gain.setTargetAtTime(g, t, 0.08);
    }

    // Comedy crash: slide-whistle down, then a low thud scheduled to
    // land with the visual fall (~0.45 s after impact — see the crash
    // theater timings in simulator.js).
    crash() {
      if (!this._ready()) return;
      const t = this.ctx.currentTime;
      this._tone(880, t, 0.55, { type: 'sawtooth', gain: 0.1, glideTo: 90 });
      const dur = 0.14;
      const buf = this.ctx.createBuffer(1, this.ctx.sampleRate * dur, this.ctx.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length);
      const src = this.ctx.createBufferSource();
      src.buffer = buf;
      const f = this.ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = 160;
      const g = this.ctx.createGain();
      g.gain.value = 0.9;
      src.connect(f);
      f.connect(g);
      g.connect(this.master);
      src.start(t + 0.45);
      this._scheduled.push(src);
      src.onended = () => {
        const i = this._scheduled.indexOf(src);
        if (i >= 0) this._scheduled.splice(i, 1);
      };
    }

    // Rising three-note arpeggio + a high sparkle — fires with the
    // landing-site celebration, not the (delayed) stamp.
    win() {
      if (!this._ready()) return;
      const t = this.ctx.currentTime;
      this._tone(523.25, t, 0.3, { gain: 0.16 });            // C5
      this._tone(659.25, t + 0.12, 0.3, { gain: 0.16 });     // E5
      this._tone(783.99, t + 0.24, 0.45, { gain: 0.18 });    // G5
      this._tone(1567.98, t + 0.36, 0.3, { type: 'sine', gain: 0.08 }); // G6
    }

    // Gentle two-note "uh-oh" for non-crash losses (wrong area, forgot a
    // package, rule errors) — matches the confused face.
    uhOh() {
      if (!this._ready()) return;
      const t = this.ctx.currentTime;
      this._tone(330, t, 0.22, { type: 'sine', gain: 0.14, glideTo: 290 });
      this._tone(262, t + 0.24, 0.34, { type: 'sine', gain: 0.14, glideTo: 215 });
    }

    // Parking-sensor blips while the wall sensor is being read. The
    // sensor only "sees" one block (30 cm), so the soundscape is: a slow
    // scanning tick while the way is clear, then rapid rising blips once
    // a wall enters the block. Self-throttling; called from
    // SimDrone.wallAhead() every predicate poll.
    sense(distCm) {
      if (!this._ready()) return;
      const now = performance.now();
      const inRange = Number.isFinite(distCm) && distCm <= 30;
      const interval = inRange ? 140 : 600;
      if (now - this._lastBlip < interval) return;
      this._lastBlip = now;
      const f = inRange ? 760 + (30 - distCm) * 14 : 700;
      this._tone(f, this.ctx.currentTime, 0.07, { type: 'sine', gain: 0.07 });
    }

    // "Found it!" chirp when a sensed fly-until leg stops at its wall.
    found() {
      if (!this._ready()) return;
      const t = this.ctx.currentTime;
      this._tone(900, t, 0.1, { type: 'sine', gain: 0.12 });
      this._tone(1200, t + 0.09, 0.16, { type: 'sine', gain: 0.12 });
    }

    // Cut anything scheduled (e.g. the crash thud after a mid-fall
    // reset). The hum isn't touched — it fades via update(rotorSpeed=0).
    stopAll() {
      for (const n of this._scheduled) {
        try { n.stop(); } catch (_) {}
      }
      this._scheduled = [];
    }
  }

  window.DroneSound = new SoundEngine();
})();
