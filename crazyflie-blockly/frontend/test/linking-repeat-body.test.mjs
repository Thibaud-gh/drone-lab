// Headless connection-graph tests for the repeat-body container-swallow flow
// and the start-over "superpose" linking bug.
//
// These drive the SAME operations the kid's clicks / toolbar arrows trigger
// (bf.insertBlock, bf.moveActiveBlock, bf.deleteActiveBlock, bf.startOver) and
// assert purely on the connection graph — no rendering, no timers except the
// harness flush() that drains Blockly's async event queue.
//
// "Superpose" === more than one TOP block when every inserted block was
// connectable and should have formed ONE chain. (ws.getTopBlocks(false).length
// > 1.)

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  loadFrontend,
  makeWorkspace,
  flush,
  topCount,
  chainTypes,
} from './harness.mjs';

// Build a fresh workspace + BlockFlow with NO-OP hooks, wired to the change
// listener exactly as app.js does. Returns { Blockly, ws, bf }.
function setup() {
  const { Blockly, BlockFlow } = loadFrontend();
  assert.equal(typeof BlockFlow?.create, 'function', 'expected window.BlockFlow.create');
  const ws = makeWorkspace();
  const bf = BlockFlow.create(ws, {}); // no-op hooks: pure connection logic
  ws.addChangeListener((e) => bf.onWorkspaceEvent(e));
  return { Blockly, ws, bf };
}

// The body (DO statement input) of a repeat_n block, as a depth-first list of
// types. Returns [] if the body is empty.
function repeatBodyTypes(Blockly, repeatBlk) {
  const input = repeatBlk.getInput('DO');
  const conn = input && input.connection;
  const first = conn && conn.targetBlock();
  const types = [];
  for (let b = first; b; b = b.getNextBlock()) types.push(b.type);
  return types;
}

// ---------------------------------------------------------------------------
// Container swallow — the documented repeat-body scenario.
// ---------------------------------------------------------------------------

test('container swallow: a fly_forward after repeat_n drops INSIDE the repeat body', async () => {
  const { Blockly, ws, bf } = setup();

  // Tap repeat, then tap a move: the glowing repeat anchor swallows the move
  // into its body (reading order: "tap repeat, then tap the moves").
  bf.insertBlock('repeat_n');
  bf.insertBlock('fly_forward');
  await flush();

  assert.equal(topCount(ws), 1, 'repeat + body block should be one top block');
  const repeatBlk = ws.getTopBlocks(false)[0];
  assert.equal(repeatBlk.type, 'repeat_n');
  assert.deepEqual(
    repeatBodyTypes(Blockly, repeatBlk),
    ['fly_forward'],
    'the move should be inside the repeat body, not chained after it',
  );
  // Nothing dangling after the repeat in the outer chain.
  assert.equal(repeatBlk.getNextBlock(), null, 'repeat should have no outer next block');
});

test('container swallow: subsequent taps keep chaining INSIDE the body', async () => {
  const { Blockly, ws, bf } = setup();

  bf.insertBlock('repeat_n');
  bf.insertBlock('fly_forward');
  bf.insertBlock('fly_forward');
  await flush();

  assert.equal(topCount(ws), 1, 'two body blocks should still be one top block');
  const repeatBlk = ws.getTopBlocks(false)[0];
  assert.deepEqual(
    repeatBodyTypes(Blockly, repeatBlk),
    ['fly_forward', 'fly_forward'],
    'both moves should sit in the repeat body as a chain of two',
  );
});

test('exact tree: take_off_loop, repeat[fly_forward, fly_forward], land_loop', async () => {
  const { Blockly, ws, bf } = setup();

  // take_off_loop BEFORE the repeat sits in the outer chain; the repeat
  // swallows the two moves; land_loop AFTER must land in the OUTER chain
  // (after the repeat), not inside the body.
  bf.insertBlock('take_off_loop');
  bf.insertBlock('repeat_n');
  bf.insertBlock('fly_forward');
  bf.insertBlock('fly_forward');

  // A repeat anchor ALWAYS swallows the next click-insert into its body — so
  // land_loop first lands at the end of the body, exactly as the
  // container-swallow rule dictates. The faithful real-app way to put it in
  // the OUTER chain (after the repeat) is the toolbar down-arrow on the last
  // body block, which exits the loop. Drive that path.
  bf.insertBlock('land_loop'); // swallowed: body becomes [ff, ff, land_loop]
  await flush();
  bf.moveActiveBlock('down'); // pop land_loop out of the loop, after the repeat
  await flush();

  assert.equal(topCount(ws), 1, 'whole program should be a single top block');

  // Outer chain: take_off_loop -> repeat_n -> land_loop.
  const top = ws.getTopBlocks(false)[0];
  assert.equal(top.type, 'take_off_loop', 'take_off_loop is the chain top');
  const second = top.getNextBlock();
  assert.equal(second.type, 'repeat_n', 'repeat follows take_off_loop in the outer chain');
  const third = second.getNextBlock();
  assert.equal(third.type, 'land_loop', 'land_loop follows the repeat in the OUTER chain');
  assert.equal(third.getNextBlock(), null, 'land_loop is the chain terminus');

  // Body holds exactly the two moves.
  assert.deepEqual(
    repeatBodyTypes(Blockly, second),
    ['fly_forward', 'fly_forward'],
    'repeat body holds the two moves and nothing else',
  );

  // The chainTypes depth-first walk should see the body before continuing the
  // outer chain: take_off_loop, repeat_n, [body...], land_loop.
  assert.deepEqual(chainTypes(ws), [
    'take_off_loop',
    'repeat_n',
    'fly_forward',
    'fly_forward',
    'land_loop',
  ]);
});

// ---------------------------------------------------------------------------
// Toolbar reorder inside / around a repeat — verifies the move primitives keep
// ONE chain (these are the moves that, in the bug repro, leave the rearrange
// lock set before start-over).
// ---------------------------------------------------------------------------

test('toolbar: moving a body block down past the repeat exits the loop into the outer chain', async () => {
  const { Blockly, ws, bf } = setup();

  // repeat[fly_forward], then a turn_left also inside (chained after it).
  bf.insertBlock('repeat_n');
  bf.insertBlock('fly_forward');
  bf.insertBlock('turn_left');
  await flush();

  const repeatBlk = ws.getAllBlocks(false).find((b) => b.type === 'repeat_n');
  assert.deepEqual(repeatBodyTypes(Blockly, repeatBlk), ['fly_forward', 'turn_left']);

  // Select the trailing turn_left (last in body) and move it DOWN — it should
  // exit the loop and become the repeat's next block in the outer chain.
  const turn = ws.getAllBlocks(false).find((b) => b.type === 'turn_left');
  bf.setLastActive(turn);
  bf.moveActiveBlock('down');
  await flush();

  assert.equal(topCount(ws), 1, 'still a single top block after the move');
  assert.deepEqual(
    repeatBodyTypes(Blockly, repeatBlk),
    ['fly_forward'],
    'turn_left left the body',
  );
  assert.equal(repeatBlk.getNextBlock()?.type, 'turn_left', 'turn_left is now after the repeat');
});

// ---------------------------------------------------------------------------
// THE BUG: start-over leaves the rearrange lock set, then click-inserts
// superpose instead of forming one chain.
//
// Repro: build a chain, reorder with the toolbar (which SETS internalRearrange
// / rearrangeTargetBlock and never clears it on start-over), then start over,
// then click-insert fresh blocks. The first new block becomes lastActive, but
// the next click should still chain onto it. If the stale lock makes the change
// listener re-pin lastActive to a disposed block (or otherwise breaks
// anchoring), the new blocks drop as separate TOP blocks (superpose).
// ---------------------------------------------------------------------------

test('after a toolbar move, start-over RELEASES the rearrange lock (regression guard)', async () => {
  const { ws, bf } = setup();

  bf.insertBlock('take_off');
  bf.insertBlock('fly_forward');
  bf.insertBlock('fly_forward');
  await flush();

  // A toolbar move SETS the sticky lock.
  const firstMove = ws.getAllBlocks(false).find((b) => b.type === 'fly_forward');
  bf.setLastActive(firstMove);
  bf.moveActiveBlock('up');
  await flush();
  assert.equal(bf.getState().internalRearrange, true, 'a toolbar move arms the lock');

  // The fix: start-over calls endRearrangeLock(), so the lock can't survive the
  // wipe and re-pin the click anchor to a disposed block (the superpose bug).
  bf.startOver();
  const state = bf.getState();
  assert.equal(state.internalRearrange, false, 'start-over must release the rearrange lock');
  assert.equal(state.rearrangeTargetBlock, null, 'start-over must drop the rearrange target');
});

test('BUG (captured): click-inserts after a toolbar-move + start-over must form ONE chain, not superpose', async () => {
  const { ws, bf } = setup();

  // 1) Build ~4 blocks — they link fine.
  bf.insertBlock('take_off');
  bf.insertBlock('fly_forward');
  bf.insertBlock('turn_left');
  bf.insertBlock('fly_forward');
  await flush();
  assert.equal(topCount(ws), 1, 'baseline: four click-inserts form one chain');

  // 2) Move some blocks up/down with the toolbar (sets the sticky lock).
  const aMove = ws.getAllBlocks(false).find((b) => b.type === 'turn_left');
  bf.setLastActive(aMove);
  bf.moveActiveBlock('up');
  await flush();
  bf.moveActiveBlock('down');
  await flush();

  // 3) Start over — wipes blocks but (bug) keeps the rearrange lock.
  bf.startOver();
  await flush();
  assert.equal(topCount(ws), 0, 'start-over cleared all blocks');

  // 4) Click blocks again — every one is connectable and SHOULD form a single
  //    chain. We flush() BETWEEN each click to mirror reality: a real kid clicks
  //    a tile, Blockly's deferred BLOCK_MOVE macrotask fires, THEN she clicks
  //    the next tile. With the leaked lock still set, that deferred BLOCK_MOVE
  //    runs the listener's `internalRearrange` branch and re-pins lastActive to
  //    the now-DISPOSED rearrange target; setLastActive rejects the disposed
  //    block, leaving lastActive === null. The following insert then has no
  //    anchor and free-places as a SEPARATE top block (superpose).
  bf.insertBlock('take_off');
  await flush();
  bf.insertBlock('fly_forward');
  await flush();
  bf.insertBlock('fly_forward');
  await flush();

  // CORRECT behavior assertion. A FAILURE HERE IS THE CAPTURED BUG: the stale
  // rearrange lock that start-over never cleared causes the fresh click-inserts
  // to superpose (>1 top block) instead of chaining into one tower. Do NOT
  // weaken this to make it pass — the assertion describes the fix's target.
  assert.equal(
    topCount(ws),
    1,
    'fresh click-inserts after start-over must form ONE chain (superpose === the bug)',
  );
  assert.deepEqual(
    chainTypes(ws),
    ['take_off', 'fly_forward', 'fly_forward'],
    'the three fresh blocks should be one take_off -> fly_forward -> fly_forward tower',
  );
});

test('control: WITHOUT a prior toolbar move, start-over then click-insert forms one chain', async () => {
  const { ws, bf } = setup();

  // No toolbar move -> no lock set. start-over then re-insert should be clean,
  // isolating the leaked-lock as the cause in the bug test above.
  bf.insertBlock('take_off');
  bf.insertBlock('fly_forward');
  await flush();

  bf.startOver();
  await flush();

  // Same per-click flush cadence as the bug test, so the ONLY difference is
  // the absence of a prior toolbar move (hence no leaked lock).
  bf.insertBlock('take_off');
  await flush();
  bf.insertBlock('fly_forward');
  await flush();
  bf.insertBlock('fly_forward');
  await flush();

  assert.equal(topCount(ws), 1, 'no leaked lock -> fresh inserts chain cleanly');
  assert.deepEqual(chainTypes(ws), ['take_off', 'fly_forward', 'fly_forward']);
});
