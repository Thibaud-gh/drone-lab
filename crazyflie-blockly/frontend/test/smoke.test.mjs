// Smoke test: prove the headless harness end-to-end WITH blockflow.js.
// Loads the real frontend blocks.js + blockflow.js, creates a BlockFlow with
// no-op hooks (so the connection logic runs but the DOM/rendering side-effects
// are skipped), wires the change listener, and drives the click-to-insert flow
// the palette tiles use in the app — then asserts the resulting tower's shape.

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  loadFrontend,
  makeWorkspace,
  flush,
  topCount,
  chainTypes,
} from './harness.mjs';

test('harness loads blockflow.js and click-inserts a take_off -> fly_forward -> fly_forward chain', async () => {
  const { BlockFlow } = loadFrontend();

  // The extraction has landed — blockflow.js exists and exposes create().
  assert.equal(typeof BlockFlow?.create, 'function', 'expected window.BlockFlow.create');

  const ws = makeWorkspace();

  // No-op hooks: every rendering/DOM side-effect (initSvg/render, glow,
  // toolbar, refreshCode, focus, scroll-lock) is a hook in the module, so a
  // headless test just passes empty functions. The connection logic and the
  // anchor/rearrange state machine run unchanged.
  const bf = BlockFlow.create(ws, {});

  // The app subscribes the module to the workspace change listener for its
  // anchor + rearrange-lock branches — mirror that here.
  ws.addChangeListener((e) => bf.onWorkspaceEvent(e));

  // Drive the palette click path: insertBlock(type) is what a tile click calls.
  bf.insertBlock('take_off');
  bf.insertBlock('fly_forward');
  bf.insertBlock('fly_forward');

  // Blockly events fire asynchronously (on a macrotask) — flush before
  // asserting on the listener-driven anchor effects.
  await flush();

  assert.equal(topCount(ws), 1, 'expected a single top block after three click-inserts');
  assert.deepEqual(chainTypes(ws), ['take_off', 'fly_forward', 'fly_forward']);
});
