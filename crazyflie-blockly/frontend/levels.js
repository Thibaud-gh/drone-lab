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
     zones     : array of {kind, x_cm, y_cm, w_cm, h_cm, color}
     win       : {type, ...} evaluated after the program ends
                 'land_anywhere' → drone is on the ground
                 'land_in_zone'  → drone landed inside zones[index]

   Distances in cm under the hood, but kid-facing they are
   unit-multiples (1 unit = 30 cm). So 90 cm = 3 units.
   ========================================================= */

(function () {
  const ALL_BLOCKS = [
    'take_off', 'fly_forward', 'fly_up',
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
      id: 'sandbox',
      caption: "Sandbox — fly anywhere!",
      palette: ALL_BLOCKS,
      zones: [],
      win: { type: 'land_anywhere' },
    },
  ];
})();
