/* Drone Lab — block-flow module (headless)
   ---------------------------------------------------------
   Owns ALL of the block-connection-graph decisions and the
   anchor / rearrange STATE MACHINE that used to live inline
   in app.js: where a click-inserted block attaches, the
   floating-toolbar reorder/delete primitives, the sticky
   `internalRearrange` lock that keeps focus pinned across
   Blockly's deferred BLOCK_MOVE tail, and the change-listener
   branches that track the active anchor.

   Everything that touches the DOM / rendering (SVG glow,
   toolbar positioning, refreshCode, hint visibility, number
   editor focus, scroll-lock, initSvg/render) is pushed behind
   `hooks.*` callbacks so the connection logic stays headless
   and unit-testable. app.js passes real implementations; tests
   pass no-ops.

   This is a plain browser IIFE — no import/export. It reads the
   global `Blockly` and attaches `window.BlockFlow = { create }`.
   It also loads under the Node harness (globalThis.Blockly set,
   file text eval'd), where `window` === globalThis.
   ========================================================= */

(function () {
  // create(workspace, hooks) -> block-flow operations.
  //
  // hooks (all optional; default to no-ops):
  //   initBlockSvg(block)        — initSvg() + render() (kept out of headless tests)
  //   onActiveChanged(block|null)— apply 'drone-active' glow + positionToolbar
  //                                (replaces setLastActive's getSvgRoot/positionToolbar)
  //   onStructureChanged()       — refreshCode + updateHintVisibility (+ debounced persist)
  //   onBlockSettled(block)      — settleViewAndFocus / focusFirstNumberField (deferred tails)
  //   onToolbarHidden(bool)      — toggle the floating toolbar's is-hidden on BLOCK_DRAG
  //   clientToWorkspace(x, y)    — translate client coords → workspace coords (drag-drop)
  function create(workspace, hooks) {
    hooks = hooks || {};
    const noop = () => {};
    const initBlockSvg     = hooks.initBlockSvg     || noop;
    const onActiveChanged  = hooks.onActiveChanged  || noop;
    const onStructureChanged = hooks.onStructureChanged || noop;
    const onBlockSettled   = hooks.onBlockSettled   || noop;
    const onToolbarHidden  = hooks.onToolbarHidden  || noop;
    const clientToWorkspace = hooks.clientToWorkspace ||
      ((x, y) => ({ x, y }));

    // ----- Active-block tracking ----------------------------------------
    // `lastActive` is the anchor for the next click-insert. The app glows
    // it softly (via onActiveChanged) so the kid can see where new blocks
    // will attach. Updated on create / move / selection — whichever
    // happened most recently.
    let lastActive = null;
    function setLastActive(blk) {
      // Reject disposed blocks too — a block deleted as part of a chain
      // keeps a truthy .workspace, so .workspace alone is not enough.
      lastActive = blk && blk.workspace && !blk.disposed ? blk : null;
      // The app applies/removes the 'drone-active' class and repositions
      // the floating toolbar in this hook (was getSvgRoot + positionToolbar).
      onActiveChanged(lastActive);
    }

    // While a programmatic move is in flight (and for its long tail of
    // late BLOCK_MOVE events), keep focus pinned to the block the kid
    // acted on. The lock is cleared by the next user-driven action.
    let internalRearrange = false;
    let rearrangeTargetBlock = null;
    function endRearrangeLock() {
      internalRearrange = false;
      rearrangeTargetBlock = null;
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

    // ----- Toolbar reorder / delete --------------------------------------
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
      onStructureChanged();   // was refreshCode()
      setTimeout(() => {
        setLastActive(block);
        onBlockSettled(block);   // was settleViewAndFocus + rAF positionToolbar
      }, 0);
    }

    function deleteActiveBlock() {
      if (!lastActive || !lastActive.workspace) return;
      // A delete is a fresh user action — drop any sticky toolbar rearrange
      // lock so the deferred dispose/heal BLOCK_MOVE tail can't re-pin the
      // anchor onto the (possibly just-disposed) rearrange target. Without
      // this, "move a block then delete one then insert" superposed.
      endRearrangeLock();
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
      onStructureChanged();   // was refreshCode() + updateHintVisibility()
    }

    // ----- Click-to-insert ------------------------------------------------
    function insertBlock(type) {
      let newBlk;
      Blockly.Events.setGroup(true);
      try {
        newBlk = workspace.newBlock(type);
        initBlockSvg(newBlk);   // was newBlk.initSvg() + newBlk.render()
        try {
          anchorBlock(newBlk);
        } catch (err) {
          // Belt and braces: a bad anchor must NEVER eat the kid's click —
          // a block has to appear no matter what. Drop the anchor and
          // re-place via the (exception-free) no-anchor path.
          console.warn('insertBlock: anchoring failed, placing block free', err);
          setLastActive(null);
          anchorBlock(newBlk);
        }
      } finally {
        Blockly.Events.setGroup(false);
      }
      // A condition that plugged into a slot keeps the anchor on its
      // PARENT statement block, so the next flight block still chains
      // onto the sequence rather than dangling off the condition.
      const plugged = newBlk.outputConnection && newBlk.getParent();
      setLastActive(plugged ? newBlk.getParent() : newBlk);
      onStructureChanged();   // was refreshCode() + updateHintVisibility()
      // Settle the view (scroll-lock + scroll a bottom block into view if
      // the stack overflows) and then open the inline number editor, so the
      // kid can type a value right away without a second tap — and so no
      // late scroll dismisses the auto-selected value.
      setTimeout(() => onBlockSettled(newBlk), 0);   // was settleViewAndFocus(newBlk)
      return newBlk;
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
      const anchorOk = lastActive && lastActive.workspace && !lastActive.disposed;
      let anchor = anchorOk ? lastActive : null;

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

      // A container anchor swallows the next block: when the glowing block
      // is a repeat (later: an if), the kid's next tap means "put this
      // INSIDE it" — so connect at the end of its body, not after the
      // chain. Once the new block anchors itself, follow-up taps keep
      // chaining within the body.
      if (newBlk.previousConnection) {
        const bodyInput = (anchor.inputList || []).find(isStatementInput);
        if (bodyInput) {
          moveBlockToEndOfInput(newBlk, bodyInput);
          return;
        }
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

    // ----- Drag-from-palette drop ----------------------------------------
    // Takes CLIENT coords; the client→workspace translation runs through
    // the clientToWorkspace hook (it needs the live injection div rect,
    // which stays app-side).
    function insertBlockAt(type, clientX, clientY) {
      let newBlk;
      Blockly.Events.setGroup(true);
      try {
        newBlk = workspace.newBlock(type);
        initBlockSvg(newBlk);   // was newBlk.initSvg() + newBlk.render()

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
      onStructureChanged();   // was refreshCode() + updateHintVisibility()
      setTimeout(() => onBlockSettled(newBlk), 0);   // was focusFirstNumberField(newBlk)
      return newBlk;
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

    // ----- Workspace change listener (block-flow branches only) ----------
    // The app keeps the change listener and forwards every event here for
    // the anchor + rearrange-lock branches. App concerns (toolbar visibility
    // on drag, viewport positioning, persistence, refreshCode, hint
    // visibility) stay in app.js — only the toolbar-hide on BLOCK_DRAG is
    // surfaced here as the onToolbarHidden hook because it's coupled to the
    // lock-clear.
    function onWorkspaceEvent(e) {
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
        // Defense in depth: never re-pin focus to a DISPOSED rearrange target.
        // A disposed block keeps a truthy `.workspace`, so `.workspace` alone
        // isn't enough — without the `!disposed` guard a stale lock (after a
        // delete/clear) would re-pin lastActive to a dead block, nulling the
        // anchor and making the next click-inserts superpose.
        if (internalRearrange && rearrangeTargetBlock &&
            rearrangeTargetBlock.workspace && !rearrangeTargetBlock.disposed) {
          // Late event from the rearrange — force focus back to the
          // block the kid acted on, regardless of which block Blockly
          // happens to report moved.
          setLastActive(rearrangeTargetBlock);
        } else {
          const blk = workspace.getBlockById(e.blockId);
          if (blk) setLastActive(blk);
        }
      } else if (e.type === Blockly.Events.BLOCK_DELETE && lastActive &&
                 (e.blockId === lastActive.id || e.ids?.includes(lastActive.id))) {
        // e.ids lists EVERY deleted block (a chain deletes its descendants in
        // one event, blockId is only the top). Missing a descendant here left
        // lastActive pointing at a disposed block whose .workspace is still
        // truthy — and the next click-insert would connect the new block
        // into the dead chain, swallowing it invisibly.
        setLastActive(null);
      } else if (e.type === Blockly.Events.BLOCK_DRAG) {
        // User started a real drag — release the rearrange lock and hide
        // the floating toolbar so it doesn't trail the drag preview.
        if (e.isStart) endRearrangeLock();
        onToolbarHidden(!!e.isStart);   // was toolbarEl.is-hidden toggle + rAF positionToolbar
      }
    }

    // ----- Start-over / level-reset / restore ----------------------------
    // Start-over wipes all blocks. It MUST also release the sticky toolbar
    // rearrange lock: a prior up/down move sets internalRearrange +
    // rearrangeTargetBlock, and after the wipe that target is disposed. With
    // the lock still armed the change listener re-pinned the click anchor to
    // the dead block, so the next click-inserts free-placed as separate top
    // blocks (the "superpose" bug). Clearing the lock here is the fix.
    function startOver() {
      if (workspace.getAllBlocks(false).length === 0) return;
      setLastActive(null);
      endRearrangeLock();     // <- fixes the superpose-after-start-over bug
      workspace.clear();
      onStructureChanged();   // was refreshCode() + updateHintVisibility()
    }

    // Level switch clears the workspace and the anchor. Release the rearrange
    // lock too (same reason as start-over) so a move on the previous level
    // can't leak its lock into the next.
    function onLevelReset() {
      setLastActive(null);
      endRearrangeLock();
    }

    // After a serialization load, re-anchor click-to-insert at the bottom
    // of the first chain so the kid can keep appending right where she
    // left off.
    function restoreAnchor() {
      const tops = workspace.getTopBlocks(true);
      if (tops.length) {
        let bottom = tops[0];
        while (bottom.nextConnection?.targetBlock()) {
          bottom = bottom.nextConnection.targetBlock();
        }
        setLastActive(bottom);
      }
    }

    // Undo may have removed the current anchor — drop it if so.
    function reconcileAnchorAfterUndo() {
      if (lastActive && !workspace.getBlockById(lastActive.id)) setLastActive(null);
    }

    return {
      // connection-graph / anchor operations
      insertBlock,
      insertBlockAt,
      anchorBlock,
      setLastActive,
      getLastActive: () => lastActive,
      moveActiveBlock,
      deleteActiveBlock,
      onWorkspaceEvent,
      startOver,
      clearAll: startOver,        // alias — same wipe path
      onLevelReset,
      restoreAnchor,
      reconcileAnchorAfterUndo,
      endRearrangeLock,
      // toolbar arrow greying predicates
      canMoveUp,
      canMoveDown,
      // white-box getters for tests
      getState: () => ({ lastActive, internalRearrange, rearrangeTargetBlock }),
    };
  }

  (window || globalThis).BlockFlow = { create };
})();
