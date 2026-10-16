// Encodeur de cellules CM93 synthétiques pour les tests : aucune vraie carte (C-MAP, sous licence) n'est versionnée dans le dépôt.
import { CM93_RADIUS } from '../../cm93/cell'
import { DECODE_TABLE } from '../../cm93/decode'

const ENCODE_TABLE = (() => {
  const t = new Uint8Array(256)
  for (let i = 0; i < 256; i++) t[DECODE_TABLE[i]!] = i
  return t
})()

export interface BuildFeature {
  cls: number
  /** 0 parent sans géométrie, 1 point, 2 ligne, 4 surface, 8 sondes */
  prim: 0 | 1 | 2 | 4 | 8
  /** surface / ligne : indices d'arêtes bruts (arête | usage << 13) */
  edges?: number[]
  /** point : indice du point ; sondes : indice de la nappe */
  point?: number
  related?: number[]
  /** octets d'attributs déjà encodés */
  attrs?: number[]
  nAttr?: number
}

export interface BuildCell {
  /** coins en degrés : la cellule est un rectangle de Mercator */
  south: number
  west: number
  north: number
  east: number
  /** arêtes : x, y, x, y… (16 bits) */
  edges: number[][]
  /** nappes de sondes : x, y, z… */
  soundings?: number[][]
  /** points isolés : x, y, x, y… */
  points?: number[]
  features: BuildFeature[]
  /** octets ajoutés à la fin du fichier (pour tester la détection de fichier corrompu) */
  trailing?: number
}

const mercX = (lon: number): number => (lon * Math.PI * CM93_RADIUS) / 180
const mercY = (lat: number): number => CM93_RADIUS * Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360))

class Out {
  bytes: number[] = []
  u8(v: number): this {
    this.bytes.push(v & 255)
    return this
  }
  u16(v: number): this {
    return this.u8(v).u8(v >> 8)
  }
  i32(v: number): this {
    return this.u16(v & 0xffff).u16((v >> 16) & 0xffff)
  }
  f64(v: number): this {
    const b = new Uint8Array(new Float64Array([v]).buffer)
    this.bytes.push(...b)
    return this
  }
}

/** Fichier de cellule brouillé, tel que C-MAP le fabrique. */
export function buildCell(c: BuildCell): Uint8Array<ArrayBuffer> {
  const t1 = new Out()
  for (const e of c.edges) {
    t1.u16(e.length / 2)
    for (const v of e) t1.u16(v)
  }
  const snd = c.soundings ?? []
  for (const s of snd) {
    t1.u16(s.length / 3)
    for (const v of s) t1.u16(v)
  }
  const pts = c.points ?? []
  for (const v of pts) t1.u16(v)

  const t2 = new Out()
  for (const f of c.features) {
    const rec = new Out()
    const hasAttrs = (f.attrs?.length ?? 0) > 0
    const flags = f.prim | (f.related?.length ? 0x10 : 0) | (hasAttrs ? 0x80 : 0)
    if (f.prim === 2 || f.prim === 4) {
      rec.u16(f.edges!.length)
      for (const e of f.edges!) rec.u16(e)
    } else if (f.prim === 1 || f.prim === 8) rec.u16(f.point ?? 0)
    if (f.related?.length) {
      rec.u8(f.related.length)
      for (const r of f.related) rec.u16(r)
    }
    if (hasAttrs) {
      rec.u8(f.nAttr ?? 0)
      rec.bytes.push(...f.attrs!)
    }
    t2.u8(f.cls)
      .u8(flags)
      .u16(rec.bytes.length + 4)
    t2.bytes.push(...rec.bytes)
  }

  const head = new Out()
  head.f64(c.west).f64(c.south).f64(c.east).f64(c.north)
  head.f64(mercX(c.west)).f64(mercY(c.south)).f64(mercX(c.east)).f64(mercY(c.north))
  head.u16(c.edges.length) // 64
  head
    .i32(c.edges.reduce((a, e) => a + e.length / 2, 0))
    .i32(0)
    .i32(0) // 66, 70, 74
  head.u16(snd.length) // 78
  head.i32(snd.reduce((a, s) => a + s.length / 3, 0)).i32(0) // 80, 84
  head.u16(pts.length / 2) // 88
  head.u16(0).u16(0) // 90, 92
  head.u16(c.features.length) // 94
  while (head.bytes.length < 128) head.u8(0)

  const pre = new Out().u16(138).i32(t1.bytes.length).i32(t2.bytes.length)
  const all = [...pre.bytes, ...head.bytes, ...t1.bytes, ...t2.bytes, ...Array.from({ length: c.trailing ?? 0 }, () => 0)]
  return Uint8Array.from(all.map((b) => ENCODE_TABLE[b]!))
}

// --- attributs -------------------------------------------------------------------------------------------------------

export const attrB = (id: number, v: number): number[] => [id, v]
export const attrW = (id: number, v: number): number[] => [id, (v * 10) & 255, ((v * 10) >> 8) & 255]
export const attrS = (id: number, s: string): number[] => [id, ...Array.from(s, (ch) => ch.charCodeAt(0) & 255), 0]
export const attrL = (id: number, l: number[]): number[] => [id, l.length, ...l]
export const attrR = (id: number, v: number): number[] => [id, ...new Uint8Array(new Float32Array([v]).buffer)]

/** Dictionnaires minimaux (même format que CM93OBJ.DIC / CM93ATTR.DIC) */
export const OBJ_DIC = [
  'DEPARE|44|A|6|Depth area|DRVAL1|DRVAL2',
  'LNDARE|81|PA|6|Land area|OBJNAM',
  'COALNE|35|L|6|Coastline|CATCOA',
  'LIGHTS|86|P|8|Light|COLOUR|LITCHR',
  'BOYLAT|18|P|8|Buoy, lateral|BOYSHP',
  'SOUNDG|147|S|4|Sounding',
  '_m_sor|217|A|6|Source coverage|CSCALE',
  '_texto|198|P|8|Text|_texta',
].join('\r\n')

export const ATTR_DIC = [
  ';comment',
  'DRVAL1|10|aWORD10|0.0|100.0',
  'DRVAL2|11|aWORD10|0.0|100.0',
  'OBJNAM|20|aSTRING',
  'COLOUR|21|aLIST|1|13',
  'COLMAR|22|aBYTE|1|18',
  'LITCHR|23|aBYTE|1|29',
  'CATCOA|24|aBYTE|1|9',
  'BOYSHP|25|aBYTE|1|8',
  'CSCALE|26|aLONG|0|0',
  'VALNMR|27|aFLOAT|0|0',
  '_texta|28|aSTRING',
  'NINFOM|29|aCMPLX',
].join('\r\n')
