// Fichier MBTiles (spécification : https://github.com/mapbox/mbtiles-spec) : tuiles raster ou vectorielles rangées dans une base SQLite.
//
// Tables : `metadata` (name, format, bounds, minzoom, maxzoom, attribution…) et `tiles` (zoom_level, tile_column, tile_row, tile_data) ;
// la ligne est numérotée à l'envers (schéma TMS, l'origine est au sud). Les fichiers de MBUtil ou de MapTiler rangent à la place les
// images dans `images (tile_id, tile_data)` reliées par `map (zoom_level, tile_column, tile_row, tile_id)` — `tiles` n'est alors qu'une
// vue — pour ne stocker qu'une fois les tuiles identiques. Les deux organisations sont prises en charge, avec ou sans WITHOUT ROWID.

import type { ByteSource } from '../bsb/kap'
import { SqliteDb, SqliteError, readSchema, type IndexDef, type Schema, type SqlValue, type TableDef } from './sqlite'

export type TileFormat = 'png' | 'jpg' | 'webp' | 'pbf' | 'unknown'

export interface MbtilesInfo {
  name: string
  format: TileFormat
  minzoom: number
  maxzoom: number
  /** emprise WGS84 : [ouest, sud, est, nord] */
  bounds: [number, number, number, number]
  attribution: string
  description: string
  /** « overlay » : couche transparente à poser sur un fond ; « baselayer » : fond complet */
  type: string
  /** `tms` (norme) : ligne 0 au sud ; `xyz` : ligne 0 au nord (fichiers non conformes) */
  scheme: 'tms' | 'xyz'
}

const WORLD: [number, number, number, number] = [-180, -85.0511287798, 180, 85.0511287798]
const num = (v: SqlValue | undefined): number | undefined => {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN
  return Number.isFinite(n) ? n : undefined
}

/** Format d'une tuile d'après ses premiers octets (la métadonnée `format` est parfois fausse ou absente). */
export function sniffFormat(b: Uint8Array): TileFormat {
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'png'
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpg'
  if (
    b.length >= 12 &&
    b[0] === 0x52 &&
    b[1] === 0x49 &&
    b[2] === 0x46 &&
    b[3] === 0x46 &&
    b[8] === 0x57 &&
    b[9] === 0x45 &&
    b[10] === 0x42 &&
    b[11] === 0x50
  )
    return 'webp'
  if (b.length >= 2 && b[0] === 0x1f && b[1] === 0x8b) return 'pbf' // tuile vectorielle compressée
  return 'unknown'
}

export const MIME: Record<TileFormat, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  webp: 'image/webp',
  pbf: 'application/x-protobuf',
  unknown: '',
}

function formatOf(s: string | undefined): TileFormat {
  const f = (s ?? '').toLowerCase()
  return f === 'png' ? 'png' : f === 'jpg' || f === 'jpeg' ? 'jpg' : f === 'webp' ? 'webp' : f === 'pbf' || f === 'mvt' ? 'pbf' : 'unknown'
}

/** Colonnes physiquement stockées d'une table : celles d'une table WITHOUT ROWID commencent par la clé primaire. */
function storedColumns(t: TableDef): string[] {
  if (!t.withoutRowid) return t.columns
  return [...t.pk, ...t.columns.filter((c) => !t.pk.includes(c))]
}

/**
 * Recherche d'une ligne par clé dans une table : directement si c'est une table WITHOUT ROWID dont la clé commence par `keyCols`,
 * sinon par un index commençant par `keyCols` puis lecture de la ligne par son rowid.
 */
class Finder {
  private constructor(
    private readonly db: SqliteDb,
    private readonly table: TableDef,
    /** racine de l'arbre à chercher (index, ou table WITHOUT ROWID) */
    private readonly root: number,
    private readonly viaIndex: boolean,
  ) {}

  static make(db: SqliteDb, schema: Schema, table: TableDef, keyCols: string[]): Finder | null {
    const starts = (cols: string[]): boolean => keyCols.every((c, i) => cols[i] === c)
    if (table.withoutRowid && starts(table.pk)) return new Finder(db, table, table.root, false)
    const idx = schema.indexes.find((i: IndexDef) => i.table === table.name && starts(i.columns))
    return idx ? new Finder(db, table, idx.root, true) : null
  }

  /** Valeurs de la ligne (colonnes dans l'ordre de `columns`), ou null */
  async get(keys: SqlValue[]): Promise<{ values: SqlValue[]; columns: string[] } | null> {
    const rec = await this.db.seekIndex(this.root, keys)
    if (!rec) return null
    if (!this.viaIndex) return { values: rec, columns: storedColumns(this.table) }
    const rowid = rec[rec.length - 1]
    if (typeof rowid !== 'number') return null
    const row = await this.db.rowByRowid(this.table.root, rowid)
    if (!row) return null
    // la colonne alias du rowid est stockée à NULL
    const values = row.map((v, i) => (this.table.columns[i] === this.table.rowidAlias ? rowid : v))
    return { values, columns: this.table.columns }
  }

  /** Première colonne de l'arbre (zoom_level pour l'index des tuiles) : valeurs extrêmes */
  async edge(last: boolean): Promise<SqlValue | null> {
    const rec = await this.db.indexEdge(this.root, last)
    return rec ? (rec[0] ?? null) : null
  }
}

const pick = (r: { values: SqlValue[]; columns: string[] }, col: string): SqlValue | undefined => r.values[r.columns.indexOf(col)]

const KEY = ['zoom_level', 'tile_column', 'tile_row']

export class Mbtiles {
  private constructor(
    private readonly db: SqliteDb,
    readonly info: MbtilesInfo,
    private readonly tiles: Finder,
    private readonly images: Finder | null,
  ) {}

  static async open(src: ByteSource): Promise<Mbtiles> {
    const db = await SqliteDb.open(src)
    const schema = await readSchema(db)

    // métadonnées
    const meta = new Map<string, string>()
    const mt = schema.tables.get('metadata')
    if (mt && !mt.isView) {
      const nameAt = Math.max(0, mt.columns.indexOf('name'))
      const valueAt = mt.columns.indexOf('value') >= 0 ? mt.columns.indexOf('value') : 1
      for await (const { row } of db.scanTable(mt.root)) {
        const k = row[nameAt]
        const v = row[valueAt]
        if (typeof k === 'string' && v !== null && v !== undefined)
          meta.set(k, typeof v === 'string' ? v : typeof v === 'number' ? String(v) : db.text(v))
      }
    }

    // où sont les tuiles
    const tilesDef = schema.tables.get('tiles')
    if (!tilesDef) throw new SqliteError('MBTiles sans table « tiles »')
    let tiles: Finder | null
    let images: Finder | null = null
    if (tilesDef.isView) {
      const map = schema.tables.get('map')
      const img = schema.tables.get('images')
      if (!map || !img || map.isView || img.isView) throw new SqliteError('Vue « tiles » non reconnue (tables map / images attendues)')
      tiles = Finder.make(db, schema, map, KEY)
      images = Finder.make(db, schema, img, ['tile_id'])
      if (!images) throw new SqliteError('Table « images » sans index sur tile_id')
    } else {
      tiles = Finder.make(db, schema, tilesDef, KEY)
    }
    if (!tiles) throw new SqliteError('MBTiles sans index sur (zoom_level, tile_column, tile_row) : lecture trop lente, fichier ignoré')

    // zooms : métadonnées, à défaut extrêmes de l'index
    let minzoom = num(meta.get('minzoom'))
    let maxzoom = num(meta.get('maxzoom'))
    if (minzoom === undefined) minzoom = num((await tiles.edge(false)) ?? undefined) ?? 0
    if (maxzoom === undefined) maxzoom = num((await tiles.edge(true)) ?? undefined) ?? 22

    const b = (meta.get('bounds') ?? '').split(',').map(Number)
    const bounds =
      b.length === 4 && b.every(Number.isFinite) && b[0]! < b[2]! && b[1]! < b[3]! ? (b as [number, number, number, number]) : WORLD

    const info: MbtilesInfo = {
      name: meta.get('name') ?? '',
      format: formatOf(meta.get('format')),
      minzoom,
      maxzoom,
      bounds,
      attribution: meta.get('attribution') ?? '',
      description: meta.get('description') ?? '',
      type: meta.get('type') ?? '',
      scheme: (meta.get('scheme') ?? '').toLowerCase() === 'xyz' ? 'xyz' : 'tms',
    }
    return new Mbtiles(db, info, tiles, images)
  }

  /** Octets de la tuile (z, colonne, ligne TMS) ou null s'il n'y en a pas (zone sans données). */
  async getTile(z: number, column: number, tmsRow: number): Promise<Uint8Array | null> {
    const hit = await this.tiles.get([z, column, tmsRow])
    if (!hit) return null
    let data: SqlValue | undefined
    if (this.images) {
      const id = pick(hit, 'tile_id')
      if (id === null || id === undefined) return null
      const img = await this.images.get([id])
      data = img ? pick(img, 'tile_data') : undefined
    } else data = pick(hit, 'tile_data')
    return data instanceof Uint8Array ? data.slice() : null
  }

  /** Ligne de la tuile (x, y) du schéma XYZ de Leaflet / Google, selon le schéma du fichier. */
  async getXyz(z: number, x: number, y: number): Promise<Uint8Array | null> {
    return this.getTile(z, x, this.info.scheme === 'tms' ? 2 ** z - 1 - y : y)
  }
}
