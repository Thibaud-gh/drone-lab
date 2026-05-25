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

  py.forBlock['take_off']    = () => 'drone.takeoff()\n';
  py.forBlock['land']        = () => 'drone.land()\n';
  py.forBlock['fly_forward'] = (block) => {
    const n = block.getFieldValue('DISTANCE');
    return `drone.forward(${n})\n`;
  };
  py.forBlock['fly_up'] = (block) => {
    const n = block.getFieldValue('DISTANCE');
    return `drone.up(${n})\n`;
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

  js.forBlock['take_off']    = () => 'await drone.takeoff();\n';
  js.forBlock['land']        = () => 'await drone.land();\n';
  js.forBlock['fly_forward'] = (block) => {
    const n = block.getFieldValue('DISTANCE');
    return `await drone.forward(${n});\n`;
  };
  js.forBlock['fly_up'] = (block) => {
    const n = block.getFieldValue('DISTANCE');
    return `await drone.up(${n});\n`;
  };
})();
