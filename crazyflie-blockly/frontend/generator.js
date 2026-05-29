/* Drone Lab — code generators
   ---------------------------------------------------------
   Two generators per block:
     - Python: what the user sees & what the bridge runs
     - JavaScript: what the browser runs against the sim
   ========================================================= */

(function () {
  const py = python.pythonGenerator;
  const js = javascript.javascriptGenerator;

  // --- Python ---------------------------------------------

  py.forBlock['take_off']      = () => 'drone.takeoff()\n';
  py.forBlock['take_off_loop'] = () => 'drone.takeoff()\n';
  py.forBlock['land']          = () => 'drone.land()\n';
  py.forBlock['land_loop']     = () => 'drone.land()\n';
  py.forBlock['turn_left']     = () => 'drone.turn_left()\n';
  py.forBlock['turn_right']    = () => 'drone.turn_right()\n';
  py.forBlock['fly_forward'] = (block) => {
    const n = block.getFieldValue('DISTANCE');
    return `drone.forward(${n})\n`;
  };
  py.forBlock['fly_up'] = (block) => {
    const n = block.getFieldValue('DISTANCE');
    return `drone.up(${n})\n`;
  };
  py.forBlock['fly_down'] = (block) => {
    const n = block.getFieldValue('DISTANCE');
    return `drone.down(${n})\n`;
  };
  py.forBlock['repeat_n'] = (block) => {
    const n = block.getFieldValue('TIMES');
    // statementToCode already indents the body using the generator's INDENT.
    const body = py.statementToCode(block, 'DO') || (py.INDENT + 'pass\n');
    return `for _ in range(${n}):\n${body}`;
  };

  // Tell the Python generator to emit a comment header
  py.init = (function (orig) {
    return function (workspace) {
      orig.call(this, workspace);
      this.definitions_['drone_header'] =
        '# Drone Lab — generated from blocks\n' +
        '# (the drone reads top to bottom, one line at a time)\n';
    };
  })(py.init);

  // --- JavaScript (drives the in-browser simulator) -------

  js.forBlock['take_off']      = () => 'await drone.takeoff();\n';
  js.forBlock['take_off_loop'] = () => 'await drone.takeoff();\n';
  js.forBlock['land']          = () => 'await drone.land();\n';
  js.forBlock['land_loop']     = () => 'await drone.land();\n';
  js.forBlock['turn_left']     = () => 'await drone.turn_left();\n';
  js.forBlock['turn_right']    = () => 'await drone.turn_right();\n';
  js.forBlock['fly_forward'] = (block) => {
    const n = block.getFieldValue('DISTANCE');
    return `await drone.forward(${n});\n`;
  };
  js.forBlock['fly_up'] = (block) => {
    const n = block.getFieldValue('DISTANCE');
    return `await drone.up(${n});\n`;
  };
  js.forBlock['fly_down'] = (block) => {
    const n = block.getFieldValue('DISTANCE');
    return `await drone.down(${n});\n`;
  };
  // Repeat loop — break out the moment the kid hits reset mid-flight so
  // subsequent iterations don't keep running against the freshly-reset
  // drone. Inside the loop we also call setRepeatCount() with the
  // iterations remaining so the kid sees the number on the repeat
  // block tick down: 4 → 3 → 2 → 1 → 0. `flightGen` /
  // `setRepeatCount` / `highlightBlock` are injected as parameters of
  // the generated async wrapper (see app.js).
  js.forBlock['repeat_n'] = (block) => {
    const n = block.getFieldValue('TIMES');
    const idLit = JSON.stringify(block.id);
    const body = js.statementToCode(block, 'DO');
    return (
      `for (let i = 0; i < ${n}; i++) {\n` +
      `  if (drone._gen !== flightGen) break;\n` +
      `  setRepeatCount(${idLit}, ${n} - i);\n` +
      `${body}` +
      `}\n` +
      `setRepeatCount(${idLit}, 0);\n`
    );
  };

  // Inject a highlight call before every statement block. The kid sees
  // each block "light up" in sync with what the drone is doing on the
  // canvas. The replacement happens at code-generation time —
  // STATEMENT_PREFIX swaps `%1` for the block's quoted id.
  js.STATEMENT_PREFIX = 'highlightBlock(%1);\n';
})();
