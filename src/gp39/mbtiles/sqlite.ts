// Lecteur SQLite minimal en lecture seule, sans Vue ni DOM : juste ce qu'il faut pour un fichier MBTiles (tables, index, enregistrements).
//
// Un MBTiles est une base SQLite de plusieurs centaines de Mo, voire de Go : on ne la charge jamais en entier (pas de sql.js) ; on lit
// par plages d'octets (`ByteSource`) les pages dont on a besoin — en-tête, schéma, quelques pages d'index puis la page du tuile —,
// avec un petit cache de pages. Prend en charge : tables à rowid, tables WITHOUT ROWID, index, enregistrements débordant sur des pages
// de débordement (les tuiles), encodages UTF-8 et UTF-16. Pas de WAL (un fichier distribué est « checkpointé »), pas d'écriture.
//
// Format : https://www.sqlite.org/fileformat2.html

import type { ByteSource } from '../bsb/kap'

export type SqlValue = number | string | Uint8Array | null

const MAGIC = 'SQLite format 3\0'
/** Mémoire maximale des pages gardées (les pages de haut d'arbre, lues sans cesse, y restent) */
const CACHE_BYTES = 8 * 1024 * 1024

const PAGE_TABLE_LEAF = 0x0d
const PAGE_TABLE_INTERIOR = 0x05
const PAGE_INDEX_LEAF = 0x0a
const PAGE_INDEX_INTERIOR = 0x02

export class SqliteError extends Error {}

/** Position de lecture dans un tampon ; évite d'allouer un tableau par entier variable. */
interface Cur {
  buf: Uint8Array
  pos: number
}

function varint(c: Cur): number {
  let v = 0
  for (let i = 0; i < 8; i++) {
    const b = c.buf[c.pos++]!
    v = v * 128 + (b & 0x7f)
    if (!(b & 0x80)) return v
  }
  // 9e octet : 8 bits de poids faible
  return v * 256 + c.buf[c.pos++]!
}

const be16 = (b: Uint8Array, o: number): number => (b[o]! << 8) | b[o + 1]!
const be32 = (b: Uint8Array, o: number): number => ((b[o]! << 24) | (b[o + 1]! << 16) | (b[o + 2]! << 8) | b[o + 3]!) >>> 0

const utf8 = new TextDecoder('utf-8')
const utf16le = new TextDecoder('utf-16le')
const utf16be = new TextDecoder('utf-16be')

/** Ordre de SQLite : NULL < nombres < texte < blob ; texte et blob comparés octet à octet. */
export function compareValues(a: SqlValue, b: SqlValue): number {
  const rank = (v: SqlValue): number => (v === null ? 0 : typeof v === 'number' ? 1 : typeof v === 'string' ? 2 : 3)
  const ra = rank(a)
  const rb = rank(b)
  if (ra !== rb) return ra < rb ? -1 : 1
  if (ra === 1) return (a as number) < (b as number) ? -1 : (a as number) > (b as number) ? 1 : 0
  if (ra === 2) return (a as string) < (b as string) ? -1 : (a as string) > (b as string) ? 1 : 0
  if (ra === 3) {
    const x = a as Uint8Array
    const y = b as Uint8Array
    const n = Math.min(x.length, y.length)
    for (let i = 0; i < n; i++) if (x[i] !== y[i]) return x[i]! < y[i]! ? -1 : 1
    return x.length < y.length ? -1 : x.length > y.length ? 1 : 0
  }
  return 0
}

export class SqliteDb {
  private cache = new Map<number, Uint8Array>()
  private cached = 0

  private constructor(
    private readonly src: ByteSource,
    readonly pageSize: number,
    /** octets utilisables d'une page (taille − octets réservés) */
    readonly usable: number,
    private readonly encoding: number,
    readonly pageCount: number,
  ) {}

  static async open(src: ByteSource): Promise<SqliteDb> {
    const head = await src.read(0, 100)
    if (head.length < 100 || String.fromCharCode(...head.subarray(0, 16)) !== MAGIC) throw new SqliteError('Pas une base SQLite')
    const raw = be16(head, 16)
    const pageSize = raw === 1 ? 65536 : raw
    if (pageSize < 512 || (pageSize & (pageSize - 1)) !== 0) throw new SqliteError('Taille de page SQLite invalide')
    const usable = pageSize - head[20]!
    const encoding = be32(head, 56) || 1
    if (encoding < 1 || encoding > 3) throw new SqliteError('Encodage SQLite inconnu')
    return new SqliteDb(src, pageSize, usable, encoding, Math.floor(src.size / pageSize))
  }

  /** Page n (à partir de 1) */
  async page(n: number): Promise<Uint8Array> {
    const hit = this.cache.get(n)
    if (hit) {
      this.cache.delete(n) // ré-insertion : ordre d'usage
      this.cache.set(n, hit)
      return hit
    }
    if (n < 1 || n > this.pageCount) throw new SqliteError(`Page ${n} hors du fichier`)
    const buf = await this.src.read((n - 1) * this.pageSize, n * this.pageSize)
    if (buf.length !== this.pageSize) throw new SqliteError('Fichier SQLite tronqué')
    this.cache.set(n, buf)
    this.cached += buf.length
    while (this.cached > CACHE_BYTES && this.cache.size > 1) {
      const oldest = this.cache.keys().next().value as number
      this.cached -= this.cache.get(oldest)!.length
      this.cache.delete(oldest)
    }
    return buf
  }

  text(b: Uint8Array): string {
    return this.encoding === 1 ? utf8.decode(b) : this.encoding === 2 ? utf16le.decode(b) : utf16be.decode(b)
  }

  // --- cellules ----------------------------------------------------------------------------------------------------

  /** Octets de page occupés par l'en-tête de la page n (100 de plus sur la page 1 : en-tête du fichier) */
  private base(n: number): number {
    return n === 1 ? 100 : 0
  }

  private cellOffsets(page: Uint8Array, n: number): { type: number; offsets: number[]; right: number } {
    const b = this.base(n)
    const type = page[b]!
    const count = be16(page, b + 3)
    const interior = type === PAGE_TABLE_INTERIOR || type === PAGE_INDEX_INTERIOR
    if (!interior && type !== PAGE_TABLE_LEAF && type !== PAGE_INDEX_LEAF) throw new SqliteError(`Type de page B-tree inconnu (${type})`)
    const start = b + (interior ? 12 : 8)
    const offsets: number[] = []
    for (let i = 0; i < count; i++) offsets.push(be16(page, start + 2 * i))
    return { type, offsets, right: interior ? be32(page, b + 8) : 0 }
  }

  /** Partie locale d'une charge utile de `size` octets, selon le type de page (voir « Cell Format » de la spécification) */
  private localSize(size: number, leafTable: boolean): number {
    const U = this.usable
    const X = leafTable ? U - 35 : Math.floor(((U - 12) * 64) / 255) - 23
    if (size <= X) return size
    const M = Math.floor(((U - 12) * 32) / 255) - 23
    const K = M + ((size - M) % (U - 4))
    return K <= X ? K : M
  }

  /** Charge utile complète d'une cellule (suit la chaîne des pages de débordement) */
  private async payload(page: Uint8Array, start: number, size: number, leafTable: boolean): Promise<Uint8Array> {
    const local = this.localSize(size, leafTable)
    if (local === size) return page.subarray(start, start + size)
    const out = new Uint8Array(size)
    out.set(page.subarray(start, start + local))
    let got = local
    let next = be32(page, start + local)
    while (got < size) {
      if (!next) throw new SqliteError('Chaîne de débordement interrompue')
      const p = await this.page(next)
      const take = Math.min(size - got, this.usable - 4)
      out.set(p.subarray(4, 4 + take), got)
      got += take
      next = be32(p, 0)
    }
    return out
  }

  decodeRecord(buf: Uint8Array): SqlValue[] {
    const c: Cur = { buf, pos: 0 }
    const headerEnd = varint(c)
    const types: number[] = []
    while (c.pos < headerEnd) types.push(varint(c))
    const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength)
    let p = headerEnd
    const out: SqlValue[] = []
    for (const t of types) {
      if (t === 0) out.push(null)
      else if (t >= 1 && t <= 6) {
        const n = [0, 1, 2, 3, 4, 6, 8][t]!
        out.push(signed(buf, dv, p, n))
        p += n
      } else if (t === 7) {
        out.push(dv.getFloat64(p))
        p += 8
      } else if (t === 8) out.push(0)
      else if (t === 9) out.push(1)
      else if (t >= 12) {
        const len = t % 2 === 0 ? (t - 12) / 2 : (t - 13) / 2
        const slice = buf.subarray(p, p + len)
        out.push(t % 2 === 0 ? slice : this.text(slice))
        p += len
      } else throw new SqliteError('Type de colonne réservé')
    }
    return out
  }

  // --- arbres ------------------------------------------------------------------------------------------------------

  /** Enregistrement de la cellule `i` d'une page feuille de table ou d'index, ou d'une cellule intérieure d'index */
  private async cellRecord(
    page: Uint8Array,
    offset: number,
    type: number,
  ): Promise<{ rowid: number; left: number; record: SqlValue[] | null }> {
    const c: Cur = { buf: page, pos: offset }
    let left = 0
    if (type === PAGE_TABLE_INTERIOR) {
      left = be32(page, offset)
      c.pos += 4
      return { rowid: varint(c), left, record: null }
    }
    if (type === PAGE_INDEX_INTERIOR) {
      left = be32(page, offset)
      c.pos += 4
    }
    const size = varint(c)
    let rowid = 0
    if (type === PAGE_TABLE_LEAF) rowid = varint(c)
    const data = await this.payload(page, c.pos, size, type === PAGE_TABLE_LEAF)
    return { rowid, left, record: this.decodeRecord(data) }
  }

  /** Toutes les lignes d'une table à rowid (petites tables seulement : schéma, métadonnées) */
  async *scanTable(root: number): AsyncGenerator<{ rowid: number; row: SqlValue[] }> {
    const page = await this.page(root)
    const { type, offsets, right } = this.cellOffsets(page, root)
    if (type === PAGE_TABLE_LEAF) {
      for (const o of offsets) {
        const c = await this.cellRecord(page, o, type)
        yield { rowid: c.rowid, row: c.record! }
      }
    } else if (type === PAGE_TABLE_INTERIOR) {
      for (const o of offsets) yield* this.scanTable(be32(page, o))
      yield* this.scanTable(right)
    } else throw new SqliteError('Table attendue')
  }

  /** Ligne de rowid donné d'une table à rowid */
  async rowByRowid(root: number, rowid: number): Promise<SqlValue[] | null> {
    let n = root
    for (let depth = 0; depth < 32; depth++) {
      const page = await this.page(n)
      const { type, offsets, right } = this.cellOffsets(page, n)
      if (type === PAGE_TABLE_INTERIOR) {
        // clé de chaque cellule = plus grand rowid du sous-arbre de gauche
        let lo = 0
        let hi = offsets.length
        while (lo < hi) {
          const mid = (lo + hi) >> 1
          const c: Cur = { buf: page, pos: offsets[mid]! + 4 }
          if (varint(c) >= rowid) hi = mid
          else lo = mid + 1
        }
        n = lo < offsets.length ? be32(page, offsets[lo]!) : right
      } else if (type === PAGE_TABLE_LEAF) {
        let lo = 0
        let hi = offsets.length - 1
        while (lo <= hi) {
          const mid = (lo + hi) >> 1
          const c: Cur = { buf: page, pos: offsets[mid]! }
          varint(c) // taille
          const id = varint(c)
          if (id === rowid) return (await this.cellRecord(page, offsets[mid]!, type)).record
          if (id < rowid) lo = mid + 1
          else hi = mid - 1
        }
        return null
      } else throw new SqliteError('Table attendue')
    }
    throw new SqliteError('Arbre trop profond')
  }

  /**
   * Premier enregistrement d'un arbre d'index (ou d'une table WITHOUT ROWID) dont les `keys.length` premières colonnes valent `keys`.
   * Renvoie l'enregistrement entier (colonnes de l'index puis rowid ; ou toutes les colonnes d'une table WITHOUT ROWID).
   */
  async seekIndex(root: number, keys: readonly SqlValue[]): Promise<SqlValue[] | null> {
    const cmp = (rec: SqlValue[]): number => {
      for (let i = 0; i < keys.length; i++) {
        const c = compareValues(rec[i] ?? null, keys[i]!)
        if (c) return c
      }
      return 0
    }
    let n = root
    for (let depth = 0; depth < 32; depth++) {
      const page = await this.page(n)
      const { type, offsets, right } = this.cellOffsets(page, n)
      if (type === PAGE_INDEX_LEAF) {
        let lo = 0
        let hi = offsets.length - 1
        while (lo <= hi) {
          const mid = (lo + hi) >> 1
          const rec = (await this.cellRecord(page, offsets[mid]!, type)).record!
          const c = cmp(rec)
          if (c === 0) return rec
          if (c < 0) lo = mid + 1
          else hi = mid - 1
        }
        return null
      }
      if (type !== PAGE_INDEX_INTERIOR) throw new SqliteError('Index attendu')
      // première cellule dont la clé est ≥ à la recherchée ; une cellule intérieure d'index porte elle-même une entrée
      let lo = 0
      let hi = offsets.length
      let found: { left: number } | null = null
      while (lo < hi) {
        const mid = (lo + hi) >> 1
        const cell = await this.cellRecord(page, offsets[mid]!, type)
        const c = cmp(cell.record!)
        if (c === 0) return cell.record
        if (c > 0) {
          hi = mid
          found = cell
        } else lo = mid + 1
      }
      n = found ? found.left : right
    }
    throw new SqliteError('Arbre trop profond')
  }

  /** Premier (`last` faux) ou dernier enregistrement d'un arbre d'index */
  async indexEdge(root: number, last: boolean): Promise<SqlValue[] | null> {
    let n = root
    for (let depth = 0; depth < 32; depth++) {
      const page = await this.page(n)
      const { type, offsets, right } = this.cellOffsets(page, n)
      if (type === PAGE_INDEX_LEAF) {
        if (!offsets.length) return null
        return (await this.cellRecord(page, offsets[last ? offsets.length - 1 : 0]!, type)).record
      }
      if (type !== PAGE_INDEX_INTERIOR) throw new SqliteError('Index attendu')
      n = last ? right : be32(page, offsets[0]!)
    }
    throw new SqliteError('Arbre trop profond')
  }
}

/** Entier signé de n octets (1, 2, 3, 4, 6 ou 8), grand-boutiste */
function signed(buf: Uint8Array, dv: DataView, p: number, n: number): number {
  if (n === 8) return Number(dv.getBigInt64(p))
  let v = 0
  for (let i = 0; i < n; i++) v = v * 256 + buf[p + i]!
  const limit = 2 ** (8 * n - 1)
  return v >= limit ? v - 2 * limit : v
}

// --- schéma ------------------------------------------------------------------------------------------------------------

export interface TableDef {
  name: string
  root: number
  isView: boolean
  sql: string
  /** noms des colonnes déclarées, dans l'ordre de la table */
  columns: string[]
  withoutRowid: boolean
  /** clé primaire déclarée (noms de colonnes) */
  pk: string[]
  /** INTEGER PRIMARY KEY : alias du rowid */
  rowidAlias: string | null
  /** contraintes UNIQUE / PRIMARY KEY dans l'ordre de déclaration (pour les index automatiques) */
  uniques: string[][]
}

export interface IndexDef {
  name: string
  table: string
  root: number
  columns: string[]
}

export interface Schema {
  tables: Map<string, TableDef>
  indexes: IndexDef[]
}

const unquote = (s: string): string => s.trim().replace(/^["'`[]|["'`\]]$/g, '')

/** Découpe une liste séparée par des virgules en respectant parenthèses et guillemets */
function splitTop(s: string): string[] {
  const out: string[] = []
  let depth = 0
  let quote = ''
  let cur = ''
  for (const ch of s) {
    if (quote) {
      cur += ch
      if (ch === quote) quote = ''
    } else if (ch === '"' || ch === "'" || ch === '`') {
      quote = ch
      cur += ch
    } else if (ch === '(') {
      depth++
      cur += ch
    } else if (ch === ')') {
      depth--
      cur += ch
    } else if (ch === ',' && depth === 0) {
      out.push(cur)
      cur = ''
    } else cur += ch
  }
  if (cur.trim()) out.push(cur)
  return out
}

const columnList = (s: string): string[] => splitTop(s).map((c) => unquote(c.trim().split(/\s+/)[0] ?? ''))

function parseTable(name: string, root: number, sql: string, isView: boolean): TableDef {
  const def: TableDef = { name, root, isView, sql, columns: [], withoutRowid: false, pk: [], rowidAlias: null, uniques: [] }
  if (isView) return def
  const open = sql.indexOf('(')
  const close = sql.lastIndexOf(')')
  if (open < 0 || close < open) return def
  def.withoutRowid = /\)\s*WITHOUT\s+ROWID/i.test(sql.slice(close))
  for (const part of splitTop(sql.slice(open + 1, close))) {
    const p = part.trim()
    const constraint = /^(?:CONSTRAINT\s+\S+\s+)?(PRIMARY\s+KEY|UNIQUE)\s*\(([^)]*)\)/i.exec(p)
    if (constraint) {
      const cols = columnList(constraint[2]!)
      const isPk = /PRIMARY/i.test(constraint[1]!)
      if (isPk) def.pk = cols
      if (!(isPk && def.withoutRowid)) def.uniques.push(cols) // la clé d'une table WITHOUT ROWID n'a pas d'index automatique
      continue
    }
    if (/^(?:CONSTRAINT|FOREIGN|CHECK)\b/i.test(p)) continue
    const col = unquote(p.split(/\s+/)[0] ?? '')
    if (!col) continue
    def.columns.push(col)
    if (/\bPRIMARY\s+KEY\b/i.test(p)) {
      def.pk = [col]
      if (!def.withoutRowid && /^\S+\s+INTEGER\b/i.test(p)) def.rowidAlias = col
      else def.uniques.push([col])
    } else if (/\bUNIQUE\b/i.test(p)) def.uniques.push([col])
  }
  return def
}

/** Lit sqlite_master (table à rowid, racine page 1) : tables, vues et index. */
export async function readSchema(db: SqliteDb): Promise<Schema> {
  const tables = new Map<string, TableDef>()
  const rawIndexes: { name: string; table: string; root: number; sql: string | null }[] = []
  for await (const { row } of db.scanTable(1)) {
    const [type, name, tbl, root, sql] = row as [string, string, string, number, string | null]
    if (type === 'table') tables.set(name, parseTable(name, root, sql ?? '', false))
    else if (type === 'view') tables.set(name, parseTable(name, 0, sql ?? '', true))
    else if (type === 'index') rawIndexes.push({ name, table: tbl, root, sql })
  }
  const indexes: IndexDef[] = []
  for (const r of rawIndexes) {
    if (r.sql) {
      const m = /\bON\s+("[^"]+"|`[^`]+`|\[[^\]]+\]|\S+?)\s*\((.*)\)/is.exec(r.sql)
      if (!m) continue
      const cols = splitTop(m[2]!).map((c) => unquote(c.trim().split(/\s+/)[0] ?? ''))
      indexes.push({ name: r.name, table: unquote(m[1]!), root: r.root, columns: cols })
    } else {
      // index automatique d'une contrainte UNIQUE / PRIMARY KEY : sqlite_autoindex_<table>_<n>
      const m = /^sqlite_autoindex_(.+)_(\d+)$/.exec(r.name)
      const t = m ? tables.get(m[1]!) : undefined
      const cols = t?.uniques[Number(m![2]) - 1]
      if (t && cols) indexes.push({ name: r.name, table: t.name, root: r.root, columns: cols })
    }
  }
  return { tables, indexes }
}
