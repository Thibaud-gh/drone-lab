/* Drone Lab — Blockly theme
   ---------------------------------------------------------
   Mirrors the page palette so blocks feel native to the
   notebook rather than dropped in from another app.
   ========================================================= */

(function () {
  const theme = Blockly.Theme.defineTheme('drone-lab', {
    base: Blockly.Themes.Classic,

    blockStyles: {
      flight_blocks: {
        colourPrimary:   '#E76F51', // persimmon
        colourSecondary: '#F3A487',
        colourTertiary:  '#A14227',
        hat: 'cap',
      },
      sensor_blocks: {
        colourPrimary:   '#7FA877', // sage
        colourSecondary: '#A9C49F',
        colourTertiary:  '#4F7148',
      },
      logic_blocks: {
        colourPrimary:   '#E9B44C', // marigold
        colourSecondary: '#F1CF87',
        colourTertiary:  '#A0792C',
      },
      expression_blocks: {
        colourPrimary:   '#C9486A', // rose
        colourSecondary: '#E37B96',
        colourTertiary:  '#8A2A47',
      },
    },

    categoryStyles: {
      flight_category:     { colour: '#E76F51' },
      sensor_category:     { colour: '#7FA877' },
      logic_category:      { colour: '#E9B44C' },
      expression_category: { colour: '#C9486A' },
    },

    componentStyles: {
      workspaceBackgroundColour: '#FFFBEE',
      toolboxBackgroundColour:   '#F2E7CC',
      toolboxForegroundColour:   '#1A2A40',
      flyoutBackgroundColour:    '#FFFBEE',
      flyoutForegroundColour:    '#1A2A40',
      flyoutOpacity:             0.96,
      scrollbarColour:           '#1A2A40',
      scrollbarOpacity:          0.25,
      insertionMarkerColour:     '#1A2A40',
      insertionMarkerOpacity:    0.35,
      cursorColour:              '#E76F51',
      selectedGlowColour:        '#F0A93B',
      selectedGlowOpacity:       0.55,
      replacementGlowColour:     '#E76F51',
      replacementGlowOpacity:    0.55,
    },

    fontStyle: {
      family: '"Lexend", system-ui, -apple-system, sans-serif',
      weight: '500',
      size:   14,
    },

    startHats: false,
  });

  window.DRONE_THEME = theme;
})();
