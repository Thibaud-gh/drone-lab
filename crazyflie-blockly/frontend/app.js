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
    { type: 'take_off',      label: 'take off',   iconKey: 'TAKEOFF' },
    // Mid-sequence variant — same look, but with connectors on both
    // sides so it can be placed after a landing inside a repeat body
    // (used by levels with multiple landings: L3, L6, sandbox).
    { type: 'take_off_loop', label: 'take off',   iconKey: 'TAKEOFF' },
    { type: 'fly_forward',   label: 'fly forward', iconKey: 'FORWARD', hint: '1 unit' },
    { type: 'fly_up',        label: 'fly up',     iconKey: 'UP',      hint: '1 unit' },
    { type: 'fly_down',      label: 'fly down',   iconKey: 'DOWN',    hint: '1 unit' },
    { type: 'turn_left',     label: 'turn left',  iconKey: 'TURN_LEFT' },
    { type: 'turn_right',    label: 'turn right', iconKey: 'TURN_RIGHT' },
    { type: 'land',          label: 'land',       iconKey: 'LAND' },
    // Mid-sequence land — pairs with take_off_loop for the same levels.
    { type: 'land_loop',     label: 'land',       iconKey: 'LAND' },
    // Reactive flight: keeps going until a condition is met.
    { type: 'fly_until',     label: 'fly until',  iconKey: 'UNTIL' },
    // Marigold logic tile sits below the dotted divider — it WRAPS other
    // blocks rather than living in the chain like the flight blocks do.
    { type: 'repeat_n',      label: 'repeat',     iconKey: 'REPEAT', hint: '3×', tileClass: 'tile--logic' },
    // Sage sensor conditions — these PLUG INTO the "fly until" slot.
    { type: 'wall_ahead',    label: 'wall',       iconKey: 'WALLAHEAD', tileClass: 'tile--sensor' },
    { type: 'gone_units',    label: 'gone',       iconKey: 'GONE', hint: '3×', tileClass: 'tile--sensor' },
  ];

  // Same SVG icons as on the blocks (white strokes on the orange tile).
  const ICONS = {
    TAKEOFF:    `<svg viewBox="0 0 32 32" class="tile__icon"><g fill="none" stroke="#FFFBEE" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 26 L28 6 L20 14 L26 18 L14 22 L18 14 Z"/><path d="M6 28 L26 28" stroke-dasharray="2 3"/></g></svg>`,
    FORWARD:    `<svg viewBox="0 0 32 32" class="tile__icon"><g fill="none" stroke="#FFFBEE" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M5 16 L25 16"/><path d="M19 9 L26 16 L19 23"/></g></svg>`,
    UP:         `<svg viewBox="0 0 32 32" class="tile__icon"><g fill="none" stroke="#FFFBEE" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M16 27 L16 7"/><path d="M9 13 L16 6 L23 13"/></g></svg>`,
    DOWN:       `<svg viewBox="0 0 32 32" class="tile__icon"><g fill="none" stroke="#FFFBEE" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M16 5 L16 25"/><path d="M9 19 L16 26 L23 19"/></g></svg>`,
    TURN_LEFT:  `<svg viewBox="0 0 32 32" class="tile__icon"><g fill="none" stroke="#FFFBEE" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M22 24 A11 11 0 0 0 11 13 L4 13"/><path d="M10 7 L4 13 L10 19"/></g></svg>`,
    TURN_RIGHT: `<svg viewBox="0 0 32 32" class="tile__icon"><g fill="none" stroke="#FFFBEE" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M10 24 A11 11 0 0 1 21 13 L28 13"/><path d="M22 7 L28 13 L22 19"/></g></svg>`,
    REPEAT:     `<svg viewBox="0 0 32 32" class="tile__icon"><g fill="none" stroke="#FFFBEE" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M7 18 A9 9 0 1 0 9 10"/><path d="M4 6 L9 10 L5 15"/></g></svg>`,
    LAND:       `<svg viewBox="0 0 32 32" class="tile__icon"><g fill="none" stroke="#FFFBEE" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 4 L16 20"/><path d="M9 14 L16 21 L23 14"/><path d="M5 27 L27 27" stroke-dasharray="2 3"/></g></svg>`,
    UNTIL:      `<svg viewBox="0 0 32 32" class="tile__icon"><g fill="none" stroke="#FFFBEE" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M4 16 L19 16"/><path d="M13 10 L19 16 L13 22"/><path d="M25 7 L25 25"/></g></svg>`,
    WALLAHEAD:  `<svg viewBox="0 0 32 32" class="tile__icon"><g fill="none" stroke="#FFFBEE" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="6" y="11" width="20" height="14" rx="1.5"/><path d="M6 18 L26 18 M13 11 L13 18 M19 18 L19 25 M13 25 L13 18"/></g></svg>`,
    GONE:       `<svg viewBox="0 0 32 32" class="tile__icon"><g fill="none" stroke="#FFFBEE" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 24 L22 24" stroke-dasharray="3 3.5"/><path d="M22 24 L22 8 L29 11 L22 14"/></g></svg>`,
  };

  // ----- Blockly workspace (no toolbox — palette lives outside) ----------
  const host = document.getElementById('blockly-host');
  const workspace = Blockly.inject(host, {
    theme: window.DRONE_THEME,
    renderer: 'zelos',
    // drag + wheel start OFF and are enabled only on vertical overflow
    // (see applyWorkspaceMobility). zoom.wheel stays off entirely —
    // accidental two-finger pinch shouldn't shrink the kid's blocks.
    move: { scrollbars: true, drag: false, wheel: false },
    zoom: { controls: false, wheel: false, startScale: 1.0, minScale: 0.6, maxScale: 1.6, scaleSpeed: 1.1 },
    grid: { spacing: 24, length: 0.5, colour: 'rgba(26,42,64,0.10)', snap: false },
    trashcan: false,   // deletion is via the per-block ✕ button, no bin
    sounds: false,
  });

  // ----- Build palette tiles --------------------------------------------
  const palette = document.getElementById('palette');
  for (const item of PALETTE) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'tile' + (item.tileClass ? ' ' + item.tileClass : '');
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
    positionToolbar();
  }

  // ----- Floating per-block toolbar (↑ ↓ ✕) -----------------------------
  // Lets the kid reorder or delete the active block by tapping a small
  // button instead of having to sustain a drag (hard at 5-yo motor
  // skill). Up/Down arrows swap with the neighbour; if the neighbour
  // is a repeat block, the active block dives INTO or out of its body
  // step-by-step. Buttons grey out at the chain extremities or next to
  // a starter/terminator block.
  const toolbarEl = document.getElementById('block-toolbar');
  const toolbarUpBtn     = toolbarEl.querySelector('[data-action="up"]');
  const toolbarDownBtn   = toolbarEl.querySelector('[data-action="down"]');
  const toolbarDeleteBtn = toolbarEl.querySelector('[data-action="delete"]');

  toolbarEl.addEventListener('click', (e) => {
    const btn = e.target.closest('.block-tool');
    if (!btn || btn.classList.contains('is-disabled')) return;
    if (!lastActive || !lastActive.workspace) return;
    const action = btn.dataset.action;
    if      (action === 'delete') deleteActiveBlock();
    else if (action === 'up')     moveActiveBlock('up');
    else if (action === 'down')   moveActiveBlock('down');
  });

  function positionToolbar() {
    if (!lastActive || !lastActive.workspace) {
      toolbarEl.classList.remove('is-visible');
      return;
    }
    const root = lastActive.getSvgRoot?.();
    if (!root) {
      toolbarEl.classList.remove('is-visible');
      return;
    }
    const rect     = root.getBoundingClientRect();
    const hostRect = host.getBoundingClientRect();
    toolbarEl.classList.add('is-visible');
    // Anchor to the top-right corner of the block, nudged 8px outward.
    toolbarEl.style.left = `${rect.right - hostRect.left + 8}px`;
    toolbarEl.style.top  = `${rect.top   - hostRect.top}px`;
    updateToolbarButtons();
  }

  function updateToolbarButtons() {
    toolbarUpBtn.classList.toggle('is-disabled', !canMoveUp(lastActive));
    toolbarDownBtn.classList.toggle('is-disabled', !canMoveDown(lastActive));
  }

  function deleteActiveBlock() {
    if (!lastActive || !lastActive.workspace) return;
    // Capture neighbours BEFORE disposing so we can pick a sensible
    // anchor for the kid's next click-to-insert (otherwise the next
    // block lands stranded at top-left of the workspace).
    const nextNeighbour = lastActive.getNextBlock();
    const prevNeighbour = lastActive.getPreviousBlock();
    Blockly.Events.setGroup(true);
    try {
      lastActive.dispose(true /* heal stack */);
    } finally {
      Blockly.Events.setGroup(false);
    }
    // Prefer NEXT over PREV: when the deleted block was first in a
    // repeat body, getPreviousBlock() returns the enclosing repeat,
    // which would anchor follow-up inserts OUTSIDE the body — wrong.
    // The next block (now the body's new first block) is the right
    // anchor instead.
    let replacement = (nextNeighbour && nextNeighbour.workspace) ? nextNeighbour : null;
    if (!replacement && prevNeighbour && prevNeighbour.workspace) replacement = prevNeighbour;
    if (!replacement) {
      // No neighbours — fall back to the bottom of any remaining top
      // stack so click-to-insert still appends instead of starting
      // fresh in a corner.
      const tops = workspace.getTopBlocks(true);
      if (tops.length) {
        let bottom = tops[0];
        while (bottom.getNextBlock()) bottom = bottom.getNextBlock();
        replacement = bottom;
      }
    }
    setLastActive(replacement);
    refreshCode();
    updateHintVisibility();
  }

  function moveActiveBlock(dir) {
    const block = lastActive;
    if (!block || !block.workspace) return;
    // Block the change listener's BLOCK_MOVE → setLastActive logic for
    // the duration of this programmatic move. Blockly fires a
    // BLOCK_MOVE for every block whose position shifted (often two or
    // three during a swap) AND defers them via setTimeout(0), so a
    // plain post-move setLastActive(block) gets clobbered as soon as
    // the deferred events fire. The flag stays true past those events
    // (reset on a setTimeout(0) of its own, which queues *after* the
    // event firings) so the kid's clicked block keeps the focus.
    // Lock focus to the block the kid just acted on. Blockly fires
    // multiple BLOCK_MOVE events for the swap AND for late layout
    // updates (e.g. when the number editor opens) — without a sticky
    // lock the listener would chase the LAST moved block and the
    // toolbar would slide off to the neighbour. The lock is cleared
    // on the next user-driven SELECTED / BLOCK_DRAG event.
    internalRearrange = true;
    rearrangeTargetBlock = block;
    // The top block of a stack owns the stack's on-screen position. When a
    // reorder changes which block is on top (e.g. moving the FIRST block
    // down, so its old neighbour becomes the new top), the new top keeps
    // its own lower coordinate and the whole stack visually jumps down a
    // block. Pin the stack: remember the top-left before, restore it after.
    const rootBefore = block.getRootBlock();
    const anchorXY   = rootBefore.getRelativeToSurfaceXY();
    Blockly.Events.setGroup(true);
    try {
      if (dir === 'up') moveBlockUp(block);
      else              moveBlockDown(block);
      const rootAfter = block.getRootBlock();
      const cur = rootAfter.getRelativeToSurfaceXY();
      if (cur.x !== anchorXY.x || cur.y !== anchorXY.y) {
        rootAfter.moveBy(anchorXY.x - cur.x, anchorXY.y - cur.y);
      }
    } finally {
      Blockly.Events.setGroup(false);
    }
    refreshCode();
    setTimeout(() => {
      setLastActive(block);
      settleViewAndFocus(block);
      requestAnimationFrame(positionToolbar);
    }, 0);
  }

  // ----- Block move helpers --------------------------------------------
  // Robust "is this a statement input" check that doesn't depend on a
  // specific Blockly enum being defined in the compressed bundle.
  function isStatementInput(input) {
    if (!input || !input.connection) return false;
    if (Blockly.inputTypes && input.type === Blockly.inputTypes.STATEMENT) return true;
    if (Blockly.NEXT_STATEMENT !== undefined && input.connection.type === Blockly.NEXT_STATEMENT) return true;
    // Raw enum value as a final fallback.
    return input.connection.type === 3;
  }
  function isStatementInputConn(conn) {
    if (!conn || !conn.getParentInput) return false;
    return isStatementInput(conn.getParentInput());
  }
  function getStatementInput(block) {
    if (!block || !block.inputList) return null;
    for (const input of block.inputList) {
      if (isStatementInput(input)) return input;
    }
    return null;
  }
  function findContainingBlock(block) {
    // Walks up the chain to the FIRST block in its body, then returns
    // the parent block (the one whose statement input we live in).
    let top = block;
    while (true) {
      const prevConn = top.previousConnection && top.previousConnection.targetConnection;
      if (!prevConn) return null;
      if (isStatementInputConn(prevConn)) return prevConn.getSourceBlock();
      top = prevConn.getSourceBlock();
    }
  }

  function canMoveUp(block) {
    if (!block || !block.previousConnection) return false;
    const prevConn = block.previousConnection.targetConnection;
    if (!prevConn) return false;          // free-floating, nothing above
    if (isStatementInputConn(prevConn)) {
      // First in a body — exiting upward inserts block before the
      // container in the parent chain. That requires nextConnection.
      return !!block.nextConnection;
    }
    const prevBlock = prevConn.getSourceBlock();
    if (!prevBlock.previousConnection) return false;  // can't swap past a starter
    if (getStatementInput(prevBlock)) {
      // Diving INTO the bottom of a repeat — block becomes the body's
      // last block. Only needs previousConnection (already checked).
      return true;
    }
    // Plain swap with the block above — both connectors required.
    return !!block.nextConnection;
  }
  function canMoveDown(block) {
    if (!block || !block.nextConnection) return false;
    const nextBlock = block.getNextBlock();
    if (!nextBlock) {
      // At end of a body — exit downward needs previousConnection (to
      // connect to the container's nextConnection). If the container
      // has its own next block in the parent chain, we also need
      // block's nextConnection so that block can be spliced in
      // BETWEEN container and that next block without orphaning it.
      const container = findContainingBlock(block);
      if (!container) return false;
      if (!block.previousConnection) return false;
      const afterContainer = container.getNextBlock();
      if (afterContainer && !block.nextConnection) return false;
      return true;
    }
    const stmt = getStatementInput(nextBlock);
    if (stmt) {
      // Diving INTO the top of a repeat — block becomes the body's
      // first block. Always needs previousConnection. If the body
      // already has a first block, we also need nextConnection so the
      // existing block stays linked behind us rather than orphaned.
      if (!block.previousConnection) return false;
      const bodyHasFirst = !!stmt.connection.targetBlock();
      if (bodyHasFirst && !block.nextConnection) return false;
      return true;
    }
    if (!nextBlock.nextConnection) return false;     // next is a terminator
    return !!block.previousConnection;
  }

  function moveBlockUp(block) {
    if (!canMoveUp(block)) return;
    const prevConn  = block.previousConnection.targetConnection;
    const prevBlock = prevConn.getSourceBlock();
    if (isStatementInputConn(prevConn)) {
      // First in a body — exit upward, become previous sibling of the container.
      moveBlockBefore(block, prevBlock);
      return;
    }
    const stmt = getStatementInput(prevBlock);
    if (stmt) {
      // prevBlock is a repeat-like container — dive INTO the bottom of its body.
      moveBlockToEndOfInput(block, stmt);
      return;
    }
    // Plain swap with the block above.
    swapBlocks(block, prevBlock);
  }
  function moveBlockDown(block) {
    if (!canMoveDown(block)) return;
    const nextBlock = block.getNextBlock();
    if (!nextBlock) {
      // At end of a body — exit downward, become next sibling of the container.
      const container = findContainingBlock(block);
      if (container) moveBlockAfter(block, container);
      return;
    }
    const stmt = getStatementInput(nextBlock);
    if (stmt) {
      // nextBlock is a repeat-like container — dive INTO the top of its body.
      moveBlockToStartOfInput(block, stmt);
      return;
    }
    // Plain swap with the block below (block goes under nextBlock).
    swapBlocks(nextBlock, block);
  }

  // Insert `block` immediately before `target` in target's chain.
  function moveBlockBefore(block, target) {
    if (!target.previousConnection) return;
    const aboveConn = target.previousConnection.targetConnection;
    block.unplug(true);
    if (aboveConn) aboveConn.disconnect();
    if (block.nextConnection) block.nextConnection.connect(target.previousConnection);
    if (aboveConn) aboveConn.connect(block.previousConnection);
  }
  // Insert `block` immediately after `target` in target's chain.
  function moveBlockAfter(block, target) {
    if (!target.nextConnection) return;
    const next     = target.getNextBlock();
    const nextConn = target.nextConnection.targetConnection;
    block.unplug(true);
    if (nextConn) nextConn.disconnect();
    target.nextConnection.connect(block.previousConnection);
    if (next && block.nextConnection) {
      block.nextConnection.connect(next.previousConnection);
    }
  }
  // Drop `block` at the bottom of `input`'s body.
  function moveBlockToEndOfInput(block, input) {
    let last = input.connection.targetBlock();
    if (last) {
      while (last.getNextBlock()) last = last.getNextBlock();
    }
    block.unplug(true);
    if (last && last.nextConnection) {
      last.nextConnection.connect(block.previousConnection);
    } else {
      input.connection.connect(block.previousConnection);
    }
  }
  // Drop `block` at the top of `input`'s body (the rest of the body
  // shifts down).
  function moveBlockToStartOfInput(block, input) {
    const first = input.connection.targetBlock();
    block.unplug(true);
    if (first) {
      input.connection.disconnect();
      input.connection.connect(block.previousConnection);
      if (block.nextConnection) {
        block.nextConnection.connect(first.previousConnection);
      }
    } else {
      input.connection.connect(block.previousConnection);
    }
  }
  // Swap two adjacent blocks. `lower` is initially below `upper`; after
  // this call they trade positions (lower is above, upper is below).
  function swapBlocks(lower, upper) {
    const aboveConn = upper.previousConnection.targetConnection;
    lower.unplug(true);   // heal: upper now connects to lower's old tail
    if (upper.previousConnection.isConnected()) {
      upper.previousConnection.disconnect();
    }
    if (aboveConn) aboveConn.connect(lower.previousConnection);
    if (lower.nextConnection) lower.nextConnection.connect(upper.previousConnection);
  }

  // ----- Auto-focus number field on insert / move -----------------------
  function focusFirstNumberField(block) {
    if (!block || !block.workspace) return;
    for (const input of block.inputList) {
      for (const field of input.fieldRow) {
        if (field instanceof Blockly.FieldNumber) {
          // Public API in v11; falls back to the protected method if not exposed.
          if (typeof field.showEditor === 'function') field.showEditor();
          else if (typeof field.showEditor_ === 'function') field.showEditor_();
          return;
        }
      }
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
    // A condition that plugged into a slot keeps the anchor on its
    // PARENT statement block, so the next flight block still chains
    // onto the sequence rather than dangling off the condition.
    const plugged = newBlk.outputConnection && newBlk.getParent();
    setLastActive(plugged ? newBlk.getParent() : newBlk);
    refreshCode();
    updateHintVisibility();
    // Settle the view (scroll-lock + scroll a bottom block into view if
    // the stack overflows) and then open the inline number editor, so the
    // kid can type a value right away without a second tap — and so no
    // late scroll dismisses the auto-selected value.
    setTimeout(() => settleViewAndFocus(newBlk), 0);
  }

  // Choose where a freshly-created block goes:
  //   - if it has a previous-connection AND there's an active chain with an
  //     open bottom, snap it onto the bottom of that chain
  //   - otherwise place it just below the active block (so the kid sees it
  //     appear right where their attention is)
  //   - if there's no active block at all, place at top-left
  // Find an empty value-input (e.g. a "fly until" condition slot) on a
  // block, so condition blocks click-to-plug into it.
  function findEmptyValueInput(block) {
    if (!block || !block.inputList) return null;
    for (const input of block.inputList) {
      const c = input.connection;
      if (c && (c.type === Blockly.INPUT_VALUE || c.type === 1) && !c.targetBlock()) {
        return input;
      }
    }
    return null;
  }

  function anchorBlock(newBlk) {
    let anchor = lastActive && lastActive.workspace ? lastActive : null;

    // If the active block is a condition (a value block plugged into a
    // slot), treat its containing statement block as the anchor — so
    // clicking another flight block keeps building the same stack
    // instead of dangling off the condition.
    if (anchor && anchor.outputConnection && !newBlk.outputConnection) {
      const parent = anchor.getParent();
      if (parent) anchor = parent;
    }

    // Condition / value blocks (output, no previous): plug into an open
    // value input on the active block or its chain (the "fly until" slot).
    if (newBlk.outputConnection) {
      let host = anchor;
      while (host) {
        const input = findEmptyValueInput(host);
        if (input) { input.connection.connect(newBlk.outputConnection); return; }
        host = host.getNextBlock();
      }
      // No slot found — drop it near the active block (kid can drag it in).
      const base = anchor || null;
      const xy = base ? base.getRelativeToSurfaceXY() : { x: 40, y: 40 };
      newBlk.moveBy(xy.x + 30, xy.y + 40);
      return;
    }

    if (!anchor) {
      // Place the first block near the TOP, slightly LEFT of centre.
      // The view is pinned to scroll(0,0) whenever the blocks fit (see
      // applyWorkspaceMobility), so workspace coords ≈ on-screen pixels.
      const m = workspace.getMetrics();
      const scale = workspace.scale || 1;
      const hw = newBlk.getHeightWidth(); // workspace units (unscaled)
      const viewW = (m ? m.viewWidth : 400) / scale;
      const off = workspace.getTopBlocks(false).length * 16; // extra tops cascade
      // Sit it well left of centre — leaves room to the right for the
      // floating ↑ ↓ ✕ toolbar and for blocks/conditions that grow wider.
      const targetX = Math.max(16, viewW / 2 - hw.width / 2 - 70) + off;
      const targetY = 22 + off;
      const cur = newBlk.getRelativeToSurfaceXY();
      newBlk.moveBy(targetX - cur.x, targetY - cur.y);
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
    setTimeout(() => focusFirstNumberField(newBlk), 0);
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
  // Re-evaluate workspace scroll-locking when the layout / browser zoom
  // changes the available space (rAF so Blockly resizes its SVG first).
  new ResizeObserver(() => requestAnimationFrame(updateWorkspaceMobility))
    .observe(host);

  const drone = new SimDrone(canvas, hud);

  // ----- Levels ----------------------------------------------------------
  const LEVELS = window.LEVELS || [];
  const captionEl  = document.getElementById('sim-caption');
  const tabsEl     = document.getElementById('level-tabs');
  let currentLevel = LEVELS[0];

  function buildLevelTabs() {
    tabsEl.innerHTML = '';
    LEVELS.forEach((lvl) => {
      if (lvl.hidden) return;   // built but not yet released (e.g. L9 capstone)
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
    // Mirrors HOME_BOTTOM_INSET in simulator.js (kept in sync) and honours
    // per-level overrides so the zoom fit matches the drone's actual home.
    const yInset = (typeof level.home_y_inset_px === 'number') ? level.home_y_inset_px : 70;
    const vAvail = Math.max(80, cssH - yInset - margin);
    // Home may be off-centre (e.g. L4's bottom-left start). Split available
    // horizontal space into left/right halves around the home anchor so the
    // fit considers asymmetric layouts.
    const xFrac = (typeof level.home_x_frac === 'number') ? level.home_x_frac : 0.5;
    const hAvailLeft = Math.max(40, cssW * xFrac - margin);
    const hAvailRight = Math.max(40, cssW * (1 - xFrac) - margin);
    // Zoneless / open levels (the sandbox) can ask for a fixed vertical
    // view span instead of fitting zones: show `view_units` units of
    // forward distance from the drone's home up the canvas. 1 unit = 30 cm,
    // 3.2 px/cm at zoom 1.0.
    if (typeof level.view_units === 'number') {
      const spanPx = level.view_units * 30 * 3.2;
      return Math.max(0.4, Math.min(1.5, vAvail / spanPx));
    }
    const zoomV = Math.abs(effMinY) > 0
      ? vAvail / (Math.abs(effMinY) * 3.2)
      : 1.5;
    const zoomHLeft  = Math.abs(minX) > 0 ? hAvailLeft  / (Math.abs(minX) * 3.2) : 1.5;
    const zoomHRight = Math.abs(maxX) > 0 ? hAvailRight / (Math.abs(maxX) * 3.2) : 1.5;
    const zoomH = Math.min(zoomHLeft, zoomHRight);
    // Bump one step in (matches a single + press) — the bare-fit zoom
    // left more empty canvas than feels good, this seats things nicely.
    // Levels with denser visuals (e.g. L6's labyrinth) can override the
    // multiplier to start more zoomed in.
    const mult = (typeof level.zoom_multiplier === 'number') ? level.zoom_multiplier : 1.25;
    const fit = Math.min(zoomV, zoomH) * mult;
    // Big levels (e.g. the L9 maze) can lower the floor so the whole
    // thing fits on the canvas instead of overflowing.
    const minZoom = (typeof level.min_zoom === 'number') ? level.min_zoom : 0.4;
    return Math.max(minZoom, Math.min(1.5, fit));
  }

  // ===== Per-level workspace persistence ========================
  // Each level has its own slot in localStorage so the kid can hop
  // between levels without losing her work — and surviving a page
  // reload too. Saved/restored as Blockly's JSON serialization, with
  // the workspace scroll offset stored alongside so panning sticks
  // per-level too. `drone_lab.lastLevel` remembers which tab she was
  // on so a refresh lands where she left off.
  const WORKSPACE_STORAGE_PREFIX = 'drone_lab.workspace.';
  const SCROLL_STORAGE_PREFIX    = 'drone_lab.scroll.';
  const LAST_LEVEL_KEY           = 'drone_lab.lastLevel';

  function persistWorkspaceForLevel(levelId) {
    try {
      if (workspace.getTopBlocks(false).length === 0) {
        localStorage.removeItem(WORKSPACE_STORAGE_PREFIX + levelId);
      } else {
        const state = Blockly.serialization.workspaces.save(workspace);
        localStorage.setItem(WORKSPACE_STORAGE_PREFIX + levelId, JSON.stringify(state));
      }
      // Always persist scroll, even when the workspace is empty — she
      // may have panned around before placing any blocks.
      localStorage.setItem(
        SCROLL_STORAGE_PREFIX + levelId,
        JSON.stringify({ x: workspace.scrollX || 0, y: workspace.scrollY || 0 }),
      );
    } catch (_) {
      // localStorage can be unavailable (private mode, quota). Silent —
      // not critical to gameplay.
    }
  }

  function restoreWorkspaceForLevel(levelId) {
    try {
      const raw = localStorage.getItem(WORKSPACE_STORAGE_PREFIX + levelId);
      if (raw) {
        Blockly.serialization.workspaces.load(JSON.parse(raw), workspace);
        // Re-anchor click-to-insert at the bottom of the first chain so
        // the kid can keep appending right where she left off.
        const tops = workspace.getTopBlocks(true);
        if (tops.length) {
          let bottom = tops[0];
          while (bottom.nextConnection?.targetBlock()) {
            bottom = bottom.nextConnection.targetBlock();
          }
          setLastActive(bottom);
        }
      }
      const scrollRaw = localStorage.getItem(SCROLL_STORAGE_PREFIX + levelId);
      if (scrollRaw) {
        const { x, y } = JSON.parse(scrollRaw);
        if (typeof workspace.scroll === 'function') workspace.scroll(x, y);
      } else {
        if (typeof workspace.scroll === 'function') workspace.scroll(0, 0);
      }
    } catch (_) { /* corrupted slot — fall through to empty workspace */ }
  }

  function setLevel(id) {
    const lvl = LEVELS.find(l => l.id === id);
    if (!lvl) return;
    // Stash the previous level's blocks (and scroll) before we swap.
    if (currentLevel && currentLevel.id !== id) {
      persistWorkspaceForLevel(currentLevel.id);
    }
    currentLevel = lvl;
    // Remember which level we're on so a page reload lands us back
    // here instead of dropping the kid back at L1.
    try { localStorage.setItem(LAST_LEVEL_KEY, String(id)); } catch (_) {}
    captionEl.textContent = lvl.caption;
    drone.setLevel(lvl);
    drone.reset();
    setResetMode(false);
    applyPalette(lvl);
    // Fit the canvas zoom so every zone in this level is comfortably on
    // screen. Reset each time — switching levels gives the kid a fresh
    // view regardless of how she'd zoomed/panned the previous level.
    drone.setPan(0, 0);
    applyCanvasZoom(autoFitZoom(lvl));
    // Fresh workspace per level — clear first, then drop in whatever
    // the kid had built on this level before (if anything).
    workspace.clear();
    setLastActive(null);
    // New level → re-evaluate fit from a clean slate (a restore below may
    // flip it again). Reset lastFits so the rescue-recenter can fire.
    lastFits = null;
    restoreWorkspaceForLevel(id);
    refreshCode();
    updateHintVisibility();   // also re-evaluates scroll-lock mobility
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
      case 'pickup_then_land': {
        // `pickup` may be a single zone index OR an array of indices —
        // arrays require ALL of them to have been visited before win.
        const required = Array.isArray(level.win.pickup)
          ? level.win.pickup
          : [level.win.pickup];
        const missed = required.filter(idx => !d._pickedUpZones?.has(idx));
        if (missed.length > 0) {
          const reason =
            missed.length === 1 && required.length === 1 ? "you forgot the package!" :
            missed.length === 1 ? "you forgot a package!" :
            `you forgot ${missed.length} packages!`;
          return { won: false, reason };
        }
        const z = level.zones[level.win.zone];
        if (!z) return { won: true };
        const inX = Math.abs(d.x_cm - (z.x_cm ?? 0)) <= (z.w_cm ?? 30) / 2;
        const inY = Math.abs(d.y_cm - (z.y_cm ?? 0)) <= (z.h_cm ?? 30) / 2;
        return inX && inY
          ? { won: true }
          : { won: false, reason: required.length === 1
              ? 'you grabbed the package but landed in the wrong area'
              : 'you grabbed all the packages but landed in the wrong area' };
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
    // The app's own block ops (palette insert, delete, clear) call
    // refreshCode/updateHintVisibility directly rather than going through
    // the workspace change listener (they run inside an event group), so
    // hook the scroll-lock re-evaluation here — it fires from every
    // block-structure change.
    updateWorkspaceMobility();
  }

  let persistTimer = null;
  // While a programmatic move is in flight (and for its long tail of
  // late BLOCK_MOVE events), keep focus pinned to the block the kid
  // acted on. The lock is cleared by the next user-driven action.
  let internalRearrange = false;
  let rearrangeTargetBlock = null;
  function endRearrangeLock() {
    internalRearrange = false;
    rearrangeTargetBlock = null;
  }
  // ----- Lock the workspace view when the blocks already fit ------------
  // Blockly pads the scrollable area far past the content, so by default
  // you can always drag/scroll into empty space — which lets a kid pan
  // her blocks clean off-screen by accident. We only want scrolling when
  // the blocks genuinely don't fit (a tall stack, or the browser zoomed
  // in). When everything fits: disable background drag-pan + hide the
  // scrollbars; when it overflows: turn them back on. Block dragging
  // itself is unaffected (that's a separate gesture).
  let lastFits = null;
  let mobilityTimer = 0;
  // Debounced: Blockly recomputes its content metrics on a deferred
  // resize cycle, so a synchronous getMetrics() right after a block
  // edit can read stale dimensions. Wait for things to settle, then
  // measure once.
  function updateWorkspaceMobility() {
    clearTimeout(mobilityTimer);
    mobilityTimer = setTimeout(applyWorkspaceMobility, 60);
  }
  function applyWorkspaceMobility() {
    const m = workspace.getMetrics();
    if (!m) return;
    // Overflow is purely VERTICAL: does the block stack reach past the
    // bottom of the visible area? Measured from getBlocksBoundingBox
    // (synchronous, always current — metrics.contentHeight lags on
    // Blockly's deferred resize cycle). When the blocks fit we pin the
    // view to scroll(0,0), so the stack's workspace Y ≈ its on-screen Y
    // and this comparison is exact.
    const scale = workspace.scale || 1;
    const hasBlocks = workspace.getTopBlocks(false).length > 0;
    const bbox = workspace.getBlocksBoundingBox();
    const bottomPx = hasBlocks ? bbox.bottom * scale : 0;
    const margin = 24; // also absorbs the small SVG origin offset
    const overflow = bottomPx > m.viewHeight - margin;
    // Drag-pan, wheel-scroll (two-finger trackpad) and scrollbars come
    // on together, only once the stack overflows. Until then the view is
    // fully locked so the kid can't fling her blocks off-screen by
    // accident — by mouse drag OR trackpad swipe. zoom.wheel stays off
    // throughout so a stray pinch never resizes the blocks.
    //
    // Only touch the options + scrollbar on a real fits↔overflow
    // TRANSITION. This function runs (debounced) on every edit, including
    // right after a click that just opened the inline number editor; a
    // redundant setContainerVisible / scroll would dismiss that editor
    // and lose the auto-selected value. Idempotent = editor survives.
    if (lastFits !== !overflow) {
      workspace.options.moveOptions.drag = overflow;
      workspace.options.moveOptions.wheel = overflow;
      workspace.options.zoomOptions.wheel = false;
      if (workspace.scrollbar) workspace.scrollbar.setContainerVisible(overflow);
      lastFits = !overflow;
    }
    // Keep the stack parked at the top / slightly-left-of-centre — but
    // only scroll when we're not already there, so a no-op scroll(0,0)
    // doesn't close an open number editor either.
    if (!overflow && (Math.abs(workspace.scrollX) > 0.5 || Math.abs(workspace.scrollY) > 0.5)) {
      workspace.scroll(0, 0);
    }
  }
  // Run the scroll-lock evaluation NOW rather than on the 60ms debounce,
  // cancelling any pending one. Used on the insert/move path so the view
  // is fully settled before we open the number editor (a later scroll
  // would dismiss it).
  function flushWorkspaceMobility() {
    clearTimeout(mobilityTimer);
    applyWorkspaceMobility();
  }
  // When the stack overflows the visible area, scroll just enough that a
  // freshly-added/moved block sits a little above the bottom edge instead
  // of below it. Measured in screen pixels (same basis as positionToolbar)
  // so it's independent of Blockly's metric quirks. No-op when everything
  // fits (the block is already on-screen).
  function scrollBlockIntoView(block) {
    if (!block || !block.workspace) return;
    const root = block.getSvgRoot?.();
    if (!root) return;
    const svgRect   = workspace.getParentSvg().getBoundingClientRect();
    const blockRect = root.getBoundingClientRect();
    const margin = 28;  // gap kept below the block so it reads as "just added"
    const overshootBottom = blockRect.bottom - (svgRect.bottom - margin);
    if (overshootBottom > 0) {
      // Move content up: smaller scrollY translates the canvas upward.
      workspace.scroll(workspace.scrollX, workspace.scrollY - overshootBottom);
    }
  }
  // The ordered tail of every insert/move: settle the view (scroll-lock +
  // bring the block on-screen) and ONLY THEN open the inline number
  // editor. Opening it last guarantees no subsequent scroll closes it,
  // which is what used to swallow the auto-selected value.
  function settleViewAndFocus(block) {
    flushWorkspaceMobility();
    scrollBlockIntoView(block);
    focusFirstNumberField(block);
  }

  workspace.addChangeListener((e) => {
    // Anchor tracking — fire on UI events too (SELECTED is a UI event)
    if (e.type === Blockly.Events.SELECTED && e.newElementId) {
      // User clicked a block. If it's different from our rearrange
      // target, the kid has moved on and we should release the lock.
      if (rearrangeTargetBlock && e.newElementId !== rearrangeTargetBlock.id) {
        endRearrangeLock();
      }
      const blk = workspace.getBlockById(e.newElementId);
      if (blk) setLastActive(blk);
    } else if (e.type === Blockly.Events.BLOCK_MOVE && e.blockId) {
      if (internalRearrange && rearrangeTargetBlock && rearrangeTargetBlock.workspace) {
        // Late event from the rearrange — force focus back to the
        // block the kid acted on, regardless of which block Blockly
        // happens to report moved.
        setLastActive(rearrangeTargetBlock);
      } else {
        const blk = workspace.getBlockById(e.blockId);
        if (blk) setLastActive(blk);
      }
    } else if (e.type === Blockly.Events.BLOCK_DELETE && lastActive && lastActive.id === e.blockId) {
      setLastActive(null);
    } else if (e.type === Blockly.Events.BLOCK_DRAG) {
      // User started a real drag — release the rearrange lock and hide
      // the floating toolbar so it doesn't trail the drag preview.
      if (e.isStart) endRearrangeLock();
      toolbarEl.classList.toggle('is-hidden', !!e.isStart);
      if (!e.isStart) requestAnimationFrame(positionToolbar);
    } else if (e.type === Blockly.Events.VIEWPORT_CHANGE) {
      positionToolbar();
      // Wheel-zooming the workspace can push content over/under the fit
      // threshold; re-evaluate. (scrollCenter only fires on the
      // overflow→fits edge, so this can't loop.)
      updateWorkspaceMobility();
    }
    if (e.isUiEvent) return;
    refreshCode();
    updateHintVisibility();   // also re-evaluates scroll-lock mobility
    // Persist this level's blocks (debounced) so a page reload mid-build
    // doesn't lose work between explicit level switches.
    if (currentLevel) {
      clearTimeout(persistTimer);
      persistTimer = setTimeout(() => persistWorkspaceForLevel(currentLevel.id), 400);
    }
  });

  // Deletion is handled by the per-block ✕ toolbar button (see
  // deleteActiveBlock); there's no drop-bin any more.

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
      if (result.won) drone._setStatus('ready when you are', 'idle');
      else            drone._setStatus(result.reason, 'stopped');
      showFlightFeedback(result);
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
    // Flipping back to "fly!" is the single signal that a flight is
    // over — whether from the reset button, a level switch, mode
    // toggle, or start-over. Clean up the per-flight visuals here so
    // every one of those paths picks it up automatically.
    if (!on) {
      endRunVisuals();
      clearFlightFeedback();
    }
  }

  // ----- Block highlight + repeat countdown during pretend-mode runs --
  // The JS generator injects `highlightBlock(<id>)` before each
  // statement (via STATEMENT_PREFIX) and `setRepeatCount(<id>, n)`
  // inside each repeat loop. The kid sees:
  //   • the block currently being animated glow brightly,
  //   • the repeat block's number field count down 4 → 3 → 2 → 1 → 0.
  // We snapshot every repeat block's original count at the start of a
  // run so we can restore them at the end (or on reset). Field writes
  // are wrapped in Blockly.Events.disable / enable so the live code
  // panel doesn't regenerate Python with the decrementing values.
  let currentHighlightedBlock = null;
  const originalRepeatCounts = new Map();

  // The glow uses a CLONE of the highlighted block's SVG, appended at
  // the end of the workspace canvas — drawing the cloned block (and
  // its drop-shadow halo) on top of everything else. We can't just put
  // the filter on the original block: Blockly nests stacked blocks as
  // DOM descendants, so a child block in the same chain would always
  // render *after* (above) the highlighted block, clipping the lower
  // half of the glow. The overlay sidesteps that ordering entirely.
  let highlightOverlay = null;
  function ensureHighlightOverlay() {
    const canvas = workspace.getCanvas();
    if (!highlightOverlay || highlightOverlay.parentNode !== canvas) {
      highlightOverlay = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      highlightOverlay.setAttribute('class', 'drone-running-overlay');
      highlightOverlay.style.pointerEvents = 'none';
      canvas.appendChild(highlightOverlay);
    } else if (canvas.lastChild !== highlightOverlay) {
      // New blocks may have been appended after us — re-park on top.
      canvas.appendChild(highlightOverlay);
    }
    return highlightOverlay;
  }
  function highlightBlock(id) {
    // Tight loops (e.g. `repeat 4 × forward`) hit STATEMENT_PREFIX with
    // the same id every iteration. Bail early so we don't redo the
    // clone work on every statement.
    if (currentHighlightedBlock && currentHighlightedBlock.id === id) return;
    const overlay = ensureHighlightOverlay();
    overlay.replaceChildren();
    currentHighlightedBlock = null;
    if (!id) return;
    const block = workspace.getBlockById(id);
    if (!block) return;
    const root = block.getSvgRoot?.();
    if (!root) return;
    const clone = root.cloneNode(true);
    // Drop sub-blocks that highlight on their own — the next block in the
    // chain and any statement-body blocks — but KEEP value-input blocks
    // (e.g. a "fly until" condition), which are part of this block's own
    // look and never light up separately. Collect their ids from the
    // live block, then remove the matching nodes in the clone.
    const dropIds = new Set();
    const addChain = (b) => { for (let n = b; n; n = n.getNextBlock()) dropIds.add(n.id); };
    if (block.getNextBlock()) addChain(block.getNextBlock());
    for (const input of (block.inputList || [])) {
      if (isStatementInput(input) && input.connection?.targetBlock()) {
        addChain(input.connection.targetBlock());
      }
    }
    dropIds.forEach((bid) => {
      const el = clone.querySelector(`[data-id="${CSS.escape(bid)}"]`);
      if (el) el.remove();
    });
    // Detach the clone from Blockly's bookkeeping: without this Blockly
    // sees a node with a known `data-id` + `blocklyDraggable` class
    // sitting in the canvas and keeps re-asserting the original
    // block's transform on it, snapping the clone back to (0, 0)
    // relative to its old parent.
    clone.removeAttribute('data-id');
    clone.querySelectorAll('[data-id]').forEach(el => el.removeAttribute('data-id'));
    clone.classList.remove('blocklyDraggable');
    clone.setAttribute('class', (clone.getAttribute('class') || '') + ' drone-running-clone');
    // Re-position in the canvas's coord space (the clone has lost its
    // original DOM-nesting context, so its transform is now relative
    // to the canvas root rather than its old parent block).
    const xy = block.getRelativeToSurfaceXY();
    clone.setAttribute('transform', `translate(${xy.x}, ${xy.y})`);
    overlay.appendChild(clone);
    currentHighlightedBlock = block;
  }
  function setRepeatCount(blockId, count) {
    const block = workspace.getBlockById(blockId);
    if (!block) return;
    Blockly.Events.disable();
    try { block.setFieldValue(count, 'TIMES'); }
    finally { Blockly.Events.enable(); }
  }
  // NOTE: this snapshot/restore is intentionally `repeat_n`-shaped. If
  // we ever add another block whose field gets mutated during a run
  // (e.g. a future "wait N seconds" counter), generalise this into a
  // per-block "transient field" registry rather than copying.
  function snapshotRepeatCounts() {
    originalRepeatCounts.clear();
    for (const b of workspace.getAllBlocks(true)) {
      if (b.type === 'repeat_n') {
        originalRepeatCounts.set(b.id, b.getFieldValue('TIMES'));
      }
    }
  }
  function restoreRepeatCounts() {
    for (const [id, count] of originalRepeatCounts) {
      setRepeatCount(id, count);
    }
    originalRepeatCounts.clear();
  }
  function endRunVisuals() {
    highlightBlock(null);
    restoreRepeatCounts();
  }

  // ----- End-of-flight feedback "stamp" ---------------------------------
  // Shows a hand-stamped note over the canvas when a program finishes:
  // a sparkle-burst celebration on a win, or the (forgiving) reason on
  // a loss. Replaces the old "flight complete ✨" status-pill text — the
  // pill now only carries in-flight progress + crash messages.
  const feedbackEl = document.getElementById('sim-feedback');
  let feedbackTimer = null;

  const WIN_TITLES = ['you did it!', 'nailed it!', 'woohoo!', 'perfect!', 'yes!'];
  const WIN_FLOURISHES = ['well flown ✶', 'what a pilot', 'high five!', 'magic ✦'];
  const SPARK_COLORS = ['#E9B44C', '#7FA877', '#E76F51', '#C9486A'];
  // 4-point sparkle + a short ink dash, drawn (not bright confetti).
  const SPARK_SVG =
    '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">' +
    '<path d="M12 1 L14 10 L23 12 L14 14 L12 23 L10 14 L1 12 L10 10 Z"/></svg>';

  function clearFlightFeedback() {
    clearTimeout(feedbackTimer);
    feedbackTimer = null;
    feedbackEl.classList.remove('is-leaving');
    feedbackEl.dataset.state = 'hidden';
    feedbackEl.replaceChildren();
  }

  function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

  function spawnSparkles(card) {
    const N = 14;
    for (let i = 0; i < N; i++) {
      const span = document.createElement('span');
      span.className = 'feedback-spark';
      const angle = (Math.PI * 2 * i) / N + (Math.random() - 0.5) * 0.5;
      const dist = 42 + Math.random() * 52;
      const size = 10 + Math.random() * 8;
      span.style.setProperty('--dx', `${Math.cos(angle) * dist}px`);
      span.style.setProperty('--dy', `${Math.sin(angle) * dist}px`);
      span.style.setProperty('--rot', `${(Math.random() - 0.5) * 220}deg`);
      span.style.setProperty('--size', `${size}px`);
      span.style.setProperty('--dur', `${620 + Math.random() * 220}ms`);
      span.style.setProperty('--delay', `${Math.random() * 130}ms`);
      span.style.setProperty('--spark-color', pick(SPARK_COLORS));
      span.innerHTML = SPARK_SVG;
      span.addEventListener('animationend', () => span.remove());
      card.appendChild(span);
    }
  }

  // result: { won: true } | { won: false, reason: '…' }
  function showFlightFeedback(result) {
    clearFlightFeedback();
    // The stamp and the face always agree: win → celebrate (^ ^ eyes +
    // the on-canvas hop/pirouette/sparkles); any loss that wasn't a
    // physical crash → confused. A crash already set its dizzy face (and
    // the tumble), so don't overwrite it.
    if (result.won) {
      drone.celebrate();
    } else if (!drone._crash) {
      drone.setFace('confused');
      window.DroneSound?.uhOh();   // the crash already made its own noise
    }
    const card = document.createElement('div');
    card.className = 'feedback-card';

    if (result.won) {
      // Hold the stamp back so the drone's own celebration plays first —
      // the card thunks down center-canvas and would cover it. The timer
      // rides feedbackTimer, so clearFlightFeedback (next fly!/reset/level
      // switch) cancels a pending stamp too.
      feedbackTimer = setTimeout(() => {
        feedbackEl.style.setProperty('--feedback-accent', 'var(--logic)');
        feedbackEl.dataset.state = 'win';
        card.innerHTML =
          `<p class="feedback-card__title">${pick(WIN_TITLES)}</p>` +
          `<p class="feedback-card__flourish">${pick(WIN_FLOURISHES)}</p>`;
        feedbackEl.appendChild(card);
        spawnSparkles(card);
      }, 750);
    } else {
      feedbackEl.style.setProperty('--feedback-accent', 'var(--flight)');
      feedbackEl.dataset.state = 'lose';
      card.innerHTML =
        `<p class="feedback-card__title">${result.title || 'so close!'}</p>` +
        `<p class="feedback-card__msg">${result.reason || "that didn't quite work"}</p>`;
      feedbackEl.appendChild(card);
    }
    // Both states persist until the next fly!/reset (matches the
    // persistent-error rule) — or until a tap on the canvas dismisses
    // the stamp early.
  }

  runBtn.addEventListener('click', async () => {
    // Browsers only allow audio after a user gesture — this click is one,
    // so the sound engine wakes up here (no-op once running).
    window.DroneSound?.unlock();
    // Any button press clears a lingering stamp first, so a previous
    // result (or the empty-plan nudge below) never bleeds into the
    // next run.
    clearFlightFeedback();

    if (resetMode) {
      // Mid-flight cancel: drone.reset() bumps the generation counter, so
      // any in-flight tween bails on its next frame without writing more
      // state. Trail clears as part of reset.
      drone.reset();
      setResetMode(false);     // also clears per-flight visuals (see setResetMode)
      return;
    }

    const emptyPlan = { won: false, title: 'oops!',
      reason: 'your flight plan is empty — add some blocks first!' };

    if (currentMode === 'real') {
      const pyCode = pyGen.workspaceToCode(workspace);
      if (!pyCode.trim()) {
        showFlightFeedback(emptyPlan);
        return;
      }
      drone.reset();
      bridge.send({ op: 'run', code: pyCode });
      return;
    }

    // pretend mode — run the JS-generated code against the in-browser sim
    const code = jsGen.workspaceToCode(workspace);
    if (!code.trim()) {
      showFlightFeedback(emptyPlan);
      return;
    }

    drone.reset();
    setResetMode(true);   // flip immediately so the kid can abort any time
    snapshotRepeatCounts();  // restore these later, no matter how the run ends
    const flightGen = drone._gen;
    await wait(120);

    try {
      // Helpers injected into the generated wrapper:
      //   flightGen        — sentinel so loops bail on mid-flight reset
      //   highlightBlock   — wired in by STATEMENT_PREFIX, lights up the
      //                      block currently being executed
      //   setRepeatCount   — called by the repeat_n generator to tick the
      //                      "N times" field down per iteration
      const fn = new Function(
        'drone', 'flightGen', 'highlightBlock', 'setRepeatCount',
        `return (async () => {\n${code}\n})();`,
      );
      await fn(drone, flightGen, highlightBlock, setRepeatCount);
      if (drone._gen !== flightGen) return;
      if (drone._stopped) {
        // stop button already set its own message.
      } else {
        const result = evaluateWin(drone, currentLevel);
        // Win/lose now lives on the canvas stamp, not the status pill.
        // Drop the pill back to neutral on a win (no stale "flying…"),
        // keep the reason on the pill for a loss as a quiet secondary.
        // (faces are set by showFlightFeedback, alongside the stamp)
        if (result.won) drone._setStatus('ready when you are', 'idle');
        else            drone._setStatus(result.reason, 'stopped');
        showFlightFeedback(result);
      }
    } catch (err) {
      console.error(err);
      if (drone._gen === flightGen) {
        const reason = "hmm — that didn't work. let's try again!";
        drone._setStatus(reason, 'stopped');
        showFlightFeedback({ won: false, reason });
      }
    } finally {
      endRunVisuals();
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

  // ----- Sound toggle ------------------------------------------------------
  const soundBtn = document.getElementById('sound-btn');
  function renderSoundBtn() {
    const muted = !!window.DroneSound?.muted;
    soundBtn.textContent = muted ? '🔇' : '🔊';
    soundBtn.classList.toggle('is-muted', muted);
  }
  soundBtn.addEventListener('click', () => {
    const s = window.DroneSound;
    if (!s) return;
    s.unlock();              // a click is a gesture — safe to start audio
    s.setMuted(!s.muted);
    renderSoundBtn();
  });
  renderSoundBtn();

  // ----- Canvas pan (drag to look around) --------------------------------
  let panActive = false;
  let panStart  = null;
  canvas.addEventListener('pointerdown', (e) => {
    // A tap dismisses a lingering feedback stamp (win or lose).
    if (feedbackEl.dataset.state !== 'hidden') clearFlightFeedback();
    panActive = true;
    panStart  = { cx: e.clientX, cy: e.clientY, px: drone._panX, py: drone._panY };
    canvas.setPointerCapture(e.pointerId);
    canvas.classList.add('is-panning');
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!panActive) return;
    drone.setPan(panStart.px + (e.clientX - panStart.cx),
                 panStart.py + (e.clientY - panStart.cy));
  });
  const endPan = (e) => {
    if (!panActive) return;
    panActive = false;
    canvas.classList.remove('is-panning');
    try { canvas.releasePointerCapture(e.pointerId); } catch {}
  };
  canvas.addEventListener('pointerup', endPan);
  canvas.addEventListener('pointercancel', endPan);

  // Double-click to recenter: reset pan + re-fit zoom to the level.
  canvas.addEventListener('dblclick', () => {
    drone.setPan(0, 0);
    applyCanvasZoom(autoFitZoom(currentLevel));
  });

  // ----- Boot ------------------------------------------------------------
  // Last thing in the IIFE so every declaration above has run before
  // setLevel(0) calls setResetMode(false) (which reads `let resetMode`).
  buildLevelTabs();
  // If the kid was on a particular level last session, drop her back
  // there. Level ids are numbers (1, 2, …) or the literal 'sandbox'.
  let initialLevelId = 1;
  try {
    const stored = localStorage.getItem(LAST_LEVEL_KEY);
    if (stored !== null) {
      const asNum = Number(stored);
      const candidate = Number.isFinite(asNum) && String(asNum) === stored ? asNum : stored;
      if (LEVELS.some(l => l.id === candidate && !l.hidden)) initialLevelId = candidate;
    }
  } catch (_) {}
  setLevel(initialLevelId);
})();
