// Headless test harness for Drone Lab's block-linking logic.
//
// NO browser, NO preview, NO jsdom, NO rendering. blocks.js (and, once it
// exists, blockflow.js) are browser IIFEs that reference the `Blockly` global
// and attach to `window`. We load them in Node by pointing both globals at the
// real npm `blockly@11` module, then eval'ing the file text. Connections work
// fully on a plain `new Blockly.Workspace()` — see CLAUDE.md §2 / the lead's
// verified harness facts.

import * as Blockly from 'blockly';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const FRONTEND = join(HERE, '..');

// Eval a frontend IIFE file against the Blockly/window globals it expects.
// Returns true if the file was loaded, false if it does not exist (tolerated).
function evalFrontendFile(name) {
  let src;
  try {
    src = readFileSync(join(FRONTEND, name), 'utf8');
  } catch (err) {
    if (err && err.code === 'ENOENT') return false;
    throw err;
  }
  // Indirect eval so the IIFE runs in global scope, seeing globalThis.Blockly
  // and globalThis.window (which we alias to globalThis below).
  (0, eval)(src);
  return true;
}

/**
 * Wire up the globals the frontend IIFEs assume, then load blocks.js and
 * (if present) blockflow.js. blockflow.js does not exist yet — its absence is
 * tolerated so the harness can be proven before the extraction lands.
 *
 * @returns {{ Blockly: typeof Blockly, BlockFlow: unknown }}
 */
export function loadFrontend() {
  globalThis.Blockly = Blockly;
  // The IIFEs attach to `window`; make it the same object as globalThis so
  // anything they hang off `window.*` is reachable afterwards.
  globalThis.window = globalThis;

  // A headless (non-injected) Blockly.Block has no rendering layer, so the
  // rendered-geometry API `getHeightWidth()` is absent. blockflow.js calls it
  // ONLY in the no-anchor branch of anchorBlock to pick a free-placement offset
  // for the very first block (a positional moveBy, not connection-graph work).
  // Provide a fixed-size stand-in so that path runs headlessly.
  if (typeof Blockly.Block.prototype.getHeightWidth !== 'function') {
    Blockly.Block.prototype.getHeightWidth = function () {
      return { width: 100, height: 40 };
    };
  }

  evalFrontendFile('blocks.js');
  const hadBlockFlow = evalFrontendFile('blockflow.js');
  // viewfit.js is pure math (no Blockly), but loads the same IIFE-on-window way.
  const hadViewFit = evalFrontendFile('viewfit.js');

  return {
    Blockly,
    BlockFlow: hadBlockFlow ? globalThis.window.BlockFlow : undefined,
    ViewFit: hadViewFit ? globalThis.window.ViewFit : undefined,
  };
}

/**
 * A fresh headless workspace — no inject, no SVG, no jsdom.
 *
 * A plain `new Blockly.Workspace()` has no rendering layer, so the
 * view-metrics API (`getMetrics`) that an *injected* workspace provides is
 * absent. blockflow.js reads `workspace.getMetrics()` ONLY to compute where to
 * free-place the very first block (the no-anchor branch of anchorBlock) — a
 * purely positional `moveBy`, not part of the connection graph. Stub it with a
 * fixed viewport so that path runs headlessly; the block still lands as a top
 * block, which is all the connection-graph assertions care about.
 */
export function makeWorkspace() {
  const ws = new Blockly.Workspace();
  if (typeof ws.getMetrics !== 'function') {
    ws.getMetrics = () => ({ viewWidth: 400, viewHeight: 480 });
  }
  return ws;
}

/** Flush Blockly's asynchronous event queue (events fire on a macrotask). */
export function flush() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/** Number of top-level (unparented) blocks in the workspace. */
export function topCount(ws) {
  return ws.getTopBlocks(false).length;
}

/**
 * Assert exactly ONE top block, then return the array of block `.type`s in
 * depth-first order: walk the `nextConnection` chain from the top, and at each
 * block descend into any statement (NEXT_STATEMENT) input bodies before
 * continuing along the chain. Lets a test assert the tower's shape.
 *
 * Throws a clear error if there are 0 or >1 top blocks.
 */
export function chainTypes(ws) {
  const tops = ws.getTopBlocks(false);
  if (tops.length !== 1) {
    throw new Error(
      `chainTypes expected exactly 1 top block, found ${tops.length}` +
        (tops.length ? ` (types: ${tops.map((b) => b.type).join(', ')})` : ''),
    );
  }

  const types = [];
  const visit = (block) => {
    for (let b = block; b; b = b.getNextBlock()) {
      types.push(b.type);
      // Descend into statement bodies (depth-first) before moving along the chain.
      for (const input of b.inputList) {
        const conn = input.connection;
        if (conn && conn.type === Blockly.NEXT_STATEMENT) {
          const inner = conn.targetBlock();
          if (inner) visit(inner);
        }
      }
    }
  };
  visit(tops[0]);
  return types;
}
