// Headless connection-graph tests for the block-flow module's
// delete-then-insert and start-over paths.
//
// NO browser, NO rendering. We load the real frontend blocks.js + blockflow.js
// through the harness, build a BlockFlow with NO-OP hooks (so the connection
// logic and the anchor/rearrange state machine run, but every DOM/rendering
// side-effect is skipped), wire the workspace change listener exactly as app.js
// does, then drive the SAME operations the kid's clicks/toolbar do
// (insertBlock / moveActiveBlock / deleteActiveBlock / startOver) and assert on
// the resulting CONNECTION GRAPH.
//
// "Superpose" === more than one top block when every inserted block was
// connectable and should have formed ONE chain. The harness's chainTypes()
// throws unless there is exactly one top block, so it doubles as a superpose
// guard; topCount() is asserted directly where the shape isn't the point.

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  loadFrontend,
  makeWorkspace,
  flush,
  topCount,
  chainTypes,
} from './harness.mjs';

// Build a fresh workspace + BlockFlow (no-op hooks) with the change listener
// subscribed, mirroring app.js's `ws.addChangeListener(e => bf.onWorkspaceEvent(e))`.
function setup() {
  const { BlockFlow, Blockly } = loadFrontend();
  assert.equal(typeof BlockFlow?.create, 'function', 'expected window.BlockFlow.create');
  const ws = makeWorkspace();
  const bf = BlockFlow.create(ws, {});
  ws.addChangeListener((e) => bf.onWorkspaceEvent(e));
  return { Blockly, ws, bf };
}

// ---------------------------------------------------------------------------
// Baseline: plain click-insert builds one chain (no rearrange, no delete).
// Establishes that the harness + listener path link correctly before we start
// stressing the stale-anchor / lock branches.
// ---------------------------------------------------------------------------
test('baseline: four click-inserts form a single chain', async () => {
  const { ws, bf } = setup();

  bf.insertBlock('take_off');
  bf.insertBlock('fly_forward');
  bf.insertBlock('fly_forward');
  bf.insertBlock('land');
  await flush();

  assert.equal(topCount(ws), 1, 'four connectable blocks must form ONE tower, not superpose');
  assert.deepEqual(chainTypes(ws), ['take_off', 'fly_forward', 'fly_forward', 'land']);
});

// ---------------------------------------------------------------------------
// SCENARIO: delete the middle (active) block, then keep inserting.
// Regression guard for the e.ids / disposed-anchor fix: after deleting the
// active block the module re-anchors to a live neighbour, so the next
// click-inserts must extend the SAME chain — no superpose.
// ---------------------------------------------------------------------------
// The chain's bottom after the heal must be able to ACCEPT more blocks, so we
// use fly_up (a mid-block with a nextConnection) as the bottom rather than a
// terminating `land` — anchoring on a terminator and expecting a chain would
// be a test bug, not a module bug.
test('delete the active middle block, then insert — stays one chain', async () => {
  const { ws, bf } = setup();

  bf.insertBlock('take_off');
  const f1 = bf.insertBlock('fly_forward'); // the middle block we'll delete
  bf.insertBlock('fly_up');
  await flush();
  assert.deepEqual(chainTypes(ws), ['take_off', 'fly_forward', 'fly_up']);

  // Make the middle block the active one (kid taps it), as the toolbar would.
  bf.setLastActive(f1);
  assert.equal(bf.getLastActive(), f1);

  // ✕ on the middle block: dispose heals the stack and re-anchors to a neighbour.
  // The next neighbour (fly_up) is preferred over prev, and it can take a next.
  bf.deleteActiveBlock();
  await flush();
  assert.equal(topCount(ws), 1, 'deleting the middle block must heal the stack to ONE top');
  assert.deepEqual(chainTypes(ws), ['take_off', 'fly_up']);

  // The anchor must point at a LIVE, non-disposed block so the next click chains.
  const anchor = bf.getLastActive();
  assert.ok(anchor && anchor.workspace && !anchor.disposed,
    're-anchor after delete must be a live, non-disposed block');

  // New connectable blocks must join the existing chain, not pile up.
  bf.insertBlock('fly_forward');
  bf.insertBlock('turn_left');
  await flush();
  assert.equal(topCount(ws), 1, 'inserts after a delete must extend the same chain (no superpose)');
  assert.deepEqual(chainTypes(ws), ['take_off', 'fly_up', 'fly_forward', 'turn_left']);
});

// ---------------------------------------------------------------------------
// SCENARIO: whole-chain delete via the TOP block.
// Disposing the chain top deletes its descendants in ONE BLOCK_DELETE event;
// e.ids carries the descendants, blockId is only the top. The listener must
// drop the anchor when lastActive is among e.ids — otherwise a later
// click-insert connects into the dead chain and vanishes (the bug the e.ids
// guard fixes). A disposed block keeps a truthy .workspace, so this is exactly
// the stale-anchor trap.
// ---------------------------------------------------------------------------
test('delete the whole chain via its top block, then insert — fresh single chain', async () => {
  const { ws, bf } = setup();

  bf.insertBlock('take_off');
  const f1 = bf.insertBlock('fly_forward');
  bf.insertBlock('fly_forward');
  bf.insertBlock('land');
  await flush();
  const top = ws.getTopBlocks(false)[0];
  assert.equal(top.type, 'take_off');

  // Anchor at a DESCENDANT, then delete the whole chain by disposing the top.
  // The deleted descendant is reported only in e.ids, not blockId.
  bf.setLastActive(f1);
  Blockly.Events.setGroup(true);
  try {
    top.dispose(true);
  } finally {
    Blockly.Events.setGroup(false);
  }
  await flush();
  assert.equal(topCount(ws), 0, 'whole chain gone');

  // The anchor must have been dropped (it was a now-disposed descendant).
  assert.equal(bf.getLastActive(), null,
    'BLOCK_DELETE e.ids guard must null the anchor when a descendant of the active chain is deleted');

  // Fresh inserts must build ONE new chain, not superpose on a dead anchor.
  bf.insertBlock('take_off');
  bf.insertBlock('fly_forward');
  bf.insertBlock('land');
  await flush();
  assert.equal(topCount(ws), 1, 'after whole-chain delete, new inserts must form ONE chain (no superpose)');
  assert.deepEqual(chainTypes(ws), ['take_off', 'fly_forward', 'land']);
});

// ---------------------------------------------------------------------------
// SCENARIO: delete down to empty, then insert.
// With no neighbours left the re-anchor falls through to null; the first new
// block is a free-placed starter and follow-ups chain onto it.
// ---------------------------------------------------------------------------
test('delete every block, then rebuild — one chain from scratch', async () => {
  const { ws, bf } = setup();

  bf.insertBlock('take_off');
  bf.insertBlock('land');
  await flush();

  // Delete the active (land), then the remaining (take_off).
  bf.deleteActiveBlock();
  await flush();
  bf.setLastActive(ws.getTopBlocks(false)[0]);
  bf.deleteActiveBlock();
  await flush();
  assert.equal(topCount(ws), 0, 'workspace emptied');
  assert.equal(bf.getLastActive(), null, 'no anchor once the workspace is empty');

  bf.insertBlock('take_off');
  bf.insertBlock('fly_forward');
  bf.insertBlock('land');
  await flush();
  assert.equal(topCount(ws), 1, 'rebuild after full delete must be ONE chain');
  assert.deepEqual(chainTypes(ws), ['take_off', 'fly_forward', 'land']);
});

// ---------------------------------------------------------------------------
// Control: a toolbar move followed by inserts (NO start-over) keeps one chain.
// This isolates the move-then-insert path from the start-over path: the
// rearrange lock is set + cleared correctly when the kid's next action is a
// genuine insert, so linking must survive. If THIS regressed it would point at
// the lock machinery itself rather than start-over.
// ---------------------------------------------------------------------------
test('control: toolbar up-move then more inserts stays one chain', async () => {
  const { ws, bf } = setup();

  bf.insertBlock('take_off');
  bf.insertBlock('fly_forward');
  const f2 = bf.insertBlock('fly_up');
  await flush();

  // Move the last block up one (sets internalRearrange / rearrangeTargetBlock).
  bf.setLastActive(f2);
  bf.moveActiveBlock('up');
  await flush(); // let the deferred re-pin + late BLOCK_MOVE tail settle
  assert.equal(topCount(ws), 1, 'a swap must not split the chain');

  // Keep inserting — must extend the SAME single chain.
  bf.insertBlock('fly_forward');
  bf.insertBlock('land');
  await flush();
  assert.equal(topCount(ws), 1, 'inserts after a toolbar move must stay one chain (no superpose)');
});

// ---------------------------------------------------------------------------
// THE USER-REPORTED BUG (superpose after start-over).
// Repro: add ~4 blocks (link fine) -> move some up/down with the toolbar ->
// start over -> click blocks again -> the NEW blocks DO NOT connect; multiple
// top-level blocks appear.
//
// CONFIRMED MECHANISM: moveActiveBlock sets internalRearrange /
// rearrangeTargetBlock and startOver deliberately does NOT call
// endRearrangeLock (see blockflow.js — the lock survives the wipe).
// rearrangeTargetBlock now points at a DISPOSED block whose .workspace is still
// truthy. After start-over, each kid click fires Blockly's deferred BLOCK_MOVE
// tail; onWorkspaceEvent's BLOCK_MOVE branch ( internalRearrange &&
// rearrangeTargetBlock.workspace ) calls setLastActive(rearrangeTargetBlock),
// which — because the target is disposed — sets lastActive to NULL. So between
// one insert's setLastActive and the next insert's anchorBlock read, the anchor
// is wiped, the next block free-places, and the blocks superpose.
//
// NOTE ON TIMING: the kid's clicks happen in SEPARATE event-loop turns, not one
// synchronous tick. We flush() between each insert to model that — that is when
// the deferred BLOCK_MOVE lands and clobbers the anchor. (Batching all inserts
// in one tick masks the bug, because the move events coalesce after the chain
// already formed; that is not how real clicks arrive.)
//
// The assertion below states the CORRECT behaviour (ONE chain). A FAILURE HERE
// IS THE CAPTURED BUG — do not weaken it to make the suite green; fixing it
// means calling endRearrangeLock() from startOver().
// ---------------------------------------------------------------------------
test('CAPTURED BUG: toolbar move then start-over then re-insert must form one chain', async () => {
  const { ws, bf } = setup();

  // Build a chain of four; they link fine.
  bf.insertBlock('take_off');
  bf.insertBlock('fly_forward');
  bf.insertBlock('fly_up');
  const last = bf.insertBlock('land');
  await flush();
  assert.equal(topCount(ws), 1, 'precondition: the initial four blocks link into one chain');

  // Move some with the toolbar — this SETS the sticky rearrange lock.
  bf.setLastActive(last);
  bf.moveActiveBlock('up');
  await flush();
  // The lock is set and pinned at the moved block (still live at this point).
  assert.equal(bf.getState().internalRearrange, true,
    'precondition: a toolbar move arms the rearrange lock');

  // Start over — wipes blocks AND (the fix) releases the rearrange lock so it
  // can't re-pin the anchor to the now-disposed move target.
  bf.startOver();
  await flush();
  assert.equal(topCount(ws), 0, 'start-over clears the workspace');
  // FIXED (regression guard): start-over must leave the lock released.
  assert.equal(bf.getState().internalRearrange, false,
    'start-over must clear the rearrange lock (endRearrangeLock)');
  assert.equal(bf.getState().rearrangeTargetBlock, null,
    'start-over must drop the rearrange target');

  // Now the kid clicks blocks again — ONE AT A TIME, in separate ticks (flush
  // between each), exactly as real clicks arrive. Each is connectable and
  // should chain onto the previous.
  bf.insertBlock('take_off');
  await flush();
  bf.insertBlock('fly_forward');
  await flush();
  bf.insertBlock('fly_forward');
  await flush();

  // CORRECT behaviour: ONE chain. A failure here (topCount > 1) reproduces the
  // user-reported superpose bug — the new blocks dropped on top of each other
  // instead of linking into a tower.
  assert.equal(
    topCount(ws), 1,
    'BUG: blocks superposed after start-over — the rearrange lock survived the wipe and ' +
      're-pinned the anchor to a disposed block (nulling it), so click-inserts no longer ' +
      'chain. Fix: startOver() must call endRearrangeLock().',
  );
  assert.deepEqual(chainTypes(ws), ['take_off', 'fly_forward', 'fly_forward']);
});

// ---------------------------------------------------------------------------
// Same superpose bug, isolated to the down-move direction, to confirm it's the
// lock surviving start-over and not specific to which way the block moved.
// CORRECT behaviour asserted; failure == the captured bug.
// ---------------------------------------------------------------------------
test('CAPTURED BUG: toolbar DOWN-move then start-over then re-insert must form one chain', async () => {
  const { ws, bf } = setup();

  bf.insertBlock('take_off');
  const f1 = bf.insertBlock('fly_forward');
  bf.insertBlock('fly_up');
  bf.insertBlock('land');
  await flush();

  // Move the second block down — arms the lock just the same.
  bf.setLastActive(f1);
  bf.moveActiveBlock('down');
  await flush();
  assert.equal(bf.getState().internalRearrange, true);

  bf.startOver();
  await flush();
  assert.equal(topCount(ws), 0);

  // Clicks one at a time, in separate ticks (see timing note above).
  bf.insertBlock('take_off');
  await flush();
  bf.insertBlock('fly_forward');
  await flush();
  bf.insertBlock('land');
  await flush();

  assert.equal(
    topCount(ws), 1,
    'BUG: superpose after a down-move + start-over (rearrange lock survived the wipe).',
  );
  assert.deepEqual(chainTypes(ws), ['take_off', 'fly_forward', 'land']);
});

// ---------------------------------------------------------------------------
// Proves the fix shape WITHOUT modifying app/blockflow: if the lock is cleared
// (as the fix would have startOver do) the superpose disappears. Calling
// bf.endRearrangeLock() manually before re-inserting stands in for the fix and
// shows the inserts then chain correctly — pinpointing the lock as the cause.
// This test SHOULD PASS today; it documents the remedy.
// ---------------------------------------------------------------------------
test('diagnosis: clearing the rearrange lock after start-over restores linking', async () => {
  const { ws, bf } = setup();

  bf.insertBlock('take_off');
  bf.insertBlock('fly_forward');
  const last = bf.insertBlock('land');
  await flush();

  bf.setLastActive(last);
  bf.moveActiveBlock('up');
  await flush();

  bf.startOver();
  // Stand in for the fix: clear the lock that start-over failed to clear.
  bf.endRearrangeLock();
  await flush();

  // Same one-click-per-tick timing that triggers the bug when the lock is left
  // armed — here, with the lock cleared, the inserts chain normally.
  bf.insertBlock('take_off');
  await flush();
  bf.insertBlock('fly_forward');
  await flush();
  bf.insertBlock('fly_forward');
  await flush();

  assert.equal(topCount(ws), 1,
    'with the rearrange lock cleared, click-inserts chain normally (no superpose)');
  assert.deepEqual(chainTypes(ws), ['take_off', 'fly_forward', 'fly_forward']);
});
