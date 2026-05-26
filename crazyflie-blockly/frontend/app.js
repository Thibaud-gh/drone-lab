/* Drone Lab — application wiring
   ---------------------------------------------------------
   Boots Blockly (toolbox-less), builds palette tiles that
   click-to-insert into the workspace, keeps the debug
   drawer in sync, and runs JS-generated code against the
   in-browser simulator.
   ========================================================= */

(function () {
  // ----- Palette config: one entry per block ----------------------------
  // The palette is HTML, NOT Blockly, so it can live in its own card.
  // Block definitions in blocks.js stay the source of truth for shape +
  // generators; this list just maps types to a friendly label + icon.
  const PALETTE = [
    { type: 'take_off',    label: 'take off',   iconKey: 'TAKEOFF' },
    { type: 'fly_forward', label: 'fly forward', iconKey: 'FORWARD', hint: '1 unit' },
    { type: 'fly_up',      label: 'fly up',     iconKey: 'UP',      hint: '1 unit' },
    { type: 'fly_down',    label: 'fly down',   iconKey: 'DOWN',    hint: '1 unit' },
    { type: 'turn_left',   label: 'turn left',  iconKey: 'TURN_LEFT' },
    { type: 'turn_right',  label: 'turn right', iconKey: 'TURN_RIGHT' },
    { type: 'land',        label: 'land',       iconKey: 'LAND' },
  ];

  // Same SVG icons as on the blocks (white strokes on the orange tile).
  const ICONS = {
    TAKEOFF:    `<svg viewBox="0 0 32 32" class="tile__icon"><g fill="none" stroke="#FFFBEE" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 26 L28 6 L20 14 L26 18 L14 22 L18 14 Z"/><path d="M6 28 L26 28" stroke-dasharray="2 3"/></g></svg>`,
    FORWARD:    `<svg viewBox="0 0 32 32" class="tile__icon"><g fill="none" stroke="#FFFBEE" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M5 16 L25 16"/><path d="M19 9 L26 16 L19 23"/></g></svg>`,
    UP:         `<svg viewBox="0 0 32 32" class="tile__icon"><g fill="none" stroke="#FFFBEE" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M16 27 L16 7"/><path d="M9 13 L16 6 L23 13"/></g></svg>`,
    DOWN:       `<svg viewBox="0 0 32 32" class="tile__icon"><g fill="none" stroke="#FFFBEE" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M16 5 L16 25"/><path d="M9 19 L16 26 L23 19"/></g></svg>`,
    TURN_LEFT:  `<svg viewBox="0 0 32 32" class="tile__icon"><g fill="none" stroke="#FFFBEE" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M22 24 A11 11 0 0 0 11 13 L4 13"/><path d="M10 7 L4 13 L10 19"/></g></svg>`,
    TURN_RIGHT: `<svg viewBox="0 0 32 32" class="tile__icon"><g fill="none" stroke="#FFFBEE" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M10 24 A11 11 0 0 1 21 13 L28 13"/><path d="M22 7 L28 13 L22 19"/></g></svg>`,
    LAND:       `<svg viewBox="0 0 32 32" class="tile__icon"><g fill="none" stroke="#FFFBEE" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 4 L16 20"/><path d="M9 14 L16 21 L23 14"/><path d="M5 27 L27 27" stroke-dasharray="2 3"/></g></svg>`,
  };

  // ----- Blockly workspace (no toolbox — palette lives outside) ----------
  const host = document.getElementById('blockly-host');
  const workspace = Blockly.inject(host, {
    theme: window.DRONE_THEME,
    renderer: 'zelos',
    move: { scrollbars: true, drag: true, wheel: true },
    zoom: { controls: false, wheel: true, startScale: 1.0, minScale: 0.6, maxScale: 1.6, scaleSpeed: 1.1 },
    grid: { spacing: 24, length: 0.5, colour: 'rgba(26,42,64,0.10)', snap: false },
    trashcan: true,
    sounds: false,
  });

  // ----- Build palette tiles --------------------------------------------
  const palette = document.getElementById('palette');
  for (const item of PALETTE) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'tile';
    btn.dataset.block = item.type;
    btn.draggable = true;
    btn.innerHTML = `${ICONS[item.iconKey] || ''}<span class="tile__label">${item.label}</span>${item.hint ? `<span class="tile__hint">${item.hint}</span>` : ''}`;
    btn.addEventListener('click', () => insertBlock(item.type));
    btn.addEventListener('dragstart', (e) => {
      e.dataTransfer.effectAllowed = 'copy';
      e.dataTransfer.setData('text/plain', item.type);
    });
    palette.appendChild(btn);
  }

  // ----- Active-block tracking + visual cue -----------------------------
  // `lastActive` is the anchor for the next click-insert. It glows softly so
  // the kid can see where new blocks will attach. Updated on create / move /
  // selection — whichever happened most recently.
  let lastActive = null;
  function setLastActive(blk) {
    if (lastActive && lastActive !== blk) {
      const root = lastActive.getSvgRoot?.();
      if (root) root.classList.remove('drone-active');
    }
    lastActive = blk && blk.workspace ? blk : null;
    if (lastActive) {
      const root = lastActive.getSvgRoot?.();
      if (root) root.classList.add('drone-active');
    }
  }

  function insertBlock(type) {
    let newBlk;
    Blockly.Events.setGroup(true);
    try {
      newBlk = workspace.newBlock(type);
      newBlk.initSvg();
      newBlk.render();
      anchorBlock(newBlk);
    } finally {
      Blockly.Events.setGroup(false);
    }
    setLastActive(newBlk);
    refreshCode();
    updateHintVisibility();
  }

  // Choose where a freshly-created block goes:
  //   - if it has a previous-connection AND there's an active chain with an
  //     open bottom, snap it onto the bottom of that chain
  //   - otherwise place it just below the active block (so the kid sees it
  //     appear right where their attention is)
  //   - if there's no active block at all, place at top-left
  function anchorBlock(newBlk) {
    const anchor = lastActive && lastActive.workspace ? lastActive : null;

    if (!anchor) {
      const off = workspace.getTopBlocks(false).length * 12;
      newBlk.moveBy(36 + off, 36 + off);
      return;
    }

    // walk to bottom of anchor's chain
    let bottom = anchor;
    while (bottom.nextConnection?.targetBlock()) {
      bottom = bottom.nextConnection.targetBlock();
    }

    if (newBlk.previousConnection && bottom.nextConnection) {
      bottom.nextConnection.connect(newBlk.previousConnection);
      return;
    }

    // can't connect — drop just below the anchor's chain
    const xy = bottom.getRelativeToSurfaceXY();
    newBlk.moveBy(xy.x, xy.y + 60);
  }

  // ----- Drag-from-palette into workspace -------------------------------
  host.addEventListener('dragover', (e) => {
    if (!Array.from(e.dataTransfer.types).includes('text/plain')) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    host.classList.add('drag-over');
  });
  host.addEventListener('dragleave', (e) => {
    if (e.relatedTarget && host.contains(e.relatedTarget)) return;
    host.classList.remove('drag-over');
  });
  host.addEventListener('drop', (e) => {
    e.preventDefault();
    host.classList.remove('drag-over');
    const type = e.dataTransfer.getData('text/plain');
    if (!type) return;
    insertBlockAt(type, e.clientX, e.clientY);
  });

  function insertBlockAt(type, clientX, clientY) {
    let newBlk;
    Blockly.Events.setGroup(true);
    try {
      newBlk = workspace.newBlock(type);
      newBlk.initSvg();
      newBlk.render();

      const ws = clientToWorkspace(clientX, clientY);
      const cur = newBlk.getRelativeToSurfaceXY();
      newBlk.moveBy(ws.x - cur.x - 30, ws.y - cur.y - 18);

      // Try to snap to a nearby compatible connection so the kid doesn't
      // have to land it perfectly on a stack.
      if (!trySnapToNearest(newBlk, 50)) {
        // standalone — that's fine, leave it where it was dropped
      }
    } finally {
      Blockly.Events.setGroup(false);
    }
    setLastActive(newBlk);
    refreshCode();
    updateHintVisibility();
  }

  function clientToWorkspace(clientX, clientY) {
    const inj = workspace.getInjectionDiv().getBoundingClientRect();
    const scale = workspace.scale || 1;
    const sx = workspace.scrollX || 0;
    const sy = workspace.scrollY || 0;
    return {
      x: (clientX - inj.left - sx) / scale,
      y: (clientY - inj.top  - sy) / scale,
    };
  }

  function trySnapToNearest(blk, threshold) {
    if (!blk.previousConnection) return false;
    const my = blk.previousConnection;
    let best = null, bestDist = threshold;
    for (const other of workspace.getAllBlocks(false)) {
      if (other === blk) continue;
      const nc = other.nextConnection;
      if (!nc || nc.targetBlock()) continue;
      const dx = (nc.x ?? 0) - (my.x ?? 0);
      const dy = (nc.y ?? 0) - (my.y ?? 0);
      const d = Math.hypot(dx, dy);
      if (d < bestDist) { bestDist = d; best = nc; }
    }
    if (best) { best.connect(my); return true; }
    return false;
  }

  // ----- Simulator -------------------------------------------------------
  const canvas = document.getElementById('sim-canvas');
  const hud = {
    height:    document.getElementById('hud-height'),
    status:    document.getElementById('sim-status'),
    statusText:document.getElementById('sim-status-text'),
    statusBox: document.getElementById('sim-status'),
  };
  hud.height.firstChild.textContent = '0.0';

  fitCanvas(canvas);
  // Only refit the canvas on resize — don't drone.reset() here, that wipes
  // the drone state mid-flight (incl. the trail) every time the layout
  // shifts. The drone's existing position renders fine even at the new
  // canvas size.
  new ResizeObserver(() => { fitCanvas(canvas); })
    .observe(canvas.parentElement);

  const drone = new SimDrone(canvas, hud);

  // ----- Levels ----------------------------------------------------------
  const LEVELS = window.LEVELS || [];
  const captionEl  = document.getElementById('sim-caption');
  const tabsEl     = document.getElementById('level-tabs');
  let currentLevel = LEVELS[0];

  function buildLevelTabs() {
    tabsEl.innerHTML = '';
    LEVELS.forEach((lvl) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'level-tab' + (lvl.id === 'sandbox' ? ' level-tab--sandbox' : '');
      btn.dataset.level = String(lvl.id);
      btn.textContent = lvl.id === 'sandbox' ? '★' : String(lvl.id);
      btn.title = lvl.caption;
      btn.addEventListener('click', () => setLevel(lvl.id));
      tabsEl.appendChild(btn);
    });
  }

  // Hide palette tiles that aren't in the current level's allow-list.
  function applyPalette(lvl) {
    const allowed = new Set(lvl.palette || PALETTE.map(p => p.type));
    palette.querySelectorAll('.tile').forEach(t => {
      t.style.display = allowed.has(t.dataset.block) ? '' : 'none';
    });
  }

  // Choose a canvas zoom that fits every zone of `level` on the canvas
  // with a margin. Drone home is at (0, 0); world y grows negative going
  // forward. We add a vertical buffer so walls/beams (which render
  // *above* their world y by an altitude offset) don't get cut at the
  // top of the canvas.
  const VERTICAL_BUFFER_CM = 60;
  function autoFitZoom(level) {
    let minX = 0, maxX = 0, minY = 0;   // y stays ≤ 0 (home is the floor)
    for (const z of (level.zones || [])) {
      const hw = (z.w_cm ?? 30) / 2;
      const hh = (z.h_cm ?? 30) / 2;
      minX = Math.min(minX, (z.x_cm ?? 0) - hw);
      maxX = Math.max(maxX, (z.x_cm ?? 0) + hw);
      minY = Math.min(minY, (z.y_cm ?? 0) - hh);
    }
    const effMinY = minY - VERTICAL_BUFFER_CM;
    const cssW = canvas._cssW || canvas.width || 400;
    const cssH = canvas._cssH || canvas.height || 480;
    const margin = 30;
    const vAvail = Math.max(80, cssH - 70 - margin);
    const hAvail = Math.max(80, cssW / 2 - margin);
    const zoomV = Math.abs(effMinY) > 0
      ? vAvail / (Math.abs(effMinY) * 3.2)
      : 1.5;
    const halfX = Math.max(Math.abs(minX), Math.abs(maxX));
    const zoomH = halfX > 0
      ? hAvail / (halfX * 3.2)
      : 1.5;
    return Math.max(0.4, Math.min(1.5, Math.min(zoomV, zoomH)));
  }

  function setLevel(id) {
    const lvl = LEVELS.find(l => l.id === id);
    if (!lvl) return;
    currentLevel = lvl;
    captionEl.textContent = lvl.caption;
    drone.setLevel(lvl);
    drone.reset();
    setResetMode(false);
    applyPalette(lvl);
    // Fit the canvas zoom so every zone in this level is comfortably on
    // screen. Reset each time — switching levels gives the kid a fresh
    // view regardless of how she'd zoomed the previous level.
    applyCanvasZoom(autoFitZoom(lvl));
    // Fresh workspace per level — avoids leftover blocks the new palette
    // wouldn't allow the kid to add back.
    workspace.clear();
    setLastActive(null);
    refreshCode();
    updateHintVisibility();
    // mark active tab — compare as strings so 'sandbox' matches
    tabsEl.querySelectorAll('.level-tab').forEach(b => {
      b.classList.toggle('is-active', b.dataset.level === String(id));
    });
  }

  function evaluateWin(d, level) {
    // Errors take precedence — keep the kid-friendly explanation.
    if (d._lastError) return { won: false, reason: d._lastError };
    if (d.flying)    return { won: false, reason: "you didn't land!" };
    switch (level.win?.type) {
      case 'land_anywhere':
        return { won: true };
      case 'land_in_zone': {
        const z = level.zones[level.win.zone];
        if (!z) return { won: true };
        const inX = Math.abs(d.x_cm - (z.x_cm ?? 0)) <= (z.w_cm ?? 30) / 2;
        const inY = Math.abs(d.y_cm - (z.y_cm ?? 0)) <= (z.h_cm ?? 30) / 2;
        return inX && inY
          ? { won: true }
          : { won: false, reason: 'you landed in the wrong area' };
      }
      default:
        return { won: true };
    }
  }

  // (initialised at the very bottom of the IIFE after setResetMode + resetMode
  // are declared — otherwise setLevel(0)'s call to setResetMode(false) trips
  // a temporal-dead-zone read on `let resetMode`.)

  // ----- Live code (in the debug drawer) ---------------------------------
  const codeOut = document.getElementById('code-out');
  const pyGen   = python.pythonGenerator;
  const jsGen   = javascript.javascriptGenerator;

  function refreshCode() {
    const text = pyGen.workspaceToCode(workspace);
    codeOut.innerHTML = text.trim().length
      ? highlightPython(text)
      : '<span class="py-cmt"># add some blocks over there ↑\n# this is where their secret recipe shows up</span>';
  }

  function updateHintVisibility() {
    const hasBlocks = workspace.getAllBlocks(false).length > 0;
    host.classList.toggle('has-blocks', hasBlocks);
  }

  workspace.addChangeListener((e) => {
    // Anchor tracking — fire on UI events too (SELECTED is a UI event)
    if (e.type === Blockly.Events.SELECTED && e.newElementId) {
      const blk = workspace.getBlockById(e.newElementId);
      if (blk) setLastActive(blk);
    } else if (e.type === Blockly.Events.BLOCK_MOVE && e.blockId) {
      const blk = workspace.getBlockById(e.blockId);
      if (blk) setLastActive(blk);
    } else if (e.type === Blockly.Events.BLOCK_DELETE && lastActive && lastActive.id === e.blockId) {
      setLastActive(null);
    } else if (e.type === Blockly.Events.BLOCK_DRAG) {
      handleBlockDrag(e);
    }
    if (e.isUiEvent) return;
    refreshCode();
    updateHintVisibility();
  });

  // ----- Custom big-bin: drop a block here to delete --------------------
  const bigbin = document.getElementById('bigbin');
  let draggingBlock = null;
  let lastPointer = { x: 0, y: 0 };

  document.addEventListener('pointermove', (e) => {
    lastPointer.x = e.clientX;
    lastPointer.y = e.clientY;
    if (draggingBlock) {
      bigbin.classList.toggle('is-target', isOverBigbin(e.clientX, e.clientY));
    }
  });

  function handleBlockDrag(e) {
    if (e.isStart) {
      draggingBlock = workspace.getBlockById(e.blockId);
    } else {
      const blk = draggingBlock;
      draggingBlock = null;
      bigbin.classList.remove('is-target');
      // Block may already be disposed (Blockly's own trashcan caught it).
      // Guard on .workspace; dispose with healStack=true so children reattach
      // to the parent's nextConnection rather than being orphaned.
      if (blk && blk.workspace && isOverBigbin(lastPointer.x, lastPointer.y)) {
        blk.dispose(true, true);
      }
    }
  }

  function isOverBigbin(x, y) {
    const r = bigbin.getBoundingClientRect();
    return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
  }

  // DOM safety net for programmatic creations that skip events
  new MutationObserver(updateHintVisibility).observe(
    workspace.getCanvas(), { childList: true, subtree: true }
  );

  refreshCode();
  updateHintVisibility();

  // ----- Drawer toggle ---------------------------------------------------
  const drawer = document.getElementById('drawer');
  const drawerToggle = document.getElementById('drawer-toggle');
  drawerToggle.addEventListener('click', () => {
    const open = drawer.dataset.state === 'open';
    drawer.dataset.state = open ? 'closed' : 'open';
    drawerToggle.setAttribute('aria-expanded', open ? 'false' : 'true');
  });

  // ----- Bridge (real-drone) wiring --------------------------------------
  // Auto-connect on load. If the bridge isn't running yet we keep retrying
  // quietly; when it appears, the "real drone" toggle becomes clickable.
  const realBtn  = document.querySelector('.mode-toggle__btn[data-mode="real"]');
  const simBtn   = document.querySelector('.mode-toggle__btn[data-mode="sim"]');
  let currentMode = 'sim';
  const bridge = new BridgeClient();

  bridge.on('connect', () => {
    realBtn.disabled = false;
    realBtn.title = 'fly the program against the bridge';
  });
  bridge.on('disconnect', () => {
    realBtn.disabled = true;
    realBtn.title = 'start the bridge (uv run python server.py) to enable';
    if (currentMode === 'real') {
      simBtn.click();   // fall back to pretend if the bridge dies mid-session
    }
  });
  bridge.on('message', (msg) => {
    if (currentMode !== 'real') return;
    if (msg.op === 'state') {
      applyStateToDrone(drone, msg, canvas);
    } else if (msg.op === 'status') {
      drone._setStatus(msg.text, msg.mode || 'flying');
    } else if (msg.op === 'error') {
      drone._lastError = msg.message;
      drone._setStatus(msg.message, 'stopped');
    } else if (msg.op === 'done') {
      const result = evaluateWin(drone, currentLevel);
      if (result.won) drone._setStatus('flight complete ✨', 'idle');
      else            drone._setStatus(result.reason, 'stopped');
    }
  });
  bridge.connect();

  // ----- Run / Stop ------------------------------------------------------
  const runBtn  = document.getElementById('run-btn');
  const stopBtn = document.getElementById('stop-btn');
  const runLabel = runBtn.querySelector('span');

  let resetMode = false;  // when true, the run button reads "reset" and a
                          // click cancels the in-flight program + resets
                          // the canvas. Real-drone mode never enters this.

  function setResetMode(on) {
    resetMode = on;
    runBtn.classList.toggle('btn--reset', on);
    runLabel.textContent = on ? 'reset' : 'fly!';
  }

  runBtn.addEventListener('click', async () => {
    if (resetMode) {
      // Mid-flight cancel: drone.reset() bumps the generation counter, so
      // any in-flight tween bails on its next frame without writing more
      // state. Trail clears as part of reset.
      drone.reset();
      setResetMode(false);
      return;
    }

    if (currentMode === 'real') {
      const pyCode = pyGen.workspaceToCode(workspace);
      if (!pyCode.trim()) {
        flash(hud.statusBox, 'add some blocks first!');
        return;
      }
      drone.reset();
      bridge.send({ op: 'run', code: pyCode });
      return;
    }

    // pretend mode — run the JS-generated code against the in-browser sim
    const code = jsGen.workspaceToCode(workspace);
    if (!code.trim()) {
      flash(hud.statusBox, 'add some blocks first!');
      return;
    }

    drone.reset();
    setResetMode(true);   // flip immediately so the kid can abort any time
    const flightGen = drone._gen;
    await wait(120);

    try {
      const fn = new Function('drone', `return (async () => {\n${code}\n})();`);
      await fn(drone);
      // If the kid pressed reset mid-flight, drone._gen has moved on.
      // Reset already set status to "ready when you are"; don't overwrite.
      if (drone._gen !== flightGen) return;
      if (drone._stopped) {
        // stop button already set its own message.
      } else {
        const result = evaluateWin(drone, currentLevel);
        if (result.won) drone._setStatus('flight complete ✨', 'idle');
        else            drone._setStatus(result.reason, 'stopped');
      }
    } catch (err) {
      console.error(err);
      if (drone._gen === flightGen) {
        drone._setStatus("hmm — that didn't work. let's try again!", 'stopped');
      }
    }
  });

  stopBtn.addEventListener('click', () => {
    if (currentMode === 'real') {
      bridge.send({ op: 'stop' });
      drone._setStatus('stopped — give it a moment', 'stopped');
    } else {
      drone.stop();
      drone._setStatus('stopped — give it a moment', 'stopped');
    }
  });

  // ----- Start over: clear all blocks ------------------------------------
  document.getElementById('clear-btn').addEventListener('click', () => {
    if (workspace.getAllBlocks(false).length === 0) return;
    setLastActive(null);
    workspace.clear();
    refreshCode();
    updateHintVisibility();
    drone.reset();
    setResetMode(false);
  });

  // ----- Mode toggle -----------------------------------------------------
  document.body.dataset.mode = 'sim';   // initial mode; CSS uses this
  document.querySelectorAll('.mode-toggle__btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      if (btn.disabled) return;
      document.querySelectorAll('.mode-toggle__btn').forEach((b) => b.classList.remove('is-active'));
      btn.classList.add('is-active');
      currentMode = btn.dataset.mode;
      document.body.dataset.mode = currentMode;
      // Land is an emergency-stop for the real drone; meaningless in sim
      // where every run starts from scratch and the user can't crash.
      stopBtn.disabled = (currentMode !== 'real');
      drone.reset();
      setResetMode(false);
    });
  });

  // ----- Helpers ---------------------------------------------------------
  function fitCanvas(c) {
    const rect = c.parentElement.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const cssW = Math.max(320, rect.width);
    const cssH = Math.max(240, rect.height);
    c.width  = Math.floor(cssW * dpr);
    c.height = Math.floor(cssH * dpr);
    c.style.width  = cssW + 'px';
    c.style.height = cssH + 'px';
    c._cssW = cssW;
    c._cssH = cssH;
    c.getContext('2d').setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function highlightPython(text) {
    const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    return esc(text)
      .replace(/(#.*)/g,                          '<span class="py-cmt">$1</span>')
      .replace(/\b(if|else|elif|for|while|in|range|and|or|not|True|False|None|def|return)\b/g,
                                                   '<span class="py-kw">$1</span>')
      .replace(/\b(drone)\.(\w+)/g,               '<span class="py-call">$1.$2</span>')
      .replace(/\b(\d+(?:\.\d+)?)\b/g,            '<span class="py-num">$1</span>');
  }

  function wait(ms) { return new Promise(r => setTimeout(r, ms)); }

  function flash(el, text) {
    const prev = document.getElementById('sim-status-text').textContent;
    document.getElementById('sim-status-text').textContent = text;
    setTimeout(() => {
      if (document.getElementById('sim-status-text').textContent === text) {
        document.getElementById('sim-status-text').textContent = prev;
      }
    }, 2400);
  }

  // ----- Canvas zoom -----------------------------------------------------
  // Two sources of truth that have to stay in sync: drone._zoom (drives
  // cm→px conversions in simulator.js) and --canvas-zoom (drives the
  // scale-bar width in styles.css). applyCanvasZoom() updates both.
  const simEl = document.querySelector('.sim');
  function applyCanvasZoom(z) {
    drone.setZoom(z);
    simEl.style.setProperty('--canvas-zoom', drone._zoom);
  }
  document.getElementById('zoom-in') .addEventListener('click', () => applyCanvasZoom(drone._zoom * 1.25));
  document.getElementById('zoom-out').addEventListener('click', () => applyCanvasZoom(drone._zoom / 1.25));
  applyCanvasZoom(1.0);

  // ----- Boot ------------------------------------------------------------
  // Last thing in the IIFE so every declaration above has run before
  // setLevel(0) calls setResetMode(false) (which reads `let resetMode`).
  buildLevelTabs();
  setLevel(1);
})();
