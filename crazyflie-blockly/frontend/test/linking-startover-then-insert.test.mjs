// Linking regression: "start over, then insert" superpose bug.
// ----------------------------------------------------------------------
// User report: "Blocks stop linking into a tower and instead drop superposed
// on top of each other." Repro: build ~4 blocks (they link fine) -> move some
// up/down with the floating toolbar -> press "start over" -> click new blocks ->
// the NEW blocks DO NOT connect; multiple top-level blocks appear (superpose).
// A starter block resets it.
//
// "superpose" === ws.getTopBlocks(false).length > 1 when every inserted block
// was connectable and should have formed ONE chain.
//
// Lead hypothesis (the module preserves the bug on purpose — see blockflow.js
// startOver's "NO endRearrangeLock" comment): a toolbar up/down move SETS the
// sticky rearrange lock (internalRearrange = true, rearrangeTargetBlock = blk).
// startOver() wipes the blocks and the click anchor but does NOT clear that
// lock. The lock's BLOCK_MOVE branch in onWorkspaceEvent then re-pins lastActive
// to the now-disposed rearrange target on the next stray BLOCK_MOVE, so the
// follow-up click-inserts anchor into a dead chain and fail to connect.
//
// These tests drive the SAME operations the kid's clicks/toolbar do
// (insertBlock / moveActiveBlock / startOver) and assert on the CONNECTION
// GRAPH. They are deterministic and rendering-free: no-op hooks, no timers
// except the harness flush(). The prime repro asserts the CORRECT behaviour
// (one chain) and is EXPECTED TO FAIL while the bug is present — that failure
// is the captured bug, not a broken test. Do not weaken it to pass.

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  loadFrontend,
  makeWorkspace,
  flush,
  topCount,
  chainTypes,
} from './harness.mjs';

// Build a BlockFlow over a fresh headless workspace, wired exactly like app.js
// (change listener forwards every event to onWorkspaceEvent). No-op hooks: the
// connection logic + anchor/rearrange state machine run unchanged; only the
// DOM/render side-effects are skipped.
function setup() {
  const { BlockFlow, Blockly } = loadFrontend();
  assert.equal(typeof BlockFlow?.create, 'function', 'expected window.BlockFlow.create');
  const ws = makeWorkspace();
  const bf = BlockFlow.create(ws, {});
  ws.addChangeListener((e) => bf.onWorkspaceEvent(e));
  return { Blockly, ws, bf };
}

// The four blocks the repro inserts after start-over. All connectable into a
// single tower: take_off (starter, next only) -> fly_forward -> fly_forward
// (middles, prev+next) -> land (terminator, prev only).
const FOUR_CHAIN = ['take_off', 'fly_forward', 'fly_forward', 'land'];

// Click-insert each type in order, mirroring successive palette taps. The kid
// taps one tile, the workspace settles (Blockly's deferred events fire), THEN
// she taps the next — so flush between inserts to reproduce that timing. This
// matters for the bug: the stale rearrange lock only nulls the anchor when its
// deferred BLOCK_MOVE event fires, which happens BETWEEN clicks, not within a
// single synchronous burst.
async function insertAllSpaced(bf, types) {
  for (const t of types) {
    bf.insertBlock(t);
    await flush();
  }
}

// ---------------------------------------------------------------------------
// Baseline: with a clean module, four click-inserts chain into one tower. This
// proves the inserts THEMSELVES are sound, so a failure in the repro below is
// the start-over interaction, not a bad insert sequence.
// ---------------------------------------------------------------------------
test('baseline: four fresh click-inserts form a single chain', async () => {
  const { ws, bf } = setup();

  await insertAllSpaced(bf, FOUR_CHAIN);

  assert.equal(topCount(ws), 1, 'four connectable inserts should make ONE top block');
  assert.deepEqual(chainTypes(ws), FOUR_CHAIN);
});

// ---------------------------------------------------------------------------
// Precondition (white-box): a toolbar up/down move SETS the sticky rearrange
// lock. This is the state start-over fails to clear. Establishes the lock is
// truthy right after a move so the repro's "still set after startOver" claim
// is meaningful.
// ---------------------------------------------------------------------------
test('precondition: a toolbar move sets the rearrange lock', async () => {
  const { ws, bf } = setup();

  await insertAllSpaced(bf, FOUR_CHAIN);
  assert.equal(topCount(ws), 1, 'sanity: built one chain before moving');

  // Re-anchor the active block to a movable middle block, then nudge it.
  const forwards = ws.getAllBlocks(false).filter((b) => b.type === 'fly_forward');
  bf.setLastActive(forwards[0]);
  bf.moveActiveBlock('down');
  // moveActiveBlock sets the lock SYNCHRONOUSLY (it only clears on a later
  // user-driven SELECTED / BLOCK_DRAG), so read it before any flush.
  const st = bf.getState();
  assert.equal(st.internalRearrange, true, 'a toolbar move should set internalRearrange');
  assert.ok(st.rearrangeTargetBlock, 'a toolbar move should set rearrangeTargetBlock');

  // The chain must stay intact through the move (no superpose from the move itself).
  await flush();
  assert.equal(topCount(ws), 1, 'a toolbar move must not split the chain');
});

// ---------------------------------------------------------------------------
// White-box: AFTER start-over, the rearrange lock must be cleared. The module
// deliberately preserves the bug (startOver does NOT call endRearrangeLock), so
// this captures the broken state directly: a clean start-over should leave
// internalRearrange === false and rearrangeTargetBlock === null.
//
// EXPECTED TO FAIL while the bug is present. The failure here IS the captured
// bug (stale lock survives start-over) — do not weaken the assertion to pass.
// ---------------------------------------------------------------------------
test('start-over clears the rearrange lock (CAPTURED BUG: expected to fail)', async () => {
  const { ws, bf } = setup();

  await insertAllSpaced(bf, FOUR_CHAIN);

  const forwards = ws.getAllBlocks(false).filter((b) => b.type === 'fly_forward');
  bf.setLastActive(forwards[0]);
  bf.moveActiveBlock('down');
  bf.setLastActive(forwards[1] ?? forwards[0]);
  bf.moveActiveBlock('up');
  await flush();

  bf.startOver();
  await flush();

  assert.equal(topCount(ws), 0, 'start-over should wipe every block');

  const st = bf.getState();
  // The captured bug: start-over leaves the lock dangling. A correct start-over
  // releases it so the next click-insert is not re-pinned to a disposed target.
  assert.equal(
    st.internalRearrange,
    false,
    'CAPTURED BUG: start-over leaves internalRearrange set (no endRearrangeLock)',
  );
  assert.equal(
    st.rearrangeTargetBlock,
    null,
    'CAPTURED BUG: start-over leaves rearrangeTargetBlock pointing at a disposed block',
  );
});

// ---------------------------------------------------------------------------
// THE PRIME REPRO (end-to-end, what the kid does):
//   build 4 blocks -> a couple of toolbar up/down moves -> start over ->
//   click-insert take_off, fly_forward, fly_forward, land.
// Those four are all connectable and SHOULD form ONE chain. If the stale lock
// survives start-over and re-pins the anchor to a disposed block, the new
// blocks drop superposed (topCount > 1) instead of chaining.
//
// This asserts the CORRECT behaviour (one chain) and is EXPECTED TO FAIL while
// the bug is present — that failure is the captured superpose bug. Do not
// weaken it to pass.
// ---------------------------------------------------------------------------
test('start-over then insert builds one chain, not a superpose (CAPTURED BUG: expected to fail)', async () => {
  const { Blockly, ws, bf } = setup();

  // 1) Build four blocks — they link fine (covered by the baseline test).
  await insertAllSpaced(bf, FOUR_CHAIN);
  assert.equal(topCount(ws), 1, 'sanity: the initial four blocks linked into one chain');

  // 2) A couple of toolbar up/down moves, like nudging blocks around.
  const forwards = ws.getAllBlocks(false).filter((b) => b.type === 'fly_forward');
  bf.setLastActive(forwards[0]);
  bf.moveActiveBlock('down');
  await flush();
  bf.setLastActive(forwards[forwards.length - 1]);
  bf.moveActiveBlock('up');
  await flush();
  assert.equal(topCount(ws), 1, 'the moves themselves must not split the chain');

  // 3) Start over — wipes the workspace.
  bf.startOver();
  await flush();
  assert.equal(topCount(ws), 0, 'start-over should leave an empty workspace');

  // 4) Click-insert four connectable blocks again, as the kid would — one tap
  //    at a time, letting the workspace settle between taps (insertAllSpaced).
  //    The stale lock's deferred BLOCK_MOVE fires BETWEEN taps and nulls the
  //    anchor, so each subsequent block free-places as its own top block.
  await insertAllSpaced(bf, FOUR_CHAIN);

  // The bug: these drop superposed because the stale rearrange lock re-pinned
  // the anchor to a disposed block, so each insert fails to chain.
  assert.equal(
    topCount(ws),
    1,
    'CAPTURED BUG (superpose): four connectable inserts after start-over should form ' +
      'ONE chain, but the stale rearrange lock leaves them as separate top blocks',
  );

  // And the tower must have the exact expected shape. (chainTypes also asserts
  // a single top block, with a clear message if superposed.)
  assert.deepEqual(
    chainTypes(ws),
    FOUR_CHAIN,
    'after start-over the re-inserted blocks should chain take_off -> 2x fly_forward -> land',
  );

  // Belt-and-braces graph check independent of the harness helper: walking the
  // first top block's next-chain should visit all four inserted blocks.
  const tops = ws.getTopBlocks(false);
  let walked = 0;
  for (let b = tops[0]; b; b = b.getNextBlock()) walked++;
  assert.equal(
    walked,
    4,
    'the next-connection chain from the top should string all four blocks together',
  );
  // Reference Blockly so a future edit that drops the import stays honest.
  assert.ok(Blockly.NEXT_STATEMENT !== undefined, 'Blockly enum sanity');
});
