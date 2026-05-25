/* Drone Lab — game levels
   ---------------------------------------------------------
   Each level is a small self-contained challenge the kid can solve
   with the current block set. Coordinates are in cm, relative to the
   drone's home position. y is negative going "forward" (canvas-up).

   Schema:
     id        : level number
     caption   : one short line for the grown-up to read aloud
     zones     : array of {kind, x_cm, y_cm, w_cm, h_cm, color}
                 — drawn on the canvas under the drone
     win       : {type, ...} — evaluated after the program ends
                 'land_anywhere' → drone is on the ground
                 'land_in_zone'  → drone landed inside zones[index]
   ========================================================= */

(function () {
  window.LEVELS = [
    {
      id: 0,
      caption: "Take off and land!",
      zones: [],
      win: { type: 'land_anywhere' },
    },
    {
      id: 1,
      caption: "Land in the green area",
      zones: [
        { kind: 'target', x_cm: 0, y_cm: -100, w_cm: 40, h_cm: 40, color: 'green' },
      ],
      win: { type: 'land_in_zone', zone: 0 },
    },
  ];
})();
