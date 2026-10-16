// Lecteur de cellules CM93 (un fichier = un carré de carte à une échelle donnée), sans Vue ni DOM.
//
// Une cellule décodée (voir decode.ts) contient : un préambule (longueur de l'en-tête, longueur des tables 1 et 2), un en-tête
// de 128 octets, puis quatre tables : arêtes (suites de points 16 bits), nappes de sondes (x, y, profondeur), points isolés, et
// enfin les objets. Les coordonnées 16 bits sont interpolées entre les bornes (mètres Mercator) données par l'en-tête. Un objet
// surfacique ou linéaire est une suite d'arêtes ; les 3 bits de poids fort de chaque indice d'arête disent comment l'emprunter
// (bit 2 : à l'envers).

import { descramble } from './decode'

export interface Cm93Header {
  /** bornes en mètres Mercator (rayon CM93) */
  eastMin: number
  northMin: number
  eastMax: number
  northMax: number
}

export interface Cm93Feature {
  /** numéro de classe (voir CM93OBJ.DIC) */
  cls: number
  /** 1 point, 2 ligne, 4 surface, 8 nappe de sondes, 0 objet parent sans géométrie propre */
  prim: number
  /** indices d'arêtes bruts : arête | usage << 13 (prim 2 et 4) */
  edges: Uint16Array
  /** prim 1 : indice du point ; prim 8 : indice de la nappe */
  point: number
  /** objets liés (enfants d'un objet parent) */
  related: Uint16Array
  nAttr: number
  attrs: Uint8Array
}

export interface Cm93Cell {
  header: Cm93Header
  /** arêtes : x0, y0, x1, y1… */
  edges: Uint16Array[]
  /** nappes de sondes : x, y, z… */
  soundings: Uint16Array[]
  /** points isolés : x, y… */
  points: Uint16Array
  features: Cm93Feature[]
}

/** Rayon terrestre de la projection CM93 (ellipsoïde International 1924) */
export const CM93_RADIUS = 6378388
const PREAMBLE = 10
const HEADER = 128
const EMPTY: Uint16Array = new Uint16Array(0)

class Reader {
  private readonly dv: DataView
  pos = 0
  constructor(private readonly bytes: Uint8Array) {
    this.dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  }
  u8(): number {
    return this.dv.getUint8(this.pos++)
  }
  u16(): number {
    const v = this.dv.getUint16(this.pos, true)
    this.pos += 2
    return v
  }
  i32(): number {
    const v = this.dv.getInt32(this.pos, true)
    this.pos += 4
    return v
  }
  f64(): number {
    const v = this.dv.getFloat64(this.pos, true)
    this.pos += 8
    return v
  }
  u16s(n: number): Uint16Array {
    if (this.pos + 2 * n > this.bytes.length) throw new RangeError('cellule tronquée')
    const out = new Uint16Array(n)
    for (let i = 0; i < n; i++) out[i] = this.u16()
    return out
  }
  bytesOf(n: number): Uint8Array {
    if (this.pos + n > this.bytes.length) throw new RangeError('cellule tronquée')
    const s = this.bytes.subarray(this.pos, this.pos + n)
    this.pos += n
    return s
  }
}

/**
 * Décode une cellule à partir des octets bruts du fichier. Renvoie null si le fichier est corrompu ou n'est pas une cellule CM93
 * (la somme « préambule + table 1 + table 2 » doit égaler la taille du fichier : c'est aussi la preuve que la table de
 * substitution est la bonne).
 */
export function parseCell(raw: Uint8Array): Cm93Cell | null {
  if (raw.length < PREAMBLE + HEADER) return null
  const r = new Reader(descramble(raw))
  const prolog = r.u16()
  const t1 = r.i32()
  const t2 = r.i32()
  if (prolog + t1 + t2 !== raw.length) return null
  try {
    return readBody(r)
  } catch {
    return null // lecture au-delà de la fin du fichier ou indices incohérents : on ignore la cellule entière
  }
}

function readBody(r: Reader): Cm93Cell {
  // en-tête : 4 bornes en degrés (inutilisées), 4 bornes en mètres, puis les effectifs des tables
  r.pos = PREAMBLE + 32
  const eastMin = r.f64()
  const northMin = r.f64()
  const eastMax = r.f64()
  const northMax = r.f64()
  const nEdges = r.u16()
  r.pos = PREAMBLE + 78
  const nSoundingRecords = r.u16()
  r.pos = PREAMBLE + 88
  const nPoints = r.u16()
  r.pos = PREAMBLE + 94
  const nFeatures = r.u16()
  r.pos = PREAMBLE + HEADER

  const edges: Uint16Array[] = []
  for (let i = 0; i < nEdges; i++) edges.push(r.u16s(2 * r.u16()))
  const soundings: Uint16Array[] = []
  for (let i = 0; i < nSoundingRecords; i++) soundings.push(r.u16s(3 * r.u16()))
  const points = r.u16s(2 * nPoints)

  const features: Cm93Feature[] = []
  for (let i = 0; i < nFeatures; i++) {
    const start = r.pos
    const cls = r.u8()
    const flags = r.u8()
    const length = r.u16() // taille de l'enregistrement entier, ces 4 octets compris
    const prim = flags & 0x0f
    let edgeList: Uint16Array = EMPTY
    let point = 0
    if (prim === 2 || prim === 4) {
      edgeList = r.u16s(r.u16())
      for (const e of edgeList) if ((e & 0x1fff) >= nEdges) throw new RangeError('arête inconnue')
    } else if (prim === 1) {
      point = r.u16()
      if (point >= nPoints) throw new RangeError('point inconnu')
    } else if (prim === 8) {
      point = r.u16()
      if (point >= nSoundingRecords) throw new RangeError('nappe inconnue')
    }
    let related: Uint16Array = EMPTY
    if (flags & 0x10) related = r.u16s(r.u8())
    if (flags & 0x20) r.u16() // compteur d'objets liés (inutilisé)
    let nAttr = 0
    let attrs: Uint8Array = new Uint8Array(0)
    if (flags & 0x80) {
      nAttr = r.u8()
      attrs = r.bytesOf(Math.max(0, start + length - r.pos))
    }
    r.pos = start + length // l'enregistrement fait foi, quoi qu'on ait lu
    features.push({ cls, prim, edges: edgeList, point, related, nAttr, attrs })
  }
  return { header: { eastMin, northMin, eastMax, northMax }, edges, soundings, points, features }
}

// --- géométrie ---------------------------------------------------------------------------------------------------------

/** Mètres Mercator → coordonnées « monde » normalisées : x dans [0,1[ de l'ouest à l'est, y dans [0,1] du nord au sud. */
const WORLD = 1 / (2 * Math.PI * CM93_RADIUS)

export interface CellFrame {
  /** monde x = x0 + ux · kx ; monde y = y0 − uy · ky (ux, uy = coordonnées 16 bits) */
  x0: number
  y0: number
  kx: number
  ky: number
}

export function cellFrame(h: Cm93Header): CellFrame {
  let dx = h.eastMax - h.eastMin
  if (dx < 0) dx += 2 * Math.PI * CM93_RADIUS // cellule à cheval sur l'antiméridien
  return {
    x0: h.eastMin * WORLD + 0.5,
    y0: 0.5 - h.northMin * WORLD,
    kx: (dx * WORLD) / 65535,
    ky: ((h.northMax - h.northMin) * WORLD) / 65535,
  }
}

/** longitude / latitude (degrés) d'un point 16 bits */
export function cellLonLat(h: Cm93Header, ux: number, uy: number): { lon: number; lat: number } {
  let dx = h.eastMax - h.eastMin
  if (dx < 0) dx += 2 * Math.PI * CM93_RADIUS
  const e = h.eastMin + (ux * dx) / 65535
  const n = h.northMin + (uy * (h.northMax - h.northMin)) / 65535
  return { lon: (e / CM93_RADIUS) * (180 / Math.PI), lat: (2 * Math.atan(Math.exp(n / CM93_RADIUS)) - Math.PI / 2) * (180 / Math.PI) }
}

export interface Ring {
  /** x, y, x, y… en coordonnées 16 bits, anneau fermé (premier point répété à la fin) */
  pts: number[]
}

/**
 * Anneaux d'une surface : on enchaîne les arêtes (à l'envers si le bit 4 de l'usage est posé) jusqu'à retomber sur le point de
 * départ. Le premier anneau est le contour extérieur, les suivants des trous.
 */
export function areaRings(cell: Cm93Cell, f: Cm93Feature): Ring[] {
  const rings: Ring[] = []
  let cur: number[] = []
  let sx = -1
  let sy = -1
  for (const word of f.edges) {
    const e = cell.edges[word & 0x1fff]!
    const rev = ((word >> 13) & 4) !== 0
    const n = e.length / 2
    if (n === 0) continue
    const at = (k: number): number => (rev ? n - 1 - k : k)
    if (cur.length === 0) {
      const k = at(0)
      sx = e[2 * k]!
      sy = e[2 * k + 1]!
    } else {
      cur.length -= 2 // le dernier point de l'arête précédente est le premier de celle-ci
    }
    for (let k = 0; k < n; k++) {
      const j = at(k)
      cur.push(e[2 * j]!, e[2 * j + 1]!)
    }
    if (cur[cur.length - 2] === sx && cur[cur.length - 1] === sy) {
      rings.push({ pts: cur })
      cur = []
    }
  }
  if (cur.length >= 6) {
    cur.push(cur[0]!, cur[1]!) // anneau resté ouvert (cellule imparfaite) : on le ferme
    rings.push({ pts: cur })
  }
  return rings
}

/** Polyligne d'un objet linéaire : toutes ses arêtes bout à bout (une seule suite de points). */
export function lineParts(cell: Cm93Cell, f: Cm93Feature): number[][] {
  const parts: number[][] = []
  let cur: number[] = []
  for (const word of f.edges) {
    const e = cell.edges[word & 0x1fff]!
    const rev = ((word >> 13) & 4) !== 0
    const n = e.length / 2
    if (n === 0) continue
    const first = rev ? n - 1 : 0
    // arête qui ne prolonge pas la précédente : on repart d'une nouvelle polyligne
    if (cur.length && (cur[cur.length - 2] !== e[2 * first] || cur[cur.length - 1] !== e[2 * first + 1])) {
      parts.push(cur)
      cur = []
    }
    if (cur.length) cur.length -= 2
    for (let k = 0; k < n; k++) {
      const j = rev ? n - 1 - k : k
      cur.push(e[2 * j]!, e[2 * j + 1]!)
    }
  }
  if (cur.length) parts.push(cur)
  return parts
}

/** Profondeur (m) d'une sonde : au-dessus de 12000, mètres entiers + 12000 ; sinon dixièmes de mètre. */
export const soundingDepth = (z: number): number => (z >= 12000 ? z - 12000 : z / 10)
