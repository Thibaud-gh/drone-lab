/* Drone Lab — game levels
   ---------------------------------------------------------
   Each level is a small self-contained challenge. The kid picks
   a level via the vertical tabs on the right of the simulator
   card; sandbox lives at the bottom of that column and unlocks
   every block.

   Schema:
     id        : number for ordered levels, or 'sandbox'
     caption   : one short line for the grown-up to read aloud
     palette   : list of block types the kid is allowed to use
                 on this level (filters the tile palette)
     zones     : array of {kind, x_cm, y_cm, w_cm, h_cm, ...}
                 kinds:
                   'target' — green zone, win by landing inside
                   'wall'   — solid obstacle, must fly STRICTLY ABOVE
                              over_height_cm (the wall's own height)
                   'beam'   — overhead obstacle, must fly STRICTLY BELOW
                              under_height_cm (the beam's own height)
                   'pickup' — marigold square; the drone must land inside
                              once during the flight to "collect" it
     win       : {type, ...} evaluated after the program ends
                 'land_anywhere'    → drone is on the ground
                 'land_in_zone'     → drone landed inside zones[index]
                 'pickup_then_land' → drone landed in zones[pickup] AT
                                      LEAST ONCE, then finished inside
                                      zones[zone]

   Distances in cm under the hood, but kid-facing they are
   unit-multiples (1 unit = 30 cm). So 90 cm = 3 units.
   ========================================================= */

(function () {
  const ALL_BLOCKS = [
    'take_off', 'fly_forward', 'fly_up', 'fly_down',
    'turn_left', 'turn_right', 'land',
  ];

  window.LEVELS = [
    {
      id: 1,
      caption: "Land in the green area",
      palette: ['take_off', 'fly_forward', 'land'],
      zones: [
        { kind: 'target', x_cm: 0, y_cm: -150, w_cm: 40, h_cm: 40, color: 'green' },
      ],
      win: { type: 'land_in_zone', zone: 0 },
    },
    {
      id: 2,
      caption: "Land in the green area (you'll need to turn!)",
      palette: ['take_off', 'fly_forward', 'turn_left', 'turn_right', 'land'],
      zones: [
        { kind: 'target', x_cm: 60, y_cm: -150, w_cm: 25, h_cm: 25, color: 'green' },
      ],
      win: { type: 'land_in_zone', zone: 0 },
    },
    {
      // Pickup-and-deliver: land on the marigold package first, then
      // carry it to the green zone. The package sits to the LEFT of the
      // start, the delivery zone sits to the RIGHT — same y as L2.
      id: 3,
      caption: "Pick up the package, then deliver it to the green area",
      palette: ['take_off', 'fly_forward', 'turn_left', 'turn_right', 'land'],
      zones: [
        { kind: 'pickup', x_cm: -60, y_cm: -150, w_cm: 25, h_cm: 25 },
        { kind: 'target', x_cm:  60, y_cm: -150, w_cm: 25, h_cm: 25, color: 'green' },
      ],
      win: { type: 'pickup_then_land', pickup: 0, zone: 1 },
    },
    {
      // Over a 1-unit wall (top at 30 cm), then under a 2-unit beam
      // (bottom at 60 cm), then land. Strict inequalities — at the
      // obstacle's exact height the drone touches it and crashes.
      // Solution: take_off → up 1 (h=2) → forward 2 (over wall) →
      // down 1 (h=1) → forward 4 (under beam, into zone) → land.
      id: 4,
      caption: "Fly OVER the wall and UNDER the beam, then land",
      palette: ['take_off', 'fly_forward', 'fly_up', 'fly_down', 'land'],
      zones: [
        { kind: 'wall',   x_cm: 0, y_cm: -30, w_cm: 80, h_cm: 12, over_height_cm: 30 },
        { kind: 'beam',   x_cm: 0, y_cm: -90, w_cm: 80, h_cm: 12, under_height_cm: 60 },
        { kind: 'target', x_cm: 0, y_cm: -180, w_cm: 30, h_cm: 30, color: 'green' },
      ],
      win: { type: 'land_in_zone', zone: 2 },
    },
    {
      // L4: combines turning + going high. Drone starts in the bottom-left
      // corner of the canvas (home_x_frac = 0.2), boxed in by 1-unit walls
      // on the north and east. The target sits diagonally up-and-right,
      // fenced by 2-unit beams. Solution sketch: take_off → up 1 (clear
      // walls) → forward 3 → turn_right → forward 3 → turn_left → down 1
      // (drop under beams) → forward 3 → land.
      id: 5,
      caption: "Escape the walls, sneak under the beams, then land",
      palette: ['take_off', 'fly_forward', 'fly_up', 'fly_down',
                'turn_left', 'turn_right', 'land'],
      home_x_frac: 0.2,
      zones: [
        // Closed square of walls around the starting position — the drone has
        // to climb over to get out. Corners overlap so it reads as one shape.
        { kind: 'wall', x_cm:   0, y_cm: -20, w_cm: 52, h_cm: 12, over_height_cm: 30 },
        { kind: 'wall', x_cm:   0, y_cm:  20, w_cm: 52, h_cm: 12, over_height_cm: 30 },
        { kind: 'wall', x_cm:  20, y_cm:   0, w_cm: 12, h_cm: 52, over_height_cm: 30 },
        { kind: 'wall', x_cm: -20, y_cm:   0, w_cm: 12, h_cm: 52, over_height_cm: 30 },
        // Two sides of a square around the target (south + west) — the kid
        // can either drop under them or fly around via the open north/east.
        { kind: 'beam', x_cm: 150, y_cm: -120, w_cm: 72, h_cm: 12, under_height_cm: 60 },
        { kind: 'beam', x_cm: 120, y_cm: -150, w_cm: 12, h_cm: 72, under_height_cm: 60 },
        // Target — 2 units right and 1 unit closer than before.
        { kind: 'target', x_cm: 150, y_cm: -150, w_cm: 25, h_cm: 25, color: 'green' },
      ],
      win: { type: 'land_in_zone', zone: 6 },
    },
    {
      id: 'sandbox',
      caption: "Sandbox — fly anywhere!",
      palette: ALL_BLOCKS,
      zones: [],
      win: { type: 'land_anywhere' },
    },
  ];
})();
