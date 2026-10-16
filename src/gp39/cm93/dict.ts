// Dictionnaires d'une collection CM93 (CM93OBJ.DIC et CM93ATTR.DIC, fournis avec les cartes, au texte clair) : numéro de classe
// d'objet → nom S-57 (6 lettres) et type de géométrie, numéro d'attribut → nom et type de valeur.

/** I entier court (jamais vu), B octet, W mot ÷ 10, G entier 32 bits, S chaîne, C complexe (3 octets + chaîne), L liste d'octets, R flottant */
export type AttrType = 'I' | 'B' | 'W' | 'G' | 'S' | 'C' | 'L' | 'R' | '?'

export interface ClassDef {
  name: string
  /** première lettre du champ géométrie : P (point), L (ligne), A (surface), S (sondes), C (texte « C-MAP »)… */
  geom: string
}
export interface AttrDef {
  name: string
  type: AttrType
}

export interface Cm93Dict {
  classes: (ClassDef | undefined)[]
  attrs: (AttrDef | undefined)[]
}

const TYPE_OF: Record<string, AttrType> = {
  aFLOAT: 'R',
  aBYTE: 'B',
  aSTRING: 'S',
  aCMPLX: 'C',
  aLIST: 'L',
  aWORD10: 'W',
  aLONG: 'G',
}

const lines = (text: string): string[][] =>
  text
    .split(/\r?\n/)
    .filter((l) => l.trim() !== '' && !l.startsWith(';'))
    .map((l) => l.split('|').map((t) => t.trim()))

export function parseDictionaries(objText: string, attrText: string): Cm93Dict {
  const classes: (ClassDef | undefined)[] = []
  for (const t of lines(objText)) {
    const n = Number.parseInt(t[1] ?? '', 10)
    if (t[0] && Number.isFinite(n) && n >= 0) classes[n] = { name: t[0], geom: (t[2] ?? '')[0] ?? '' }
  }
  const attrs: (AttrDef | undefined)[] = []
  for (const t of lines(attrText)) {
    const n = Number.parseInt(t[1] ?? '', 10)
    if (!t[0] || !Number.isFinite(n) || n < 0) continue
    const type = t.slice(2).find((x) => x in TYPE_OF)
    attrs[n] = { name: t[0], type: type ? TYPE_OF[type]! : '?' }
  }
  return { classes, attrs }
}

export const isDictionaryName = (name: string): 'obj' | 'attr' | null => {
  const n = name.toLowerCase()
  return n === 'cm93obj.dic' ? 'obj' : n === 'cm93attr.dic' ? 'attr' : null
}
