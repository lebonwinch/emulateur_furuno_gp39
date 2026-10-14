// Géométrie de l'écran LCD du GP-39 : 480 × 272 pixels (manuel, spécifications §2).

export const LCD_W = 480
export const LCD_H = 272

/** Zone cartographique du plotter (même disposition que le manuel §1.4). */
export const PLOTTER = {
  panelW: 112,
  mapX: 116,
  mapY: 4,
  mapW: 360,
  mapH: 232,
  stripY: 238,
} as const

/** Zone cartographique du highway display. */
export const HIGHWAY = {
  panelW: 108,
  viewX: 112,
  viewY: 4,
  viewW: 364,
  viewH: 196,
} as const
