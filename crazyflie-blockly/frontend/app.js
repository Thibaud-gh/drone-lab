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
    { type: 'take_off',    label: 'take off',  iconKey: 'TAKEOFF' },
    { type: 'fly_forward', label: 'fly forward', iconKey: 'FORWARD', hint: '30 cm' },
    { type: 'fly_up',      label: 'fly up',    iconKey: 'UP',      hint: '20 cm' },
    { type: 'land',        label: 'land',      iconKey: 'LAND' },
  ];

  // Same SVG icons as on the blocks (white strokes on the orange tile).
  const ICONS = {
    TAKEOFF: `<svg viewBox="0 0 32 32" class="tile__icon"><g fill="none" stroke="#FFFBEE" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 26 L28 6 L20 14 L26 18 L14 22 L18 14 Z"/><path d="M6 28 L26 28" stroke-dasharray="2 3"/></g></svg>`,
    FORWARD: `<svg viewBox="0 0 32 32" class="tile__icon"><g fill="none" stroke="#FFFBEE" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M5 16 L25 16"/><path d="M19 9 L26 16 L19 23"/></g></svg>`,
    UP:      `<svg viewBox="0 0 32 32" class="tile__icon"><g fill="none" stroke="#FFFBEE" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M16 27 L16 7"/><path d="M9 13 L16 6 L23 13"/></g></svg>`,
    LAND:    `<svg viewBox="0 0 32 32" class="tile__icon"><g fill="none" stroke="#FFFBEE" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 4 L16 20"/><path d="M9 14 L16 21 L23 14"/><path d="M5 27 L27 27" stroke-dasharray="2 3"/></g></svg>`,
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
  hud.height.firstChild.textContent = '0';

  fitCanvas(canvas);
  new ResizeObserver(() => { fitCanvas(canvas); drone.reset(); refreshCode(); })
    .observe(canvas.parentElement);

  const drone = new SimDrone(canvas, hud);

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
    }
    if (e.isUiEvent) return;
    refreshCode();
    updateHintVisibility();
  });

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

  // ----- Run / Stop ------------------------------------------------------
  const runBtn  = document.getElementById('run-btn');
  const stopBtn = document.getElementById('stop-btn');

  let running = false;

  runBtn.addEventListener('click', async () => {
    if (running) return;
    const code = jsGen.workspaceToCode(workspace);
    if (!code.trim()) {
      flash(hud.statusBox, 'add some blocks first!');
      return;
    }
    running = true;
    runBtn.classList.add('is-running');
    runBtn.disabled = true;

    drone.reset();
    await wait(120);

    try {
      const fn = new Function('drone', `return (async () => {\n${code}\n})();`);
      await fn(drone);
      // Status precedence: in-flight error > user-stopped > clean finish.
      // Errors and stops are persistent (set by the sim/stop handler with red
      // dot); only the clean-finish case sets a transient celebration message.
      if (drone._lastError) {
        // _setStatus was already called in _fail(); leave it on screen.
      } else if (drone._stopped) {
        // stop button already set its own message.
      } else if (drone.flying) {
        drone._setStatus("flight complete ✨ — but the drone is still in the air!", 'stopped');
      } else {
        drone._setStatus('flight complete ✨', 'idle');
      }
    } catch (err) {
      console.error(err);
      drone._setStatus("hmm — that didn't work. let's try again!", 'stopped');
    } finally {
      running = false;
      runBtn.disabled = false;
      runBtn.classList.remove('is-running');
    }
  });

  stopBtn.addEventListener('click', () => {
    drone.stop();
    drone._setStatus('stopped — give it a moment', 'stopped');
  });

  // ----- Start over: clear all blocks ------------------------------------
  document.getElementById('clear-btn').addEventListener('click', () => {
    if (workspace.getAllBlocks(false).length === 0) return;
    setLastActive(null);
    workspace.clear();
    refreshCode();
    updateHintVisibility();
  });

  // ----- Mode toggle -----------------------------------------------------
  document.querySelectorAll('.mode-toggle__btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      if (btn.disabled) return;
      document.querySelectorAll('.mode-toggle__btn').forEach((b) => b.classList.remove('is-active'));
      btn.classList.add('is-active');
      // Land is an emergency-stop for the real drone; meaningless in sim
      // where every run starts from scratch and the user can't crash.
      stopBtn.disabled = (btn.dataset.mode !== 'real');
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
})();
