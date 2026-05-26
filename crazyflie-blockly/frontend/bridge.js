/* Drone Lab — WebSocket bridge client
   ---------------------------------------------------------
   Talks to bridge/server.py over ws://localhost:8765. In
   "real drone" mode the bridge runs the Python program and
   streams drone state back; we render the state on the
   same canvas the in-browser sim uses.
   ========================================================= */

(function () {
  const BRIDGE_URL = 'ws://localhost:8765';

  class BridgeClient {
    constructor() {
      this.ws = null;
      this.connected = false;
      this.listeners = { connect: [], disconnect: [], message: [] };
      this._reconnectTimer = null;
    }

    on(event, fn) { (this.listeners[event] ||= []).push(fn); return this; }
    _emit(event, payload) { (this.listeners[event] || []).forEach(fn => fn(payload)); }

    connect() {
      if (this.ws && this.ws.readyState <= 1) return;
      try {
        this.ws = new WebSocket(BRIDGE_URL);
      } catch (err) {
        this._scheduleReconnect();
        return;
      }

      this.ws.addEventListener('open', () => {
        this.connected = true;
        this._emit('connect');
      });

      this.ws.addEventListener('message', (ev) => {
        let msg;
        try { msg = JSON.parse(ev.data); } catch { return; }
        this._emit('message', msg);
      });

      const onClose = () => {
        if (!this.connected && !this._reconnectTimer) {
          // first attempt failed — back off and try again so the bridge can
          // be started after the page loads
          this._scheduleReconnect();
        }
        this.connected = false;
        this._emit('disconnect');
      };
      this.ws.addEventListener('close', onClose);
      this.ws.addEventListener('error', onClose);
    }

    _scheduleReconnect() {
      if (this._reconnectTimer) return;
      this._reconnectTimer = setTimeout(() => {
        this._reconnectTimer = null;
        this.connect();
      }, 2500);
    }

    send(msg) {
      if (!this.ws || this.ws.readyState !== 1) return false;
      this.ws.send(JSON.stringify(msg));
      return true;
    }
  }

  // Adapter: takes bridge state messages and writes them onto the existing
  // SimDrone instance so the canvas renders identically in both modes.
  // SimDrone's own animation methods are bypassed in real-drone mode —
  // bridge.js drives state directly.
  function applyStateToDrone(drone, msg /*, canvas */) {
    // SimDrone stores state in cm relative to home — bridge messages
    // already use that frame, so this is now a straight copy.
    drone.x_cm   = msg.x_cm;
    drone.y_cm   = msg.y_cm;
    drone.height = msg.height_cm;
    drone.heading = msg.heading;
    drone.flying  = !!msg.flying;
    drone._rotorSpeed = msg.rotor_speed ?? drone._rotorSpeed;
    if (typeof msg.status === 'string') {
      drone._setStatus(msg.status, drone.flying ? 'flying' : 'idle');
    }
  }

  window.BridgeClient = BridgeClient;
  window.applyStateToDrone = applyStateToDrone;
})();
