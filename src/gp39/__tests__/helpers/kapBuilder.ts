// Encodeur de cartes KAP synthétiques pour les tests : aucune vraie carte (SHOM, sous licence) n'est versionnée dans le dépôt.
import { mercY } from '../../bsb/georef'

export interface SynthOptions {
  width: number
  height: number
  /** bits par pixel (1 à 7) */
  depth?: number
  /** couleur RGB des valeurs de pixel 1, 2, 3… */
  palette?: [number, number, number][]
  /** valeur de pixel (1…) au pixel (x, y) */
  pixel: (x: number, y: number) => number
  name?: string
  number?: string
  scale?: number
  projection?: string
  datum?: string
  /** décalage de datum en secondes d'arc : [latitude, longitude] */
  dtm?: [number, number]
  /** emprise [sud, ouest, nord, est] (datum de la carte) : sert à fabriquer les REF/ d'une carte Mercator */
  bbox: [number, number, number, number]
  /** polygone de zone utile en pixels ; par défaut, une marge de 10 px */
  plyPx?: [number, number][]
  /** écrit la table d'index de fin de fichier (vrai par défaut) */
  index?: boolean
  /** corrompt la table d'index : l'offset final ne pointe plus sur la table */
  corruptIndex?: boolean
}

const CRLF = '\r\n'

/** Position pixel → lat/lon d'une carte Mercator remplissant exactement `bbox`. */
export function mercatorAt(o: Pick<SynthOptions, 'width' | 'height' | 'bbox'>, x: number, y: number): { lat: number; lon: number } {
  const [south, west, north, east] = o.bbox
  const yN = mercY(north)
  const yS = mercY(south)
  const v = yN + ((yS - yN) * y) / (o.height - 1)
  // lat = invMercY(v), calculée ici pour ne pas dépendre du code testé : itération de point fixe
  let phi = 2 * Math.atan(Math.exp(v)) - Math.PI / 2
  const e = 0.0818191908426215
  for (let i = 0; i < 12; i++) phi = 2 * Math.atan(Math.exp(v + e * Math.atanh(e * Math.sin(phi)))) - Math.PI / 2
  return { lat: (phi * 180) / Math.PI, lon: west + ((east - west) * x) / (o.width - 1) }
}

function runBytes(value: number, run: number, depth: number): number[] {
  const shift = 7 - depth
  const countMask = (1 << shift) - 1
  let rest = run - 1
  const tail: number[] = []
  while (rest > countMask) {
    tail.unshift(rest & 0x7f)
    rest >>= 7
  }
  const first = (value << shift) | rest | (tail.length ? 0x80 : 0)
  return [first, ...tail.map((t, i) => (i < tail.length - 1 ? t | 0x80 : t))]
}

function markerBytes(row: number): number[] {
  const groups: number[] = []
  let r = row
  do {
    groups.unshift(r & 0x7f)
    r = Math.floor(r / 128)
  } while (r > 0)
  return groups.map((g, i) => (i < groups.length - 1 ? g | 0x80 : g))
}

/** Fabrique le contenu complet d'un fichier .kap. */
export function buildKap(o: SynthOptions): Uint8Array<ArrayBuffer> {
  const depth = o.depth ?? 6
  const palette = o.palette ?? [
    [255, 255, 255],
    [255, 0, 0],
    [0, 0, 255],
  ]
  const refPx: [number, number][] = [
    [0, 0],
    [o.width - 1, 0],
    [o.width - 1, o.height - 1],
    [0, o.height - 1],
  ]
  const plyPx = o.plyPx ?? [
    [10, 10],
    [o.width - 11, 10],
    [o.width - 11, o.height - 11],
    [10, o.height - 11],
  ]
  const dtm = o.dtm ?? [0, 0]
  const lines = [
    '!(C) test chart, synthetic',
    `CHT/NA=${o.name ?? 'Carte test'},NU=${o.number ?? '9999'}`,
    `BSB/NA=${o.name ?? 'Carte test'},NU=${o.number ?? '9999'},RA=${o.width},${o.height},DU=254`,
    // une coupure de ligne sans virgule, comme dans les fichiers du SHOM
    `KNP/SC=${o.scale ?? 50000},GD=${o.datum ?? 'European 1950'}`,
    `    PR=${o.projection ?? 'MERCATOR'},PP=0.000000,UN=METERS,SD=LOWEST LOW WATER`,
    ...refPx.map(([x, y], i) => {
      const g = mercatorAt(o, x, y)
      return `REF/${i + 1},${x},${y},${g.lat.toFixed(8)},${g.lon.toFixed(8)}`
    }),
    ...plyPx.map(([x, y], i) => {
      const g = mercatorAt(o, x, y)
      return `PLY/${i + 1},${g.lat.toFixed(8)},${g.lon.toFixed(8)}`
    }),
    `DTM/${dtm[0]},${dtm[1]}`,
    `IFM/${depth}`,
    ...palette.map(([r, g, b], i) => `RGB/${i + 1},${r},${g},${b}`),
  ]
  const head = new TextEncoder().encode(lines.join(CRLF) + CRLF)

  const rows: number[][] = []
  for (let y = 0; y < o.height; y++) {
    const bytes = [...markerBytes(y)]
    let x = 0
    while (x < o.width) {
      const v = o.pixel(x, y)
      let run = 1
      while (x + run < o.width && o.pixel(x + run, y) === v) run++
      bytes.push(...runBytes(v, run, depth))
      x += run
    }
    bytes.push(0)
    rows.push(bytes)
  }
  const dataStart = head.length + 3
  const offsets: number[] = []
  let pos = dataStart
  for (const r of rows) {
    offsets.push(pos)
    pos += r.length
  }
  const raster = new Uint8Array(pos - dataStart)
  let p = 0
  for (const r of rows) {
    raster.set(r, p)
    p += r.length
  }
  const withIndex = o.index !== false
  const table = new Uint8Array(withIndex ? offsets.length * 4 + 4 : 0)
  if (withIndex) {
    const dv = new DataView(table.buffer)
    offsets.forEach((off, i) => dv.setUint32(i * 4, off, false))
    dv.setUint32(offsets.length * 4, o.corruptIndex ? 7 : pos, false)
  }
  const file = new Uint8Array(dataStart + raster.length + table.length)
  file.set(head, 0)
  file.set([0x1a, 0x00, depth], head.length)
  file.set(raster, dataStart)
  file.set(table, dataStart + raster.length)
  return file
}
