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
      type: 'land',
      message0: '%1 land',
      args0: [
        { type: 'field_image', src: ICON_LAND, width: 22, height: 22, alt: 'land' },
      ],
      previousStatement: null,
      style: 'flight_blocks',
      tooltip: 'come back down gently',
    },
  ]);
})();
