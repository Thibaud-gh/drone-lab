/* Drone Lab — block definitions
   ---------------------------------------------------------
   Four starter blocks: take_off, fly_forward, fly_up, land.
   Each uses a small SVG icon (data URI) + a chunky label.
   ========================================================= */

(function () {
  // helper: encode an inline SVG string as a data URI we can hand to field_image
  function icon(svg) {
    return 'data:image/svg+xml;utf8,' + encodeURIComponent(svg);
  }

  // hand-drawn-style line icons, white-on-block (filled by stroke)
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

  const ICON_LAND = icon(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">
    <g fill="none" stroke="#FFFBEE" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M16 4 L16 20" />
      <path d="M9 14 L16 21 L23 14" />
      <path d="M5 27 L27 27" stroke-dasharray="2 3" />
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
      message0: '%1 fly forward %2 cm',
      args0: [
        { type: 'field_image', src: ICON_FORWARD, width: 22, height: 22, alt: 'forward' },
        { type: 'field_number', name: 'DISTANCE', value: 30, min: 5, max: 300, precision: 5 },
      ],
      previousStatement: null,
      nextStatement: null,
      style: 'flight_blocks',
      tooltip: 'move forward by this many cm',
    },
    {
      type: 'fly_up',
      message0: '%1 fly up %2 cm',
      args0: [
        { type: 'field_image', src: ICON_UP, width: 22, height: 22, alt: 'up' },
        { type: 'field_number', name: 'DISTANCE', value: 20, min: 5, max: 200, precision: 5 },
      ],
      previousStatement: null,
      nextStatement: null,
      style: 'flight_blocks',
      tooltip: 'climb up by this many cm',
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
