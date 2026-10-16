// Choix des cellules CM93 pour une tuile : l'échelle voulue d'après le zoom, puis les échelles plus petites en complément (là où
// l'échelle voulue n'a pas de cartes), comme le fait OpenCPN.

import { SCALES, cellKeyId, cellsForBox, scaleForView } from './scales'

const RAD = Math.PI / 180
const TILE_PX = 256

export function tileGeoBox(z: number, x: number, y: number): { south: number; west: number; north: number; east: number } {
  const n = 2 ** z
  const lat = (ty: number): number => Math.atan(Math.sinh(Math.PI * (1 - (2 * ty) / n))) / RAD
  return { west: (x / n) * 360 - 180, east: ((x + 1) / n) * 360 - 180, north: lat(y), south: lat(y + 1) }
}

/** Mètres au sol par pixel (CSS) d'une tuile à ce zoom et à cette latitude */
export const metersPerPixel = (z: number, latDeg: number): number => (40075016.68557849 / (TILE_PX * 2 ** z)) * Math.cos(latDeg * RAD)

export interface PlannedLayer<T> {
  /** indice d'échelle (0 = Z … 7 = G) */
  scale: number
  cells: T[]
}

/**
 * `cells` : les cellules du dossier par « échelle/latitude/longitude » ; `perScale` : leur nombre par échelle (les échelles
 * absentes du dossier sont sautées). Résultat : de l'échelle voulue à la plus petite, celles qui ont des cellules sous la tuile.
 */
export function planTile<T>(
  cells: ReadonlyMap<string, readonly T[]>,
  perScale: readonly number[],
  z: number,
  x: number,
  y: number,
  detail = 0,
): PlannedLayer<T>[] {
  const box = tileGeoBox(z, x, y)
  const wanted = scaleForView(metersPerPixel(z, (box.north + box.south) / 2), detail)
  const out: PlannedLayer<T>[] = []
  for (let s = wanted; s >= 0; s--) {
    if (!perScale[s]) continue
    const found: T[] = []
    for (const k of cellsForBox(box, s)) {
      const list = cells.get(cellKeyId(k))
      if (list) found.push(...list)
    }
    if (found.length) out.push({ scale: s, cells: found })
  }
  return out
}

export const scaleLabel = (s: number): string => `${SCALES[s]!.ch} (1:${SCALES[s]!.denom.toLocaleString('fr-FR')})`
