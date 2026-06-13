// Headless connection-graph tests for the click-to-insert block-flow.
//
// These drive the EXACT operations the kid's palette clicks and per-block
// floating-toolbar produce — bf.insertBlock(type), bf.moveActiveBlock('up'|
// 'down'), bf.deleteActiveBlock(), bf.startOver() — against the real
// blockflow.js logic loaded by the headless harness (no DOM, no rendering,
// no-op hooks). We assert on the CONNECTION GRAPH only: how many top blocks
// there are and the depth-first chain of types.
//
// "Superpose" === more than one top block when every inserted block was
// connectable and SHOULD have formed one chain. That is the user-reported
// bug ("blocks stop linking into a tower and instead drop superposed on top
// of each other"), and the start-over scenario below is written to FAIL while
// the bug is live — see the comment on that test.

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  loadFrontend,
  makeWorkspace,
  flush,
  topCount,
  chainTypes,
} from './harness.mjs';

// One BlockFlow wired exactly like app.js: no-op hooks, change listener
// forwarding every event to onWorkspaceEvent. Returns { ws, bf }.
function setup() {
  const { BlockFlow } = loadFrontend();
  assert.equal(typeof BlockFlow?.create, 'function', 'expected window.BlockFlow.create');
  const ws = makeWorkspace();
  const bf = BlockFlow.create(ws, {});
  ws.addChangeListener((e) => bf.onWorkspaceEvent(e));
  return { ws, bf };
}

// ---------------------------------------------------------------------------
// Baseline fresh-tower behaviour: the happy path the bug regresses against.
// ---------------------------------------------------------------------------

test('fresh inserts: take_off -> fly_forward -> fly_forward -> land form ONE chain in order', async () => {
  const { ws, bf } = setup();

  bf.insertBlock('take_off');
  bf.insertBlock('fly_forward');
  bf.insertBlock('fly_forward');
  bf.insertBlock('land');
  await flush();

  assert.equal(topCount(ws), 1, 'four connectable click-inserts should form a single tower');
  assert.deepEqual(chainTypes(ws), [
    'take_off',
    'fly_forward',
    'fly_forward',
    'land',
  ]);

  // Spot-check the raw connection graph too, not just the harness walk.
  const top = ws.getTopBlocks(false)[0];
  assert.equal(top.type, 'take_off');
  assert.equal(top.getNextBlock()?.type, 'fly_forward');
  assert.equal(top.getNextBlock()?.getNextBlock()?.type, 'fly_forward');
  assert.equal(
    top.getNextBlock()?.getNextBlock()?.getNextBlock()?.type,
    'land',
  );
  // land is a terminator — nothing after it.
  assert.equal(
    top.getNextBlock()?.getNextBlock()?.getNextBlock()?.getNextBlock(),
    null,
  );
});

test('from-empty single non-starter (fly_forward) appears as exactly one top block', async () => {
  const { ws, bf } = setup();

  const blk = bf.insertBlock('fly_forward');
  await flush();

  assert.equal(topCount(ws), 1, 'a lone non-starter must still produce one visible block');
  assert.deepEqual(chainTypes(ws), ['fly_forward']);
  // It has no parent — it really is a free top block, not swallowed anywhere.
  assert.equal(blk.getParent(), null);
  // And it became the click anchor for whatever comes next.
  assert.equal(bf.getLastActive(), blk);
});

test('the second fresh insert links onto the lone non-starter (no superpose from-empty)', async () => {
  const { ws, bf } = setup();

  // Spaced clicks (flush between) on a CLEAN workspace with no rearrange lock:
  // chaining must hold even with the macrotask gap. This is the control that
  // isolates the start-over bug below — same spacing, only the surviving lock
  // differs.
  bf.insertBlock('fly_forward');
  await flush();
  bf.insertBlock('fly_forward');
  await flush();

  assert.equal(topCount(ws), 1, 'two from-empty spaced non-starters should chain, not superpose');
  assert.deepEqual(chainTypes(ws), ['fly_forward', 'fly_forward']);
});

// ---------------------------------------------------------------------------
// Toolbar reorders alone don't break linking — isolate the lock-vs-startover
// interaction from the reorder itself.
// ---------------------------------------------------------------------------

test('inserts AFTER a toolbar move (no start-over) still chain into one tower', async () => {
  const { ws, bf } = setup();

  bf.insertBlock('take_off');
  bf.insertBlock('fly_forward'); // call this A
  bf.insertBlock('fly_forward'); // call this B (now the anchor)
  await flush();

  // Kid grabs the toolbar and nudges the active block up one. This SETS the
  // sticky internalRearrange lock.
  bf.moveActiveBlock('up');
  await flush();

  // Still one tower (just reordered), and the lock has been set by the move.
  assert.equal(topCount(ws), 1, 'a reorder must not split the tower');
  assert.deepEqual(chainTypes(ws), ['take_off', 'fly_forward', 'fly_forward']);

  // Now keep building. New blocks must continue to chain onto the tower.
  bf.insertBlock('fly_forward');
  bf.insertBlock('land');
  await flush();

  assert.equal(
    topCount(ws),
    1,
    'click-inserts after a toolbar reorder must keep chaining (one tower)',
  );
  assert.deepEqual(chainTypes(ws), [
    'take_off',
    'fly_forward',
    'fly_forward',
    'fly_forward',
    'land',
  ]);
});

// ---------------------------------------------------------------------------
// THE BUG (user-reported): build a tower, reorder with the toolbar, start
// over, then build again — the new blocks superpose instead of chaining.
//
// Mechanism (verified headlessly): moveActiveBlock sets internalRearrange /
// rearrangeTargetBlock; startOver() deliberately does NOT call
// endRearrangeLock() (it is bug-preserving, see blockflow.js). After
// workspace.clear() the rearrange target block is DISPOSED but keeps a truthy
// .id and .workspace, so the `internalRearrange && rearrangeTargetBlock &&
// rearrangeTargetBlock.workspace` guard in onWorkspaceEvent's BLOCK_MOVE branch
// still fires — and setLastActive(disposedTarget) rejects it, pinning the
// anchor to null. Because Blockly DEFERS BLOCK_MOVE via setTimeout(0), the
// re-pin-to-null lands one macrotask AFTER each insert. So the symptom appears
// only when there is a real time gap between the kid's clicks: the deferred
// re-pin fires, lastActive goes null, and the NEXT insert takes the no-anchor
// free-place path and lands as its own top block — SUPERPOSE. (Synchronous
// back-to-back inserts mask it because the deferred re-pin hasn't fired yet,
// which is why these tests await flush() BETWEEN inserts to model spaced clicks.)
//
// These two tests assert the CORRECT behaviour (one chain). A FAILURE here is
// the captured bug, not a broken test — do NOT weaken the assertion to make it
// pass. The fix is a one-liner (call endRearrangeLock in startOver); once that
// lands these go green.
// ---------------------------------------------------------------------------

test('BUG REPRO — start-over after a toolbar move: fresh spaced inserts must form ONE chain (failure here = the superpose bug)', async () => {
  const { ws, bf } = setup();

  // 1. Build a tower (these link fine).
  bf.insertBlock('take_off');
  bf.insertBlock('fly_forward');
  bf.insertBlock('fly_forward');
  bf.insertBlock('land');
  await flush();
  assert.equal(topCount(ws), 1, 'precondition: the initial tower links');

  // 2. Reorder with the toolbar (sets the sticky rearrange lock).
  bf.moveActiveBlock('up');
  await flush();

  // 3. Start over — wipes blocks but (bug) leaves the rearrange lock set.
  bf.startOver();
  await flush();
  assert.equal(topCount(ws), 0, 'precondition: start-over wiped the workspace');

  // 4. Build again, exactly as a kid clicking palette tiles would: each click
  //    is a separate user gesture spaced out in real time, so a macrotask gap
  //    (flush) sits between them — letting Blockly's deferred BLOCK_MOVE events
  //    fire and exposing the surviving rearrange lock.
  bf.insertBlock('take_off');
  await flush();
  bf.insertBlock('fly_forward');
  await flush();
  bf.insertBlock('fly_forward');
  await flush();
  bf.insertBlock('land');
  await flush();

  // CORRECT behaviour: one tower in order. If this fails with topCount > 1,
  // that is the user-reported superpose bug reproduced — see header comment.
  assert.equal(
    topCount(ws),
    1,
    'after start-over+rebuild every connectable insert should chain into ONE tower (superpose bug if >1)',
  );
  assert.deepEqual(chainTypes(ws), [
    'take_off',
    'fly_forward',
    'fly_forward',
    'land',
  ]);
});

test('BUG REPRO (non-starters only) — start-over after a move: three fresh spaced non-starters must chain (failure here = superpose)', async () => {
  const { ws, bf } = setup();

  // Arm the lock then trip it: build, reorder (sets the sticky lock), wipe.
  bf.insertBlock('take_off');
  bf.insertBlock('fly_forward');
  await flush();
  bf.moveActiveBlock('up'); // arms internalRearrange / rearrangeTargetBlock
  await flush();

  bf.startOver();
  await flush();

  // Three spaced clicks (flush between each = real time gaps). The first
  // insert's deferred BLOCK_MOVE re-pins the anchor to null (disposed locked
  // target); the SECOND then free-places as a new top, the third chains onto
  // it — so a healthy single chain (3) becomes two top blocks. Three is the
  // smallest count that strands a block DETERMINISTICALLY: with only two
  // inserts the second sometimes still lands on the first before the null
  // re-pin settles, so we use three to capture the superpose without timing
  // flakiness. All three are connectable and SHOULD form one tower.
  bf.insertBlock('fly_forward');
  await flush();
  bf.insertBlock('fly_forward');
  await flush();
  bf.insertBlock('fly_forward');
  await flush();

  // Three connectable blocks from empty SHOULD chain (the from-empty control
  // above proves spaced inserts chain on a clean workspace). If they
  // superpose here, the only difference is the surviving rearrange lock —
  // i.e. the captured bug.
  assert.equal(
    topCount(ws),
    1,
    'three fresh non-starters after start-over should chain, not superpose (superpose bug if >1)',
  );
  assert.deepEqual(chainTypes(ws), ['fly_forward', 'fly_forward', 'fly_forward']);
});

// ---------------------------------------------------------------------------
// Diagnostic: pin the mechanism named in the hypothesis. After start-over the
// rearrange lock should be CLEAR for fresh building to work. This documents
// the root cause directly (independent of the superpose symptom above).
// ---------------------------------------------------------------------------

test('DIAGNOSTIC — start-over after a toolbar move leaves the rearrange lock armed (root cause)', async () => {
  const { ws, bf } = setup();

  bf.insertBlock('take_off');
  bf.insertBlock('fly_forward');
  await flush();
  bf.moveActiveBlock('up');
  await flush();

  bf.startOver();
  await flush();

  const { internalRearrange, lastActive } = bf.getState();
  // For a healthy fresh build, the lock must be released and the anchor null.
  // A failure here is the precise root cause of the superpose bug: the lock
  // survives start-over (blockflow.js startOver() omits endRearrangeLock by
  // design), so the next inserts' BLOCK_MOVE events re-pin the anchor to the
  // disposed rearrange target and the chain never forms.
  assert.equal(
    internalRearrange,
    false,
    'start-over should clear internalRearrange (armed lock = superpose root cause)',
  );
  assert.equal(lastActive, null, 'start-over should clear the click anchor');
});
