/* Drone Lab — workspace view-fit math (headless, pure)
   ---------------------------------------------------------
   Pure decision helpers for the blocks-workspace view, pulled out of app.js
   so they can be unit-tested with NO rendering. app.js still does the
   rendering-coupled parts (measuring real pixels via getBoundingClientRect /
   getMetrics, and calling workspace.scroll); the *decision* lives here.

   Plain browser IIFE — no import/export. Attaches `window.ViewFit`. Also loads
   under the Node test harness (window === globalThis). No Blockly dependency.
   ========================================================= */

(function () {
  // How far to scroll (a scrollY delta, in px) so a freshly added/moved
  // block's bottom sits a little above the viewport's bottom edge — or 0 to
  // leave the view untouched.
  //
  // THE KEY RULE (regression guard for the "tower jumps a little on every
  // toolbar move" bug): when the stack is NOT overflowing the viewport, return
  // 0 unconditionally — no matter where the block sits. If everything fits, the
  // scroll-lock (applyWorkspaceMobility) pins the view to the top; scrolling
  // here just because a block is near the bottom edge gets snapped straight
  // back, and that round-trip is the visible jump. Only an OVERFLOWING stack is
  // allowed to scroll a block into view.
  //
  //   overflowing   — does the block stack exceed the visible workspace height?
  //   blockBottomPx — the block's bottom edge, in client/screen px
  //   viewBottomPx  — the workspace viewport's bottom edge, in the same px
  //   margin        — gap to keep below the block so it reads as "just added"
  function scrollIntoViewDelta(opts) {
    const { overflowing, blockBottomPx, viewBottomPx } = opts;
    const margin = typeof opts.margin === 'number' ? opts.margin : 28;
    if (!overflowing) return 0;                       // fits → never scroll (no jump)
    const overshoot = blockBottomPx - (viewBottomPx - margin);
    return overshoot > 0 ? -overshoot : 0;            // scroll content up by the overshoot
  }

  (window || globalThis).ViewFit = { scrollIntoViewDelta };
})();
