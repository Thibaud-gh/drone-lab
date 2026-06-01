/* Drone Lab — block definitions
   ---------------------------------------------------------
   Movement values are in **units** (kid-facing). 1 unit = 30 cm
   in the physical world; the conversion happens inside the
   Drone drivers (SimDrone, MockDrone, future CrazyflieDrone).
   The scale bar on the canvas shows "1 unit" as a reference.
   ========================================================= */

(function () {
  function icon(svg) {
    return 'data:image/svg+xml;utf8,' + encodeURIComponent(svg);
  }

  const ICON_TAKEOFF = icon(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">
    <g fill="none" stroke="#FFFBEE" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M4 26 L28 6 L20 14 L26 18 L14 22 L18 14 Z" />
      <path d="M6 28 L26 28" stroke-dasharray="2 3" />
    </g></svg>`);

  const ICON_FORWARD = icon(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">
    <g fill="none" stroke="#FFFBEE" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">
      <path d="M5 16 L25 16" />
      <path d="M19 9 L26 16 L19 23" />
    </g></svg>`);

  const ICON_UP = icon(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">
    <g fill="none" stroke="#FFFBEE" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">
      <path d="M16 27 L16 7" />
      <path d="M9 13 L16 6 L23 13" />
    </g></svg>`);

  const ICON_DOWN = icon(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">
    <g fill="none" stroke="#FFFBEE" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">
      <path d="M16 5 L16 25" />
      <path d="M9 19 L16 26 L23 19" />
    </g></svg>`);

  const ICON_LAND = icon(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">
    <g fill="none" stroke="#FFFBEE" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M16 4 L16 20" />
      <path d="M9 14 L16 21 L23 14" />
      <path d="M5 27 L27 27" stroke-dasharray="2 3" />
    </g></svg>`);

  const ICON_TURN_LEFT = icon(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">
    <g fill="none" stroke="#FFFBEE" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">
      <path d="M22 24 A11 11 0 0 0 11 13 L4 13" />
      <path d="M10 7 L4 13 L10 19" />
    </g></svg>`);

  const ICON_TURN_RIGHT = icon(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">
    <g fill="none" stroke="#FFFBEE" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">
      <path d="M10 24 A11 11 0 0 1 21 13 L28 13" />
      <path d="M22 7 L28 13 L22 19" />
    </g></svg>`);

  // Circular arrow — same visual language as Blockly's built-in repeat.
  const ICON_REPEAT = icon(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">
    <g fill="none" stroke="#FFFBEE" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">
      <path d="M7 18 A9 9 0 1 0 9 10" />
      <path d="M4 6 L9 10 L5 15" />
    </g></svg>`);

  // Forward arrow stopping at a bar — "fly forward until …".
  const ICON_UNTIL = icon(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">
    <g fill="none" stroke="#FFFBEE" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">
      <path d="M4 16 L19 16" />
      <path d="M13 10 L19 16 L13 22" />
      <path d="M25 7 L25 25" />
    </g></svg>`);

  // Little brick wall — the "wall ahead" sensor.
  const ICON_WALLAHEAD = icon(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">
    <g fill="none" stroke="#FFFBEE" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <rect x="6" y="11" width="20" height="14" rx="1.5" />
      <path d="M6 18 L26 18 M13 11 L13 18 M19 18 L19 25 M13 25 L13 18" />
    </g></svg>`);

  // Dashed trail to a flag — the "gone N units" travelled-distance sensor.
  const ICON_GONE = icon(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">
    <g fill="none" stroke="#FFFBEE" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M4 24 L22 24" stroke-dasharray="3 3.5" />
      <path d="M22 24 L22 8 L29 11 L22 14" />
    </g></svg>`);

  // take_off and land each come in TWO shapes:
  //   • take_off / land  — starter + terminator. Match the
  //     "one flight, one landing" feel of L1, L2, L4, L5, L7.
  //   • take_off_loop / land_loop — connectors on every side so they
  //     can live mid-sequence (and inside repeat bodies). Used by
  //     levels with multiple landings: L3 (pickup-and-deliver), L6
  //     (hop), and sandbox.
  // The kid sees identical tiles in the palette either way — the
  // level's palette decides which type the tile actually inserts.
  Blockly.common.defineBlocksWithJsonArray([
    {
      type: 'take_off',
      message0: '%1 take off',
      args0: [
        { type: 'field_image', src: ICON_TAKEOFF, width: 22, height: 22, alt: 'takeoff' },
      ],
      nextStatement: null,
      style: 'flight_blocks',
      tooltip: 'lift off and hover',
    },
    {
      type: 'take_off_loop',
      message0: '%1 take off',
      args0: [
        { type: 'field_image', src: ICON_TAKEOFF, width: 22, height: 22, alt: 'takeoff' },
      ],
      previousStatement: null,
      nextStatement: null,
      style: 'flight_blocks',
      tooltip: 'lift off and hover',
    },
    {
      type: 'fly_forward',
      message0: '%1 fly forward %2',
      args0: [
        { type: 'field_image', src: ICON_FORWARD, width: 22, height: 22, alt: 'forward' },
        { type: 'field_number', name: 'DISTANCE', value: 1, min: 1, max: 10, precision: 1 },
      ],
      previousStatement: null,
      nextStatement: null,
      style: 'flight_blocks',
      tooltip: 'move forward by this many units',
    },
    {
      type: 'fly_up',
      message0: '%1 fly up %2',
      args0: [
        { type: 'field_image', src: ICON_UP, width: 22, height: 22, alt: 'up' },
        { type: 'field_number', name: 'DISTANCE', value: 1, min: 1, max: 6, precision: 1 },
      ],
      previousStatement: null,
      nextStatement: null,
      style: 'flight_blocks',
      tooltip: 'climb up by this many units',
    },
    {
      type: 'fly_down',
      message0: '%1 fly down %2',
      args0: [
        { type: 'field_image', src: ICON_DOWN, width: 22, height: 22, alt: 'down' },
        { type: 'field_number', name: 'DISTANCE', value: 1, min: 1, max: 6, precision: 1 },
      ],
      previousStatement: null,
      nextStatement: null,
      style: 'flight_blocks',
      tooltip: 'descend by this many units',
    },
    {
      type: 'turn_left',
      message0: '%1 turn left',
      args0: [
        { type: 'field_image', src: ICON_TURN_LEFT, width: 22, height: 22, alt: 'turn left' },
      ],
      previousStatement: null,
      nextStatement: null,
      style: 'flight_blocks',
      tooltip: 'turn left by a quarter (90°)',
    },
    {
      type: 'turn_right',
      message0: '%1 turn right',
      args0: [
        { type: 'field_image', src: ICON_TURN_RIGHT, width: 22, height: 22, alt: 'turn right' },
      ],
      previousStatement: null,
      nextStatement: null,
      style: 'flight_blocks',
      tooltip: 'turn right by a quarter (90°)',
    },
    {
      // Standard repeat-N — number on the block, statement mouth for the
      // body. Mirrors Blockly's controls_repeat but styled in our marigold
      // logic colour and worded for a 5-yo.
      type: 'repeat_n',
      message0: '%1 repeat %2 times',
      args0: [
        { type: 'field_image', src: ICON_REPEAT, width: 22, height: 22, alt: 'repeat' },
        { type: 'field_number', name: 'TIMES', value: 4, min: 1, max: 10, precision: 1 },
      ],
      message1: 'do %1',
      args1: [
        { type: 'input_statement', name: 'DO' },
      ],
      previousStatement: null,
      nextStatement: null,
      style: 'logic_blocks',
      tooltip: 'do the blocks inside this one N times in a row',
    },
    {
      // First REACTIVE block: fly forward and keep going until the
      // plugged-in condition becomes true. The condition is a separate
      // sage block dropped into the slot (wall_ahead / gone_units).
      type: 'fly_until',
      message0: '%1 fly forward until %2',
      args0: [
        { type: 'field_image', src: ICON_UNTIL, width: 22, height: 22, alt: 'fly until' },
        { type: 'input_value', name: 'COND', check: 'Boolean' },
      ],
      inputsInline: true,
      previousStatement: null,
      nextStatement: null,
      style: 'flight_blocks',
      tooltip: 'fly forward until the condition is true',
    },
    {
      // Sensor condition: is there a wall close in front? (front
      // Multi-ranger on the real drone; ray-cast in the sim.)
      type: 'wall_ahead',
      message0: '%1 wall ahead',
      args0: [
        { type: 'field_image', src: ICON_WALLAHEAD, width: 22, height: 22, alt: 'wall ahead' },
      ],
      output: 'Boolean',
      style: 'sensor_blocks',
      tooltip: 'true when a wall is close in front of the drone',
    },
    {
      // Travelled-distance condition: true once the drone has gone N
      // units during this "fly forward until". (The loop keeps flying
      // while the travelled distance is still below the threshold.)
      type: 'gone_units',
      message0: '%1 gone %2 units',
      args0: [
        { type: 'field_image', src: ICON_GONE, width: 22, height: 22, alt: 'gone' },
        { type: 'field_number', name: 'UNITS', value: 3, min: 1, max: 10, precision: 1 },
      ],
      output: 'Boolean',
      style: 'sensor_blocks',
      tooltip: 'true once the drone has travelled this many units',
    },
    {
      type: 'land',
      message0: '%1 land',
      args0: [
        { type: 'field_image', src: ICON_LAND, width: 22, height: 22, alt: 'land' },
      ],
      previousStatement: null,
      style: 'flight_blocks',
      tooltip: 'come back down gently',
    },
    {
      type: 'land_loop',
      message0: '%1 land',
      args0: [
        { type: 'field_image', src: ICON_LAND, width: 22, height: 22, alt: 'land' },
      ],
      previousStatement: null,
      nextStatement: null,
      style: 'flight_blocks',
      tooltip: 'come back down gently',
    },
  ]);
})();
