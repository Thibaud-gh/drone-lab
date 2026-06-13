// Regression guard: the "tower jumps a little on every toolbar move" bug.
// ----------------------------------------------------------------------
// User report: with ~4+ blocks, nudging any block with the ↑/↓ toolbar made
// the whole tower jump up ~one block-height and snap back. Cause: the move's
// settle tail (scrollBlockIntoView) scrolled to "reveal" the moved block
// whenever it sat near the viewport's bottom edge — EVEN WHEN THE WHOLE STACK
// FIT. The scroll-lock then immediately pinned the view back to the top, and
// that scroll-and-snap-back round-trip is the visible jump. It only showed at
// >=4 blocks because that's when the stack is tall enough to reach the bottom
// margin.
//
// The fix lives in the pure decision ViewFit.scrollIntoViewDelta: when the
// stack is NOT overflowing, it returns 0 unconditionally (no scroll, no jump);
// only an overflowing stack may scroll a block into view. These tests pin that
// decision with no rendering. (app.js still does the rendering-coupled parts —
// measuring real pixels and calling workspace.scroll — which a headless test
// can't exercise; this guards the DECISION that had the bug.)

import test from 'node:test';
import assert from 'node:assert/strict';
import { loadFrontend } from './harness.mjs';

const { ViewFit } = loadFrontend();

test('ViewFit module is exposed', () => {
  assert.equal(typeof ViewFit?.scrollIntoViewDelta, 'function',
    'expected window.ViewFit.scrollIntoViewDelta');
});

// ---------------------------------------------------------------------------
// THE REGRESSION GUARD: stack FITS -> never scroll, no matter where the block
// sits. This is the exact condition that produced the jump. Even a block whose
// bottom is far PAST the viewport bottom must yield delta 0 when !overflowing,
// because the scroll-lock owns the view and any scroll here snaps back.
// ---------------------------------------------------------------------------
test('fits (not overflowing): never scrolls, even for a block past the bottom edge', () => {
  // block bottom well past the viewport bottom — the old code WOULD have
  // scrolled (overshoot > 0); the fix must keep it at 0 because it fits.
  assert.equal(
    ViewFit.scrollIntoViewDelta({ overflowing: false, blockBottomPx: 1000, viewBottomPx: 357, margin: 28 }),
    0,
    'CAPTURED BUG: scrolling while the stack fits causes the tower-jump — must be 0',
  );
  // block comfortably within view, fits → also 0
  assert.equal(
    ViewFit.scrollIntoViewDelta({ overflowing: false, blockBottomPx: 120, viewBottomPx: 357, margin: 28 }),
    0,
  );
  // right at the bottom edge, fits → still 0
  assert.equal(
    ViewFit.scrollIntoViewDelta({ overflowing: false, blockBottomPx: 357, viewBottomPx: 357, margin: 28 }),
    0,
  );
});

// ---------------------------------------------------------------------------
// When the stack genuinely OVERFLOWS, scrolling a block into view is the
// correct behaviour (and must be preserved — don't "fix" the jump by killing
// scroll-into-view entirely).
// ---------------------------------------------------------------------------
test('overflowing: scrolls up by the overshoot when the block is past the bottom margin', () => {
  // block bottom 400, view bottom 357, margin 28 -> threshold 329 -> overshoot 71
  // delta is NEGATIVE (content moves up) by exactly the overshoot.
  assert.equal(
    ViewFit.scrollIntoViewDelta({ overflowing: true, blockBottomPx: 400, viewBottomPx: 357, margin: 28 }),
    -71,
    'overflowing + block past the margin should scroll the content up by the overshoot',
  );
});

test('overflowing: does NOT scroll when the block is already comfortably in view', () => {
  // block bottom 300 < threshold 329 -> no overshoot -> 0
  assert.equal(
    ViewFit.scrollIntoViewDelta({ overflowing: true, blockBottomPx: 300, viewBottomPx: 357, margin: 28 }),
    0,
  );
});

test('overflowing: a block exactly at the margin threshold does not scroll', () => {
  // bottom 329, threshold (357-28)=329 -> overshoot 0 -> 0
  assert.equal(
    ViewFit.scrollIntoViewDelta({ overflowing: true, blockBottomPx: 329, viewBottomPx: 357, margin: 28 }),
    0,
  );
});

test('margin defaults to 28 when omitted', () => {
  const withDefault = ViewFit.scrollIntoViewDelta({ overflowing: true, blockBottomPx: 400, viewBottomPx: 357 });
  const withExplicit = ViewFit.scrollIntoViewDelta({ overflowing: true, blockBottomPx: 400, viewBottomPx: 357, margin: 28 });
  assert.equal(withDefault, withExplicit);
  assert.equal(withDefault, -71);
});
