// Attributs d'un objet CM93 : suite de (numéro d'attribut sur 1 octet, valeur) dont la taille dépend du type de l'attribut
// (CM93ATTR.DIC). Un type inconnu rend la suite illisible : on s'arrête là, comme OpenCPN.

import type { Cm93Feature } from './cell'
import type { Cm93Dict } from './dict'

export type AttrValue = number | string | number[]
export type Attrs = Record<string, AttrValue>

const latin1 = new TextDecoder('windows-1252')

/** Couleurs « CM93 » (attribut COLMAR) → liste de codes COULEUR S-57 (1 blanc, 2 noir, 3 rouge, 4 vert, 6 jaune, 11 orange…) */
const COLMAR: Record<number, number[]> = {
  1: [4],
  2: [2],
  3: [3],
  4: [6],
  5: [1],
  6: [11],
  7: [2, 6],
  8: [2, 6, 2],
  9: [6, 2],
  10: [6, 2, 6],
  11: [3, 1],
  12: [4, 3, 4],
  13: [3, 4, 3],
  14: [2, 3, 2],
  15: [6, 3, 6],
  16: [4, 3],
  17: [3, 4],
  18: [4, 1],
}

export function decodeAttrs(f: Cm93Feature, dict: Cm93Dict): Attrs {
  const out: Attrs = {}
  const b = f.attrs
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength)
  const cstr = (from: number): { s: string; end: number } => {
    let end = from
    while (end < b.length && b[end] !== 0) end++
    return { s: latin1.decode(b.subarray(from, end)), end: end + 1 }
  }
  let p = 0
  for (let i = 0; i < f.nAttr && p < b.length; i++) {
    const def = dict.attrs[b[p++]!]
    if (!def) break
    let value: AttrValue
    switch (def.type) {
      case 'B':
        value = b[p++]!
        break
      case 'I':
        value = dv.getInt16(p, true)
        p += 2
        break
      case 'W':
        value = dv.getUint16(p, true) / 10
        p += 2
        break
      case 'G':
        value = dv.getInt32(p, true)
        p += 4
        break
      case 'R':
        value = dv.getFloat32(p, true)
        p += 4
        break
      case 'S': {
        const c = cstr(p)
        value = c.s
        p = c.end
        break
      }
      case 'C': {
        const c = cstr(p + 3)
        value = c.s
        p = c.end
        break
      }
      case 'L': {
        const n = b[p++]!
        value = Array.from(b.subarray(p, p + n))
        p += n
        break
      }
      default:
        return out
    }
    if (p > b.length) break // valeur tronquée
    if (def.name === 'COLMAR') {
      out.COLOUR = COLMAR[value as number] ?? [value as number]
    } else if (def.name === 'QUASOU' || def.name === 'CATLIT') {
      out[def.name] = typeof value === 'number' ? [value] : value // énumération CM93, liste en S-57
    } else {
      out[def.name] = value
    }
  }
  return out
}
