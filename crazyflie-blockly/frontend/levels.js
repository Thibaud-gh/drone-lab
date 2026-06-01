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
  // Sandbox allows multiple landings, so it uses the *_loop flight
  // variants (take_off / land with connectors on both sides). Other
  // levels with a single landing zone use the plain take_off / land.
  const ALL_BLOCKS = [
    'take_off_loop', 'fly_forward', 'fly_up', 'fly_down',
    'turn_left', 'turn_right', 'repeat_n',
    'fly_until', 'wall_ahead', 'gone_units', 'land_loop',
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
      // Two landings (pickup + delivery) → uses *_loop flight variants.
      palette: ['take_off_loop', 'fly_forward', 'turn_left', 'turn_right', 'land_loop'],
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
      // L6 — open-ended "many paths" puzzle, before the loop levels.
      // Drone starts bottom-left. The green landing area is directly
      // ahead (north). Two packages: one bottom-right, one top-right.
      // A short 2-unit-high wall sits 1/3 of the way between the start
      // and the bottom-right package, blocking the naive straight-east
      // route. The kid can fly OVER it (up 2), go AROUND its short
      // ends, or skip it entirely by grabbing the top-right package
      // first and dropping down to the bottom one. No single intended
      // solution — the point is to notice there are several.
      id: 6,
      caption: "Fetch both packages, then land up top — there are lots of ways to get there!",
      // Two pickups + a final landing → *_loop flight variants.
      palette: ['take_off_loop', 'fly_forward', 'fly_up', 'fly_down',
                'turn_left', 'turn_right', 'land_loop'],
      home_x_frac: 0.2,
      zones: [
        { kind: 'pickup', x_cm: 120, y_cm:    0, w_cm: 25, h_cm: 25 },   // bottom-right
        { kind: 'pickup', x_cm: 120, y_cm: -120, w_cm: 25, h_cm: 25 },   // top-right
        // Short wall, height 2 (clear by flying above 60 cm), 1/3 of the
        // way to the bottom-right package, just long enough to block the
        // straight shot but easy to round at either end.
        { kind: 'wall', x_cm: 40, y_cm: 0, w_cm: 12, h_cm: 60, over_height_cm: 60 },
        { kind: 'target', x_cm: 0, y_cm: -120, w_cm: 28, h_cm: 28, color: 'green' },
      ],
      win: { type: 'pickup_then_land', pickup: [0, 1], zone: 3 },
    },
    {
      // L7 — gentle intro to the loop block. Three packages plus the
      // green landing area in a straight line ahead of the drone, one
      // unit apart. Each "hop" is exactly the same dance: take off →
      // forward 1 → land. Four hops in a row is the obvious place for
      // a repeat block — the loop body is just 3 blocks, no turns.
      //
      // Solution: repeat 4 × (take_off, forward 1, land).
      //   With the loop:  4 visible blocks.
      //   Without:       12 blocks (the same trio four times).
      id: 7,
      caption: "Grab every package on the way — same hop, again and again. Can repeat help?",
      // Four landings (3 pickups + delivery) → uses *_loop variants so
      // take_off / land can live inside the repeat body.
      palette: ['take_off_loop', 'fly_forward', 'repeat_n', 'land_loop'],
      zones: [
        { kind: 'pickup', x_cm: 0, y_cm:  -30, w_cm: 25, h_cm: 25 },
        { kind: 'pickup', x_cm: 0, y_cm:  -60, w_cm: 25, h_cm: 25 },
        { kind: 'pickup', x_cm: 0, y_cm:  -90, w_cm: 25, h_cm: 25 },
        { kind: 'target', x_cm: 0, y_cm: -120, w_cm: 25, h_cm: 25, color: 'green' },
      ],
      win: { type: 'pickup_then_land', pickup: [0, 1, 2], zone: 3 },
    },
    {
      // L8 — introduces the loop block in earnest. Walls force a
      // staircase path (forward, turn_right, forward, turn_left)
      // repeated 4 times. We deliberately drop fly_up / fly_down from
      // the palette so the kid can't bypass the walls by climbing over
      // them — the only way through is the zig-zag.
      // Solution: take_off → repeat 4 × (forward 1, turn_right,
      //                                   forward 1, turn_left) → land.
      id: 8,
      caption: "Climb the staircase — the same dance, over and over",
      palette: ['take_off', 'fly_forward', 'turn_left', 'turn_right',
                'repeat_n', 'land'],
      // Drone starts bottom-left of the canvas; the corridor climbs NE.
      home_x_frac: 0.2,
      zones: [
        // ───────────── L6 STAIRCASE CORRIDOR ─────────────
        //
        //  Two thin staircase walls (12 cm thick — same as L3/L4) trace
        //  both sides of the path corridor, offset 15 cm from it. The
        //  two staircases meet around the target to seal it (the
        //  corridor entry from the west is the only opening). Adjacent
        //  segments overlap by 6 cm at each corner so the walls read
        //  visually as continuous lines rather than disjoint sticks.
        //
        //  Path:  (0,0) → (0,-30) → (30,-30) → (30,-60) → (60,-60)
        //              → (60,-90) → (90,-90) → (90,-120) → (120,-120)
        //
        //  Each rect is 12cm thick and 42cm long, so the long edges
        //  EXTEND 6cm past the centre of the perpendicular neighbour —
        //  the vertical sides of every H rect line up exactly with the
        //  outer sides of the V rects it joins, producing clean
        //  90° corners at each step.
        //
        //  Two perspective compensations are applied so the SLAB
        //  visual gap from the path is symmetric in both directions
        //  (≈ 20.5 cm on every side):
        //   • Lower walls shifted +11 cm SOUTH (2× the y lift cancels
        //     the lift's pull-up of the slab).
        //   • Lower walls shifted +5.5 cm EAST and upper walls shifted
        //     5.5 cm WEST so the V rects sit at ground-distance 20.5 cm
        //     from their vertical path segment (no lift in x, so the
        //     ground shift IS the visual shift).
        //
        //  ── Lower staircase (SE side of path) ──────────────────────
        { kind: 'wall', group: 'corridor', x_cm:  20.5, y_cm:    11, w_cm: 12, h_cm: 42 },
        { kind: 'wall', group: 'corridor', x_cm:  35.5, y_cm:    -4, w_cm: 42, h_cm: 12 },
        { kind: 'wall', group: 'corridor', x_cm:  50.5, y_cm:   -19, w_cm: 12, h_cm: 42 },
        { kind: 'wall', group: 'corridor', x_cm:  65.5, y_cm:   -34, w_cm: 42, h_cm: 12 },
        { kind: 'wall', group: 'corridor', x_cm:  80.5, y_cm:   -49, w_cm: 12, h_cm: 42 },
        { kind: 'wall', group: 'corridor', x_cm:  95.5, y_cm:   -64, w_cm: 42, h_cm: 12 },
        { kind: 'wall', group: 'corridor', x_cm: 110.5, y_cm:   -79, w_cm: 12, h_cm: 42 },
        { kind: 'wall', group: 'corridor', x_cm: 125.5, y_cm:   -94, w_cm: 42, h_cm: 12 },
        // LV4 bridges the shifted LH3 to the unmoved TR around the
        // target, so it's taller than the other V rects (h=53).
        { kind: 'wall', group: 'corridor', x_cm: 140.5, y_cm: -114.5, w_cm: 12, h_cm: 53 },
        //  ── Upper staircase (NW side of path) ──────────────────────
        { kind: 'wall', group: 'corridor', x_cm: -20.5, y_cm:  -30, w_cm: 12, h_cm: 42 },
        { kind: 'wall', group: 'corridor', x_cm:  -5.5, y_cm:  -45, w_cm: 42, h_cm: 12 },
        { kind: 'wall', group: 'corridor', x_cm:   9.5, y_cm:  -60, w_cm: 12, h_cm: 42 },
        { kind: 'wall', group: 'corridor', x_cm:  24.5, y_cm:  -75, w_cm: 42, h_cm: 12 },
        { kind: 'wall', group: 'corridor', x_cm:  39.5, y_cm:  -90, w_cm: 12, h_cm: 42 },
        { kind: 'wall', group: 'corridor', x_cm:  54.5, y_cm: -105, w_cm: 42, h_cm: 12 },
        { kind: 'wall', group: 'corridor', x_cm:  69.5, y_cm: -120, w_cm: 12, h_cm: 42 },
        { kind: 'wall', group: 'corridor', x_cm:  84.5, y_cm: -135, w_cm: 42, h_cm: 12 },
        //  ── Top of the ring — joins UH4 (ends at x=105) to LV4
        //     (north end at x=135) so the target is sealed on the
        //     north side. Slightly wider than 30 so it overlaps both
        //     neighbours at the corners. ────────────────────────────
        { kind: 'wall', group: 'corridor', x_cm: 120, y_cm: -135, w_cm: 42, h_cm: 12 },
        // Goal.
        { kind: 'target', x_cm: 120, y_cm: -120, w_cm: 30, h_cm: 30, color: 'green' },
      ],
      win: { type: 'land_in_zone', zone: 18 },
    },
    {
      // First "fly until" level: a wall straight ahead (8.5 units out)
      // with the landing area on the grid line just before it (8 units).
      // "fly until wall ahead" creeps up and stops half a unit short —
      // right on the green. Only the wall_ahead condition here.
      id: 9,
      caption: "Fly until you reach the wall, then land!",
      palette: ['take_off', 'fly_forward', 'fly_until', 'wall_ahead', 'land'],
      home_x_frac: 0.2,   // start bottom-left — long climb ahead
      zones: [
        { kind: 'wall',   x_cm: 0, y_cm: -255, w_cm: 90, h_cm: 12, over_height_cm: 60 },
        { kind: 'target', x_cm: 0, y_cm: -240, w_cm: 60, h_cm: 30, color: 'green' },
      ],
      win: { type: 'land_in_zone', zone: 1 },
    },
    {
      // Adds the "gone N units" condition. Reach the wall, turn, then fly
      // a set distance to the landing area sitting 4 units to the RIGHT
      // of the wall. Solution: take off → fly until wall ahead →
      // turn right → fly until gone 4 units → land.
      id: 10,
      caption: "Reach the wall, then turn and travel to land beside it!",
      palette: ['take_off', 'fly_forward', 'fly_until', 'wall_ahead', 'gone_units',
                'turn_left', 'turn_right', 'land'],
      home_x_frac: 0.2,   // start bottom-left — climb then head right
      zones: [
        { kind: 'wall',   x_cm:   0, y_cm: -255, w_cm: 90, h_cm: 12, over_height_cm: 60 },
        { kind: 'target', x_cm: 120, y_cm: -240, w_cm: 50, h_cm: 50, color: 'green' },
      ],
      win: { type: 'land_in_zone', zone: 1 },
    },
    {
      id: 'sandbox',
      caption: "Sandbox — fly anywhere!",
      palette: ALL_BLOCKS,
      zones: [],
      win: { type: 'land_anywhere' },
      // No zones to fit — start the canvas zoomed out enough to see ~8
      // units of forward distance, so a long flight stays on screen.
      view_units: 8,
    },
  ];
})();
