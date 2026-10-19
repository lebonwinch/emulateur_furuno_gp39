// Dessin des objets CM93 dans une tuile (canevas 2D : OffscreenCanvas dans un Worker, ou un canevas ordinaire).
//
// Une présentation volontairement simplifiée de la carte électronique : teintes de profondeur, terre, côte, courbes de niveau,
// sondes, balisage (bouées, balises, feux avec secteurs), dangers, zones réglementées, noms. Les tailles des symboles sont en
// pixels d'écran (elles ne grossissent pas avec le zoom) ; `env.k` est le rapport de pixels de l'écran (2 sur écran Retina).

import type { Ctx } from '../canvas'
import { Layer, type Box, type Item } from './prepare'
import { PALETTE, depthColour, formatDepth, lightLabel, lightSectorColour, navColours } from './style'

export type { Ctx } from '../canvas'

export interface Env {
  z: number
  /** tuile (x, y) du niveau de zoom z */
  tx: number
  ty: number
  /** pixels de canevas par pixel CSS */
  k: number
  /** côté du canevas en pixels */
  size: number
  /** échelle CM93 des objets dessinés (0 = Z … 7 = G) */
  scale: number
}

/** Au-delà de cette distance (px), un sommet est ramené par découpage dans la tuile : les canevas perdent en précision. */
const FAR = 2e5

export const worldToPixel = (env: Env, wx: number, wy: number): [number, number] => {
  const n = 2 ** env.z
  return [(wx * n - env.tx) * env.size, (wy * n - env.ty) * env.size]
}

/** Emprise de la tuile en coordonnées monde, élargie d'une marge en pixels */
export function tileWorldBox(env: Env, marginPx: number): Box {
  const n = 2 ** env.z
  const m = marginPx / env.size
  return [(env.tx - m) / n, (env.ty - m) / n, (env.tx + 1 + m) / n, (env.ty + 1 + m) / n]
}

export const boxesTouch = (a: Box, b: Box): boolean => a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1]

// --- tracés ------------------------------------------------------------------------------------------------------------

/** Sutherland-Hodgman : anneau découpé par un rectangle (sert pour les anneaux dont les sommets sont très loin de la tuile). */
function clipRing(pts: number[], lo: number, hi: number): number[] {
  let cur = pts
  for (let edge = 0; edge < 4; edge++) {
    const out: number[] = []
    const inside = (x: number, y: number): boolean => (edge === 0 ? x >= lo : edge === 1 ? x <= hi : edge === 2 ? y >= lo : y <= hi)
    const cross = (x0: number, y0: number, x1: number, y1: number): [number, number] => {
      const bound = edge < 2 ? (edge === 0 ? lo : hi) : edge === 2 ? lo : hi
      if (edge < 2) {
        const t = (bound - x0) / (x1 - x0)
        return [bound, y0 + t * (y1 - y0)]
      }
      const t = (bound - y0) / (y1 - y0)
      return [x0 + t * (x1 - x0), bound]
    }
    for (let i = 0; i < cur.length; i += 2) {
      const j = (i + 2) % cur.length
      const x0 = cur[i]!
      const y0 = cur[i + 1]!
      const x1 = cur[j]!
      const y1 = cur[j + 1]!
      const in0 = inside(x0, y0)
      const in1 = inside(x1, y1)
      if (in0) out.push(x0, y0)
      if (in0 !== in1) out.push(...cross(x0, y0, x1, y1))
    }
    cur = out
    if (!cur.length) break
  }
  return cur
}

/** Segment découpé par un rectangle (Liang-Barsky) ; null s'il est entièrement dehors. */
function clipSegment(x0: number, y0: number, x1: number, y1: number, lo: number, hi: number): [number, number, number, number] | null {
  let t0 = 0
  let t1 = 1
  const dx = x1 - x0
  const dy = y1 - y0
  const p = [-dx, dx, -dy, dy]
  const q = [x0 - lo, hi - x0, y0 - lo, hi - y0]
  for (let i = 0; i < 4; i++) {
    if (p[i] === 0) {
      if (q[i]! < 0) return null
    } else {
      const t = q[i]! / p[i]!
      if (p[i]! < 0) {
        if (t > t1) return null
        if (t > t0) t0 = t
      } else {
        if (t < t0) return null
        if (t < t1) t1 = t
      }
    }
  }
  return [x0 + t0 * dx, y0 + t0 * dy, x0 + t1 * dx, y0 + t1 * dy]
}

/** Ajoute un anneau fermé au tracé courant ; renvoie faux s'il ne touche pas la tuile. */
export function addRing(ctx: Ctx, env: Env, ring: Float64Array): boolean {
  const n = 2 ** env.z
  const s = env.size
  const raw: number[] = []
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  let lastX = NaN
  let lastY = NaN
  const last = ring.length - 2
  for (let i = 0; i <= last; i += 2) {
    const x = (ring[i]! * n - env.tx) * s
    const y = (ring[i + 1]! * n - env.ty) * s
    // sommets quasi confondus : inutile de les tracer (surtout aux petits zooms, où un anneau compte des milliers de points)
    if (i !== 0 && i !== last && Math.abs(x - lastX) + Math.abs(y - lastY) < 0.6) continue
    lastX = x
    lastY = y
    raw.push(x, y)
    if (x < minX) minX = x
    if (x > maxX) maxX = x
    if (y < minY) minY = y
    if (y > maxY) maxY = y
  }
  if (raw.length < 6 || maxX < 0 || maxY < 0 || minX > s || minY > s) return false
  const pts = minX < -FAR || minY < -FAR || maxX > FAR || maxY > FAR ? clipRing(raw, -s, 2 * s) : raw
  if (pts.length < 6) return false
  ctx.moveTo(pts[0]!, pts[1]!)
  for (let i = 2; i < pts.length; i += 2) ctx.lineTo(pts[i]!, pts[i + 1]!)
  ctx.closePath()
  return true
}

function addLine(ctx: Ctx, env: Env, line: Float64Array): void {
  const n = 2 ** env.z
  const s = env.size
  let px = NaN
  let py = NaN
  let pen = false
  for (let i = 0; i < line.length; i += 2) {
    const x = (line[i]! * n - env.tx) * s
    const y = (line[i + 1]! * n - env.ty) * s
    if (i > 0) {
      const far = Math.abs(x) > FAR || Math.abs(y) > FAR || Math.abs(px) > FAR || Math.abs(py) > FAR
      if (far) {
        const c = clipSegment(px, py, x, y, -s, 2 * s)
        if (c) {
          ctx.moveTo(c[0], c[1])
          ctx.lineTo(c[2], c[3])
        }
        pen = false
      } else {
        if (!pen) ctx.moveTo(px, py)
        ctx.lineTo(x, y)
        pen = true
      }
    }
    px = x
    py = y
  }
}

// --- surfaces et lignes ------------------------------------------------------------------------------------------------

const RESTRICTED = new Set([
  'RESARE',
  'ACHARE',
  'CBLARE',
  'PIPARE',
  'MIPARE',
  'SPLARE',
  'FAIRWY',
  'TSSLPT',
  'TSSRON',
  'TSSCRS',
  'TSEZNE',
  'DWRTPT',
  'CTNARE',
  'PRCARE',
  'FSHZNE',
  'DMPGRD',
  'ICEARE',
  'HRBARE',
])
const WATER = new Set(['DEPARE', 'DRGARE', 'LAKARE', 'RIVERS', 'CANALS', 'DOCARE'])

const num = (v: unknown): number | undefined => (typeof v === 'number' ? v : undefined)

function drawArea(ctx: Ctx, env: Env, it: Item): void {
  const k = env.k
  let fill: string | undefined
  let stroke: string | undefined
  let width = 1
  let dash: number[] = []
  const a = it.attrs
  if (WATER.has(it.cls)) fill = it.cls === 'DEPARE' || it.cls === 'DRGARE' ? depthColour(num(a.DRVAL1), false) : PALETTE.lake
  else if (it.cls === 'ITDARE') fill = PALETTE.intertidal
  else if (it.cls === 'LNDARE') fill = PALETTE.land
  else if (it.cls === 'BUAARE') fill = PALETTE.built
  else if (it.cls === 'BUISGL' || it.cls === 'BUIREL') {
    fill = PALETTE.building
    stroke = PALETTE.landEdge
    width = 0.8
  } else if (it.cls === 'SLCONS' || it.cls === 'PONTON' || it.cls === 'DRYDOC' || it.cls === 'LOKBSN') {
    fill = '#b9b9ae'
    stroke = PALETTE.landEdge
  } else if (it.cls === 'OBSTRN') {
    fill = 'rgba(120,120,120,0.22)'
    stroke = '#555555'
    dash = [1.5, 2.5]
  } else if (RESTRICTED.has(it.cls)) {
    if (env.scale < 3) return // aux petites échelles ces zones ne font que charger la carte
    stroke = PALETTE.special
    dash = [6, 4]
  } else return
  ctx.beginPath()
  let any = false
  for (const ring of it.parts!) any = addRing(ctx, env, ring) || any
  if (!any) return
  if (fill) {
    ctx.fillStyle = fill
    ctx.fill('evenodd')
  }
  if (stroke) {
    ctx.strokeStyle = stroke
    ctx.lineWidth = width * k
    ctx.setLineDash(dash.map((d) => d * k))
    ctx.stroke()
    ctx.setLineDash([])
  }
}

function drawLine(ctx: Ctx, env: Env, it: Item): void {
  const k = env.k
  let color: string = PALETTE.coast
  let width = 1
  let dash: number[] = []
  switch (it.cls) {
    case 'COALNE':
    case 'SLCONS':
      width = 1.3
      break
    case 'DEPCNT': {
      const v = num(it.attrs.VALDCO)
      color = v === 30 ? '#4a6a80' : PALETTE.contour
      width = v === 30 ? 1.4 : 0.8
      break
    }
    case 'ZEMCNT':
      color = PALETTE.contour
      width = 0.8
      break
    case 'LAKSHR':
    case 'RIVBNK':
    case 'CANBNK':
    case 'DYKCRW':
    case 'DAMCON':
    case 'FNCLNE':
    case 'CAUSWY':
      width = 0.9
      break
    case 'NAVLNE':
    case 'RECTRC':
    case 'DWRTCL':
    case 'TSELNE':
    case 'TSSBND':
    case 'RDOCAL':
    case 'RCRTCL':
      if (env.scale < 3) return
      color = PALETTE.special
      dash = [8, 4]
      break
    case 'CBLSUB':
    case 'CBLOHD':
    case 'PIPSOL':
    case 'PIPOHD':
      if (env.scale < 4) return
      color = PALETTE.special
      dash = [2, 3]
      break
    case 'FERYRT':
      if (env.scale < 4) return
      color = PALETTE.special
      dash = [10, 4]
      break
    case 'RAILWY':
      if (env.scale < 4) return
      color = '#6b6b6b'
      dash = [4, 3]
      break
    case 'BRIDGE':
      color = '#444444'
      width = 2.2
      break
    case 'OBSTRN':
      color = '#555555'
      dash = [1.5, 2.5]
      break
    default:
      return
  }
  ctx.beginPath()
  for (const part of it.parts!) addLine(ctx, env, part)
  ctx.strokeStyle = color
  ctx.lineWidth = width * k
  ctx.setLineDash(dash.map((d) => d * k))
  ctx.stroke()
  ctx.setLineDash([])
}

// --- textes ------------------------------------------------------------------------------------------------------------

function text(
  ctx: Ctx,
  env: Env,
  s: string,
  x: number,
  y: number,
  o: { color?: string; size?: number; align?: CanvasTextAlign; italic?: boolean; bold?: boolean } = {},
): void {
  ctx.font = `${o.italic ? 'italic ' : ''}${o.bold ? 'bold ' : ''}${(o.size ?? 11) * env.k}px sans-serif`
  ctx.textAlign = o.align ?? 'center'
  ctx.textBaseline = 'middle'
  ctx.lineJoin = 'round'
  ctx.lineWidth = 3 * env.k
  ctx.strokeStyle = PALETTE.halo
  ctx.strokeText(s, x, y)
  ctx.fillStyle = o.color ?? PALETTE.text
  ctx.fillText(s, x, y)
}

/** Grille de dépouillement des étiquettes : une seule par case, la même d'une tuile à l'autre (les cases tombent sur la grille 256). */
class Grid {
  private readonly used = new Set<number>()
  constructor(
    private readonly env: Env,
    private readonly cell: number,
  ) {}
  take(x: number, y: number): boolean {
    const n = 2 ** this.env.z
    const gx = Math.floor((x * n * this.env.size) / (this.cell * this.env.k))
    const gy = Math.floor((y * n * this.env.size) / (this.cell * this.env.k))
    const key = gx * 4_194_304 + gy
    if (this.used.has(key)) return false
    this.used.add(key)
    return true
  }
}

// --- symboles ----------------------------------------------------------------------------------------------------------

function bands(ctx: Ctx, colours: string[], x: number, y: number, w: number, h: number, vertical: boolean): void {
  const n = Math.max(1, colours.length)
  for (let i = 0; i < n; i++) {
    ctx.fillStyle = colours[i] ?? '#9a9a9a'
    if (vertical) ctx.fillRect(x + (w * i) / n, y, w / n + 0.5, h)
    else ctx.fillRect(x, y + (h * i) / n, w, h / n + 0.5)
  }
}

function drawBuoy(ctx: Ctx, env: Env, it: Item, px: number, py: number): void {
  const k = env.k
  const a = it.attrs
  const cols = navColours(it.cls, a)
  const shape = num(a.BOYSHP) ?? (it.cls === 'BOYLAT' ? (num(a.CATLAM) === 2 ? 1 : 2) : 4)
  const w = 7 * k
  const h = 9 * k
  ctx.save()
  ctx.translate(px, py)
  ctx.lineWidth = 1 * k
  ctx.strokeStyle = '#222222'
  ctx.beginPath()
  const body = (): void => {
    ctx.save()
    ctx.clip()
    bands(ctx, cols.length ? cols : ['#9a9a9a'], -w / 2, -h - 2 * k, w, h, num(a.COLPAT) === 2)
    ctx.restore()
    ctx.stroke()
  }
  if (shape === 1) {
    // conique : triangle pointe en haut
    ctx.moveTo(0, -h - 2 * k)
    ctx.lineTo(w / 2, -2 * k)
    ctx.lineTo(-w / 2, -2 * k)
    ctx.closePath()
    body()
  } else if (shape === 3 || shape === 7) {
    ctx.arc(0, -w / 2 - 2 * k, w / 2, 0, Math.PI * 2)
    body()
  } else if (shape === 5) {
    ctx.rect(-1 * k, -h - 4 * k, 2 * k, h + 2 * k)
    body()
  } else {
    // cylindrique, espar, tonneau, pilier : rectangle (le pilier est plus fin et plus haut)
    const ww = shape === 4 ? w * 0.7 : w
    ctx.rect(-ww / 2, -h - 2 * k, ww, h)
    body()
  }
  // marque de tête des cardinales : deux cônes noirs selon le quadrant (1 N, 2 E, 3 S, 4 O)
  const cat = it.cls === 'BOYCAR' ? num(a.CATCAM) : undefined
  if (cat) {
    ctx.fillStyle = '#111111'
    const top = -h - 4 * k
    const cone = (cy: number, up: boolean): void => {
      ctx.beginPath()
      ctx.moveTo(-2.5 * k, up ? cy + 2.5 * k : cy)
      ctx.lineTo(2.5 * k, up ? cy + 2.5 * k : cy)
      ctx.lineTo(0, up ? cy : cy + 2.5 * k)
      ctx.closePath()
      ctx.fill()
    }
    const up1 = cat === 1 || cat === 2
    const up2 = cat === 1 || cat === 4
    cone(top - 5 * k, up1)
    cone(top - 0.5 * k, up2)
  }
  // position exacte
  ctx.fillStyle = '#111111'
  ctx.beginPath()
  ctx.arc(0, 0, 1.2 * k, 0, Math.PI * 2)
  ctx.fill()
  ctx.restore()
}

function drawBeacon(ctx: Ctx, env: Env, it: Item, px: number, py: number): void {
  const k = env.k
  const cols = navColours(it.cls, it.attrs)
  ctx.save()
  ctx.translate(px, py)
  ctx.lineWidth = 1 * k
  ctx.strokeStyle = '#222222'
  ctx.beginPath()
  ctx.moveTo(0, -1 * k)
  ctx.lineTo(3.5 * k, -9 * k)
  ctx.lineTo(-3.5 * k, -9 * k)
  ctx.closePath()
  ctx.save()
  ctx.clip()
  bands(ctx, cols.length ? cols : ['#9a9a9a'], -4 * k, -9 * k, 8 * k, 8 * k, false)
  ctx.restore()
  ctx.stroke()
  ctx.fillStyle = '#111111'
  ctx.beginPath()
  ctx.arc(0, 0, 1.2 * k, 0, Math.PI * 2)
  ctx.fill()
  ctx.restore()
}

function drawLight(ctx: Ctx, env: Env, it: Item, px: number, py: number): void {
  const k = env.k
  const a = it.attrs
  const s1 = num(a.SECTR1)
  const s2 = num(a.SECTR2)
  ctx.save()
  ctx.translate(px, py)
  const col = lightSectorColour(a)
  // les arcs de secteur n'ont de sens qu'à grande échelle ; plus petit, un simple fanion
  if (env.z >= 12 && s1 !== undefined && s2 !== undefined && s1 !== s2) {
    // secteur coloré : relèvements « de la mer vers le feu », l'arc se dessine donc du côté opposé
    const rad = (b: number): number => ((b + 180 - 90) * Math.PI) / 180
    let a1 = rad(s1)
    let a2 = rad(s2)
    if (a2 <= a1) a2 += Math.PI * 2
    const r = 24 * k
    ctx.lineCap = 'butt'
    ctx.lineWidth = 4.5 * k
    ctx.strokeStyle = '#222222'
    ctx.beginPath()
    ctx.arc(0, 0, r, a1, a2)
    ctx.stroke()
    ctx.lineWidth = 3 * k
    ctx.strokeStyle = col
    ctx.beginPath()
    ctx.arc(0, 0, r, a1, a2)
    ctx.stroke()
    ctx.lineWidth = 0.7 * k
    ctx.strokeStyle = PALETTE.special
    ctx.setLineDash([3 * k, 3 * k])
    ctx.beginPath()
    for (const ang of [a1, a2]) {
      ctx.moveTo(0, 0)
      ctx.lineTo(Math.cos(ang) * r, Math.sin(ang) * r)
    }
    ctx.stroke()
    ctx.setLineDash([])
  } else {
    // feu sans secteur : fanion magenta orienté vers le haut à droite
    ctx.fillStyle = col
    ctx.strokeStyle = PALETTE.special
    ctx.lineWidth = 1.2 * k
    ctx.beginPath()
    ctx.moveTo(0, 0)
    ctx.arc(0, 0, 13 * k, (-80 * Math.PI) / 180, (-10 * Math.PI) / 180)
    ctx.closePath()
    ctx.fill()
    ctx.stroke()
  }
  ctx.fillStyle = '#111111'
  ctx.beginPath()
  ctx.arc(0, 0, 1.4 * k, 0, Math.PI * 2)
  ctx.fill()
  ctx.restore()
}

function drawDanger(ctx: Ctx, env: Env, it: Item, px: number, py: number): void {
  const k = env.k
  ctx.save()
  ctx.translate(px, py)
  ctx.strokeStyle = '#111111'
  ctx.lineWidth = 1.3 * k
  ctx.beginPath()
  if (it.cls === 'WRECKS') {
    // épave : coque et mâts
    ctx.moveTo(-5 * k, 0)
    ctx.quadraticCurveTo(0, 4 * k, 5 * k, 0)
    ctx.moveTo(-2 * k, 0)
    ctx.lineTo(-2 * k, -6 * k)
    ctx.moveTo(2 * k, 0)
    ctx.lineTo(2 * k, -5 * k)
    ctx.moveTo(-2 * k, -4 * k)
    ctx.lineTo(2 * k, -4 * k)
  } else if (it.cls === 'UWTROC') {
    // roche : croix (découvrante : astérisque)
    ctx.moveTo(-3.5 * k, 0)
    ctx.lineTo(3.5 * k, 0)
    ctx.moveTo(0, -3.5 * k)
    ctx.lineTo(0, 3.5 * k)
    if (num(it.attrs.WATLEV) === 4 || num(it.attrs.WATLEV) === 5) {
      ctx.moveTo(-2.5 * k, -2.5 * k)
      ctx.lineTo(2.5 * k, 2.5 * k)
      ctx.moveTo(2.5 * k, -2.5 * k)
      ctx.lineTo(-2.5 * k, 2.5 * k)
    }
  } else {
    // obstruction
    ctx.moveTo(-3 * k, -3 * k)
    ctx.lineTo(3 * k, 3 * k)
    ctx.moveTo(3 * k, -3 * k)
    ctx.lineTo(-3 * k, 3 * k)
  }
  ctx.stroke()
  ctx.restore()
}

function drawLandmark(ctx: Ctx, env: Env, px: number, py: number): void {
  const k = env.k
  ctx.save()
  ctx.translate(px, py)
  ctx.fillStyle = '#6b6350'
  ctx.strokeStyle = '#222222'
  ctx.lineWidth = 0.9 * k
  ctx.beginPath()
  ctx.rect(-1.8 * k, -7 * k, 3.6 * k, 7 * k)
  ctx.fill()
  ctx.stroke()
  ctx.restore()
}

function drawAnchor(ctx: Ctx, env: Env, px: number, py: number): void {
  const k = env.k
  ctx.save()
  ctx.translate(px, py)
  ctx.strokeStyle = PALETTE.special
  ctx.lineWidth = 1.3 * k
  ctx.beginPath()
  ctx.arc(0, -6 * k, 1.4 * k, 0, Math.PI * 2)
  ctx.moveTo(0, -4.6 * k)
  ctx.lineTo(0, 4 * k)
  ctx.moveTo(-2.5 * k, -2 * k)
  ctx.lineTo(2.5 * k, -2 * k)
  ctx.moveTo(-4 * k, 1 * k)
  ctx.quadraticCurveTo(-3 * k, 5 * k, 0, 4.5 * k)
  ctx.quadraticCurveTo(3 * k, 5 * k, 4 * k, 1 * k)
  ctx.stroke()
  ctx.restore()
}

// --- tuile -------------------------------------------------------------------------------------------------------------

/** Dessine les objets d'une échelle dans la tuile (les couches de bas en haut). */
export function drawItems(ctx: Ctx, env: Env, items: readonly Item[]): void {
  const symbolBox = tileWorldBox(env, 70 * env.k)
  const textBox = tileWorldBox(env, 220 * env.k)
  const nameGrid = new Grid(env, env.scale >= 5 ? 1 : 110)
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  const tileBox = tileWorldBox(env, 0)

  // surfaces et lignes
  for (const it of items) {
    if (it.layer === Layer.Sounding) break
    if (it.kind === 'area') {
      if (boxesTouch(it.box, tileBox)) drawArea(ctx, env, it)
    } else if (it.kind === 'line') {
      if (boxesTouch(it.box, tileBox)) drawLine(ctx, env, it)
    }
  }

  // sondes : la plus petite profondeur de chaque case de la grille
  if (env.scale >= 3) {
    const best = new Map<number, { d: number; x: number; y: number }>()
    const n = 2 ** env.z
    const cell = 30 * env.k
    for (const it of items) {
      if (it.kind !== 'sounds' || !boxesTouch(it.box, symbolBox)) continue
      const s = it.sounds!
      for (let i = 0; i < s.length; i += 3) {
        const x = s[i]!
        const y = s[i + 1]!
        if (x < symbolBox[0] || x > symbolBox[2] || y < symbolBox[1] || y > symbolBox[3]) continue
        const key = Math.floor((x * n * env.size) / cell) * 4_194_304 + Math.floor((y * n * env.size) / cell)
        const cur = best.get(key)
        if (!cur || s[i + 2]! < cur.d) best.set(key, { d: s[i + 2]!, x, y })
      }
    }
    for (const b of best.values()) {
      const [px, py] = worldToPixel(env, b.x, b.y)
      text(ctx, env, formatDepth(b.d), px, py, { size: 10, color: b.d > 30 ? PALETTE.soundingDeep : PALETTE.sounding })
    }
  }

  // symboles
  for (const it of items) {
    if (it.layer !== Layer.Symbol || !boxesTouch(it.box, symbolBox)) continue
    const [px, py] = worldToPixel(env, it.x!, it.y!)
    const c = it.cls
    if (c.startsWith('BOY') || c === 'LITFLT' || c === 'LITVES') drawBuoy(ctx, env, it, px, py)
    else if (c.startsWith('BCN')) drawBeacon(ctx, env, it, px, py)
    else if (c === 'LIGHTS') {
      if (env.z >= 10) drawLight(ctx, env, it, px, py)
    } else if (c === 'WRECKS' || c === 'UWTROC' || c === 'OBSTRN') drawDanger(ctx, env, it, px, py)
    else if (c === 'ACHARE') {
      if (env.scale >= 4) drawAnchor(ctx, env, px, py)
    } else if (c === 'TOWERS' || c === 'CHIMNY' || c === 'MONUMT') {
      if (env.scale >= 4) drawLandmark(ctx, env, px, py)
    }
  }

  // textes : noms de lieux, de balises, caractères des feux
  const detail = env.z >= 13
  for (const it of items) {
    if (!boxesTouch(it.box, textBox) || it.kind !== 'point') continue
    const c = it.cls
    const [px, py] = worldToPixel(env, it.x!, it.y!)
    if (it.layer === Layer.Label) {
      const name = c === '_texto' ? it.attrs._texta : c.startsWith('NAME:') ? it.attrs.OBJNAM : undefined
      if (typeof name !== 'string' || !name) continue
      if (c.startsWith('NAME:') && env.scale < 3) continue
      if (!nameGrid.take(it.x!, it.y!)) continue
      text(ctx, env, name, px, py, { size: c === 'NAME:BUAARE' || c === 'NAME:SEAARE' ? 12 : 11, italic: true })
    } else if (it.layer === Layer.Symbol && detail) {
      if (c === 'LIGHTS') {
        const label = lightLabel(it.attrs)
        if (label) text(ctx, env, label, px + 8 * env.k, py - 14 * env.k, { size: 10, color: PALETTE.special, align: 'left' })
      } else if ((c.startsWith('BOY') || c.startsWith('BCN') || c === 'WRECKS') && env.z >= 14) {
        const name = it.attrs.OBJNAM
        const depth = c === 'WRECKS' ? num(it.attrs.VALSOU) : undefined
        const label = typeof name === 'string' ? name : depth !== undefined ? formatDepth(depth) : ''
        if (label) text(ctx, env, label, px + 8 * env.k, py - 2 * env.k, { size: 10, align: 'left' })
      }
    }
  }
}
