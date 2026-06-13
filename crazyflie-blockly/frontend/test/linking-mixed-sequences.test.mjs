// Headless, fuzz-style stateful tests for the block-flow linking state machine.
//
// Everything runs against the REAL frontend logic in blockflow.js, loaded by the
// harness with NO browser / NO rendering. We drive the EXACT operations the kid's
// clicks + the floating ↑ ↓ ✕ toolbar trigger in the app (bf.insertBlock,
// bf.moveActiveBlock, bf.deleteActiveBlock, bf.startOver), wire the module to the
// workspace change listener like app.js does, and assert on the CONNECTION GRAPH.
//
// Goal of THIS file (mixed-sequences): interleave insert / moveUp / moveDown /
// delete / startOver / insert in several distinct orders and, after each
// sequence, assert the final tree is EXACTLY the connectable chain(s) we expect.
// The point is to surface any stale-state SUPERPOSE — where blocks that are all
// connectable and should have formed ONE tower instead drop on top of each other
// as multiple top-level blocks.
//
// "Superpose" === ws.getTopBlocks(false).length > 1 when every inserted block was
// connectable and should have formed ONE chain.
//
// NOTE on the headless harness: bf.insertBlock re-anchors synchronously (it sets
// lastActive to the new block at the end of the call, before any deferred Blockly
// listener event fires), and setLastActive rejects disposed blocks. So the
// real-app timing window that lets the stale rearrange lock re-pin the anchor onto
// a disposed block is narrower here than in the live DOM. These tests still assert
// the CORRECT behaviour (one chain) for every permutation; a failure on any of
// them — especially the start-over-after-a-toolbar-move case — is the captured
// superpose regression and must NOT be weakened to pass (see the start-over test).

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  loadFrontend,
  makeWorkspace,
  flush,
  topCount,
  chainTypes,
} from './harness.mjs';

// Fresh module + workspace per test, wired exactly like app.js: BlockFlow.create
// with no-op hooks (so the pure connection logic + anchor/rearrange state machine
// run unchanged) and the change listener forwarding every event to onWorkspaceEvent.
function setup() {
  const { Blockly, BlockFlow } = loadFrontend();
  assert.equal(typeof BlockFlow?.create, 'function', 'expected window.BlockFlow.create');
  const ws = makeWorkspace();
  const bf = BlockFlow.create(ws, {});
  ws.addChangeListener((e) => bf.onWorkspaceEvent(e));
  return { Blockly, ws, bf };
}

// The flat list of blocks down the active stack's spine (top chain only). Used to
// address a block by position before driving the toolbar on it.
function spine(ws) {
  const out = [];
  const top = ws.getTopBlocks(false)[0];
  for (let b = top; b; b = b.getNextBlock()) out.push(b);
  return out;
}

// Drive the toolbar on the block at `index` in the top chain's spine: select it as
// the active block (what the kid's tap does), then press up/down. Await the
// deferred BLOCK_MOVE / setLastActive tail.
async function moveAt(bf, ws, index, dir) {
  const blk = spine(ws)[index];
  assert.ok(blk, `moveAt: no block at spine index ${index}`);
  bf.setLastActive(blk);
  bf.moveActiveBlock(dir);
  await flush();
}

// Delete the block at `index` in the top chain's spine via the toolbar ✕.
async function deleteAt(bf, ws, index) {
  const blk = spine(ws)[index];
  assert.ok(blk, `deleteAt: no block at spine index ${index}`);
  bf.setLastActive(blk);
  bf.deleteActiveBlock();
  await flush();
}

// Click-insert a run of block types in order (the kid tapping palette tiles).
async function insertSeq(bf, types) {
  for (const t of types) bf.insertBlock(t);
  await flush();
}

// Assert ONE top block and that its full depth-first chain shape equals `expected`.
function assertChain(ws, expected, msg) {
  assert.equal(
    topCount(ws),
    1,
    `${msg}: expected ONE top block (superpose === topCount > 1), found ${topCount(ws)}` +
      (topCount(ws) > 1
        ? ` — tops: ${ws.getTopBlocks(false).map((b) => b.type).join(', ')}`
        : ''),
  );
  assert.deepEqual(chainTypes(ws), expected, `${msg}: chain shape`);
}

// Assert ONE top block whose chain is some PERMUTATION of `expected` (order may
// differ after reorders, but nothing may be dropped, duplicated, or orphaned).
function assertChainPermutation(ws, expected, msg) {
  assert.equal(
    topCount(ws),
    1,
    `${msg}: expected ONE top block (superpose === topCount > 1), found ${topCount(ws)}` +
      (topCount(ws) > 1
        ? ` — tops: ${ws.getTopBlocks(false).map((b) => b.type).join(', ')}`
        : ''),
  );
  const got = chainTypes(ws);
  assert.deepEqual(
    [...got].sort(),
    [...expected].sort(),
    `${msg}: chain must be a permutation of the expected blocks`,
  );
  return got;
}

// ---------------------------------------------------------------------------
// Sequence 1 — insert, move (down then up), insert MORE: the late inserts must
// still chain onto the SAME tower, never superpose.
// ---------------------------------------------------------------------------
test('seq1: build -> move down -> move up -> insert more keeps ONE chain', async () => {
  const { ws, bf } = setup();
  await insertSeq(bf, ['take_off', 'fly_forward', 'fly_forward']);
  assertChain(ws, ['take_off', 'fly_forward', 'fly_forward'], 'seq1 after build');

  await moveAt(bf, ws, 1, 'down'); // middle down
  assertChainPermutation(ws, ['take_off', 'fly_forward', 'fly_forward'], 'seq1 after move down');
  await moveAt(bf, ws, 2, 'up'); // bottom up
  assertChainPermutation(ws, ['take_off', 'fly_forward', 'fly_forward'], 'seq1 after move up');

  // Now click more blocks — the rearrange lock from the moves must not strand them.
  await insertSeq(bf, ['turn_left', 'fly_forward']);
  assertChainPermutation(
    ws,
    ['take_off', 'fly_forward', 'fly_forward', 'turn_left', 'fly_forward'],
    'seq1 after inserting more post-move',
  );
});

// ---------------------------------------------------------------------------
// Sequence 2 — insert, DELETE a middle block (toolbar ✕), then insert more. The
// delete re-anchors to a neighbour; follow-up clicks must keep ONE chain.
// ---------------------------------------------------------------------------
test('seq2: build -> delete middle -> insert more keeps ONE chain', async () => {
  const { ws, bf } = setup();
  await insertSeq(bf, ['take_off', 'fly_forward', 'turn_left', 'fly_forward']);
  assertChain(ws, ['take_off', 'fly_forward', 'turn_left', 'fly_forward'], 'seq2 after build');

  await deleteAt(bf, ws, 2); // delete the turn_left in the middle
  assertChain(ws, ['take_off', 'fly_forward', 'fly_forward'], 'seq2 after delete middle');

  await insertSeq(bf, ['turn_right', 'fly_forward']);
  assertChain(
    ws,
    ['take_off', 'fly_forward', 'fly_forward', 'turn_right', 'fly_forward'],
    'seq2 after inserting more post-delete',
  );
});

// ---------------------------------------------------------------------------
// Sequence 3 — move, delete, move, insert all interleaved on the SAME tower.
// A stress permutation that mixes every toolbar primitive before re-inserting.
// ---------------------------------------------------------------------------
test('seq3: move -> delete -> move -> insert interleaved keeps ONE chain', async () => {
  const { ws, bf } = setup();
  await insertSeq(bf, ['take_off', 'fly_forward', 'fly_up', 'fly_down', 'turn_left']);
  assertChain(
    ws,
    ['take_off', 'fly_forward', 'fly_up', 'fly_down', 'turn_left'],
    'seq3 after build',
  );

  await moveAt(bf, ws, 3, 'up'); // fly_down up past fly_up
  assertChainPermutation(
    ws,
    ['take_off', 'fly_forward', 'fly_up', 'fly_down', 'turn_left'],
    'seq3 after move up',
  );
  await deleteAt(bf, ws, 4); // delete the bottom block (turn_left at the tail)
  assertChainPermutation(
    ws,
    ['take_off', 'fly_forward', 'fly_up', 'fly_down'],
    'seq3 after delete tail',
  );
  await moveAt(bf, ws, 1, 'down'); // shuffle a middle block
  assertChainPermutation(
    ws,
    ['take_off', 'fly_forward', 'fly_up', 'fly_down'],
    'seq3 after second move',
  );

  await insertSeq(bf, ['turn_right']); // late insert must still chain
  assertChainPermutation(
    ws,
    ['take_off', 'fly_forward', 'fly_up', 'fly_down', 'turn_right'],
    'seq3 after late insert',
  );
});

// ---------------------------------------------------------------------------
// Sequence 4 — repeat container in the mix. Insert a repeat, tap blocks (they
// dive into the body), move a body block, delete a body block, insert more —
// the whole structure must stay ONE top block with the body intact.
//
// CAPTURED BUG (this test currently FAILS — do NOT weaken it): the body-block
// MOVE sets the sticky rearrange lock (internalRearrange / rearrangeTargetBlock)
// and the body-block DELETE never clears it. deleteActiveBlock re-anchors
// synchronously onto a valid neighbour, but the deferred BLOCK_MOVE tail from the
// delete then hits the listener's `internalRearrange && rearrangeTargetBlock &&
// rearrangeTargetBlock.workspace` branch — the disposed rearrange target still
// has a truthy `.workspace`, so setLastActive(rearrangeTargetBlock) runs, the
// disposed-block guard nulls it, and lastActive becomes null. The very next
// click-insert then takes anchorBlock's no-anchor branch and free-places the
// block as a SECOND top block (superpose). This is the same stale-rearrange-lock
// class as seq6, surfaced here by a move+delete (no start-over needed).
// The assertion below is the CORRECT behaviour (ONE chain); a failure IS the bug.
// ---------------------------------------------------------------------------
test('seq4 CAPTURED BUG: repeat body move -> delete -> insert must keep ONE chain', async () => {
  const { ws, bf } = setup();
  // take_off, then a repeat; tapping flight blocks while the repeat is the anchor
  // drops them INTO its body (container swallow).
  await insertSeq(bf, ['take_off', 'repeat_n', 'fly_forward', 'fly_forward', 'turn_left']);
  // Depth-first: take_off, repeat_n, then its body fly_forward, fly_forward, turn_left.
  assertChain(
    ws,
    ['take_off', 'repeat_n', 'fly_forward', 'fly_forward', 'turn_left'],
    'seq4 after building repeat body',
  );
  // Sanity: the repeat is mid-chain and actually contains a body.
  const repeat = spine(ws).find((b) => b.type === 'repeat_n');
  assert.ok(repeat, 'seq4: repeat_n present in the top chain');
  const bodyInput = repeat.inputList.find(
    (i) => i.connection && i.connection.type === 3,
  );
  assert.ok(bodyInput && bodyInput.connection.targetBlock(), 'seq4: repeat body is non-empty');

  // Reorder a body block: select the first body block and move it down within
  // the body. Still ONE top block; same multiset overall.
  const firstBody = bodyInput.connection.targetBlock();
  bf.setLastActive(firstBody);
  bf.moveActiveBlock('down');
  await flush();
  assertChainPermutation(
    ws,
    ['take_off', 'repeat_n', 'fly_forward', 'fly_forward', 'turn_left'],
    'seq4 after moving a body block',
  );

  // Delete a body block via the toolbar, then click MORE blocks (anchor is the
  // re-anchored body neighbour, so taps keep landing in the body).
  const repeat2 = spine(ws).find((b) => b.type === 'repeat_n');
  const body2 = repeat2.inputList.find((i) => i.connection && i.connection.type === 3);
  const aBodyBlock = body2.connection.targetBlock().getNextBlock(); // 2nd in body
  bf.setLastActive(aBodyBlock);
  bf.deleteActiveBlock();
  await flush();
  assert.equal(topCount(ws), 1, 'seq4: still ONE top block after deleting a body block');

  // CORRECT behaviour: the late insert chains into the existing tower (ONE top
  // block). A FAILURE HERE (topCount > 1) is the captured stale-rearrange-lock
  // superpose: the prior body move left the lock set, the body delete didn't
  // clear it, the deferred delete tail nulled the anchor onto the disposed
  // rearrange target, and this insert free-placed as a second top block. Do NOT
  // weaken this assertion to make it pass.
  await insertSeq(bf, ['fly_up']);
  assert.equal(
    topCount(ws),
    1,
    'seq4: inserting after a body move+delete must keep ONE chain, not superpose ' +
      '— a failure here is the captured stale-rearrange-lock bug',
  );
});

// ---------------------------------------------------------------------------
// Sequence 5 — startOver in the middle of an editing session, twice, with
// inserts after each wipe. After every wipe the fresh clicks must relink.
// ---------------------------------------------------------------------------
test('seq5: build -> startOver -> rebuild -> startOver -> rebuild keeps ONE chain each time', async () => {
  const { ws, bf } = setup();

  await insertSeq(bf, ['take_off', 'fly_forward', 'fly_forward']);
  assertChain(ws, ['take_off', 'fly_forward', 'fly_forward'], 'seq5 first build');

  bf.startOver();
  await flush();
  assert.equal(topCount(ws), 0, 'seq5: first startOver emptied the workspace');

  await insertSeq(bf, ['take_off', 'turn_left', 'fly_forward']);
  assertChain(ws, ['take_off', 'turn_left', 'fly_forward'], 'seq5 second build (post first wipe)');

  bf.startOver();
  await flush();
  assert.equal(topCount(ws), 0, 'seq5: second startOver emptied the workspace');

  await insertSeq(bf, ['take_off', 'fly_up', 'fly_down', 'land']);
  assertChain(
    ws,
    ['take_off', 'fly_up', 'fly_down', 'land'],
    'seq5 third build (post second wipe)',
  );
});

// ---------------------------------------------------------------------------
// Sequence 6 — THE CAPTURED BUG, mixed-sequence form.
//
// Repro: build a tower, REORDER it with the toolbar (this SETS the sticky
// rearrange lock — internalRearrange / rearrangeTargetBlock), then "start over"
// (which deliberately does NOT call endRearrangeLock — see blockflow.js
// startOver), then click NEW blocks. They should relink into ONE fresh tower.
//
// The user-reported symptom: the new blocks DO NOT connect and multiple
// top-level blocks appear (superpose), because the stale rearrange lock survives
// the wipe and the change listener re-pins the click anchor (lastActive) onto the
// now-disposed rearrange target, so subsequent click-inserts fail to chain.
//
// The assertions below are written for the CORRECT behaviour: after start-over,
// fresh clicks form ONE chain. A FAILURE HERE IS THE CAPTURED BUG — do NOT weaken
// it to pass. (In this pure-headless harness insertBlock re-anchors synchronously,
// so the timing window is narrow and this may currently pass; the assertion is
// kept strict so it will fail the moment the stale lock strands a real insert.)
// ---------------------------------------------------------------------------
test('seq6 CAPTURED BUG: toolbar move -> startOver -> new clicks must relink into ONE chain', async () => {
  const { ws, bf } = setup();

  // 1) Build a 4-block chain (links fine).
  await insertSeq(bf, ['take_off', 'fly_forward', 'fly_forward', 'fly_forward']);
  assert.equal(topCount(ws), 1, 'seq6 precondition: initial chain is one tower');

  // 2) Reorder with the toolbar — SETS the sticky rearrange lock.
  await moveAt(bf, ws, 1, 'down');
  assert.equal(topCount(ws), 1, 'seq6 precondition: still one tower after the reorder');
  assert.equal(
    bf.getState().internalRearrange,
    true,
    'seq6 precondition: the toolbar move set the sticky rearrange lock',
  );

  // 3) Start over — wipes the blocks AND (the fix) releases the rearrange lock.
  bf.startOver();
  await flush();
  assert.equal(topCount(ws), 0, 'seq6 precondition: start-over emptied the workspace');
  // Regression guard: start-over must release the lock (was the bug's stale state).
  assert.equal(
    bf.getState().internalRearrange,
    false,
    'seq6: start-over must release the rearrange lock',
  );

  // 4) Click NEW connectable blocks — they must rebuild ONE chain.
  await insertSeq(bf, ['take_off', 'fly_forward', 'fly_forward']);

  // CORRECT behaviour: a single fresh tower. If this fails with topCount > 1,
  // that IS the reported superpose regression — leave the assertion as-is.
  assertChain(
    ws,
    ['take_off', 'fly_forward', 'fly_forward'],
    'seq6: after start-over, new clicks must relink into ONE chain — a failure ' +
      'here is the captured stale-rearrange-lock superpose bug',
  );
});

// ---------------------------------------------------------------------------
// Sequence 7 — CONTROL for seq6: same wipe-then-rebuild WITHOUT a preceding
// toolbar move (so the rearrange lock is never set). If seq6 ever fails while
// this passes, the difference is precisely the lock startOver fails to clear.
// ---------------------------------------------------------------------------
test('seq7 CONTROL: startOver WITHOUT a prior toolbar move relinks new clicks into ONE chain', async () => {
  const { ws, bf } = setup();

  await insertSeq(bf, ['take_off', 'fly_forward', 'fly_forward', 'fly_forward']);
  assert.equal(topCount(ws), 1, 'seq7 precondition: initial chain is one tower');
  assert.equal(
    bf.getState().internalRearrange,
    false,
    'seq7 precondition: no toolbar move, so the rearrange lock is clear',
  );

  bf.startOver();
  await flush();
  assert.equal(topCount(ws), 0, 'seq7 precondition: start-over emptied the workspace');

  await insertSeq(bf, ['take_off', 'fly_forward', 'fly_forward']);
  assertChain(
    ws,
    ['take_off', 'fly_forward', 'fly_forward'],
    'seq7 control: clean wipe must relink into ONE chain',
  );
});

// ---------------------------------------------------------------------------
// Sequence 8 — the bug shape WITHOUT start-over: move, then DELETE the whole
// tower block-by-block (each delete also runs while the lock may be set), then
// rebuild. Isolates whether the lock alone (no workspace.clear) strands inserts.
// ---------------------------------------------------------------------------
test('seq8: move -> delete every block -> rebuild keeps ONE chain', async () => {
  const { ws, bf } = setup();

  await insertSeq(bf, ['take_off', 'fly_forward', 'fly_forward']);
  await moveAt(bf, ws, 1, 'down'); // sets the rearrange lock

  // Delete from the bottom up until the workspace is empty.
  while (topCount(ws) > 0) {
    const s = spine(ws);
    bf.setLastActive(s[s.length - 1]);
    bf.deleteActiveBlock();
    await flush();
  }
  assert.equal(topCount(ws), 0, 'seq8: deleted every block');

  await insertSeq(bf, ['take_off', 'turn_left', 'fly_forward']);
  assertChain(
    ws,
    ['take_off', 'turn_left', 'fly_forward'],
    'seq8: rebuild after move+full-delete must be ONE chain',
  );
});

// ---------------------------------------------------------------------------
// Sequence 9 — onLevelReset (level switch) in the mix: build, move, level-reset,
// rebuild. onLevelReset clears the anchor but (like startOver) not the lock; a
// fresh level still starts a new chain, so the symptom must be masked here.
// ---------------------------------------------------------------------------
test('seq9: build -> move -> onLevelReset -> rebuild keeps ONE chain', async () => {
  const { ws, bf } = setup();

  await insertSeq(bf, ['take_off', 'fly_forward', 'fly_forward']);
  await moveAt(bf, ws, 2, 'up'); // sets the rearrange lock

  // A level switch in the app clears the workspace itself, then calls onLevelReset
  // to drop the anchor. Emulate both halves.
  bf.onLevelReset();
  ws.clear();
  await flush();
  assert.equal(topCount(ws), 0, 'seq9: level reset cleared the workspace');

  await insertSeq(bf, ['take_off', 'fly_up', 'land']);
  assertChain(
    ws,
    ['take_off', 'fly_up', 'land'],
    'seq9: rebuild after a level reset must be ONE chain',
  );
});
