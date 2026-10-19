// Fabrique de fichiers MBTiles synthétiques pour les tests, avec le vrai SQLite de Node (`node:sqlite`) : le lecteur est ainsi éprouvé
// sur des fichiers écrits par SQLite lui-même (pages de débordement, arbres à plusieurs niveaux, index automatiques, WITHOUT ROWID…).
// Aucune vraie carte n'est versionnée dans le dépôt.
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

export type Layout = 'index' | 'unique' | 'pk' | 'withoutrowid' | 'mapimages' | 'noindex'

export interface TileRow {
  z: number
  x: number
  /** ligne TMS (0 au sud) */
  row: number
  data: Uint8Array
}

export interface BuildOptions {
  layout?: Layout
  pageSize?: number
  tiles: TileRow[]
  /** null : pas de table metadata */
  metadata?: Record<string, string> | null
}

export const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]

/** Données de tuile reconnaissables : signature PNG puis octets déterminés par (z, x, row), `size` octets au total. */
export function fakeTile(z: number, x: number, row: number, size: number, magic: number[] = PNG_MAGIC): Uint8Array {
  const out = new Uint8Array(Math.max(size, magic.length + 3))
  out.set(magic)
  let h = (z * 73856093) ^ (x * 19349663) ^ (row * 83492791)
  for (let i = magic.length; i < out.length; i++) {
    h = (Math.imul(h, 1664525) + 1013904223) | 0
    out[i] = (h >>> 24) & 0xff
  }
  return out
}

export function buildMbtiles(o: BuildOptions): Uint8Array<ArrayBuffer> {
  const layout = o.layout ?? 'index'
  const dir = mkdtempSync(join(tmpdir(), 'mbt-'))
  const path = join(dir, 'test.mbtiles')
  try {
    const db = new DatabaseSync(path)
    if (o.pageSize) db.exec(`PRAGMA page_size = ${o.pageSize}`)
    if (o.metadata !== null) {
      db.exec('CREATE TABLE metadata (name TEXT, value TEXT)')
      const ins = db.prepare('INSERT INTO metadata VALUES (?, ?)')
      for (const [k, v] of Object.entries(o.metadata ?? {})) ins.run(k, v)
    }
    db.exec('BEGIN')
    if (layout === 'mapimages') {
      db.exec('CREATE TABLE map (zoom_level INTEGER, tile_column INTEGER, tile_row INTEGER, tile_id TEXT)')
      db.exec('CREATE TABLE images (tile_data BLOB, tile_id TEXT)')
      const ids = new Map<string, string>()
      const insImg = db.prepare('INSERT INTO images VALUES (?, ?)')
      const insMap = db.prepare('INSERT INTO map VALUES (?, ?, ?, ?)')
      for (const t of o.tiles) {
        const key = Buffer.from(t.data).toString('base64')
        let id = ids.get(key)
        if (!id) {
          id = `img${ids.size}`
          ids.set(key, id)
          insImg.run(t.data, id)
        }
        insMap.run(t.z, t.x, t.row, id)
      }
      db.exec('CREATE UNIQUE INDEX map_index ON map (zoom_level, tile_column, tile_row)')
      db.exec('CREATE UNIQUE INDEX images_id ON images (tile_id)')
      db.exec(
        'CREATE VIEW tiles AS SELECT map.zoom_level AS zoom_level, map.tile_column AS tile_column, map.tile_row AS tile_row, images.tile_data AS tile_data FROM map JOIN images ON images.tile_id = map.tile_id',
      )
    } else {
      const cols = 'zoom_level INTEGER, tile_column INTEGER, tile_row INTEGER, tile_data BLOB'
      const key = '(zoom_level, tile_column, tile_row)'
      if (layout === 'unique') db.exec(`CREATE TABLE tiles (${cols}, UNIQUE ${key})`)
      else if (layout === 'pk') db.exec(`CREATE TABLE tiles (${cols}, PRIMARY KEY ${key})`)
      else if (layout === 'withoutrowid') db.exec(`CREATE TABLE tiles (${cols}, PRIMARY KEY ${key}) WITHOUT ROWID`)
      else db.exec(`CREATE TABLE tiles (${cols})`)
      const ins = db.prepare('INSERT INTO tiles VALUES (?, ?, ?, ?)')
      for (const t of o.tiles) ins.run(t.z, t.x, t.row, t.data)
      if (layout === 'index') db.exec(`CREATE UNIQUE INDEX tile_index ON tiles ${key}`)
    }
    db.exec('COMMIT')
    db.close()
    const bytes = readFileSync(path)
    return new Uint8Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}
