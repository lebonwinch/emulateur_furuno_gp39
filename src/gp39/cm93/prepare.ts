// Cellule CM93 → objets prêts à dessiner (coordonnées « monde » 0..1, attributs décodés, couche de dessin), une fois par cellule
// ouverte : le dessin d'une tuile n'a plus qu'à filtrer par emprise.

import { decodeAttrs, type Attrs } from './attrs'
import { areaRings, cellFrame, lineParts, soundingDepth, type Cm93Cell } from './cell'
import type { Cm93Dict } from './dict'

/** Ordre de dessin, du dessous au dessus */
export const Layer = { Depth: 0, Land: 1, Area: 2, Line: 3, Sounding: 4, Symbol: 5, Label: 6 } as const

export type Box = [number, number, number, number]

export interface Item {
  kind: 'area' | 'line' | 'point' | 'sounds'
  layer: number
  /** nom de classe S-57 (6 lettres) */
  cls: string
  attrs: Attrs
  box: Box
  /** surface : anneaux (le premier est le contour, les autres des trous) ; ligne : tronçons. x, y, x, y… en coordonnées monde */
  parts?: Float64Array[]
  /** point : position ; sondes : x, y, profondeur (m) par sonde */
  x?: number
  y?: number
  sounds?: Float64Array
}

export interface PreparedCell {
  items: Item[]
  /** zones couvertes par la cellule (une par carte source) : anneaux en coordonnées monde */
  coverage: Float64Array[]
  box: Box
}

const AREA_CLASSES: Record<string, number> = {
  DEPARE: Layer.Depth,
  DRGARE: Layer.Depth,
  LAKARE: Layer.Depth,
  RIVERS: Layer.Depth,
  CANALS: Layer.Depth,
  DOCARE: Layer.Depth,
  HRBARE: Layer.Area,
  ITDARE: Layer.Land - 0.5,
  LNDARE: Layer.Land,
  BUAARE: Layer.Land + 0.1,
  BUISGL: Layer.Land + 0.2,
  BUIREL: Layer.Land + 0.2,
  SLCONS: Layer.Land + 0.3,
  PONTON: Layer.Land + 0.3,
  DRYDOC: Layer.Land + 0.3,
  LOKBSN: Layer.Land + 0.3,
  OBSTRN: Layer.Area,
  RESARE: Layer.Area,
  ACHARE: Layer.Area,
  CBLARE: Layer.Area,
  PIPARE: Layer.Area,
  MIPARE: Layer.Area,
  SPLARE: Layer.Area,
  FAIRWY: Layer.Area,
  TSSLPT: Layer.Area,
  TSSRON: Layer.Area,
  TSSCRS: Layer.Area,
  TSEZNE: Layer.Area,
  DWRTPT: Layer.Area,
  CTNARE: Layer.Area,
  PRCARE: Layer.Area,
  FSHZNE: Layer.Area,
  DMPGRD: Layer.Area,
  ICEARE: Layer.Area,
}

const LINE_CLASSES = new Set([
  'COALNE',
  'DEPCNT',
  'ZEMCNT',
  'SLCONS',
  'LAKSHR',
  'RIVBNK',
  'CANBNK',
  'NAVLNE',
  'RECTRC',
  'CBLSUB',
  'CBLOHD',
  'PIPSOL',
  'PIPOHD',
  'TSSBND',
  'TSELNE',
  'DWRTCL',
  'FERYRT',
  'RAILWY',
  'BRIDGE',
  'DYKCRW',
  'DAMCON',
  'FNCLNE',
  'CAUSWY',
  'OBSTRN',
  'RDOCAL',
  'RCRTCL',
])

const POINT_CLASSES = new Set([
  'BOYCAR',
  'BOYINB',
  'BOYISD',
  'BOYLAT',
  'BOYSAW',
  'BOYSPP',
  'LITFLT',
  'LITVES',
  'BCNCAR',
  'BCNISD',
  'BCNLAT',
  'BCNSAW',
  'BCNSPP',
  'LIGHTS',
  'WRECKS',
  'UWTROC',
  'OBSTRN',
  'TOWERS',
  'CHIMNY',
  'MONUMT',
  'ACHARE',
  '_texto',
])

/** surfaces dont on affiche le nom (attribut OBJNAM) au centre de leur emprise */
const NAMED_AREAS = new Set(['BUAARE', 'LNDARE', 'LNDRGN', 'SEAARE', 'LAKARE', 'HRBARE', 'ACHARE', 'RESARE'])

const emptyBox = (): Box => [Infinity, Infinity, -Infinity, -Infinity]
const grow = (b: Box, x: number, y: number): void => {
  if (x < b[0]) b[0] = x
  if (y < b[1]) b[1] = y
  if (x > b[2]) b[2] = x
  if (y > b[3]) b[3] = y
}

export function prepareCell(cell: Cm93Cell, dict: Cm93Dict): PreparedCell {
  const fr = cellFrame(cell.header)
  const wrap = fr.x0 >= 1 ? -1 : fr.x0 < 0 ? 1 : 0
  const wx = (ux: number): number => fr.x0 + wrap + ux * fr.kx
  const wy = (uy: number): number => fr.y0 - uy * fr.ky
  const world = (pts: ArrayLike<number>): Float64Array => {
    const out = new Float64Array(pts.length)
    for (let i = 0; i < pts.length; i += 2) {
      out[i] = wx(pts[i]!)
      out[i + 1] = wy(pts[i + 1]!)
    }
    return out
  }
  const items: Item[] = []
  const coverage: Float64Array[] = []
  const cbox = emptyBox()

  const boxOf = (parts: Float64Array[]): Box => {
    const b = emptyBox()
    for (const p of parts) for (let i = 0; i < p.length; i += 2) grow(b, p[i]!, p[i + 1]!)
    return b
  }

  for (const f of cell.features) {
    const cls = dict.classes[f.cls]?.name
    if (!cls) continue
    if (f.prim === 4) {
      const covr = cls === '_m_sor'
      const layer = AREA_CLASSES[cls]
      if (!covr && layer === undefined && !NAMED_AREAS.has(cls)) continue
      const rings = areaRings(cell, f).map((r) => world(r.pts))
      if (!rings.length) continue
      if (covr) {
        coverage.push(rings[0]!)
        for (let i = 0; i < rings[0]!.length; i += 2) grow(cbox, rings[0]![i]!, rings[0]![i + 1]!)
        continue
      }
      const attrs = decodeAttrs(f, dict)
      const box = boxOf(rings)
      if (layer !== undefined) items.push({ kind: 'area', layer, cls, attrs, box, parts: rings })
      if (NAMED_AREAS.has(cls) && typeof attrs.OBJNAM === 'string') {
        // le nom est dessiné au centre de l'emprise de la surface
        items.push({
          kind: 'point',
          layer: Layer.Label,
          cls: 'NAME:' + cls,
          attrs,
          box,
          x: (box[0] + box[2]) / 2,
          y: (box[1] + box[3]) / 2,
        })
      }
    } else if (f.prim === 2) {
      if (!LINE_CLASSES.has(cls)) continue
      const parts = lineParts(cell, f).map(world)
      if (!parts.length) continue
      items.push({ kind: 'line', layer: Layer.Line, cls, attrs: decodeAttrs(f, dict), box: boxOf(parts), parts })
    } else if (f.prim === 1) {
      if (!POINT_CLASSES.has(cls)) continue
      const x = wx(cell.points[2 * f.point]!)
      const y = wy(cell.points[2 * f.point + 1]!)
      items.push({
        kind: 'point',
        layer: cls === '_texto' ? Layer.Label : Layer.Symbol,
        cls,
        attrs: decodeAttrs(f, dict),
        box: [x, y, x, y],
        x,
        y,
      })
    } else if (f.prim === 8) {
      if (cls !== 'SOUNDG') continue
      const s = cell.soundings[f.point]!
      const out = new Float64Array(s.length)
      const b = emptyBox()
      for (let i = 0; i < s.length; i += 3) {
        out[i] = wx(s[i]!)
        out[i + 1] = wy(s[i + 1]!)
        out[i + 2] = soundingDepth(s[i + 2]!)
        grow(b, out[i]!, out[i + 1]!)
      }
      items.push({ kind: 'sounds', layer: Layer.Sounding, cls, attrs: {}, box: b, sounds: out })
    }
  }
  // une cellule sans zone de couverture déclarée est couverte en entier
  if (!coverage.length) {
    const x0 = wx(0)
    const x1 = wx(65535)
    const y0 = wy(0)
    const y1 = wy(65535)
    coverage.push(Float64Array.of(x0, y0, x1, y0, x1, y1, x0, y1, x0, y0))
    grow(cbox, x0, y0)
    grow(cbox, x1, y1)
  }
  items.sort((a, b) => a.layer - b.layer)
  return { items, coverage, box: cbox }
}
