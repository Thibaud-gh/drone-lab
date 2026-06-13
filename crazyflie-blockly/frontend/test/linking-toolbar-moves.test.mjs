// Headless tests for the block-flow toolbar-move + start-over linking behaviour.
//
// Everything runs against the REAL frontend logic in blockflow.js, loaded by the
// harness with NO browser / NO rendering. We drive the exact same operations the
// kid's clicks and the floating ↑ ↓ ✕ toolbar trigger in the app
// (bf.insertBlock, bf.moveActiveBlock, bf.startOver, …), wire the module to the
// workspace change listener like app.js does, and assert on the CONNECTION GRAPH.
//
// "Superpose" === more than one top-level block when every inserted block was
// connectable and should have formed ONE chain. The whole point of these tests is
// to distinguish a healthy single tower (a permutation of the same blocks) from
// the user-reported regression where new blocks drop on top of each other.

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  loadFrontend,
  makeWorkspace,
  flush,
  topCount,
  chainTypes,
} from './harness.mjs';

// Each test gets its own freshly-loaded module + workspace, wired exactly like
// app.js: BlockFlow.create with no-op hooks (the connection logic and the
// anchor/rearrange state machine run unchanged) and the change listener
// forwarding every event to bf.onWorkspaceEvent.
function setup() {
  const { Blockly, BlockFlow } = loadFrontend();
  assert.equal(typeof BlockFlow?.create, 'function', 'expected window.BlockFlow.create');
  const ws = makeWorkspace();
  const bf = BlockFlow.create(ws, {});
  ws.addChangeListener((e) => bf.onWorkspaceEvent(e));
  return { Blockly, ws, bf };
}

// Build a chain of the given block types via the click-to-insert path. The first
// block is a `take_off` hat-top starter; the rest are connectable flight blocks
// that should chain onto the bottom of the active stack.
//
// We flush() BETWEEN each insert, not just once at the end. This is faithful to
// how the app behaves: the kid clicks a tile, Blockly's DEFERRED (setTimeout 0)
// BLOCK_MOVE / SELECTED events fire, THEN she clicks the next tile. The
// anchor/rearrange-lock listener branches only run when those deferred events
// fire — so batching every insert before a single trailing flush would let the
// in-memory anchor stay valid across all of them and MASK the superpose bug.
async function buildChain(bf, types) {
  for (const t of types) {
    bf.insertBlock(t);
    await flush(); // let the deferred BLOCK_MOVE / SELECTED listener branches run
  }
}

// A "permutation" assertion: still ONE top block, and the multiset of block types
// is unchanged (a reorder may shuffle order but must never drop, duplicate, or
// orphan a block). Returns the current chain types for further inspection.
function assertSingleChainPermutation(ws, expectedTypesSorted, msg) {
  assert.equal(
    topCount(ws),
    1,
    `${msg}: expected ONE top block (superpose === topCount > 1), found ${topCount(ws)}`,
  );
  const got = chainTypes(ws);
  assert.deepEqual(
    [...got].sort(),
    [...expectedTypesSorted].sort(),
    `${msg}: chain must be a permutation of the original blocks`,
  );
  return got;
}

// ---------------------------------------------------------------------------
// 1. Baseline — a chain links into a single tower with click-to-insert.
// ---------------------------------------------------------------------------
test('4-block chain links into one tower (take_off + fly_forward x3)', async () => {
  const { ws, bf } = setup();
  await buildChain(bf, ['take_off', 'fly_forward', 'fly_forward', 'fly_forward']);

  assert.equal(topCount(ws), 1, 'four connectable click-inserts must form ONE chain, not superpose');
  assert.deepEqual(chainTypes(ws), ['take_off', 'fly_forward', 'fly_forward', 'fly_forward']);
});

// ---------------------------------------------------------------------------
// 2. Toolbar up/down moves at every position keep ONE chain (4 blocks).
//    After EVERY move the workspace is still a single tower (a permutation),
//    never superposed.
// ---------------------------------------------------------------------------
test('toolbar moveUp/moveDown at chain extremities + middle stays one chain (4 blocks)', async () => {
  const { ws, bf } = setup();
  const expected = ['take_off', 'fly_forward', 'fly_forward', 'fly_forward'];
  await buildChain(bf, expected);

  // Helper: select a block by index along the chain, then move it.
  const chainBlocks = () => {
    const out = [];
    for (let b = ws.getTopBlocks(false)[0]; b; b = b.getNextBlock()) out.push(b);
    return out;
  };
  const moveAt = async (index, dir) => {
    const blk = chainBlocks()[index];
    bf.setLastActive(blk);
    bf.moveActiveBlock(dir);
    await flush(); // let the deferred setLastActive / BLOCK_MOVE tail settle
  };

  // Move the LAST block up (it's at the bottom extremity).
  await moveAt(3, 'up');
  assertSingleChainPermutation(ws, expected, 'after moving last block up');

  // Move a MIDDLE block down.
  await moveAt(1, 'down');
  assertSingleChainPermutation(ws, expected, 'after moving a middle block down');

  // Move a MIDDLE block up.
  await moveAt(2, 'up');
  assertSingleChainPermutation(ws, expected, 'after moving a middle block up');

  // Try to move the SECOND block up against the starter (top extremity). The
  // starter can't be displaced, so this may be a no-op — but it must never
  // superpose.
  await moveAt(1, 'up');
  assertSingleChainPermutation(ws, expected, 'after attempting to move against the starter');

  // The starter must remain the top of the single chain throughout.
  assert.equal(ws.getTopBlocks(false)[0].type, 'take_off', 'take_off starter stays on top');
});

// ---------------------------------------------------------------------------
// 3. Same coverage for a 3-block chain.
// ---------------------------------------------------------------------------
test('toolbar moves on a 3-block chain stay one chain', async () => {
  const { ws, bf } = setup();
  const expected = ['take_off', 'fly_forward', 'fly_forward'];
  await buildChain(bf, expected);

  const chainBlocks = () => {
    const out = [];
    for (let b = ws.getTopBlocks(false)[0]; b; b = b.getNextBlock()) out.push(b);
    return out;
  };
  const moveAt = async (index, dir) => {
    bf.setLastActive(chainBlocks()[index]);
    bf.moveActiveBlock(dir);
    await flush();
  };

  await moveAt(2, 'up'); // bottom up
  assertSingleChainPermutation(ws, expected, '3-chain: bottom block up');
  await moveAt(1, 'down'); // middle down (back to original-ish)
  assertSingleChainPermutation(ws, expected, '3-chain: middle block down');
});

// ---------------------------------------------------------------------------
// 4. Same coverage for a 5-block chain.
// ---------------------------------------------------------------------------
test('toolbar moves on a 5-block chain stay one chain', async () => {
  const { ws, bf } = setup();
  const expected = ['take_off', 'fly_forward', 'fly_forward', 'fly_forward', 'fly_forward'];
  await buildChain(bf, expected);

  const chainBlocks = () => {
    const out = [];
    for (let b = ws.getTopBlocks(false)[0]; b; b = b.getNextBlock()) out.push(b);
    return out;
  };
  const moveAt = async (index, dir) => {
    bf.setLastActive(chainBlocks()[index]);
    bf.moveActiveBlock(dir);
    await flush();
  };

  await moveAt(4, 'up'); // bottom extremity up
  assertSingleChainPermutation(ws, expected, '5-chain: bottom up');
  await moveAt(1, 'down'); // top-of-body middle down
  assertSingleChainPermutation(ws, expected, '5-chain: index1 down');
  await moveAt(3, 'up'); // another middle up
  assertSingleChainPermutation(ws, expected, '5-chain: index3 up');
  await moveAt(2, 'down'); // middle down
  assertSingleChainPermutation(ws, expected, '5-chain: index2 down');

  assert.equal(ws.getTopBlocks(false)[0].type, 'take_off', '5-chain: starter stays on top');
});

// ---------------------------------------------------------------------------
// 5. THE BUG (user-reported, captured here).
//
//    Repro: build a chain, reorder with the toolbar, "start over", then click
//    NEW blocks. They should link into ONE fresh tower. The confirmed mechanism:
//    moveActiveBlock sets the sticky rearrange lock (internalRearrange = true,
//    rearrangeTargetBlock = the moved block) and startOver() deliberately does
//    NOT clear it (endRearrangeLock is intentionally omitted — see blockflow.js
//    startOver). After the wipe rearrangeTargetBlock is disposed BUT still has a
//    truthy .workspace. So when a fresh block is inserted, the DEFERRED
//    BLOCK_MOVE listener branch sees `internalRearrange && rearrangeTargetBlock
//    && rearrangeTargetBlock.workspace`, calls setLastActive(<stale, disposed>),
//    and the disposed-guard drops it to null — wiping the click anchor. The NEXT
//    connectable insert then finds no anchor and free-places, producing a second
//    top block (superpose).
//
//    Timing note: the wipe happens on the deferred event, so the symptom only
//    appears once a flush() runs BETWEEN inserts (as it does in the real app
//    between clicks). buildChain flushes between inserts for exactly this reason;
//    a single trailing flush would mask it.
//
//    The assertion below is written for the CORRECT behaviour: after start-over,
//    fresh click-inserts form ONE chain. A FAILURE HERE IS THE CAPTURED BUG —
//    do NOT weaken this assertion to make it pass.
// ---------------------------------------------------------------------------
test('CAPTURED BUG: after a toolbar move + start-over, new clicks must relink into ONE chain', async () => {
  const { ws, bf } = setup();

  // 1) Build a 4-block chain (links fine).
  await buildChain(bf, ['take_off', 'fly_forward', 'fly_forward', 'fly_forward']);
  assert.equal(topCount(ws), 1, 'precondition: the initial chain links into one tower');

  // 2) Reorder with the toolbar — this SETS the sticky rearrange lock.
  const second = ws.getTopBlocks(false)[0].getNextBlock(); // index 1
  bf.setLastActive(second);
  bf.moveActiveBlock('down');
  await flush();
  assert.equal(topCount(ws), 1, 'precondition: still one tower after the reorder');

  // 3) Start over — wipes the blocks. (Bug-preserving: does NOT clear the lock.)
  bf.startOver();
  await flush();
  assert.equal(topCount(ws), 0, 'precondition: start-over emptied the workspace');

  // 4) Click NEW blocks. These are all connectable and should rebuild ONE chain.
  await buildChain(bf, ['take_off', 'fly_forward', 'fly_forward']);

  // CORRECT behaviour: a single fresh tower. If this fails with topCount > 1,
  // that IS the reported superpose regression — the stale rearrange lock
  // survived start-over and re-pinned the anchor to a disposed block, so the
  // new blocks could not chain. Leave the assertion as-is.
  assert.equal(
    topCount(ws),
    1,
    'after start-over, new clicks must relink into ONE chain (superpose === topCount > 1) — ' +
      'a failure here is the captured stale-rearrange-lock bug',
  );
  assert.deepEqual(
    chainTypes(ws),
    ['take_off', 'fly_forward', 'fly_forward'],
    'the fresh chain should be take_off -> fly_forward -> fly_forward',
  );
});

// ---------------------------------------------------------------------------
// 6. Control: without a preceding toolbar move, start-over + new clicks relink
//    fine. This isolates the rearrange lock as the culprit — if THIS passes but
//    test #5 fails, the difference is precisely the toolbar move that set the
//    lock startOver fails to clear.
// ---------------------------------------------------------------------------
test('CONTROL: start-over WITHOUT a prior toolbar move relinks new clicks into one chain', async () => {
  const { ws, bf } = setup();

  await buildChain(bf, ['take_off', 'fly_forward', 'fly_forward', 'fly_forward']);
  assert.equal(topCount(ws), 1, 'precondition: initial chain is one tower');

  // No toolbar move here — straight to start-over.
  bf.startOver();
  await flush();
  assert.equal(topCount(ws), 0, 'precondition: start-over emptied the workspace');

  await buildChain(bf, ['take_off', 'fly_forward', 'fly_forward']);
  assert.equal(topCount(ws), 1, 'control path must relink into ONE chain');
  assert.deepEqual(chainTypes(ws), ['take_off', 'fly_forward', 'fly_forward']);
});
