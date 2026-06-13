// linking-terminator-and-starter.test.mjs
// ---------------------------------------------------------------------------
// Headless connection-graph tests for the click-to-insert / toolbar block-flow
// logic in frontend/blockflow.js, driven through the Node harness (no browser,
// no rendering). We drive the SAME entry points the kid's clicks and toolbar
// buttons call (bf.insertBlock, bf.moveActiveBlock, bf.deleteActiveBlock,
// bf.startOver) and assert on the resulting connection graph.
//
// "Superpose" === more than one TOP block (ws.getTopBlocks(false).length > 1)
// when every inserted block was connectable and SHOULD have formed one chain.
//
// Two scenarios live here:
//   1. terminator-and-starter — the CORRECT non-linking case. A hat starter
//      (take_off) physically cannot connect below a terminator (land), so it
//      legitimately becomes a 2nd top block. That is intended behaviour, not a
//      bug. The take_off_loop variant (which has a previousConnection) DOES
//      chain. We document and assert the distinction.
//   2. start-over superpose bug — the user-reported regression. After a
//      toolbar move sets the sticky rearrange lock, start-over wipes the
//      blocks WITHOUT clearing that lock; subsequent click-inserts then fail
//      to chain and drop superposed. The assertions here demand the CORRECT
//      behaviour (one chain); a FAILURE is the captured bug (see comments).

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  loadFrontend,
  makeWorkspace,
  flush,
  topCount,
  chainTypes,
} from './harness.mjs';

// Build a fresh workspace + BlockFlow wired exactly the way app.js wires it:
// no-op hooks (rendering/DOM side-effects are all behind hooks), and the
// module subscribed to the workspace change listener for its anchor +
// rearrange-lock branches.
function setup() {
  const { Blockly, BlockFlow } = loadFrontend();
  assert.equal(typeof BlockFlow?.create, 'function', 'expected window.BlockFlow.create');
  const ws = makeWorkspace();
  const bf = BlockFlow.create(ws, {}); // {} → all hooks default to no-ops
  ws.addChangeListener((e) => bf.onWorkspaceEvent(e));
  return { Blockly, ws, bf };
}

// ===========================================================================
// SCENARIO 1 — terminator-and-starter: CORRECT non-linking cases.
//
// take_off is a HAT block: nextStatement only, NO previousConnection. It is
// the top of a flight and cannot attach below anything. land is a TERMINATOR:
// previousConnection only, NO nextConnection. So inserting take_off after land
// genuinely cannot connect — a 2nd top block is the right, expected outcome,
// NOT the superpose bug. take_off_loop (previous + next) is the variant that
// DOES chain mid-sequence.
// ===========================================================================

test('terminator-and-starter: take_off (hat) after land cannot connect — a 2nd top block is EXPECTED, not a bug', async () => {
  const { ws, bf } = setup();

  bf.insertBlock('take_off');
  bf.insertBlock('fly_forward');
  bf.insertBlock('land'); // terminator — no nextConnection
  await flush();

  // First three form one clean tower ending in the terminator.
  assert.equal(topCount(ws), 1, 'take_off → fly_forward → land should be one chain');
  assert.deepEqual(chainTypes(ws), ['take_off', 'fly_forward', 'land']);

  // Now the kid taps the take_off tile again. The anchor is `land`, but:
  //   - land has NO nextConnection (terminator), so nothing can attach below it;
  //   - take_off has NO previousConnection (hat), so it can't attach below anything.
  // anchorBlock's chain-bottom append therefore CANNOT connect, and the block
  // is free-placed. Two top blocks here is the CORRECT physical outcome.
  const second = bf.insertBlock('take_off');
  await flush();

  assert.equal(topCount(ws), 2, 'a hat starter after a terminator is legitimately a 2nd top block');
  // The new take_off is genuinely free-floating: no previous connection exists
  // to attach, and it carries no parent.
  assert.equal(second.previousConnection, null, 'take_off is a hat — it has no previousConnection');
  assert.equal(second.getParent(), null, 'the new take_off is a free top block, not parented');
});

test('terminator-and-starter: take_off_loop (previous+next) DOES chain after a terminator-free tail', async () => {
  const { ws, bf } = setup();

  // Mid-sequence flight using the *_loop variants the multi-landing levels use.
  bf.insertBlock('take_off_loop');
  bf.insertBlock('fly_forward');
  bf.insertBlock('land_loop'); // loop variant: HAS a nextConnection
  await flush();

  assert.equal(topCount(ws), 1, 'loop variants chain into one tower');
  assert.deepEqual(chainTypes(ws), ['take_off_loop', 'fly_forward', 'land_loop']);

  // Tap take_off_loop again. Unlike the hat take_off, take_off_loop HAS a
  // previousConnection, and land_loop HAS a nextConnection — so the new block
  // appends to the bottom of the chain. One top block, no superpose.
  const second = bf.insertBlock('take_off_loop');
  await flush();

  assert.equal(topCount(ws), 1, 'take_off_loop should chain onto the loop-variant tail, not superpose');
  assert.deepEqual(chainTypes(ws), [
    'take_off_loop', 'fly_forward', 'land_loop', 'take_off_loop',
  ]);
  assert.ok(second.previousConnection, 'take_off_loop has a previousConnection (chains mid-sequence)');
  assert.ok(second.getParent(), 'the new take_off_loop is parented onto the chain');
});

test('terminator-and-starter: documenting the distinction — hat does NOT chain, loop variant DOES', async () => {
  // Side-by-side in one workspace each, asserting the connector-shape contract
  // that decides linking. This is the load-bearing distinction for the level
  // designer: pick the *_loop variant on multi-landing levels.
  const a = setup();
  a.bf.insertBlock('land');
  a.bf.insertBlock('take_off'); // hat after terminator → cannot connect
  await flush();
  assert.equal(topCount(a.ws), 2, 'hat take_off after land: two top blocks (correct)');

  const b = setup();
  b.bf.insertBlock('land_loop');
  b.bf.insertBlock('take_off_loop'); // both connectors → chains
  await flush();
  assert.equal(topCount(b.ws), 1, 'take_off_loop after land_loop: one chain (correct)');
  assert.deepEqual(chainTypes(b.ws), ['land_loop', 'take_off_loop']);
});

// ===========================================================================
// SCENARIO 2 — the user-reported SUPERPOSE bug.
//
//   "Blocks stop linking into a tower and instead drop superposed on top of
//    each other."
//
// Repro: insert ~4 blocks (they chain) → move some up/down with the toolbar →
// click "start over" → click blocks again → the NEW blocks do NOT connect;
// multiple top blocks appear. A starter block resets it.
//
// Lead hypothesis: moveActiveBlock SETS the sticky rearrange lock
// (internalRearrange = true, rearrangeTargetBlock = <block>). startOver()
// deliberately does NOT call endRearrangeLock (bug-preserving, per blockflow.js
// comment), so the lock survives the wipe. After the wipe, the workspace
// change listener's BLOCK_MOVE branch sees internalRearrange && a (now
// disposed) rearrangeTargetBlock whose .workspace is still truthy, and keeps
// re-pinning lastActive to that dead block — so subsequent click-inserts
// anchor into nothing and free-place (superpose).
//
// The assertions below demand the CORRECT post-start-over behaviour: a fresh
// chain of one top block. A FAILURE here IS the captured bug — do NOT weaken
// these assertions to make them pass.
// ===========================================================================

// Helper: build a 4-block tower the way the kid does — ONE click at a time,
// flushing Blockly's deferred event queue between clicks. Per-click flush is
// the faithful repro: the workspace change listener processes each insert's
// events (notably the deferred BLOCK_MOVE) BEFORE the next click, exactly as a
// kid tapping tiles one by one does. (Batching all clicks then one flush hides
// the bug because the interleaving is wrong.) Returns the blocks.
async function buildFourBlockTower(bf) {
  const t = bf.insertBlock('take_off_loop');
  await flush();
  const f1 = bf.insertBlock('fly_forward');
  await flush();
  const f2 = bf.insertBlock('fly_forward');
  await flush();
  const l = bf.insertBlock('land_loop');
  await flush();
  return { t, f1, f2, l };
}

// Re-insert a fresh 4-block tower one click-and-flush at a time (kid pace).
async function reinsertFourBlockTower(bf) {
  bf.insertBlock('take_off_loop');
  await flush();
  bf.insertBlock('fly_forward');
  await flush();
  bf.insertBlock('fly_forward');
  await flush();
  bf.insertBlock('land_loop');
  await flush();
}

test('superpose-precondition: a toolbar up-move sets the sticky rearrange lock', async () => {
  const { bf } = setup();
  const { f2 } = await buildFourBlockTower(bf);

  // Select the 3rd block, then move it up with the toolbar (↑). This is the
  // operation that arms the lock.
  bf.setLastActive(f2);
  bf.moveActiveBlock('up');
  // The lock is set synchronously inside moveActiveBlock (before its deferred
  // tail). Observe it via the white-box getState() getter.
  const st = bf.getState();
  assert.equal(st.internalRearrange, true, 'moveActiveBlock should arm the rearrange lock');
  assert.ok(st.rearrangeTargetBlock, 'the rearrange target should be pinned');
});

test('superpose BUG: build 4 → toolbar move → start over → re-insert should form ONE chain (failure here is the captured bug)', async () => {
  const { ws, bf } = setup();

  // 1. Build a 4-block tower — chains fine.
  const { f1, f2 } = await buildFourBlockTower(bf);
  assert.equal(topCount(ws), 1, 'four click-inserts should chain into one tower');

  // 2. Move some blocks up/down with the toolbar (arms the sticky lock).
  bf.setLastActive(f2);
  bf.moveActiveBlock('up');
  await flush();
  bf.setLastActive(f1);
  bf.moveActiveBlock('down');
  await flush();

  // 3. Start over — wipes all blocks. (Bug: does NOT clear the rearrange lock.)
  bf.startOver();
  await flush();
  assert.equal(topCount(ws), 0, 'start over should leave an empty workspace');

  // 4. Click blocks again, one at a time (kid pace). These all carry
  //    connectors and SHOULD chain into a single fresh tower — exactly as a
  //    first-time build does.
  await reinsertFourBlockTower(bf);

  // CORRECT behaviour: one chain of four. If this FAILS with topCount > 1,
  // that is the user-reported superpose bug reproduced — the stale rearrange
  // lock (never cleared by startOver) keeps re-pinning lastActive to a disposed
  // block, so each insert anchors into nothing and free-places. DO NOT relax
  // this assertion to make the test pass; the fix is to clear the lock on
  // start-over.
  assert.equal(
    topCount(ws),
    1,
    'after start-over, new click-inserts should rebuild ONE chain — >1 top block is the captured superpose bug',
  );
  assert.deepEqual(chainTypes(ws), [
    'take_off_loop', 'fly_forward', 'fly_forward', 'land_loop',
  ]);
});

test('superpose BUG (isolated): start over right after a single toolbar move, then two inserts must chain', async () => {
  // Minimal repro — strips the test down to the exact mechanism: one move to
  // arm the lock, start over, then two connectable inserts.
  const { ws, bf } = setup();

  const { f1 } = await buildFourBlockTower(bf);
  bf.setLastActive(f1);
  bf.moveActiveBlock('down'); // arm the sticky lock
  await flush();

  bf.startOver(); // does NOT clear the lock (bug-preserving)
  await flush();

  // Three connectable inserts, one click-and-flush at a time. The third is the
  // one that strands: after the second insert's flush the stale BLOCK_MOVE
  // branch re-pins lastActive to the disposed rearrange target (nulled by
  // setLastActive), so the third has no anchor and free-places.
  bf.insertBlock('take_off_loop');
  await flush();
  bf.insertBlock('fly_forward');
  await flush();
  bf.insertBlock('fly_forward');
  await flush();

  // Three connectable blocks must form one chain. Failure === captured bug.
  assert.equal(
    topCount(ws),
    1,
    'three connectable blocks after start-over should chain — >1 top block is the captured superpose bug',
  );
  assert.deepEqual(chainTypes(ws), ['take_off_loop', 'fly_forward', 'fly_forward']);
});

test('superpose CONTROL: WITHOUT a toolbar move, start over → re-insert chains cleanly (no lock to leak)', async () => {
  // The same start-over + re-insert flow, but with NO prior toolbar move, so
  // the rearrange lock is never armed. This must pass today — it isolates the
  // lock as the cause: if THIS chains but the move-first variant superposes,
  // the lock is the culprit.
  const { ws, bf } = setup();

  await buildFourBlockTower(bf);
  bf.startOver();
  await flush();

  // Same per-click-and-flush kid pace as the bug test, but no lock was armed.
  await reinsertFourBlockTower(bf);

  assert.equal(topCount(ws), 1, 'no armed lock → start-over then re-insert should chain cleanly');
  assert.deepEqual(chainTypes(ws), [
    'take_off_loop', 'fly_forward', 'fly_forward', 'land_loop',
  ]);
  // Sanity: with no move, the lock was never set.
  assert.equal(bf.getState().internalRearrange, false, 'control path leaves the rearrange lock unarmed');
});

test('superpose-fix-shape: manually clearing the lock (endRearrangeLock) after start-over restores chaining', async () => {
  // Demonstrates the FIX shape without editing blockflow.js: if start-over had
  // called endRearrangeLock(), re-inserts would chain. We call it explicitly
  // here to show the lock is the sole cause. This test should PASS today and
  // documents the intended fix.
  const { ws, bf } = setup();

  const { f1 } = await buildFourBlockTower(bf);
  bf.setLastActive(f1);
  bf.moveActiveBlock('down');
  await flush();

  bf.startOver();
  bf.endRearrangeLock(); // the missing call that start-over should make
  await flush();

  // Per-click-and-flush kid pace — with the lock cleared, all three chain.
  bf.insertBlock('take_off_loop');
  await flush();
  bf.insertBlock('fly_forward');
  await flush();
  bf.insertBlock('fly_forward');
  await flush();

  assert.equal(topCount(ws), 1, 'clearing the lock after start-over restores one-chain behaviour');
  assert.deepEqual(chainTypes(ws), ['take_off_loop', 'fly_forward', 'fly_forward']);
});
