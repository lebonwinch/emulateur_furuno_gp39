// Géoréférencement d'une carte BSB : pixel ↔ latitude/longitude WGS84, à partir des points de calage REF/ et du décalage de datum DTM/.
//
// Méthode (celle d'OpenCPN pour les cartes sans polynômes) : on cherche, par moindres carrés, la transformation qui envoie les
// coordonnées « plan » de la carte (longitude, Mercator(latitude) pour une carte Mercator ; longitude, latitude sinon) sur les
// pixels, et la transformation inverse. Une carte Mercator est affine dans ce plan ; les cartes gnomoniques ou Transverse Mercator
// (ports, cartes britanniques) couvrent peu d'étendue : un terme bilinéaire suffit à absorber la déformation.

import type { KapHeader } from './kap'

// excentricité de l'ellipsoïde : celle de WGS84 ; l'écart avec Hayford (ED50) ou Airy (OSGB36) est de l'ordre du mètre ici
const E = 0.0818191908426215
const RAD = Math.PI / 180

/** Ordonnée Mercator ellipsoïdale (sans dimension) d'une latitude en degrés. */
export function mercY(latDeg: number): number {
  const phi = latDeg * RAD
  return Math.log(Math.tan(Math.PI / 4 + phi / 2)) - E * Math.atanh(E * Math.sin(phi))
}

/** Latitude en degrés d'une ordonnée Mercator ellipsoïdale. */
export function invMercY(y: number): number {
  let phi = 2 * Math.atan(Math.exp(y)) - Math.PI / 2
  for (let i = 0; i < 8; i++) phi = 2 * Math.atan(Math.exp(y + E * Math.atanh(E * Math.sin(phi)))) - Math.PI / 2
  return phi / RAD
}

interface Poly {
  cu: number
  cv: number
  su: number
  sv: number
  /** 3 coefficients (affine) ou 4 (bilinéaire) */
  c: number[]
}

function evalPoly(p: Poly, u: number, v: number): number {
  const a = (u - p.cu) / p.su
  const b = (v - p.cv) / p.sv
  return p.c[0]! + p.c[1]! * a + p.c[2]! * b + (p.c.length > 3 ? p.c[3]! * a * b : 0)
}

/** Moindres carrés t ≈ f(u, v) ; null si le système est dégénéré (points alignés…). */
function fitPoly(us: number[], vs: number[], t: number[], bilinear: boolean): Poly | null {
  const n = us.length
  const mean = (a: number[]): number => a.reduce((s, x) => s + x, 0) / a.length
  const span = (a: number[]): number => (Math.max(...a) - Math.min(...a)) / 2 || 1
  const p: Poly = { cu: mean(us), cv: mean(vs), su: span(us), sv: span(vs), c: [] }
  const k = bilinear ? 4 : 3
  const rows = us.map((u, i) => {
    const a = (u - p.cu) / p.su
    const b = (vs[i]! - p.cv) / p.sv
    return bilinear ? [1, a, b, a * b] : [1, a, b]
  })
  // équations normales  (AᵀA) c = Aᵀ t, résolues par élimination de Gauss avec pivot
  const m: number[][] = Array.from({ length: k }, () => Array.from({ length: k + 1 }, () => 0))
  for (let r = 0; r < n; r++) {
    for (let i = 0; i < k; i++) {
      for (let j = 0; j < k; j++) m[i]![j]! += rows[r]![i]! * rows[r]![j]!
      m[i]![k]! += rows[r]![i]! * t[r]!
    }
  }
  for (let col = 0; col < k; col++) {
    let piv = col
    for (let r = col + 1; r < k; r++) if (Math.abs(m[r]![col]!) > Math.abs(m[piv]![col]!)) piv = r
    if (Math.abs(m[piv]![col]!) < 1e-9) return null
    ;[m[col], m[piv]] = [m[piv]!, m[col]!]
    for (let r = 0; r < k; r++) {
      if (r === col) continue
      const f = m[r]![col]! / m[col]![col]!
      for (let c = col; c <= k; c++) m[r]![c]! -= f * m[col]![c]!
    }
  }
  p.c = m.map((row, i) => row[k]! / row[i]!)
  return p
}

export interface GeoModel {
  /** latitude/longitude WGS84 d'un pixel de la carte */
  pixelToGeo(x: number, y: number): { lat: number; lon: number }
  /** pixel de la carte pour une position WGS84 */
  geoToPixel(lat: number, lon: number): { x: number; y: number }
  /** coordonnée « plan » d'une latitude WGS84 (Mercator pour une carte Mercator) : calculable une fois par ligne de tuile */
  planeV(latWgs: number): number
  /** coordonnée « plan » d'une longitude WGS84 */
  planeU(lonWgs: number): number
  /** pixel à partir des coordonnées plan (voir planeU/planeV) ; écrit dans `out` pour éviter les allocations */
  planeToPixel(u: number, v: number, out: { x: number; y: number }): void
  /** erreur quadratique moyenne du calage aux points REF, en pixels */
  rmsPx: number
  /** résolution au sol au centre de la carte, en mètres par pixel */
  metersPerPixel: number
  /** emprise WGS84 de la zone utile : [sud, ouest, nord, est] */
  bbox: [number, number, number, number]
  /** polygone de la zone utile en pixels de la carte (liste x0,y0,x1,y1,…) ; le cadre entier si la carte n'en a pas */
  polygonPx: Float64Array
}

const distM = (lat1: number, lon1: number, lat2: number, lon2: number): number => {
  const dLat = (lat2 - lat1) * RAD
  const dLon = (lon2 - lon1) * RAD
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * RAD) * Math.cos(lat2 * RAD) * Math.sin(dLon / 2) ** 2
  return 2 * 6371008.8 * Math.asin(Math.min(1, Math.sqrt(a)))
}

/** Construit le modèle de géoréférencement ; null si les points de calage sont inutilisables. */
export function buildGeoModel(h: KapHeader): GeoModel | null {
  const mercator = h.projection === 'MERCATOR'
  // plan de la carte, dans le datum de la carte (les REF/ et PLY/ y sont exprimés)
  const planeOf = (latChart: number): number => (mercator ? mercY(latChart) : latChart)
  const us = h.refs.map((r) => r.lon)
  const vs = h.refs.map((r) => planeOf(r.lat))
  const xs = h.refs.map((r) => r.x)
  const ys = h.refs.map((r) => r.y)
  const bilinear = h.refs.length >= 4

  const build = (bi: boolean): { fx: Poly; fy: Poly; fu: Poly; fv: Poly } | null => {
    const fx = fitPoly(us, vs, xs, bi)
    const fy = fitPoly(us, vs, ys, bi)
    const fu = fitPoly(xs, ys, us, bi)
    const fv = fitPoly(xs, ys, vs, bi)
    return fx && fy && fu && fv ? { fx, fy, fu, fv } : null
  }
  const polys = (bilinear ? build(true) : null) ?? build(false)
  if (!polys) return null
  const { fx, fy, fu, fv } = polys

  const dLat = h.dtmLat / 3600
  const dLon = h.dtmLon / 3600
  const planeToPixel = (u: number, v: number, out: { x: number; y: number }): void => {
    out.x = evalPoly(fx, u, v)
    out.y = evalPoly(fy, u, v)
  }
  const pixelToGeo = (x: number, y: number): { lat: number; lon: number } => {
    const v = evalPoly(fv, x, y)
    return { lat: (mercator ? invMercY(v) : v) + dLat, lon: evalPoly(fu, x, y) + dLon }
  }
  const tmp = { x: 0, y: 0 }
  const geoToPixel = (lat: number, lon: number): { x: number; y: number } => {
    planeToPixel(lon - dLon, planeOf(lat - dLat), tmp)
    return { x: tmp.x, y: tmp.y }
  }

  let sq = 0
  for (const r of h.refs) {
    planeToPixel(r.lon, planeOf(r.lat), tmp)
    sq += (tmp.x - r.x) ** 2 + (tmp.y - r.y) ** 2
  }

  // zone utile : PLY/ (datum de la carte) → pixels ; à défaut, le cadre entier
  const polygonPx = new Float64Array(h.ply.length >= 3 ? h.ply.length * 2 : 8)
  if (h.ply.length >= 3) {
    h.ply.forEach((p, i) => {
      planeToPixel(p.lon, planeOf(p.lat), tmp)
      polygonPx[i * 2] = tmp.x
      polygonPx[i * 2 + 1] = tmp.y
    })
  } else polygonPx.set([0, 0, h.width, 0, h.width, h.height, 0, h.height])

  let south = 90
  let west = 180
  let north = -90
  let east = -180
  for (let i = 0; i < polygonPx.length; i += 2) {
    const g = pixelToGeo(polygonPx[i]!, polygonPx[i + 1]!)
    south = Math.min(south, g.lat)
    north = Math.max(north, g.lat)
    west = Math.min(west, g.lon)
    east = Math.max(east, g.lon)
  }

  const cx = h.width / 2
  const cy = h.height / 2
  const c = pixelToGeo(cx, cy)
  const r = pixelToGeo(cx + 100, cy)
  const d = pixelToGeo(cx, cy + 100)
  const metersPerPixel = (distM(c.lat, c.lon, r.lat, r.lon) + distM(c.lat, c.lon, d.lat, d.lon)) / 200

  return {
    pixelToGeo,
    geoToPixel,
    planeV: (latWgs) => planeOf(latWgs - dLat),
    planeU: (lonWgs) => lonWgs - dLon,
    planeToPixel,
    rmsPx: Math.sqrt(sq / h.refs.length),
    metersPerPixel,
    bbox: [south, west, north, east],
    polygonPx,
  }
}
