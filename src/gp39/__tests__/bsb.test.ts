// Cartes BSB : lecture KAP, calage, choix des cartes selon le zoom, rendu de tuiles, catalogue, file d'attente — cartes synthétiques.
import { describe, expect, it } from 'vitest'
import { buildKap, mercatorAt, type SynthOptions } from './helpers/kapBuilder'
import { bufferSource, decodeRow, parseKapHeader, readKapHeader, readRowIndex, scanRowIndex, type ByteSource } from '../bsb/kap'
import { buildGeoModel } from '../bsb/georef'
import {
  MAX_CHARTS_PER_TILE,
  TILE,
  makeChartInfo,
  metersPerTilePixel,
  openChart,
  renderTile,
  selectCharts,
  tileBox,
  type ChartInfo,
} from '../bsb/tiles'
import { listDirectory, refsFromFileList, scanCharts, type ChartFileRef, type DirHandleLike } from '../bsb/catalog'
import { BsbEngine, InlineRunner, type TileRunner } from '../bsb/engine'
import type { TileJob, TileResult } from '../bsb/runner'

const BBOX: [number, number, number, number] = [47.725, -3.4, 47.775, -3.3]
/** damier de cases de 50 px : valeur 1 + (case x + case y) mod 3 → blanc, rouge, bleu */
const checker = (x: number, y: number): number => 1 + ((Math.floor(x / 50) + Math.floor(y / 50)) % 3)
const base = (extra: Partial<SynthOptions> = {}): SynthOptions => ({ width: 400, height: 300, bbox: BBOX, pixel: checker, ...extra })

const WHITE = [255, 255, 255, 255]
const RED = [255, 0, 0, 255]
const BLUE = [0, 0, 255, 255]
const COLORS = [[], WHITE, RED, BLUE]

const rgbaAt = (pixels: Uint32Array, x: number, y: number): number[] => {
  const b = new Uint8Array(pixels.buffer, pixels.byteOffset, pixels.byteLength)
  const i = (y * TILE + x) * 4
  return [b[i]!, b[i + 1]!, b[i + 2]!, b[i + 3]!]
}

const world = (lat: number, lon: number, z: number): { x: number; y: number } => {
  const n = TILE * 2 ** z
  const r = (lat * Math.PI) / 180
  return { x: ((lon + 180) / 360) * n, y: ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n }
}
const tileOf = (lat: number, lon: number, z: number): { x: number; y: number } => {
  const w = world(lat, lon, z)
  return { x: Math.floor(w.x / TILE), y: Math.floor(w.y / TILE) }
}

function chartOf(id: string, bytes: Uint8Array): { info: ChartInfo; src: ByteSource } {
  const src = bufferSource(bytes)
  const header = parseKapHeader(bytes)!
  return { info: makeChartInfo(id, bytes.length, header)!, src }
}

/** Source qui compte les lectures et les octets lus. */
function counting(src: ByteSource): ByteSource & { reads: number; bytes: number; tailReads: number } {
  const c = {
    size: src.size,
    reads: 0,
    bytes: 0,
    tailReads: 0,
    read: async (s: number, e: number) => {
      const out = await src.read(s, e)
      c.reads++
      c.bytes += out.length
      if (e - s === 4 && e >= src.size) c.tailReads++
      return out
    },
  }
  return c
}

describe('KAP : en-tête', () => {
  const bytes = buildKap(base({ dtm: [-3.6, -4.98], scale: 12345 }))
  const h = parseKapHeader(bytes)!

  it('lit nom, taille, échelle, projection, datum (coupure de ligne sans virgule comprise), DTM', () => {
    expect(h).toMatchObject({ name: 'Carte test', number: '9999', width: 400, height: 300, dpi: 254, scale: 12345, projection: 'MERCATOR' })
    expect(h.datum).toBe('European 1950')
    expect([h.dtmLat, h.dtmLon]).toEqual([-3.6, -4.98])
  })

  it('lit points de calage, polygone et palette (valeur 0 transparente)', () => {
    expect(h.refs).toHaveLength(4)
    expect(h.ply).toHaveLength(4)
    expect(h.depth).toBe(6)
    const pal = new Uint8Array(h.palette.buffer)
    expect([...pal.subarray(0, 4)]).toEqual([0, 0, 0, 0])
    expect([...pal.subarray(4, 8)]).toEqual(WHITE)
    expect([...pal.subarray(8, 12)]).toEqual(RED)
    expect([...pal.subarray(12, 16)]).toEqual(BLUE)
  })

  it('le raster commence après 0x1A 0x00 et l’octet de profondeur', () => {
    expect(bytes[h.dataStart - 3]).toBe(0x1a)
    expect(bytes[h.dataStart - 2]).toBe(0)
    expect(bytes[h.dataStart - 1]).toBe(6)
  })

  it('refuse ce qui n’est pas une carte exploitable', () => {
    expect(parseKapHeader(new TextEncoder().encode('pas une carte'))).toBeNull() // pas de 0x1A
    const text = new TextDecoder('latin1').decode(bytes.subarray(0, h.dataStart - 3))
    const cut = (re: RegExp): Uint8Array => {
      const t = text.replace(re, '')
      const out = new Uint8Array(t.length + 3)
      out.set(new TextEncoder().encode(t), 0)
      out.set([0x1a, 0, 6], t.length)
      return out
    }
    expect(parseKapHeader(cut(/RA=\d+,\d+,/))).toBeNull() // taille inconnue
    expect(parseKapHeader(cut(/REF\/[34],.*\r\n/g))).toBeNull() // moins de 3 points de calage
    const badDepth = bytes.slice()
    badDepth[h.dataStart - 1] = 0
    expect(parseKapHeader(badDepth)).toBeNull()
  })

  it('readKapHeader lit les premiers octets d’une source', async () => {
    const src = counting(bufferSource(bytes))
    const hh = await readKapHeader(src)
    expect(hh?.width).toBe(400)
    expect(src.reads).toBe(1)
  })
})

describe('KAP : raster et index des lignes', () => {
  it.each([4, 5, 6, 7])('décode chaque ligne à %i bits par pixel (suites longues comprises)', async (depth) => {
    // lignes à suites longues (plus que ce que l'octet de départ peut coder) et lignes en damier serré
    const o = base({ width: 700, height: 40, depth, pixel: (x, y) => (y % 2 ? 1 + (x % 3) : x < 650 ? 2 : 3) })
    const file = buildKap(o)
    const h = parseKapHeader(file)!
    const idx = await readRowIndex(bufferSource(file), h)
    expect(idx).toHaveLength(41)
    const out = new Uint8Array(o.width)
    for (let y = 0; y < o.height; y++) {
      decodeRow(file, idx[y]!, depth, o.width, o.width, out)
      for (let x = 0; x < o.width; x++)
        if (out[x] !== o.pixel(x, y)) throw new Error(`pixel ${x},${y} : ${out[x]} au lieu de ${o.pixel(x, y)}`)
    }
  })

  it('une ligne entière d’une même couleur (suite de plusieurs milliers de pixels) se décode', async () => {
    const o = base({ width: 5000, height: 3, pixel: () => 2 })
    const file = buildKap(o)
    const h = parseKapHeader(file)!
    const idx = await readRowIndex(bufferSource(file), h)
    const out = new Uint8Array(5000)
    decodeRow(file, idx[1]!, 6, 5000, 5000, out)
    expect(out.every((v) => v === 2)).toBe(true)
  })

  it('n’écrit que les pixels demandés (xLimit) et renvoie la position de la ligne suivante', async () => {
    const o = base({ width: 400, height: 4 })
    const file = buildKap(o)
    const h = parseKapHeader(file)!
    const idx = await readRowIndex(bufferSource(file), h)
    const out = new Uint8Array(400).fill(99)
    const next = decodeRow(file, idx[0]!, 6, 400, 120, out)
    expect(out[119]).toBe(o.pixel(119, 0))
    expect(out[120]).toBe(99)
    expect(next).toBe(idx[1])
  })

  it('table d’index : height + 1 offsets, le dernier = fin du raster ; une seule petite lecture en fin de fichier', async () => {
    const file = buildKap(base())
    const h = parseKapHeader(file)!
    const src = counting(bufferSource(file))
    const idx = await readRowIndex(src, h)
    expect(idx).toHaveLength(301)
    expect(idx[0]).toBe(h.dataStart)
    expect(idx[300]).toBe(file.length - 4 - 300 * 4)
    expect(src.reads).toBe(2) // 4 derniers octets, puis la table
    expect(src.bytes).toBe(4 + 300 * 4)
  })

  it('table absente ou corrompue : l’index est reconstruit en parcourant le raster, avec le même résultat', async () => {
    const good = buildKap(base())
    const h = parseKapHeader(good)!
    const expected = await readRowIndex(bufferSource(good), h)
    for (const o of [base({ index: false }), base({ corruptIndex: true })]) {
      const file = buildKap(o)
      const hh = parseKapHeader(file)!
      expect([...(await readRowIndex(bufferSource(file), hh))]).toEqual([...expected])
    }
    expect([...(await scanRowIndex(bufferSource(good), h))]).toEqual([...expected])
  })

  it('raster tronqué : erreur claire', async () => {
    const file = buildKap(base({ index: false }))
    const h = parseKapHeader(file)!
    await expect(readRowIndex(bufferSource(file.subarray(0, file.length - 400)), h)).rejects.toThrow(/Raster incomplet/)
  })
})

describe('calage', () => {
  const o = base({ dtm: [-3.6, -4.98] })
  const h = parseKapHeader(buildKap(o))!
  const model = buildGeoModel(h)!

  it('les points REF sont retrouvés à moins d’un centième de pixel', () => {
    expect(model.rmsPx).toBeLessThan(0.01)
  })

  it('pixel → WGS84 : position de la carte + décalage de datum (DTM, en secondes d’arc)', () => {
    for (const [x, y] of [
      [0, 0],
      [399, 299],
      [123, 211],
      [200, 150],
    ] as const) {
      const g = model.pixelToGeo(x, y)
      const c = mercatorAt(o, x, y)
      expect(g.lat).toBeCloseTo(c.lat - 3.6 / 3600, 6)
      expect(g.lon).toBeCloseTo(c.lon - 4.98 / 3600, 6)
    }
  })

  it('WGS84 → pixel est l’inverse exact (aller-retour à 0,01 px)', () => {
    for (let i = 0; i < 25; i++) {
      const x = (i * 97) % 400
      const y = (i * 61) % 300
      const g = model.pixelToGeo(x, y)
      const p = model.geoToPixel(g.lat, g.lon)
      expect(p.x).toBeCloseTo(x, 1)
      expect(p.y).toBeCloseTo(y, 1)
    }
  })

  it('résolution au sol : 0,1° de longitude à 47,75° ≈ 7,5 km sur 399 pixels', () => {
    expect(model.metersPerPixel).toBeGreaterThan(18.5 * 0.97)
    expect(model.metersPerPixel).toBeLessThan(18.9 * 1.03)
  })

  it('emprise = zone utile (polygone), pas le cadre entier', () => {
    const [s, w, n, e] = model.bbox
    expect(s).toBeGreaterThan(BBOX[0] + 0.0005) // la marge de 10 px, moins le décalage de datum (−3,6″)
    expect(n).toBeLessThan(BBOX[2] - 0.001)
    expect(w).toBeGreaterThan(BBOX[1] + 0.001)
    expect(e).toBeLessThan(BBOX[3] - 0.001)
  })

  it('sans polygone : le cadre entier est la zone utile', () => {
    const noPly = { ...h, ply: [] }
    const m = buildGeoModel(noPly)!
    expect(m.polygonPx).toHaveLength(8)
    expect([...m.polygonPx]).toEqual([0, 0, 400, 0, 400, 300, 0, 300])
  })

  it('carte gnomonique (plan = latitude/longitude) et carte à 3 points : calage possible ; points alignés : refusé', () => {
    const g = buildGeoModel({ ...h, projection: 'GNOMONIC' })!
    const p = g.pixelToGeo(200, 150)
    const q = g.geoToPixel(p.lat, p.lon)
    expect([q.x, q.y].map(Math.round)).toEqual([200, 150])
    expect(buildGeoModel({ ...h, refs: h.refs.slice(0, 3) })).not.toBeNull()
    const line = [0, 100, 200].map((x) => ({ x, y: 0, lat: 47.7, lon: -3.4 + x * 0.001 }))
    expect(buildGeoModel({ ...h, refs: line })).toBeNull()
  })
})

describe('choix des cartes selon le zoom (comportement OpenCPN)', () => {
  const fake = (id: string, mpp: number, bbox: [number, number, number, number] = [47, -4, 48, -3]): ChartInfo =>
    ({ id, bbox, metersPerPixel: mpp, size: 0, rmsPx: 0, header: {} }) as unknown as ChartInfo
  const charts = [fake('detail', 1), fake('port', 5), fake('cote', 16), fake('general', 276)]
  const t13 = tileOf(47.75, -3.35, 13)
  const box = tileBox(13, t13.x, t13.y) // ~ 47,75°N : 12,9 m par pixel de tuile
  const ids = (z: number): string[] => selectCharts(charts, z, box).map((c) => c.id)

  it('géométrie des tuiles', () => {
    const w = tileBox(0, 0, 0)
    expect([w.west, w.east]).toEqual([-180, 180])
    expect(w.north).toBeCloseTo(85.0511, 3)
    expect(w.south).toBeCloseTo(-85.0511, 3)
    expect(metersPerTilePixel(0, 0)).toBeCloseTo(156543.03, 1)
    expect(metersPerTilePixel(13, 47.7)).toBeCloseTo(12.85, 1)
  })

  it('d’abord la carte la plus détaillée encore lisible (pixels de la carte ≤ 2 par pixel d’écran), les autres complètent', () => {
    // z13 : tuile 12,9 m/px → cote (k 0,8) lisible, port (k 2,6) un peu trop détaillé, général agrandi, détail trop fin
    expect(ids(13)).toEqual(['cote', 'port', 'general', 'detail'])
    // z14 : tuile 6,4 m/px → port (k 1,3) lisible ; côte agrandie 2,5 fois ; détail (k 6,4) en dernier recours
    expect(ids(14)).toEqual(['port', 'cote', 'general', 'detail'])
    // z15 : tuile 3,2 m/px → port (k 0,64) lisible ; le détail (k 3,2) un peu trop détaillé passe avant les cartes agrandies
    expect(ids(15)).toEqual(['port', 'detail', 'cote', 'general'])
    // z17 : 0,8 m/px → le détail (k 0,8)
    expect(ids(17)[0]).toBe('detail')
  })

  it('une carte qui ne touche pas la tuile n’est pas retenue ; au plus 8 cartes par tuile', () => {
    const ailleurs = fake('ailleurs', 16, [10, 10, 11, 11])
    expect(selectCharts([...charts, ailleurs], 13, box).map((c) => c.id)).not.toContain('ailleurs')
    const many = Array.from({ length: 20 }, (_, i) => fake(`c${i}`, 10 + i))
    expect(selectCharts(many, 13, box)).toHaveLength(MAX_CHARTS_PER_TILE)
  })
})

describe('rendu de tuiles', () => {
  const z = 12
  const o = base({ dtm: [-3.6, -4.98] })
  const file = buildKap(o)
  const { info, src } = chartOf('test.kap', file)
  const model = buildGeoModel(info.header)!
  const t = tileOf(47.75, -3.35, z)

  /** position, dans la tuile (t), du pixel (cx, cy) de la carte */
  const inTile = (cx: number, cy: number): { x: number; y: number } => {
    const g = model.pixelToGeo(cx, cy)
    const w = world(g.lat, g.lon, z)
    return { x: Math.floor(w.x - t.x * TILE), y: Math.floor(w.y - t.y * TILE) }
  }

  it('chaque case du damier tombe au bon endroit de la tuile, avec la bonne couleur (datum compris)', async () => {
    const out = new Uint32Array(TILE * TILE)
    const used = await renderTile(z, t.x, t.y, [openChart(info, src)!], out)
    expect(used).toEqual(['test.kap'])
    let checked = 0
    for (let i = 1; i <= 6; i++) {
      for (let j = 1; j <= 4; j++) {
        const p = inTile(50 * i + 25, 50 * j + 25)
        if (p.x < 0 || p.y < 0 || p.x >= TILE || p.y >= TILE) continue
        expect(rgbaAt(out, p.x, p.y), `case ${i},${j}`).toEqual(COLORS[checker(50 * i + 25, 50 * j + 25)])
        checked++
      }
    }
    expect(checked).toBeGreaterThan(5)
  })

  it('hors de la zone utile (marge du cadre) : transparent ; hors de la carte : tuile vide, aucune carte utilisée', async () => {
    const out = new Uint32Array(TILE * TILE)
    await renderTile(z, t.x, t.y, [openChart(info, src)!], out)
    const m = inTile(4, 150) // dans la marge de 10 px, à gauche
    if (m.x >= 0 && m.x < TILE) expect(rgbaAt(out, m.x, m.y)[3]).toBe(0)
    const far = new Uint32Array(TILE * TILE).fill(7)
    expect(await renderTile(z, t.x + 40, t.y, [openChart(info, src)!], far)).toEqual([])
    expect(far.every((v) => v === 0)).toBe(true)
  })

  it('le décalage de datum déplace bien la carte (sans DTM, la même case n’est plus au même endroit)', async () => {
    const plain = chartOf('plain.kap', buildKap(base()))
    const a = new Uint32Array(TILE * TILE)
    const b = new Uint32Array(TILE * TILE)
    await renderTile(z, t.x, t.y, [openChart(info, src)!], a)
    await renderTile(z, t.x, t.y, [openChart(plain.info, plain.src)!], b)
    // 3,6″ de latitude ≈ 111 m ≈ 4 pixels de tuile à ce zoom : les deux rendus diffèrent
    let diff = 0
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) diff++
    expect(diff).toBeGreaterThan(200)
  })

  it('agrandissement (zoom 17, k < 1) : pixels carrés de la carte, couleurs franches (pas de mélange)', async () => {
    const z2 = 17
    const t2 = tileOf(47.75, -3.35, z2)
    const out = new Uint32Array(TILE * TILE)
    await renderTile(z2, t2.x, t2.y, [openChart(info, src)!], out)
    const colours = new Set<string>()
    for (let y = 0; y < TILE; y += 7) for (let x = 0; x < TILE; x += 7) colours.add(rgbaAt(out, x, y).join(','))
    for (const c of colours) expect([WHITE, RED, BLUE, [0, 0, 0, 0]].map((v) => v.join(','))).toContain(c)
  })

  it('une tuile ne lit qu’une petite partie du fichier ; la table d’index n’est lue qu’une fois pour plusieurs tuiles', async () => {
    // grande carte : 3000 lignes de bandes de 40 px
    const big = buildKap(
      base({
        width: 2000,
        height: 3000,
        bbox: [47.4, -3.6, 48.0, -3.0],
        pixel: (x, y) => 1 + ((Math.floor(x / 40) + Math.floor(y / 40)) % 3),
      }),
    )
    const cs = chartOf('big.kap', big)
    const counted = counting(cs.src)
    const oc = openChart(cs.info, counted)!
    const bz = 12
    const bt = tileOf(47.7, -3.3, bz)
    const out = new Uint32Array(TILE * TILE)
    const [r1, r2] = await Promise.all([
      renderTile(bz, bt.x, bt.y, [oc], out),
      renderTile(bz, bt.x + 1, bt.y, [oc], new Uint32Array(TILE * TILE)),
    ])
    expect(r1.length + r2.length).toBeGreaterThan(0)
    expect(counted.tailReads).toBe(1) // table d'index lue une seule fois, même demandée en parallèle
    expect(counted.bytes).toBeLessThan(big.length * 0.35)
  })
})

describe('composition de plusieurs cartes (quilt)', () => {
  const z = 12
  const detail = chartOf('detail.kap', buildKap(base({ pixel: () => 2, number: '1' }))) // rouge, 18,7 m/px
  const overview = chartOf(
    'overview.kap',
    buildKap(base({ width: 300, height: 300, bbox: [47.615, -3.55, 47.885, -3.15], pixel: () => 3, number: '2' })),
  ) // bleu, ~100 m/px
  const t = tileOf(47.75, -3.35, z)

  it('la carte prioritaire dessine d’abord, la moins détaillée ne fait que compléter ce qu’elle ne couvre pas', async () => {
    const infos = [overview.info, detail.info]
    const mpp = metersPerTilePixel(z, 47.75)
    expect(mpp / detail.info.metersPerPixel).toBeGreaterThan(0.5) // le détail est lisible à ce zoom
    const sel = selectCharts(infos, z, tileBox(z, t.x, t.y))
    expect(sel.map((c) => c.id)).toEqual(['detail.kap', 'overview.kap'])
    const oc = new Map([
      [detail.info.id, openChart(detail.info, detail.src)!],
      [overview.info.id, openChart(overview.info, overview.src)!],
    ])
    const out = new Uint32Array(TILE * TILE)
    const used = await renderTile(
      z,
      t.x,
      t.y,
      sel.map((c) => oc.get(c.id)!),
      out,
    )
    expect(used).toEqual(['detail.kap', 'overview.kap'])
    const colours = new Set<string>()
    for (let y = 0; y < TILE; y += 5) for (let x = 0; x < TILE; x += 5) colours.add(rgbaAt(out, x, y).join(','))
    expect(colours.has(RED.join(','))).toBe(true) // le détail
    expect(colours.has(BLUE.join(','))).toBe(true) // la vue d'ensemble complète les bords
    // la case rouge n'est jamais recouverte par le bleu : au centre de la zone du détail
    const g = buildGeoModel(detail.info.header)!.pixelToGeo(200, 150)
    const w = world(g.lat, g.lon, z)
    expect(rgbaAt(out, Math.floor(w.x - t.x * TILE), Math.floor(w.y - t.y * TILE))).toEqual(RED)
  })

  it('dès que la tuile est entièrement couverte, les autres cartes ne sont même pas lues', async () => {
    const z2 = 14
    const t2 = tileOf(47.75, -3.35, z2) // la tuile entière est dans la zone utile du détail
    const d = counting(detail.src)
    const v = counting(overview.src)
    const out = new Uint32Array(TILE * TILE)
    const used = await renderTile(z2, t2.x, t2.y, [openChart(detail.info, d)!, openChart(overview.info, v)!], out)
    expect(used).toEqual(['detail.kap'])
    expect(d.reads).toBeGreaterThan(0)
    expect(v.reads).toBe(0)
    expect(rgbaAt(out, 0, 0)).toEqual(RED)
    expect(rgbaAt(out, TILE - 1, TILE - 1)).toEqual(RED)
  })
})

describe('catalogue du dossier', () => {
  const kap = (n: number): File => new File([buildKap(base({ number: String(n), name: `Carte ${n}` }))], `c${n}.kap`)
  const ref = (id: string, f: File, calls: { n: number }): ChartFileRef => ({
    id,
    size: f.size,
    lastModified: 1000,
    getFile: async () => {
      calls.n++
      return f
    },
  })

  it('ne lit que les .kap (les .bsb sont de simples fiches) ; compte les fichiers illisibles avec la raison', async () => {
    const calls = { n: 0 }
    const res = await scanCharts([
      ref('a/c1.kap', kap(1), calls),
      ref('a/c2.KAP', kap(2), calls),
      ref('a/c1.BSB', new File(['x'], 'c1.BSB'), calls),
      ref('a/cassee.kap', new File(['rien'], 'cassee.kap'), calls),
    ])
    expect(res.charts.map((c) => c.id)).toEqual(['a/c1.kap', 'a/c2.KAP'])
    expect(res.skipped).toEqual([{ id: 'a/cassee.kap', reason: 'en-tête BSB illisible' }])
    expect(calls.n).toBe(3) // le .bsb n'est jamais ouvert
  })

  it('le cache évite de relire un en-tête dont la taille et la date n’ont pas changé', async () => {
    const calls = { n: 0 }
    const refs = [ref('c1.kap', kap(1), calls), ref('c2.kap', kap(2), calls)]
    const first = await scanCharts(refs)
    expect(calls.n).toBe(2)
    const cache = new Map(first.entries.map((e) => [e.id, e]))
    const second = await scanCharts(refs, { cache })
    expect(calls.n).toBe(2)
    expect(second.charts).toHaveLength(2)
    // fichier modifié (autre taille) : relu
    const changed = { ...refs[0]!, size: refs[0]!.size + 1 }
    await scanCharts([changed, refs[1]!], { cache })
    expect(calls.n).toBe(3)
  })

  it('progression signalée à chaque fichier', async () => {
    const calls = { n: 0 }
    const seen: number[] = []
    await scanCharts([ref('c1.kap', kap(1), calls), ref('c2.kap', kap(2), calls), ref('c3.kap', kap(3), calls)], {
      onProgress: (d) => seen.push(d),
    })
    expect(seen.sort((a, b) => a - b)).toEqual([1, 2, 3])
  })

  it('parcourt un dossier et ses sous-dossiers (File System Access API simulée)', async () => {
    const file = (name: string, n: number): { kind: 'file'; name: string; getFile(): Promise<File> } => ({
      kind: 'file',
      name,
      getFile: async () => kap(n),
    })
    const dir = (name: string, items: (DirHandleLike | ReturnType<typeof file>)[]): DirHandleLike => ({
      kind: 'directory',
      name,
      values: async function* () {
        for (const i of items) yield i
      },
    })
    const root = dir('BSB', [file('1.kap', 1), file('1.BSB', 1), dir('sud', [file('2.KAP', 2), dir('plus', [file('3.kap', 3)])])])
    const refs = await listDirectory(root)
    expect(refs.map((r) => r.id)).toEqual(['1.kap', 'sud/2.KAP', 'sud/plus/3.kap'])
    expect((await refs[1]!.getFile()).name).toBe('c2.kap')
  })

  it('liste de fichiers d’un <input webkitdirectory> : le chemin relatif sert d’identifiant', () => {
    const f = kap(1)
    Object.defineProperty(f, 'webkitRelativePath', { value: 'BSB_France/c1.kap' })
    const refs = refsFromFileList([f, new File(['x'], 'lisez-moi.txt')])
    expect(refs.map((r) => r.id)).toEqual(['BSB_France/c1.kap'])
  })
})

describe('moteur de tuiles', () => {
  async function engineWith(runner: TileRunner): Promise<{ engine: BsbEngine; tile: { x: number; y: number } }> {
    const files = [new File([buildKap(base())], 'c1.kap')]
    const refs: ChartFileRef[] = files.map((f) => ({ id: f.name, size: f.size, lastModified: 1, getFile: async () => f }))
    const scan = await scanCharts(refs)
    const engine = new BsbEngine(runner)
    engine.setCatalog(refs, scan.charts)
    return { engine, tile: tileOf(47.75, -3.38, 14) }
  }

  it('fabrique une tuile de bout en bout (fichier → catalogue → choix → décodage → pixels)', async () => {
    const { engine, tile } = await engineWith(new InlineRunner())
    expect(engine.chartCount).toBe(1)
    const r = await engine.renderTile(14, tile.x, tile.y)
    expect(r.used).toEqual(['c1.kap'])
    expect(r.pixels).not.toBeNull()
    const none = await engine.renderTile(14, tile.x + 50, tile.y)
    expect(none).toEqual({ pixels: null, used: [] })
  })

  it('file d’attente : dernier arrivé, premier servi ; une tuile annulée avant son départ n’est jamais fabriquée', async () => {
    const started: string[] = []
    const gates: (() => void)[] = []
    const runner: TileRunner = {
      capacity: 1,
      run: (job: TileJob) =>
        new Promise<TileResult>((resolve) => {
          started.push(`${job.x}`)
          gates.push(() => resolve({ pixels: null, used: [] }))
        }),
      dispose() {},
    }
    const { engine, tile } = await engineWith(runner)
    const ac = new AbortController()
    const p1 = engine.renderTile(14, tile.x, tile.y) // part tout de suite
    await new Promise((r) => setTimeout(r, 5))
    const p2 = engine.renderTile(14, tile.x + 1, tile.y)
    const p3 = engine.renderTile(14, tile.x + 2, tile.y, ac.signal)
    const p4 = engine.renderTile(14, tile.x + 3, tile.y)
    ac.abort()
    await expect(p3).rejects.toMatchObject({ name: 'AbortError' })
    await expect(engine.renderTile(14, tile.x, tile.y, ac.signal)).rejects.toMatchObject({ name: 'AbortError' }) // déjà annulée
    gates[0]!()
    await p1
    await new Promise((r) => setTimeout(r, 5))
    expect(started).toEqual([String(tile.x), String(tile.x + 3)]) // p4 (le plus récent) passe avant p2 ; p3 n'est jamais partie
    gates[1]!()
    await p4
    await new Promise((r) => setTimeout(r, 5))
    gates[2]!()
    await p2
    expect(started).toEqual([String(tile.x), String(tile.x + 3), String(tile.x + 1)])
  })

  it('une carte absente du catalogue ou un nouveau catalogue en cours de route : erreur, pas de blocage', async () => {
    const { engine, tile } = await engineWith(new InlineRunner())
    engine.setCatalog([], [])
    expect((await engine.renderTile(14, tile.x, tile.y)).pixels).toBeNull()
  })
})
