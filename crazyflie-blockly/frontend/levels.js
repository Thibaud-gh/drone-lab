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
     win       : {type, ...} evaluated after the program ends
                 'land_anywhere' → drone is on the ground
                 'land_in_zone'  → drone landed inside zones[index]

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
        { kind: 'target', x_cm: 0, y_cm: -90, w_cm: 40, h_cm: 40, color: 'green' },
      ],
      win: { type: 'land_in_zone', zone: 0 },
    },
    {
      id: 2,
      caption: "Land in the green area (you'll need to turn!)",
      palette: ['take_off', 'fly_forward', 'turn_left', 'turn_right', 'land'],
      zones: [
        { kind: 'target', x_cm: 60, y_cm: -90, w_cm: 25, h_cm: 25, color: 'green' },
      ],
      win: { type: 'land_in_zone', zone: 0 },
    },
    {
      // Over a 1-unit wall (top at 30 cm), then under a 2-unit beam
      // (bottom at 60 cm), then land. Strict inequalities — at the
      // obstacle's exact height the drone touches it and crashes.
      // Solution: take_off → up 1 (h=2) → forward 2 (over wall) →
      // down 1 (h=1) → forward 2 (under beam, into zone) → land.
      id: 3,
      caption: "Fly OVER the wall and UNDER the beam, then land",
      palette: ['take_off', 'fly_forward', 'fly_up', 'fly_down', 'land'],
      zones: [
        { kind: 'wall',   x_cm: 0, y_cm: -30, w_cm: 80, h_cm: 12, over_height_cm: 30 },
        { kind: 'beam',   x_cm: 0, y_cm: -90, w_cm: 80, h_cm: 12, under_height_cm: 60 },
        { kind: 'target', x_cm: 0, y_cm: -120, w_cm: 30, h_cm: 30, color: 'green' },
      ],
      win: { type: 'land_in_zone', zone: 2 },
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
