// Pictogrammes et couleurs des waypoints du GP-39.
//
// - GP39Symbol (0-9) = rang dans la liste « Symbol » du GP-39 : 0 rond, 1 carré, 2 losange, 3-5 poissons,
//   6-7 (non documentés dans le manuel : représentation provisoire), 8 tête de mort, 9 drapeau.
// - FECColor (0-6) = rang dans la liste « Color » : Red, Yellow, Green, Blue, Purple, Black, Brown.
// La tête de mort et le drapeau sont les tracés vectoriels de symbols.pdf ; les couleurs en sont aussi tirées.

import type { Waypoint } from './types'

export const COLOR_NAMES = ['Red', 'Yellow', 'Green', 'Blue', 'Purple', 'Black', 'Brown'] as const

/** Couleurs RVB relevées dans symbols.pdf. */
export const COLORS = [
  '#CA0000', // 0 Red
  '#F0E000', // 1 Yellow
  '#00B80C', // 2 Green
  '#005AE0', // 3 Blue
  '#8B008B', // 4 Purple
  '#00000C', // 5 Black
  '#C87137', // 6 Brown
] as const

/** Libellés français (légende, info-bulles). */
export const SYMBOL_NAMES_FR = [
  'Rond',
  'Carré',
  'Losange',
  'Poisson',
  'Deux poissons',
  'Banc de poissons',
  'Ancre',
  'Croix',
  'Tête de mort',
  'Drapeau',
] as const
export const COLOR_NAMES_FR = ['Rouge', 'Jaune', 'Vert', 'Bleu', 'Violet', 'Noir', 'Brun'] as const

export const SYMBOL_COUNT = 10
export const DEFAULT_SYMBOL = 0
export const DEFAULT_COLOR = 2 // cercle vert plein

interface Part {
  d: string
  /** 'fill' : rempli avec la couleur du waypoint ; 'stroke' : trait ; 'black' : rempli en noir. */
  kind: 'fill' | 'stroke' | 'black'
  sw?: number
  evenodd?: boolean
  /** contour noir autour d'une surface remplie (drapeau). */
  outline?: number
}

interface Shape {
  parts: Part[]
  tx?: number
  ty?: number
}

/** Poisson orienté vers la gauche, centré en (cx, cy), longueur ≈ 62·s. */
function fish(cx: number, cy: number, s: number): string {
  const p = (x: number, y: number): string => `${(cx + (x - 50) * s).toFixed(2)} ${(cy + (y - 50) * s).toFixed(2)}`
  return (
    `M${p(10, 50)}C${p(24, 30)} ${p(56, 26)} ${p(78, 50)}C${p(56, 74)} ${p(24, 70)} ${p(10, 50)}Z` +
    `M${p(76, 50)}L${p(94, 32)}L${p(94, 68)}Z`
  )
}

const SHAPES: Shape[] = [
  // 0 rond
  { parts: [{ d: 'M5 50a45 45 0 1 0 90 0a45 45 0 1 0-90 0Z', kind: 'fill' }] },
  // 1 carré
  { parts: [{ d: 'M8 8H92V92H8Z', kind: 'fill' }] },
  // 2 losange
  { parts: [{ d: 'M50 0L100 50L50 100L0 50Z', kind: 'fill' }] },
  // 3 poisson
  { parts: [{ d: fish(50, 50, 1.4), kind: 'fill' }] },
  // 4 deux poissons
  { parts: [{ d: fish(50, 28, 1.05) + fish(50, 74, 1.05), kind: 'fill' }] },
  // 5 banc de poissons
  { parts: [{ d: fish(34, 26, 0.9) + fish(66, 50, 0.9) + fish(34, 76, 0.9), kind: 'fill' }] },
  // 6 ancre (provisoire)
  {
    parts: [
      { d: 'M50 22V90M32 40H68M14 64C14 80 32 90 50 90C68 90 86 80 86 64M14 64l-8 12M86 64l8 12', kind: 'stroke', sw: 9 },
      { d: 'M50 6a14 14 0 1 0 0.01 0Z', kind: 'stroke', sw: 8 },
    ],
  },
  // 7 croix (provisoire)
  { parts: [{ d: 'M12 12L88 88M88 12L12 88', kind: 'stroke', sw: 16 }] },
  // 8 tête de mort (symbols.pdf)
  {
    ty: 18.65,
    parts: [
      {
        kind: 'fill',
        evenodd: true,
        d:
          'M50 0C36 0 24.6 11.4 24.6 25.4C24.6 32.4 27.4 38.8 32 43.4C34.3 45.7 35.8 60.1 38.9 61.4C41.9 62.7 58.1 62.7 61.2 61.4C64.2 60.1 65.7 45.7 68 43.4C72.6 38.8 75.4 32.4 75.4 25.4C75.4 11.4 64 0 50 0Z' +
          'M8.6 13.5C5.6 13.6 2.7 15.4 1.6 18.4C0 22.4 2 26.9 5.9 28.4C7.9 29.2 9.9 29.1 11.7 28.4L22.5 32.6C21.9 30.3 21.5 27.9 21.5 25.4C21.5 23.7 21.7 22.1 22 20.4L15.8 18C15 16.3 13.5 14.8 11.6 14C10.6 13.6 9.6 13.5 8.6 13.5Z' +
          'M91.4 13.5C90.4 13.5 89.4 13.6 88.4 14C86.4 14.8 85 16.2 84.2 18L78 20.4C78.3 22 78.6 23.7 78.6 25.4C78.6 27.9 78.1 30.3 77.5 32.6L88.3 28.4C90.1 29.1 92.1 29.2 94.1 28.4C98 26.8 100 22.4 98.4 18.4C97.3 15.4 94.4 13.6 91.4 13.5Z' +
          'M39.6 19.3C43.6 19.3 46.8 22.5 46.8 26.5C46.8 30.5 43.6 33.7 39.6 33.7C35.6 33.7 32.4 30.5 32.4 26.5C32.4 22.5 35.6 19.3 39.6 19.3Z' +
          'M60.4 19.3C64.4 19.3 67.6 22.5 67.6 26.5C67.6 30.5 64.4 33.7 60.4 33.7C56.4 33.7 53.2 30.5 53.2 26.5C53.2 22.5 56.4 19.3 60.4 19.3Z' +
          'M26 40.9L11.7 46.5C9.9 45.8 7.9 45.7 5.9 46.4C2 48 0 52.5 1.6 56.5C3.1 60.5 7.6 62.4 11.6 60.8C13.5 60.1 15 58.6 15.8 56.9L31.4 50.7C31.1 49.8 30.9 48.7 30.6 47.9C30.1 46.3 29.3 45.1 29.8 45.6C28.4 44.2 27.1 42.6 26 40.9Z' +
          'M74 40.9C72.8 42.6 71.6 44.2 70.2 45.6C70.7 45.1 69.8 46.3 69.4 47.9C69.1 48.7 68.9 49.8 68.6 50.7L84.2 56.9C85 58.6 86.4 60.1 88.4 60.8C92.4 62.4 96.9 60.5 98.4 56.5C100 52.5 98 48 94.1 46.4C92.1 45.7 90.1 45.8 88.3 46.5Z',
      },
    ],
  },
  // 9 drapeau (symbols.pdf) : hampe noire + fanion
  {
    tx: 14.6,
    parts: [
      { d: 'M0.3 0.4C14.9 17 51 13.6 70.7 11.4C51 51.3 0.3 43.9 0.3 43.9Z', kind: 'fill', outline: 4 },
      { d: 'M0 0H8.6V100H0Z', kind: 'black' },
    ],
  },
]

export const SYMBOL_NAMES = ['Circle', 'Square', 'Diamond', 'Fish', 'Fish x2', 'Fish school', 'Anchor', 'Cross', 'Skull', 'Flag']

/** Tracés SVG (boîte de 100 unités, y vers le bas) d'un symbole : sert aux tests d'orientation. */
export function symbolPaths(symbol: number): string[] {
  return SHAPES[symbol]?.parts.map((p) => p.d) ?? []
}

const path2dCache = new Map<string, Path2D>()
function path2d(d: string): Path2D {
  let p = path2dCache.get(d)
  if (!p) {
    p = new Path2D(d)
    path2dCache.set(d, p)
  }
  return p
}

/** Dessine le symbole `symbol` de couleur `color`, centré en (cx, cy), dans un carré de `size` px. */
export function drawMark(ctx: CanvasRenderingContext2D, symbol: number, color: number, cx: number, cy: number, size: number): void {
  const sh = SHAPES[symbol] ?? SHAPES[0]!
  const col = COLORS[color] ?? COLORS[DEFAULT_COLOR]
  ctx.save()
  ctx.translate(cx - size / 2, cy - size / 2)
  const sc = size / 100
  ctx.scale(sc, sc)
  ctx.translate(sh.tx ?? 0, sh.ty ?? 0)
  for (const part of sh.parts) {
    const p = path2d(part.d)
    if (part.kind === 'stroke') {
      ctx.strokeStyle = col
      ctx.lineWidth = part.sw ?? 8
      ctx.lineCap = 'round'
      ctx.lineJoin = 'round'
      ctx.stroke(p)
    } else {
      ctx.fillStyle = part.kind === 'black' ? '#000' : col
      ctx.fill(p, part.evenodd ? 'evenodd' : 'nonzero')
      if (part.outline) {
        ctx.strokeStyle = '#000'
        ctx.lineWidth = part.outline
        ctx.lineJoin = 'round'
        ctx.stroke(p)
      }
    }
  }
  ctx.restore()
}

/** Même symbole, en SVG (listes, menus). */
export function markSvg(symbol: number, color: number, size = 16): string {
  const sh = SHAPES[symbol] ?? SHAPES[0]!
  const col = COLORS[color] ?? COLORS[DEFAULT_COLOR]
  const inner = sh.parts
    .map((p) => {
      if (p.kind === 'stroke')
        return `<path d="${p.d}" fill="none" stroke="${col}" stroke-width="${p.sw ?? 8}" stroke-linecap="round" stroke-linejoin="round"/>`
      const fill = p.kind === 'black' ? '#000' : col
      const out = p.outline ? ` stroke="#000" stroke-width="${p.outline}" stroke-linejoin="round"` : ''
      return `<path d="${p.d}" fill="${fill}"${p.evenodd ? ' fill-rule="evenodd"' : ''}${out}/>`
    })
    .join('')
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 100 100"><g transform="translate(${sh.tx ?? 0} ${sh.ty ?? 0})">${inner}</g></svg>`
}

/** Texte de l'info-bulle : nom, commentaire et codes GPX (pour vérifier la prise en compte de GP39Symbol / FECColor). */
export function waypointTooltip(w: Pick<Waypoint, 'name' | 'comment' | 'symbol' | 'color'>): string {
  // le contenu vient d'un fichier GPX : on échappe le HTML
  const esc = (t: string): string => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  const name = esc(w.name || '(sans nom)')
  const sym = `GP39Symbol=${w.symbol} (${SYMBOL_NAMES_FR[w.symbol] ?? '?'})`
  const col = `FECColor=${w.color} (${COLOR_NAMES_FR[w.color] ?? '?'})`
  return `<b>${name}</b>${w.comment ? ` · ${esc(w.comment)}` : ''}<br>${sym}<br>${col}`
}
