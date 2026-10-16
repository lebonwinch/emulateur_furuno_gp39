// Cartes BSB → tuiles Web Mercator 256 × 256 : choix des cartes selon le zoom (comme OpenCPN) et rendu d'une tuile.
//
// Principe : une tuile est fabriquée à la demande en ne lisant dans chaque fichier que les lignes de raster dont elle a besoin
// (table d'index + une ou quelques plages d'octets). Rien n'est gardé en mémoire au-delà de la table d'index de chaque carte
// utilisée (4 octets par ligne, ~40 Ko) : le gros des Go de cartes reste sur le disque.

import { buildGeoModel, type GeoModel } from './georef'
import { decodeRow, readRowIndex, type ByteSource, type KapHeader } from './kap'

export const TILE = 256
const RAD = Math.PI / 180

/** Ce que l'on retient de chaque carte au scan du dossier : sérialisable (cache, envoi à un Worker). */
export interface ChartInfo {
  /** identifiant stable : chemin du fichier dans le dossier */
  id: string
  size: number
  header: KapHeader
  /** emprise WGS84 de la zone utile : [sud, ouest, nord, est] */
  bbox: [number, number, number, number]
  /** résolution au sol des pixels de la carte (m/px) */
  metersPerPixel: number
  /** erreur du calage aux points REF (px) : plusieurs pixels = carte mal calée */
  rmsPx: number
}

/** Analyse une carte : null si elle n'est pas géoréférençable. */
export function makeChartInfo(id: string, size: number, header: KapHeader): ChartInfo | null {
  const model = buildGeoModel(header)
  if (!model) return null
  return { id, size, header, bbox: model.bbox, metersPerPixel: model.metersPerPixel, rmsPx: model.rmsPx }
}

export interface TileBox {
  south: number
  west: number
  north: number
  east: number
}

export function tileBox(z: number, x: number, y: number): TileBox {
  const n = 2 ** z
  const lat = (ty: number): number => Math.atan(Math.sinh(Math.PI * (1 - (2 * ty) / n))) / RAD
  return { west: (x / n) * 360 - 180, east: ((x + 1) / n) * 360 - 180, north: lat(y), south: lat(y + 1) }
}

/** Mètres au sol couverts par un pixel de tuile 256 à ce zoom et à cette latitude. */
export function metersPerTilePixel(z: number, latDeg: number): number {
  return (40075016.68557849 / (TILE * 2 ** z)) * Math.cos(latDeg * RAD)
}

const intersects = (b: [number, number, number, number], t: TileBox): boolean =>
  b[0] <= t.north && b[2] >= t.south && b[1] <= t.east && b[3] >= t.west

/** Au-delà de ce facteur (pixels de la carte ramenés à un pixel d'écran), le texte de la carte devient illisible. */
const K_COMFORT = 2
/** Une carte plus détaillée que cela n'est plus utilisée qu'en dernier recours (lignes sautées : coût borné). */
const K_LIMIT = 4
/** Nombre maximal de cartes superposées pour une tuile (la tuile s'arrête dès qu'elle est entièrement couverte). */
export const MAX_CHARTS_PER_TILE = 8

/**
 * Cartes à dessiner pour une tuile, de la plus prioritaire à la moins prioritaire.
 * `k` = mètres par pixel de tuile / mètres par pixel de la carte : 1 = pixels de la carte affichés tels quels, 2 = un pixel sur
 * deux (ou plus), 0,5 = carte agrandie deux fois. Ordre, comme le fait OpenCPN (carte la plus détaillée encore lisible d'abord,
 * les moins détaillées complétant ce qu'elle ne couvre pas) :
 *  1. cartes lisibles (0,5 ≤ k ≤ 2), la plus détaillée d'abord ;
 *  2. cartes un peu trop détaillées (2 < k ≤ 4), la moins détaillée d'abord ;
 *  3. cartes agrandies (k < 0,5), la plus détaillée d'abord ;
 *  4. dernier recours : cartes trop détaillées (k > 4), la moins détaillée d'abord.
 */
export function selectCharts(charts: readonly ChartInfo[], z: number, box: TileBox): ChartInfo[] {
  const lat = (box.north + box.south) / 2
  const mpp = metersPerTilePixel(z, lat)
  const scored = charts.filter((c) => intersects(c.bbox, box)).map((c) => ({ c, k: mpp / c.metersPerPixel }))
  const tier = (k: number): number => (k >= 0.5 && k <= K_COMFORT ? 0 : k > K_COMFORT && k <= K_LIMIT ? 1 : k < 0.5 ? 2 : 3)
  scored.sort((a, b) => {
    const ta = tier(a.k)
    const tb = tier(b.k)
    if (ta !== tb) return ta - tb
    // tiers 0 et 2 : k décroissant (le plus détaillé d'abord) ; tiers 1 et 3 : k croissant
    return ta === 0 || ta === 2 ? b.k - a.k : a.k - b.k
  })
  return scored.slice(0, MAX_CHARTS_PER_TILE).map((s) => s.c)
}

/** Une carte prête à dessiner : son modèle de calage et sa table de lignes (lue au premier usage). */
export interface OpenChart {
  info: ChartInfo
  model: GeoModel
  src: ByteSource
  rowIndex(): Promise<Uint32Array>
}

export function openChart(info: ChartInfo, src: ByteSource): OpenChart | null {
  const model = buildGeoModel(info.header)
  if (!model) return null
  let index: Promise<Uint32Array> | null = null
  return {
    info,
    model,
    src,
    // une seule lecture, même si plusieurs tuiles la demandent en même temps ; réessayée si elle a échoué
    rowIndex: () =>
      (index ??= readRowIndex(src, info.header).catch((e: unknown) => {
        index = null
        throw e
      })),
  }
}

/** Point dans le polygone (liste x0,y0,x1,y1,… ; règle pair-impair). */
function inPolygon(poly: Float64Array, px: number, py: number): boolean {
  let inside = false
  const n = poly.length / 2
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = poly[i * 2]!
    const yi = poly[i * 2 + 1]!
    const xj = poly[j * 2]!
    const yj = poly[j * 2 + 1]!
    if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

/** Plage d'octets maximale lue d'un coup : au-delà, on enchaîne plusieurs lectures. */
const READ_CHUNK = 4 * 1024 * 1024

/**
 * Dessine une carte dans la tuile, uniquement là où `filled` n'est pas encore rempli (les cartes de moindre priorité ne
 * font que compléter). Renvoie le nombre de pixels de tuile nouvellement remplis.
 */
async function paintChart(chart: OpenChart, z: number, x: number, y: number, out: Uint32Array, filled: Uint8Array): Promise<number> {
  const { model } = chart
  const h = chart.info.header
  const n = TILE * 2 ** z

  // coordonnées « plan » de la carte pour chaque colonne et chaque ligne de la tuile (centre des pixels)
  const us = new Float64Array(TILE)
  const vs = new Float64Array(TILE)
  for (let i = 0; i < TILE; i++) us[i] = model.planeU(((x * TILE + i + 0.5) / n) * 360 - 180)
  for (let j = 0; j < TILE; j++) {
    const lat = Math.atan(Math.sinh(Math.PI * (1 - (2 * (y * TILE + j + 0.5)) / n))) / RAD
    vs[j] = model.planeV(lat)
  }

  // pixel de la carte pour chaque pixel de tuile non encore rempli et dans la zone utile
  const px = new Int32Array(TILE * TILE).fill(-1)
  const py = new Int32Array(TILE * TILE)
  const rowsNeeded = new Uint8Array(h.height)
  const tmp = { x: 0, y: 0 }
  const poly = model.polygonPx
  let minX = h.width
  let maxX = -1
  let minY = h.height
  let maxY = -1
  for (let j = 0; j < TILE; j++) {
    for (let i = 0; i < TILE; i++) {
      const p = j * TILE + i
      if (filled[p]) continue
      model.planeToPixel(us[i]!, vs[j]!, tmp)
      const cx = Math.round(tmp.x)
      const cy = Math.round(tmp.y)
      if (cx < 0 || cy < 0 || cx >= h.width || cy >= h.height) continue
      if (!inPolygon(poly, tmp.x, tmp.y)) continue
      px[p] = cx
      py[p] = cy
      rowsNeeded[cy] = 1
      if (cx < minX) minX = cx
      if (cx > maxX) maxX = cx
      if (cy < minY) minY = cy
      if (cy > maxY) maxY = cy
    }
  }
  if (maxX < 0) return 0

  // lecture et décodage des seules lignes utiles, dans une fenêtre [minX, maxX] (indices de palette)
  const index = await chart.rowIndex()
  const winW = maxX - minX + 1
  const rowSlot = new Int32Array(maxY - minY + 1).fill(-1)
  let nRows = 0
  for (let r = minY; r <= maxY; r++) if (rowsNeeded[r]) rowSlot[r - minY] = nRows++
  const pix = new Uint8Array(nRows * winW)
  const rowBuf = new Uint8Array(h.width)
  const xLimit = maxX + 1
  let r = minY
  while (r <= maxY) {
    if (!rowsNeeded[r]) {
      r++
      continue
    }
    // regroupe les lignes utiles consécutives dans une plage d'octets d'au plus READ_CHUNK
    const first = r
    let last = r
    const start = index[first]!
    while (last + 1 <= maxY && index[last + 2]! - start <= READ_CHUNK) {
      last++
    }
    // dernière ligne à décoder dans cette plage : la dernière ligne utile avant `last`
    let lastUsed = first
    for (let q = first; q <= last; q++) if (rowsNeeded[q]) lastUsed = q
    const end = index[lastUsed + 1]!
    const bytes = await chart.src.read(start, end)
    for (let q = first; q <= lastUsed; q++) {
      if (!rowsNeeded[q]) continue
      rowBuf.fill(0, 0, xLimit)
      decodeRow(bytes, index[q]! - start, h.depth, h.width, xLimit, rowBuf)
      pix.set(rowBuf.subarray(minX, xLimit), rowSlot[q - minY]! * winW)
    }
    r = lastUsed + 1
  }

  const pal = h.palette
  let painted = 0
  for (let p = 0; p < TILE * TILE; p++) {
    const cx = px[p]!
    if (cx < 0) continue
    const idx = pix[rowSlot[py[p]! - minY]! * winW + (cx - minX)]!
    const colour = idx < pal.length ? pal[idx]! : 0
    if (colour === 0) continue
    out[p] = colour
    filled[p] = 1
    painted++
  }
  return painted
}

/**
 * Fabrique une tuile : dessine les cartes dans l'ordre reçu (voir `selectCharts`), chacune ne complétant que ce qui reste
 * transparent, et s'arrête dès que la tuile est entièrement couverte. `out` reçoit 256 × 256 pixels RGBA (transparents là où
 * aucune carte ne couvre). Renvoie les identifiants des cartes qui ont réellement dessiné.
 */
export async function renderTile(z: number, x: number, y: number, charts: readonly OpenChart[], out: Uint32Array): Promise<string[]> {
  out.fill(0)
  const filled = new Uint8Array(TILE * TILE)
  let remaining = TILE * TILE
  const used: string[] = []
  for (const chart of charts) {
    if (!remaining) break
    const done = await paintChart(chart, z, x, y, out, filled)
    if (done) {
      used.push(chart.info.id)
      remaining -= done
    }
  }
  return used
}
