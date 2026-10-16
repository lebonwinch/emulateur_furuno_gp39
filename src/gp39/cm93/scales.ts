// Échelles et découpage en cellules d'une collection CM93, sans Vue ni DOM.
//
// CM93 découpe le monde en cellules carrées, de plus en plus petites quand l'échelle grandit : 8 échelles notées Z (1:20 M),
// A (1:3 M), B (1:1 M), C (1:200 000), D (1:100 000), E (1:50 000), F (1:20 000) et G (1:7 500). Un fichier de cellule s'appelle
// « <s><latitude sur 3 chiffres><longitude sur 4 chiffres>.<échelle> » : <s> vaut 0 pour la cellule principale, A, B… pour les
// cellules complémentaires de la même zone ; latitude = 3·lat + 270 et longitude = 3·(lon + 360), arrondies au pas de l'échelle.

export interface Cm93Scale {
  /** lettre de l'extension des fichiers */
  ch: string
  denom: number
  /** côté d'une cellule, en tiers de degré (20') */
  step: number
}

export const SCALES: readonly Cm93Scale[] = [
  { ch: 'Z', denom: 20_000_000, step: 120 },
  { ch: 'A', denom: 3_000_000, step: 60 },
  { ch: 'B', denom: 1_000_000, step: 30 },
  { ch: 'C', denom: 200_000, step: 12 },
  { ch: 'D', denom: 100_000, step: 3 },
  { ch: 'E', denom: 50_000, step: 1 },
  { ch: 'F', denom: 20_000, step: 1 },
  { ch: 'G', denom: 7_500, step: 1 },
]

/** indice d'échelle (0 = Z … 7 = G) d'une lettre */
export const scaleIndex = (ch: string): number => SCALES.findIndex((s) => s.ch === ch.toUpperCase())

/**
 * Seuils d'OpenCPN : l'échelle utilisée dépend de « 3000 × mètres par pixel » (G sous 5000, F sous 15000, E sous 40000, D sous
 * 150000, C sous 300000, B sous 1 M, A sous 5 M, Z au-delà). `detail` décale le choix vers des cartes plus (positif) ou moins
 * (négatif) détaillées, en crans.
 */
const BREAKS = [5_000, 15_000, 40_000, 150_000, 300_000, 1_000_000, 5_000_000]
export function scaleForView(metersPerPixel: number, detail = 0): number {
  const v = 3000 * metersPerPixel
  let idx = 7
  for (const b of BREAKS) {
    if (v < b) break
    idx--
  }
  return Math.max(0, Math.min(7, idx + detail))
}

export interface CellKey {
  scale: number
  /** latitude du fichier : 3 · lat + 270 (coin sud-ouest) */
  jlat: number
  /** longitude du fichier : 3 · (lon + 360) mod 1080 (coin sud-ouest) */
  jlon: number
}

export interface ParsedCellName extends CellKey {
  /** « 0 » pour la cellule principale, A, B… pour les complémentaires */
  sub: string
}

const NAME = /^([0-9A-Z])(\d{3})(\d{4})\.([A-GZ])$/i

export function parseCellName(name: string): ParsedCellName | null {
  const m = NAME.exec(name)
  if (!m) return null
  const scale = scaleIndex(m[4]!)
  const jlat = Number(m[2])
  const jlon = Number(m[3])
  const step = SCALES[scale]!.step
  // le nom d'une vraie cellule tombe sur la grille de son échelle (sinon : un fichier qui n'en est pas une)
  if ((jlat - 30) % step !== 0 || jlon % step !== 0 || jlon >= 1080) return null
  return { sub: m[1]!.toUpperCase(), scale, jlat, jlon }
}

export const cellKeyId = (k: CellKey): string => `${k.scale}/${k.jlat}/${k.jlon}`

export const cellFileName = (sub: string, k: CellKey): string =>
  `${sub}${String(k.jlat).padStart(3, '0')}${String(k.jlon).padStart(4, '0')}.${SCALES[k.scale]!.ch}`

/** Emprise d'une cellule en degrés (longitude entre −180 et 180 pour l'ouest ; l'est peut dépasser 180). */
export function cellBox(k: CellKey): { south: number; west: number; north: number; east: number } {
  const d = SCALES[k.scale]!.step / 3
  const south = (k.jlat - 270) / 3
  let west = k.jlon / 3
  if (west >= 180) west -= 360
  return { south, west, north: south + d, east: west + d }
}

const wrap1080 = (v: number): number => ((v % 1080) + 1080) % 1080

/** Cellules d'une échelle qui recouvrent une emprise (degrés ; l'est peut dépasser 180). */
export function cellsForBox(box: { south: number; west: number; north: number; east: number }, scale: number): CellKey[] {
  const step = SCALES[scale]!.step
  const lat3 = (lat: number): number => Math.floor((Math.max(-80, Math.min(89.99, lat)) * 3 + 240) / step) * step
  const out: CellKey[] = []
  const lonFrom = Math.floor(((box.west + 360) * 3) / step) * step
  const lonTo = Math.floor(((box.east + 360) * 3 - 1e-9) / step) * step
  for (let la = lat3(box.south); la <= lat3(box.north - 1e-9); la += step) {
    for (let lo = lonFrom; lo <= lonTo; lo += step) out.push({ scale, jlat: la + 30, jlon: wrap1080(lo) })
  }
  return out
}
