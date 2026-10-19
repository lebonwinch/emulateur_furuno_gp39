// Cartes MBTiles : lecteur SQLite, lecture des tuiles, choix des fichiers selon le zoom, dessin, catalogue, reconnaissance du dossier,
// moteur — fichiers fabriqués par le vrai SQLite de Node.
import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import { PNG_MAGIC, buildMbtiles, fakeTile, type Layout, type TileRow } from './helpers/mbtilesBuilder'
import { bufferSource } from '../bsb/kap'
import { Mbtiles, sniffFormat } from '../mbtiles/mbtiles'
import { SqliteDb, SqliteError, compareValues, readSchema } from '../mbtiles/sqlite'
import { MAX_FILES_PER_TILE, MAX_OVERZOOM, mbtilesRank, planMbtiles, type MbEntry } from '../mbtiles/plan'
import { MbtilesRenderer, type Bitmap, type MbJob } from '../mbtiles/render'
import { attributionHtml, scanMbtiles, unusable } from '../mbtiles/catalog'
import { CM93_RANK, bsbRank, stackOrder, type TilePart } from '../tileCompose'
import { MbtilesEngine, type MbRunner } from '../mbtiles/engine'
import { formatsOf, listFolder, listFromFileList } from '../library'
import type { ChartFileRef, DirHandleLike } from '../bsb/catalog'
import type { Canvas2D } from '../canvas'

/** tuile XYZ qui contient un point */
const tileAt = (lat: number, lon: number, z: number): { x: number; y: number; row: number } => {
  const n = 2 ** z
  const r = (lat * Math.PI) / 180
  const y = Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n)
  return { x: Math.floor(((lon + 180) / 360) * n), y, row: n - 1 - y }
}

const META = {
  name: 'Essai',
  format: 'png',
  bounds: '-5,48,-4,49',
  minzoom: '8',
  maxzoom: '12',
  attribution: 'Données d’essai',
  type: 'baselayer',
}

/** tuiles variées : tailles de 20 octets à 7 Ko (donc des pages de débordement), sur trois niveaux de zoom */
function someTiles(n = 300): TileRow[] {
  const out: TileRow[] = []
  for (let i = 0; i < n; i++) {
    const z = 8 + (i % 3)
    const x = 100 + Math.floor(i / 3)
    const row = 200 + ((i * 7) % 50)
    const size = i % 11 === 0 ? 7000 : i % 5 === 0 ? 1800 : 20 + ((i * 37) % 400)
    out.push({ z, x, row, data: fakeTile(z, x, row, size) })
  }
  // on évite les doublons de clé
  const seen = new Set<string>()
  return out.filter((t) => !seen.has(`${t.z}/${t.x}/${t.row}`) && !!seen.add(`${t.z}/${t.x}/${t.row}`))
}

describe('SQLite minimal', () => {
  it('compare comme SQLite : NULL < nombres < texte < blob', () => {
    expect(compareValues(null, 0)).toBeLessThan(0)
    expect(compareValues(5, 'a')).toBeLessThan(0)
    expect(compareValues('z', new Uint8Array([0]))).toBeLessThan(0)
    expect(compareValues(2, 10)).toBeLessThan(0)
    expect(compareValues('b', 'a')).toBeGreaterThan(0)
    expect(compareValues(new Uint8Array([1, 2]), new Uint8Array([1, 2, 0]))).toBeLessThan(0)
    expect(compareValues(3, 3)).toBe(0)
  })

  it('refuse un fichier qui n’est pas une base SQLite', async () => {
    await expect(SqliteDb.open(bufferSource(new Uint8Array(500)))).rejects.toThrow(SqliteError)
    await expect(SqliteDb.open(bufferSource(new TextEncoder().encode('pas une base')))).rejects.toThrow()
  })

  it('lit le schéma : tables, vues, index (explicites et automatiques), WITHOUT ROWID', async () => {
    const db = await SqliteDb.open(bufferSource(buildMbtiles({ layout: 'unique', tiles: someTiles(10), metadata: META })))
    const s = await readSchema(db)
    expect([...s.tables.keys()].sort()).toEqual(['metadata', 'tiles'])
    expect(s.tables.get('tiles')!.columns).toEqual(['zoom_level', 'tile_column', 'tile_row', 'tile_data'])
    expect(s.indexes.map((i) => [i.table, i.columns])).toEqual([['tiles', ['zoom_level', 'tile_column', 'tile_row']]])

    const w = await readSchema(await SqliteDb.open(bufferSource(buildMbtiles({ layout: 'withoutrowid', tiles: someTiles(10) }))))
    expect(w.tables.get('tiles')!.withoutRowid).toBe(true)
    expect(w.tables.get('tiles')!.pk).toEqual(['zoom_level', 'tile_column', 'tile_row'])
    expect(w.indexes).toHaveLength(0)

    const m = await readSchema(await SqliteDb.open(bufferSource(buildMbtiles({ layout: 'mapimages', tiles: someTiles(10) }))))
    expect(m.tables.get('tiles')!.isView).toBe(true)
    expect(m.indexes.map((i) => i.name).sort()).toEqual(['images_id', 'map_index'])
  })
})

describe('MBTiles — lecture des tuiles', () => {
  const layouts: Layout[] = ['index', 'unique', 'pk', 'withoutrowid', 'mapimages']
  for (const layout of layouts) {
    for (const pageSize of [512, 4096, 65536]) {
      it(`${layout}, pages de ${pageSize} octets : toutes les tuiles (grosses comprises) se retrouvent, les absentes donnent null`, async () => {
        const tiles = someTiles()
        const mb = await Mbtiles.open(bufferSource(buildMbtiles({ layout, pageSize, tiles, metadata: META })))
        for (const t of tiles) {
          const got = await mb.getTile(t.z, t.x, t.row)
          expect(got, `${t.z}/${t.x}/${t.row}`).not.toBeNull()
          expect(got!.length).toBe(t.data.length)
          expect(Buffer.from(got!).equals(Buffer.from(t.data))).toBe(true)
        }
        expect(await mb.getTile(8, 100, 999)).toBeNull()
        expect(await mb.getTile(3, 1, 1)).toBeNull()
        expect(await mb.getTile(99, 99999, 1)).toBeNull()
      })
    }
  }

  it('tuiles identiques stockées une seule fois (map + images) : chaque position retrouve la bonne image', async () => {
    const same = fakeTile(9, 1, 1, 600)
    const tiles: TileRow[] = [
      { z: 9, x: 1, y: 0, row: 1, data: same },
      { z: 9, x: 2, y: 0, row: 1, data: same },
      { z: 9, x: 3, y: 0, row: 1, data: fakeTile(9, 3, 1, 90) },
    ].map(({ y: _y, ...t }) => t)
    const mb = await Mbtiles.open(bufferSource(buildMbtiles({ layout: 'mapimages', tiles, metadata: META })))
    expect(Buffer.from((await mb.getTile(9, 2, 1))!).equals(Buffer.from(same))).toBe(true)
    expect((await mb.getTile(9, 3, 1))!.length).toBe(90)
  })

  it('numérotation des lignes : TMS (0 au sud) par défaut, XYZ si les métadonnées le disent', async () => {
    const tile = fakeTile(2, 1, 3, 40)
    const tms = await Mbtiles.open(bufferSource(buildMbtiles({ tiles: [{ z: 2, x: 1, row: 3, data: tile }], metadata: META })))
    // ligne TMS 3 au zoom 2 = ligne XYZ 0 (la plus au nord)
    expect(await tms.getXyz(2, 1, 0)).not.toBeNull()
    expect(await tms.getXyz(2, 1, 3)).toBeNull()
    const xyz = await Mbtiles.open(
      bufferSource(buildMbtiles({ tiles: [{ z: 2, x: 1, row: 3, data: tile }], metadata: { ...META, scheme: 'xyz' } })),
    )
    expect(await xyz.getXyz(2, 1, 3)).not.toBeNull()
    expect(xyz.info.scheme).toBe('xyz')
  })

  it('métadonnées : nom, format, zooms, emprise, attribution', async () => {
    const mb = await Mbtiles.open(bufferSource(buildMbtiles({ tiles: someTiles(20), metadata: META })))
    expect(mb.info).toMatchObject({
      name: 'Essai',
      format: 'png',
      minzoom: 8,
      maxzoom: 12,
      bounds: [-5, 48, -4, 49],
      attribution: 'Données d’essai',
      type: 'baselayer',
      scheme: 'tms',
    })
  })

  it('métadonnées absentes : zooms déduits de l’index, emprise = le monde', async () => {
    const mb = await Mbtiles.open(bufferSource(buildMbtiles({ tiles: someTiles(60), metadata: null })))
    expect(mb.info.minzoom).toBe(8)
    expect(mb.info.maxzoom).toBe(10)
    expect(mb.info.bounds[0]).toBe(-180)
    expect(mb.info.bounds[2]).toBe(180)
    expect(mb.info.format).toBe('unknown')
  })

  it('refuse un fichier sans index sur (zoom_level, tile_column, tile_row) : lecture trop lente', async () => {
    await expect(Mbtiles.open(bufferSource(buildMbtiles({ layout: 'noindex', tiles: someTiles(10), metadata: META })))).rejects.toThrow(
      /index/,
    )
  })

  it('reconnaît le format d’une tuile d’après ses octets', () => {
    expect(sniffFormat(Uint8Array.from(PNG_MAGIC))).toBe('png')
    expect(sniffFormat(Uint8Array.from([0xff, 0xd8, 0xff, 0xe0]))).toBe('jpg')
    expect(sniffFormat(new TextEncoder().encode('RIFF\0\0\0\0WEBPVP8 '))).toBe('webp')
    expect(sniffFormat(Uint8Array.from([0x1f, 0x8b, 8]))).toBe('pbf')
    expect(sniffFormat(Uint8Array.from([1, 2, 3]))).toBe('unknown')
  })
})

describe('MBTiles — choix des fichiers pour une tuile', () => {
  const entry = (id: string, minzoom: number, maxzoom: number, bounds: [number, number, number, number] = [-6, 47, -3, 49]): MbEntry => ({
    id,
    info: { name: id, format: 'png', minzoom, maxzoom, bounds, attribution: '', description: '', type: '', scheme: 'tms' },
  })
  // zoom 10 au-dessus de Brest (48.4, −4.5)
  const brest = { z: 10, ...tileAt(48.4, -4.5, 10) }

  it('les fichiers natifs d’abord, le plus détaillé en tête, puis les fichiers à agrandir, le moins agrandi d’abord', () => {
    const plan = planMbtiles(
      [entry('b-large', 4, 12), entry('c-fin', 9, 16), entry('a-petit', 4, 8), entry('d-tres-petit', 4, 6)],
      brest.z,
      brest.x,
      brest.y,
    )
    expect(plan).toEqual([
      { id: 'c-fin', dz: 0 },
      { id: 'b-large', dz: 0 },
      { id: 'a-petit', dz: 2 },
      { id: 'd-tres-petit', dz: 4 },
    ])
  })

  it('ignore ce qui est hors emprise, sous son zoom minimal ou trop agrandi', () => {
    expect(planMbtiles([entry('ailleurs', 4, 16, [10, 40, 12, 42])], brest.z, brest.x, brest.y)).toEqual([])
    expect(planMbtiles([entry('fin', 11, 16)], brest.z, brest.x, brest.y)).toEqual([])
    expect(planMbtiles([entry('trop-petit', 2, 10 - MAX_OVERZOOM - 1)], brest.z, brest.x, brest.y)).toEqual([])
    expect(planMbtiles([entry('limite', 2, 10 - MAX_OVERZOOM)], brest.z, brest.x, brest.y)).toEqual([{ id: 'limite', dz: MAX_OVERZOOM }])
  })

  it('au plus quelques fichiers par tuile', () => {
    const many = Array.from({ length: 20 }, (_, i) => entry(`f${String(i).padStart(2, '0')}`, 4, 14))
    expect(planMbtiles(many, brest.z, brest.x, brest.y)).toHaveLength(MAX_FILES_PER_TILE)
  })

  it('rang de qualité : natif devant, agrandi derrière', () => {
    expect(mbtilesRank(0)).toBeLessThan(mbtilesRank(1))
    expect(mbtilesRank(1)).toBeLessThan(mbtilesRank(2))
    expect(mbtilesRank(0)).toBeLessThan(1)
    expect(mbtilesRank(2)).toBeGreaterThan(1.5) // derrière les cartes vectorielles
  })
})

// --- dessin -------------------------------------------------------------------------------------------------------------

interface Rec {
  log: string[]
  draws: number[][]
  make: (w: number, h: number) => Canvas2D
}

/** Faux canevas : enregistre les `drawImage` ; `opaque` fait croire que tout est déjà peint. */
function recorder(opaque: boolean): Rec {
  const r: Rec = {
    log: [],
    draws: [],
    make: (w, h) => {
      const ctx = new Proxy(
        {},
        {
          get: (_t, p) => {
            if (p === 'getImageData') return () => ({ data: new Uint8ClampedArray(w * h * 4).fill(opaque ? 255 : 0) })
            if (p === 'drawImage') return (_img: unknown, ...a: number[]) => void r.draws.push(a)
            return () => undefined
          },
          set: (_t, p, v) => {
            r.log.push(`${String(p)}=${String(v)}`)
            return true
          },
        },
      )
      return { width: w, height: h, getContext: () => ctx as never }
    },
  }
  return r
}

const decode = (size = 256): ((b: Uint8Array) => Promise<Bitmap>) =>
  vi.fn(async () => ({ width: size, height: size, image: {} as CanvasImageSource }))

describe('MBTiles — tuile', () => {
  const file = (tiles: TileRow[], meta = META): Blob => new Blob([buildMbtiles({ tiles, metadata: meta })])

  it('dessine la tuile native à pleine taille', async () => {
    const rec = recorder(false)
    const dec = decode()
    const r = new MbtilesRenderer(rec.make, dec)
    const job: MbJob = {
      z: 10,
      x: 505,
      y: 357,
      k: 1,
      sources: [{ id: 'a', dz: 0, file: file([{ z: 10, x: 505, row: 666, data: fakeTile(10, 505, 666, 300) }]) }],
    }
    const res = await r.render(job)
    expect(res.used).toEqual(['a'])
    expect(res.best).toBe(0)
    expect(res.size).toBe(256)
    expect(res.pixels).toHaveLength(256 * 256)
    expect(rec.log).toContain('globalCompositeOperation=destination-over')
    expect(rec.draws[0]).toEqual([0, 0, 256, 256])
  })

  it('agrandit la bonne partie de la tuile du dernier zoom du fichier', async () => {
    const rec = recorder(false)
    const r = new MbtilesRenderer(rec.make, decode(256))
    // tuile 12/2021/1429 = enfant (1, 1) de la tuile 10/505/357 agrandie deux fois (2^2 = 4 sous-tuiles par côté)
    const res = await r.render({
      z: 12,
      x: 2022,
      y: 1429,
      k: 1,
      sources: [{ id: 'a', dz: 2, file: file([{ z: 10, x: 505, row: 666, data: fakeTile(10, 505, 666, 300) }]) }],
    })
    expect(res.best).toBe(2)
    // largeur de la partie source : 256 / 4 = 64 ; x = 2022 % 4 = 2, y = 1429 % 4 = 1
    expect(rec.draws[0]).toEqual([2 * 64, 1 * 64, 64, 64, 0, 0, 256, 256])
  })

  it('passe à la tuile suivante tant que la précédente laisse des trous, et s’arrête dès que tout est opaque', async () => {
    const tile = (n: number): TileRow => ({ z: 10, x: 505, row: 666, data: fakeTile(10, 505, 666, n) })
    const holes = recorder(false)
    const a = await new MbtilesRenderer(holes.make, decode()).render({
      z: 10,
      x: 505,
      y: 357,
      k: 1,
      sources: [
        { id: 'a', dz: 0, file: file([tile(100)]) },
        { id: 'b', dz: 0, file: file([tile(200)]) },
      ],
    })
    expect(a.used).toEqual(['a', 'b'])
    const full = recorder(true)
    const b = await new MbtilesRenderer(full.make, decode()).render({
      z: 10,
      x: 505,
      y: 357,
      k: 1,
      sources: [
        { id: 'a', dz: 0, file: file([tile(100)]) },
        { id: 'b', dz: 0, file: file([tile(200)]) },
      ],
    })
    expect(b.used).toEqual(['a'])
  })

  describe('tuile absente au niveau voulu : on se rabat sur le niveau supérieur, agrandi', () => {
    // fichier qui n'a de tuile qu'au zoom 9 (tuile XYZ 9/126/89 = ligne TMS 511 − 89 = 422)
    const parent = { z: 9, x: 126, row: 422, data: fakeTile(9, 126, 422, 200) }
    const only9 = (minzoom = '4'): Blob => file([parent], { ...META, minzoom, maxzoom: '12' })

    it('une tuile du zoom 11 absente est remplacée par la bonne partie de celle du zoom 9', async () => {
      const rec = recorder(false)
      // 11/507/357 est la sous-tuile (3, 1) de 9/126/89 (4 × 4 sous-tuiles)
      const res = await new MbtilesRenderer(rec.make, decode(256)).render({
        z: 11,
        x: 507,
        y: 357,
        k: 1,
        sources: [{ id: 'a', dz: 0, file: only9() }],
      })
      expect(res.used).toEqual(['a'])
      expect(res.best).toBe(2) // rang d'une tuile agrandie deux fois, pas d'une tuile native
      expect(rec.draws[0]).toEqual([3 * 64, 1 * 64, 64, 64, 0, 0, 256, 256])
    })

    it('la tuile du niveau voulu, quand elle existe, passe avant : même vide, elle dit qu’il n’y a rien', async () => {
      const rec = recorder(false)
      const both = file([parent, { z: 11, x: 507, row: 2047 - 357, data: fakeTile(11, 507, 1690, 30) }], {
        ...META,
        minzoom: '4',
        maxzoom: '12',
      })
      const res = await new MbtilesRenderer(rec.make, decode(256)).render({
        z: 11,
        x: 507,
        y: 357,
        k: 1,
        sources: [{ id: 'a', dz: 0, file: both }],
      })
      expect(res.best).toBe(0)
      expect(rec.draws[0]).toEqual([0, 0, 256, 256])
    })

    it('ne descend pas sous le zoom minimal du fichier ni au-delà de MAX_OVERZOOM niveaux', async () => {
      const r = new MbtilesRenderer(recorder(false).make, decode(256))
      // zoom minimal 10 : la tuile du zoom 9 n'est pas une réponse valable
      expect((await r.render({ z: 11, x: 507, y: 357, k: 1, sources: [{ id: 'a', dz: 0, file: only9('10') }] })).pixels).toBeNull()
      // 9 + MAX_OVERZOOM + 1 : trop loin
      const z = 9 + MAX_OVERZOOM + 1
      const k = 2 ** (z - 9)
      expect((await r.render({ z, x: 126 * k, y: 89 * k, k: 1, sources: [{ id: 'b', dz: 0, file: only9() }] })).pixels).toBeNull()
      // 9 + MAX_OVERZOOM : à la limite
      const z2 = 9 + MAX_OVERZOOM
      const k2 = 2 ** (z2 - 9)
      expect((await r.render({ z: z2, x: 126 * k2, y: 89 * k2, k: 1, sources: [{ id: 'c', dz: 0, file: only9() }] })).best).toBe(
        MAX_OVERZOOM,
      )
    })
  })

  it('pas de tuile ici : rien ; tuile vectorielle : ignorée', async () => {
    const r = new MbtilesRenderer(recorder(false).make, decode())
    const none = await r.render({
      z: 10,
      x: 1,
      y: 1,
      k: 1,
      sources: [{ id: 'a', dz: 0, file: file([{ z: 10, x: 505, row: 666, data: fakeTile(10, 505, 666, 80) }]) }],
    })
    expect(none.pixels).toBeNull()
    const pbf = file([{ z: 10, x: 505, row: 666, data: fakeTile(10, 505, 666, 80, [0x1f, 0x8b, 0x08]) }])
    const vec = await r.render({ z: 10, x: 505, y: 357, k: 1, sources: [{ id: 'v', dz: 0, file: pbf }] })
    expect(vec.pixels).toBeNull()
  })

  it('un fichier illisible ne prive pas la tuile des autres ; s’il n’y a que lui, l’erreur remonte', async () => {
    const good = file([{ z: 10, x: 505, row: 666, data: fakeTile(10, 505, 666, 80) }])
    const bad = new Blob([new Uint8Array(900)])
    const r = new MbtilesRenderer(recorder(false).make, decode())
    const mixed = await r.render({
      z: 10,
      x: 505,
      y: 357,
      k: 1,
      sources: [
        { id: 'bad', dz: 0, file: bad },
        { id: 'good', dz: 0, file: good },
      ],
    })
    expect(mixed.used).toEqual(['good'])
    await expect(
      new MbtilesRenderer(recorder(false).make, decode()).render({
        z: 10,
        x: 505,
        y: 357,
        k: 1,
        sources: [{ id: 'bad', dz: 0, file: bad }],
      }),
    ).rejects.toThrow()
  })

  it('double résolution sur écran Retina', async () => {
    const r = new MbtilesRenderer(recorder(false).make, decode(512))
    const res = await r.render({
      z: 10,
      x: 505,
      y: 357,
      k: 2,
      sources: [{ id: 'a', dz: 0, file: file([{ z: 10, x: 505, row: 666, data: fakeTile(10, 505, 666, 80) }]) }],
    })
    expect(res.size).toBe(512)
    expect(res.pixels).toHaveLength(512 * 512)
  })
})

// --- catalogue, dossier, moteur -----------------------------------------------------------------------------------------

const ref = (id: string, blob: Blob, lastModified = 1): ChartFileRef => ({
  id,
  size: blob.size,
  lastModified,
  getFile: async () => new File([blob], id, { lastModified }),
  source: blob,
})

describe('MBTiles — catalogue', () => {
  it('lit l’en-tête de chaque fichier, écarte les illisibles et les vectoriels avec la raison', async () => {
    const png = ref('a.mbtiles', new Blob([buildMbtiles({ tiles: someTiles(20), metadata: META })]))
    const vector = ref('vec.mbtiles', new Blob([buildMbtiles({ tiles: someTiles(20), metadata: { ...META, format: 'pbf' } })]))
    const broken = ref('cassé.mbtiles', new Blob([new Uint8Array(1000)]))
    const noIndex = ref('sans-index.mbtiles', new Blob([buildMbtiles({ layout: 'noindex', tiles: someTiles(10), metadata: META })]))
    const progress: number[] = []
    const res = await scanMbtiles([png, vector, broken, noIndex], { onProgress: (d) => progress.push(d) })
    expect(res.entries.map((e) => e.id)).toEqual(['a.mbtiles'])
    expect(res.entries[0]!.info.maxzoom).toBe(12)
    expect(Object.fromEntries(res.skipped.map((s) => [s.id, s.reason]))).toMatchObject({
      'vec.mbtiles': expect.stringContaining('vectorielles'),
      'cassé.mbtiles': expect.any(String),
      'sans-index.mbtiles': expect.stringContaining('index'),
    })
    expect(progress.at(-1)).toBe(4)
  })

  it('le cache évite de rouvrir un fichier inchangé', async () => {
    const png = ref('a.mbtiles', new Blob([buildMbtiles({ tiles: someTiles(20), metadata: META })]))
    const first = await scanMbtiles([png])
    const getFile = vi.fn(() => png.getFile())
    const again = await scanMbtiles([{ ...png, getFile }], { cache: new Map(first.entries.map((e) => [e.id, e])) })
    expect(getFile).not.toHaveBeenCalled()
    expect(again.entries).toEqual(first.entries)
    // fichier modifié : rouvert
    await scanMbtiles([{ ...png, getFile, lastModified: 2 }], { cache: new Map(first.entries.map((e) => [e.id, e])) })
    expect(getFile).toHaveBeenCalledTimes(1)
  })

  it('zooms incohérents : inutilisable', () => {
    expect(
      unusable({
        name: '',
        format: 'png',
        minzoom: 9,
        maxzoom: 3,
        bounds: [0, 0, 1, 1],
        attribution: '',
        description: '',
        type: '',
        scheme: 'tms',
      }),
    ).toContain('zoom')
  })
})

describe('MBTiles — attribution', () => {
  const info = (attribution: string, name = ''): MbEntry['info'] => ({
    name,
    format: 'png',
    minzoom: 0,
    maxzoom: 1,
    bounds: [0, 0, 1, 1],
    attribution,
    description: '',
    type: '',
    scheme: 'tms',
  })

  it('ne garde que le texte de la source : balises retirées, entités conservées, doublons fusionnés', () => {
    const html = attributionHtml([
      info('<a href="https://x.example/" onclick="evil()">NOAA</a> &copy; données <script>alert(1)</script>'),
      info('NOAA'),
      info('', 'Carte sans attribution'),
    ])
    expect(html).not.toContain('<')
    expect(html).not.toContain('onclick')
    expect(html).toContain('&copy;')
    expect(html).toContain('Carte sans attribution')
    expect(html.match(/NOAA/g)).toHaveLength(2) // « NOAA &copy; données … » et « NOAA » : deux textes distincts
  })

  it('un < ou un > isolé est neutralisé ; sans aucune source, texte par défaut', () => {
    expect(attributionHtml([info('1 < 2')])).toContain('1 &lt; 2')
    expect(attributionHtml([info('x > y')])).toContain('x &gt; y')
    expect(attributionHtml([info('')])).toContain('dossier local')
  })
})

describe('superposition des tuiles de plusieurs formats', () => {
  const part = (rank: number, tag: number): TilePart => ({ pixels: new Uint32Array([tag]), size: 1, rank })
  const order = (parts: TilePart[]): number[] => stackOrder(parts).map((p) => p.pixels[0]!)

  it('la source la plus lisible est dessinée en dernier (au-dessus)', () => {
    // tags : 1 = BSB lisible, 2 = MBTiles natif, 3 = CM93
    expect(order([part(bsbRank(0), 1), part(mbtilesRank(0), 2), part(CM93_RANK, 3)])).toEqual([3, 2, 1])
  })

  it('une carte BSB trop détaillée ou agrandie passe derrière le CM93 ; un MBTiles agrandi aussi', () => {
    expect(order([part(bsbRank(3), 1), part(CM93_RANK, 3)])).toEqual([1, 3])
    expect(order([part(bsbRank(2), 1), part(CM93_RANK, 3)])).toEqual([1, 3])
    expect(order([part(bsbRank(1), 1), part(CM93_RANK, 3)])).toEqual([3, 1])
    expect(order([part(mbtilesRank(1), 2), part(CM93_RANK, 3)])).toEqual([3, 2])
    expect(order([part(mbtilesRank(2), 2), part(CM93_RANK, 3)])).toEqual([2, 3])
  })

  it('à rang égal, la première source donnée reste au-dessus', () => {
    expect(order([part(1, 1), part(1, 2), part(1, 3)])).toEqual([3, 2, 1])
  })
})

type Entry = DirHandleLike | { kind: 'file'; name: string; getFile(): Promise<File> }
const dfile = (name: string): Entry => ({ kind: 'file', name, getFile: async () => new File(['x'], name, { lastModified: 7 }) })
const ddir = (name: string, items: Entry[]): DirHandleLike => ({
  kind: 'directory',
  name,
  async *values() {
    for (const i of items) yield i
  },
})

describe('dossier de cartes — fichiers MBTiles reconnus automatiquement', () => {
  it('les .mbtiles sont listés, avec leur taille et leur date ; les autres formats restent reconnus', async () => {
    const l = await listFolder(
      ddir('Cartes', [dfile('noaa.mbtiles'), dfile('AUTRE.MBTILES'), ddir('sous', [dfile('x.kap'), dfile('lisez-moi.txt')])]),
    )
    expect(l.mbtiles.map((m) => m.id)).toEqual(['AUTRE.MBTILES', 'noaa.mbtiles'])
    expect(l.mbtiles[0]!.lastModified).toBe(7)
    expect(formatsOf(l)).toEqual(['bsb', 'mbtiles'])
  })

  it('un dossier de seuls .mbtiles est reconnu ; la liste d’un <input webkitdirectory> aussi', () => {
    const f = new File(['x'], 'c.mbtiles')
    Object.defineProperty(f, 'webkitRelativePath', { value: 'Cartes/c.mbtiles' })
    const l = listFromFileList([f])
    expect(formatsOf(l)).toEqual(['mbtiles'])
    expect(l.mbtiles[0]!.id).toBe('Cartes/c.mbtiles')
    expect(l.mbtiles[0]!.source).toBe(f)
  })
})

describe('MBTiles — moteur', () => {
  it('construit le travail d’une tuile d’après le catalogue, sans rien lire', async () => {
    const jobs: MbJob[] = []
    const reset = vi.fn()
    const runner: MbRunner = {
      capacity: 1,
      reset,
      run: async (job) => {
        jobs.push(job)
        return { pixels: null, size: 256, used: [] }
      },
      dispose: () => {},
    }
    const a = ref('fin.mbtiles', new Blob(['x']))
    const b = ref('large.mbtiles', new Blob(['x']))
    const info = (minzoom: number, maxzoom: number): MbEntry['info'] => ({
      name: '',
      format: 'png',
      minzoom,
      maxzoom,
      bounds: [-6, 47, -3, 49],
      attribution: '',
      description: '',
      type: '',
      scheme: 'tms',
    })
    const e = new MbtilesEngine(runner)
    e.setCatalog(
      [a, b],
      [
        { id: 'fin.mbtiles', info: info(9, 16) },
        { id: 'large.mbtiles', info: info(2, 12) },
      ],
    )
    expect(reset).toHaveBeenCalled()
    expect(e.fileCount).toBe(2)
    const brest = tileAt(48.4, -4.5, 10)
    await e.renderTile(10, brest.x, brest.y)
    expect(jobs).toHaveLength(1)
    expect(jobs[0]!.sources.map((s) => [s.id, s.dz])).toEqual([
      ['fin.mbtiles', 0],
      ['large.mbtiles', 0],
    ])
    expect(jobs[0]!.sources[0]!.file).toBeInstanceOf(Blob)
    // rien ne couvre cette tuile : pas de travail
    await e.renderTile(10, 1, 1)
    expect(jobs).toHaveLength(1)
    // tuile annulée avant son départ : jamais fabriquée
    const ac = new AbortController()
    ac.abort()
    await expect(e.renderTile(10, brest.x, brest.y, ac.signal)).rejects.toThrow()
    expect(jobs).toHaveLength(1)
  })
})

// --- vrai fichier (facultatif) ------------------------------------------------------------------------------------------

// MBTILES_FILE="C:/…/ncds_21.mbtiles;C:/…/world_l1_webp.mbtiles" npx vitest run mbtiles : vérifie le lecteur sur de vrais fichiers
// (séparés par « ; », jamais versionnés, jamais exigés).
const REAL = (process.env.MBTILES_FILE ?? '').split(';').filter(Boolean)
describe.skipIf(!REAL.length)('MBTiles — vrais fichiers', () => {
  for (const file of REAL) {
    it(`${file.split(/[\\/]/).pop()} : s’ouvre, lit ses métadonnées et des tuiles autour du centre de son emprise`, async () => {
      const bytes = readFileSync(file)
      const mb = await Mbtiles.open(bufferSource(new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength)))
      const { bounds, minzoom, maxzoom } = mb.info
      console.log('MBTiles réel :', JSON.stringify(mb.info))
      expect(maxzoom).toBeGreaterThanOrEqual(minzoom)
      const lon = (bounds[0] + bounds[2]) / 2
      const lat = (bounds[1] + bounds[3]) / 2
      let found = 0
      for (let z = minzoom; z <= maxzoom; z++) {
        const n = 2 ** z
        const x0 = Math.floor(((lon + 180) / 360) * n)
        const r = (lat * Math.PI) / 180
        const y0 = Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n)
        // 3 × 3 tuiles autour du centre : un fichier peut n'avoir des tuiles que par endroits
        for (let dx = -1; dx <= 1; dx++) {
          for (let dy = -1; dy <= 1; dy++) {
            if (x0 + dx < 0 || y0 + dy < 0 || x0 + dx >= n || y0 + dy >= n) continue
            const t = await mb.getXyz(z, x0 + dx, y0 + dy)
            if (t) {
              found++
              expect(['png', 'jpg', 'webp']).toContain(sniffFormat(t))
            }
          }
        }
      }
      expect(found).toBeGreaterThan(0)
    })
  }
})
