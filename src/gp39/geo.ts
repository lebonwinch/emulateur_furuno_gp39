// Géodésie / navigation de base du GP-39 (Terre sphérique, 1 NM = 1852 m).
// Les distances sont en milles nautiques (NM), les angles en degrés.

export const NM_M = 1852
/** Rayon moyen de la Terre exprimé en NM (6 371 008,8 m). */
export const R_NM = 6371008.8 / NM_M

const RAD = Math.PI / 180
const DEG = 180 / Math.PI

export const toRad = (d: number): number => d * RAD
export const toDeg = (r: number): number => r * DEG

/** Ramène un angle dans [0, 360[. */
export const norm360 = (d: number): number => ((d % 360) + 360) % 360
/** Ramène un angle dans ]-180, 180]. */
export const norm180 = (d: number): number => {
  const n = norm360(d)
  return n > 180 ? n - 360 : n
}
/** Ramène une longitude dans [-180, 180[. */
export const normLon = (lon: number): number => {
  const n = ((((lon + 180) % 360) + 360) % 360) - 180
  return n
}

export interface LatLon {
  lat: number
  lon: number
}

// ---------------------------------------------------------------- Mercator

/** Latitude croissante (rad) : ψ = ln tan(π/4 + φ/2). */
const psi = (latRad: number): number => Math.log(Math.tan(Math.PI / 4 + latRad / 2))
const psiInv = (p: number): number => 2 * Math.atan(Math.exp(p)) - Math.PI / 2

const MAX_LAT = 85

export const clampLat = (lat: number): number => Math.max(-MAX_LAT, Math.min(MAX_LAT, lat))

/**
 * Projection Mercator locale. `pxPerNm` = nombre de pixels pour 1 NM (vrai) mesuré
 * en Est-Ouest à la latitude du centre, comme l'échelle horizontale du GP-39.
 */
export class Mercator {
  readonly cx: number
  readonly cy: number
  private readonly k: number
  private readonly lat0: number
  private readonly lon0: number
  private readonly psi0: number

  constructor(center: LatLon, pxPerNm: number, originX: number, originY: number) {
    this.lat0 = clampLat(center.lat)
    this.lon0 = center.lon
    this.psi0 = psi(toRad(this.lat0))
    this.k = pxPerNm * Math.cos(toRad(this.lat0)) * R_NM
    this.cx = originX
    this.cy = originY
  }

  /** lat/lon → pixel (y vers le bas). */
  toPx(lat: number, lon: number): [number, number] {
    const dLon = normLon(lon - this.lon0)
    const x = this.cx + this.k * toRad(dLon)
    const y = this.cy - this.k * (psi(toRad(clampLat(lat))) - this.psi0)
    return [x, y]
  }

  /** pixel → lat/lon. */
  fromPx(x: number, y: number): LatLon {
    const lon = normLon(this.lon0 + toDeg((x - this.cx) / this.k))
    const lat = toDeg(psiInv(this.psi0 - (y - this.cy) / this.k))
    return { lat, lon }
  }
}

// ---------------------------------------------------------------- distances

/** Distance orthodromique (NM). */
export function gcDistance(a: LatLon, b: LatLon): number {
  const p1 = toRad(a.lat)
  const p2 = toRad(b.lat)
  const dp = p2 - p1
  const dl = toRad(normLon(b.lon - a.lon))
  const h = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2
  return 2 * R_NM * Math.asin(Math.min(1, Math.sqrt(h)))
}

/** Cap initial orthodromique (°, 0-360). */
export function gcBearing(a: LatLon, b: LatLon): number {
  const p1 = toRad(a.lat)
  const p2 = toRad(b.lat)
  const dl = toRad(normLon(b.lon - a.lon))
  const y = Math.sin(dl) * Math.cos(p2)
  const x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl)
  return norm360(toDeg(Math.atan2(y, x)))
}

/** Distance loxodromique (NM). */
export function rhumbDistance(a: LatLon, b: LatLon): number {
  const p1 = toRad(a.lat)
  const p2 = toRad(b.lat)
  const dp = p2 - p1
  const dl = toRad(normLon(b.lon - a.lon))
  const dPsi = psi(p2) - psi(p1)
  const q = Math.abs(dPsi) > 1e-12 ? dp / dPsi : Math.cos(p1)
  return Math.sqrt(dp * dp + q * q * dl * dl) * R_NM
}

/** Cap loxodromique (°, 0-360). */
export function rhumbBearing(a: LatLon, b: LatLon): number {
  const p1 = toRad(a.lat)
  const p2 = toRad(b.lat)
  const dl = toRad(normLon(b.lon - a.lon))
  const dPsi = psi(p2) - psi(p1)
  return norm360(toDeg(Math.atan2(dl, dPsi)))
}

export type NavMethod = 'Rhumb Line' | 'Great Circle'

export function distance(a: LatLon, b: LatLon, m: NavMethod = 'Rhumb Line'): number {
  return m === 'Great Circle' ? gcDistance(a, b) : rhumbDistance(a, b)
}

export function bearing(a: LatLon, b: LatLon, m: NavMethod = 'Rhumb Line'): number {
  return m === 'Great Circle' ? gcBearing(a, b) : rhumbBearing(a, b)
}

/** Point atteint en suivant un cap loxodromique constant sur `distNm`. */
export function rhumbDestination(a: LatLon, brgDeg: number, distNm: number): LatLon {
  const p1 = toRad(a.lat)
  const th = toRad(brgDeg)
  const delta = distNm / R_NM
  let p2 = p1 + delta * Math.cos(th)
  // Ne pas dépasser les pôles
  const lim = toRad(89.9)
  if (Math.abs(p2) > lim) p2 = Math.sign(p2) * lim
  const dPsi = psi(p2) - psi(p1)
  const q = Math.abs(dPsi) > 1e-12 ? (p2 - p1) / dPsi : Math.cos(p1)
  const dl = (delta * Math.sin(th)) / q
  return { lat: toDeg(p2), lon: normLon(a.lon + toDeg(dl)) }
}

/** Point atteint en suivant un grand cercle sur `distNm` depuis `a` (cap initial `brgDeg`). */
export function gcDestination(a: LatLon, brgDeg: number, distNm: number): LatLon {
  const d = distNm / R_NM
  const th = toRad(brgDeg)
  const p1 = toRad(a.lat)
  const p2 = Math.asin(Math.sin(p1) * Math.cos(d) + Math.cos(p1) * Math.sin(d) * Math.cos(th))
  const dl = Math.atan2(Math.sin(th) * Math.sin(d) * Math.cos(p1), Math.cos(d) - Math.sin(p1) * Math.sin(p2))
  return { lat: toDeg(p2), lon: normLon(a.lon + toDeg(dl)) }
}

/** Point de destination selon la méthode de navigation choisie (loxodromie ou grand cercle). */
export function destinationPoint(a: LatLon, brgDeg: number, distNm: number, m: NavMethod = 'Rhumb Line'): LatLon {
  return m === 'Great Circle' ? gcDestination(a, brgDeg, distNm) : rhumbDestination(a, brgDeg, distNm)
}

/**
 * Écart traversier (XTE, NM) du point `p` par rapport au segment `from → to`.
 * Positif : le bateau est à DROITE de la route (il faut barrer à gauche), comme sur le GP-39.
 * Calcul plan local (suffisant pour des segments de quelques dizaines de NM).
 */
export function crossTrack(from: LatLon, to: LatLon, p: LatLon): number {
  const lat0 = toRad((from.lat + to.lat) / 2)
  const kx = Math.cos(lat0) * 60
  const ky = 60
  const ax = 0
  const ay = 0
  const bx = normLon(to.lon - from.lon) * kx
  const by = (to.lat - from.lat) * ky
  const px = normLon(p.lon - from.lon) * kx
  const py = (p.lat - from.lat) * ky
  const len = Math.hypot(bx - ax, by - ay)
  if (len < 1e-9) return 0
  // produit vectoriel (route × position) : > 0 → position à gauche en repère x/Est y/Nord
  const cross = (bx * py - by * px) / len
  return -cross
}

// ---------------------------------------------------------------- magnétisme

type Declination = (lat: number, lon: number, date?: Date) => number
let decl: Declination | null = null

/** Déclinaison magnétique (° ; positive vers l'Est) fournie par le modèle WMM, 0 si indisponible. */
export function magneticVariation(lat: number, lon: number, date = new Date()): number {
  return decl ? decl(lat, lon, date) : 0
}

export function setDeclinationProvider(p: Declination): void {
  decl = p
}

// ---------------------------------------------------------------- grille

/** Pas « agréables » de graduation en minutes d'arc. */
const GRID_STEPS_MIN = [0.0005, 0.001, 0.0025, 0.005, 0.01, 0.025, 0.05, 0.125, 0.25, 0.5, 1, 2, 5, 10, 20, 30, 60, 120, 300, 600]

/** Choisit le plus petit pas (en minutes) dont l'écart en pixels est ≥ `minPx`. */
export function gridStepMin(minutesPerPx: number, minPx: number): number {
  const wanted = minutesPerPx * minPx
  for (const s of GRID_STEPS_MIN) if (s >= wanted) return s
  return GRID_STEPS_MIN[GRID_STEPS_MIN.length - 1]!
}
