// Block-flow connection-graph tests — value-input plugging + the
// "superpose after start-over" linking bug.
//
// Headless: no browser, no rendering, no timers except the harness flush().
// Each test loads the real frontend blocks.js + blockflow.js, makes a plain
// Blockly.Workspace, creates a BlockFlow with NO-OP hooks (so the connection
// logic and the anchor/rearrange state machine run, but every DOM/render
// side-effect is skipped), and wires the module to the change listener exactly
// as app.js does. We then drive the SAME operations the kid's clicks/toolbar
// trigger (insertBlock / moveActiveBlock / deleteActiveBlock / startOver) and
// assert on the resulting CONNECTION GRAPH.
//
// "Superpose" === more than one top block when every inserted block was
// connectable and should have formed ONE chain.

import test from 'node:test';
import assert from 'node:assert/strict';
import * as BlocklyNS from 'blockly';
import {
  loadFrontend,
  makeWorkspace,
  flush,
  topCount,
  chainTypes,
} from './harness.mjs';

// Build a fresh workspace + module + listener wiring for one test.
function setup() {
  const { BlockFlow, Blockly } = loadFrontend();
  assert.equal(typeof BlockFlow?.create, 'function', 'expected window.BlockFlow.create');
  const ws = makeWorkspace();
  const bf = BlockFlow.create(ws, {}); // no-op hooks: rendering/DOM skipped
  // app.js forwards every workspace event into the module's anchor +
  // rearrange-lock branches — mirror that.
  ws.addChangeListener((e) => bf.onWorkspaceEvent(e));
  return { ws, bf, Blockly: Blockly || BlocklyNS };
}

// ---------------------------------------------------------------------------
// VALUE-INPUT scenario: fly_until + wall_ahead must PLUG into the COND slot.
// ---------------------------------------------------------------------------

test('wall_ahead click-plugs into fly_until COND value input (one top block)', async () => {
  const { ws, bf } = setup();

  const flyUntil = bf.insertBlock('fly_until');
  const wall = bf.insertBlock('wall_ahead');
  await flush();

  // Still a single tower — the condition plugged into the slot, it did NOT
  // become a second top block.
  assert.equal(topCount(ws), 1, 'fly_until + wall_ahead should stay one top block');

  // wall_ahead is parented into fly_until's COND value input.
  assert.equal(
    flyUntil.getInputTargetBlock('COND'),
    wall,
    'wall_ahead should be plugged into fly_until COND',
  );
  assert.equal(wall.getParent(), flyUntil, 'wall_ahead parent is fly_until');
});

test('after plugging a condition, anchor stays on the parent statement so the next flight block chains on', async () => {
  const { ws, bf } = setup();

  bf.insertBlock('take_off');
  const flyUntil = bf.insertBlock('fly_until');
  const wall = bf.insertBlock('wall_ahead');

  // insertBlock keeps the anchor on the PARENT statement (fly_until) when a
  // value block plugs in — not on the condition itself. (Checked SYNCHRONOUSLY,
  // i.e. immediately as insertBlock returns: a later deferred BLOCK_MOVE for the
  // plugged condition flows through the listener and moves the raw anchor onto
  // the condition — anchorBlock recovers from that via its parent-climb, which
  // is what the chaining assertion below proves.)
  assert.equal(bf.getLastActive(), flyUntil, 'anchor should pin to fly_until right after the plug');

  await flush();

  // The next flight block must chain onto the sequence (after fly_until),
  // not dangle off the condition — even though the post-flush raw anchor now
  // sits on wall_ahead, anchorBlock climbs to its parent statement.
  bf.insertBlock('land');
  await flush();

  assert.equal(topCount(ws), 1, 'land should chain onto the sequence, not start a new top block');
  assert.deepEqual(
    chainTypes(ws),
    ['take_off', 'fly_until', 'land'],
    'flight chain order with the condition nested in fly_until',
  );
  // Condition is still plugged into the slot.
  assert.equal(flyUntil.getInputTargetBlock('COND'), wall);
});

test('a second condition with no free slot drops free, but the flight chain stays connected', async () => {
  const { ws, bf } = setup();

  const flyUntil = bf.insertBlock('fly_until');
  const wall = bf.insertBlock('wall_ahead'); // fills the only COND slot
  const gone = bf.insertBlock('gone_units'); // no free value input anywhere
  await flush();

  // wall_ahead keeps the COND slot.
  assert.equal(flyUntil.getInputTargetBlock('COND'), wall, 'wall_ahead still occupies COND');

  // gone_units found no open value input, so it free-places as its own top
  // block (the kid can drag it in) — it must NOT have displaced wall_ahead.
  assert.equal(gone.getParent(), null, 'gone_units has no parent (dropped free)');
  assert.equal(gone.outputConnection.targetBlock(), null, 'gone_units is unplugged');

  // Two top blocks here is EXPECTED and correct: the flight tower + the
  // free-dropped spare condition. That is not "superpose" — gone_units had
  // nowhere valid to connect.
  const tops = ws.getTopBlocks(false);
  assert.equal(tops.length, 2, 'fly_until tower + free gone_units');
  assert.ok(tops.includes(flyUntil), 'fly_until is still a top block');
  assert.ok(tops.includes(gone), 'gone_units is the other top block');

  // The flight tower itself stayed connected and intact.
  assert.equal(flyUntil.getNextBlock(), null, 'fly_until has no trailing flight block here');
  assert.equal(flyUntil.getInputTargetBlock('COND'), wall, 'condition still nested');
});

// ---------------------------------------------------------------------------
// Baseline: a plain tower links fine, and toolbar reorders preserve one chain.
// (These pass today and guard the bug test's premise.)
// ---------------------------------------------------------------------------

test('baseline — four click-inserts link into one tower', async () => {
  const { ws, bf } = setup();

  bf.insertBlock('take_off');
  bf.insertBlock('fly_forward');
  bf.insertBlock('turn_right');
  bf.insertBlock('land');
  await flush();

  assert.equal(topCount(ws), 1, 'four connectable blocks should form ONE chain');
  assert.deepEqual(chainTypes(ws), ['take_off', 'fly_forward', 'turn_right', 'land']);
});

test('toolbar up/down reorder keeps the chain as a single tower', async () => {
  const { ws, bf } = setup();

  bf.insertBlock('take_off');
  bf.insertBlock('fly_forward'); // this is the active block
  const turn = bf.insertBlock('turn_right');
  bf.insertBlock('land');
  await flush();

  // Re-select the middle flight block (as a kid tap would) so it's the
  // rearrange target, then nudge it up and down.
  bf.setLastActive(turn);
  bf.moveActiveBlock('up');
  await flush();
  bf.moveActiveBlock('down');
  await flush();

  // Order returns to baseline and it's still ONE tower.
  assert.equal(topCount(ws), 1, 'reorder must not split the tower');
  assert.deepEqual(chainTypes(ws), ['take_off', 'fly_forward', 'turn_right', 'land']);
});

// ---------------------------------------------------------------------------
// THE BUG (user-reported): blocks stop linking into a tower and drop superposed
// after a toolbar move followed by start-over.
//
//   add ~4 blocks (link fine) -> toolbar up/down -> start over
//   -> click new blocks -> they DO NOT connect; multiple top blocks (superpose).
//
// Lead hypothesis: moveActiveBlock SETS the sticky rearrange lock
// (internalRearrange / rearrangeTargetBlock); startOver() deliberately does NOT
// call endRearrangeLock() (see the bug-preserving comment in blockflow.js). The
// lock survives the wipe still pointing at a now-disposed block, so the deferred
// BLOCK_MOVE branch of the listener re-pins lastActive to that disposed block
// (rejected -> null) on each fresh insert, and the next click free-places its
// block as its own top block instead of chaining.
//
// TIMING NOTE — this is load-bearing: the kid clicks the palette tiles one at a
// time, with the UI settling (Blockly's deferred BLOCK_MOVE / SELECTED events
// firing) BETWEEN clicks. So we flush() after EACH fresh insert. If you batch
// several inserts before a single flush, all the synchronous lastActive
// assignments win and the connections form before the stale-lock BLOCK_MOVE
// ever fires — which masks the bug entirely. Per-click flushing is what makes
// this faithful to the real app.
//
// The assertions below describe the CORRECT behaviour (ONE chain). A FAILURE
// HERE IS THE CAPTURED BUG — do not weaken it to make it pass.
// ---------------------------------------------------------------------------

test('CAPTURES BUG: after a toolbar move + start-over, new click-inserts must still link into ONE tower (no superpose)', async () => {
  const { ws, bf } = setup();

  // 1) Build a chain that links fine.
  bf.insertBlock('take_off');
  const fwd = bf.insertBlock('fly_forward');
  bf.insertBlock('turn_right');
  bf.insertBlock('land');
  await flush();
  assert.equal(topCount(ws), 1, 'precondition: four blocks linked into one tower');

  // 2) Move a block with the toolbar — this SETS the sticky rearrange lock.
  bf.setLastActive(fwd);
  bf.moveActiveBlock('down');
  await flush();

  // Sanity: the lock is set (white-box) — this is what start-over fails to clear.
  assert.equal(bf.getState().internalRearrange, true, 'toolbar move set the rearrange lock');

  // 3) Start over — wipes the blocks AND (the fix) releases the rearrange lock
  //    so it can't re-pin the anchor to the now-disposed fly_forward.
  bf.startOver();
  await flush();
  assert.equal(topCount(ws), 0, 'start over cleared the workspace');
  assert.equal(
    bf.getState().internalRearrange,
    false,
    'start-over must release the rearrange lock (regression guard)',
  );

  // 4) Click NEW blocks, ONE AT A TIME (flush between clicks — see TIMING NOTE).
  bf.insertBlock('take_off');
  await flush();
  bf.insertBlock('fly_forward');
  await flush();
  bf.insertBlock('land');
  await flush();

  // The correct outcome: ONE tower. If this fails with >1 top block, the
  // superpose bug reproduced — the stale rearrange lock re-pinned lastActive
  // to the disposed block (-> null) between clicks, so the new blocks dropped
  // on top of each other instead of chaining.
  // *** A FAILURE ON THE NEXT TWO ASSERTIONS IS THE CAPTURED USER BUG. ***
  assert.equal(
    topCount(ws),
    1,
    'SUPERPOSE BUG: new blocks after start-over should form ONE chain, not stack as separate top blocks',
  );
  assert.deepEqual(
    chainTypes(ws),
    ['take_off', 'fly_forward', 'land'],
    'the fresh tower should be a single connected chain',
  );
});

test('CONTROL: endRearrangeLock() before fresh inserts lets them link (isolates the start-over omission as the cause)', async () => {
  const { ws, bf } = setup();

  bf.insertBlock('take_off');
  const fwd = bf.insertBlock('fly_forward');
  bf.insertBlock('turn_right');
  bf.insertBlock('land');
  await flush();

  bf.setLastActive(fwd);
  bf.moveActiveBlock('down');
  await flush();

  bf.startOver();
  // The one thing start-over omits — clear the rearrange lock.
  bf.endRearrangeLock();
  await flush();

  // Fresh inserts, ONE AT A TIME with a flush between (same kid-click timing as
  // the bug test) — the only difference from that test is the endRearrangeLock()
  // above, so any divergence in outcome isolates the lock as the cause.
  bf.insertBlock('take_off');
  await flush();
  bf.insertBlock('fly_forward');
  await flush();
  bf.insertBlock('land');
  await flush();

  // With the lock cleared, the fresh inserts link into one tower — confirming
  // the missing endRearrangeLock() in startOver() is the cause of the bug.
  assert.equal(topCount(ws), 1, 'with the lock cleared, fresh inserts link into one chain');
  assert.deepEqual(chainTypes(ws), ['take_off', 'fly_forward', 'land']);
});

test('a fresh starter block resets the anchor and recovers linking (matches the user observation)', async () => {
  const { ws, bf, Blockly } = setup();

  bf.insertBlock('take_off');
  const fwd = bf.insertBlock('fly_forward');
  bf.insertBlock('land');
  await flush();

  bf.setLastActive(fwd);
  bf.moveActiveBlock('down');
  await flush();

  bf.startOver();
  await flush();

  // The user noted "a starter block resets it." A kid tap selects the new
  // starter, whose SELECTED event flows through the listener: that branch
  // releases the rearrange lock (newElementId !== the disposed target) AND
  // re-pins the anchor to a live block. From there the following clicks chain.
  bf.insertBlock('take_off');
  await flush();
  const starter = ws.getTopBlocks(false).find((b) => b.type === 'take_off');
  // Model the kid tapping the new starter (SELECTED event) — this is the
  // "starter resets it" recovery path. Drive it through the listener as a real
  // selection so the lock-release branch runs, not just the direct setter.
  bf.onWorkspaceEvent({
    type: Blockly.Events.SELECTED,
    newElementId: starter.id,
  });
  await flush();
  bf.insertBlock('fly_forward');
  await flush();
  bf.insertBlock('land');
  await flush();

  assert.equal(topCount(ws), 1, 'after a starter resets the anchor, linking recovers');
  assert.deepEqual(chainTypes(ws), ['take_off', 'fly_forward', 'land']);
});
