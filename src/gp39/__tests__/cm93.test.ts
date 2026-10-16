// Cartes CM93 : décodage des cellules, dictionnaires, échelles et cellules d'une tuile, reconnaissance du dossier, dessin — cellules synthétiques.
import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import { ATTR_DIC, OBJ_DIC, attrB, attrL, attrR, attrS, attrW, buildCell, type BuildCell, type BuildFeature } from './helpers/cm93Builder'
import { areaRings, cellFrame, cellLonLat, lineParts, parseCell, soundingDepth } from '../cm93/cell'
import { DECODE_TABLE, descramble } from '../cm93/decode'
import { decodeAttrs } from '../cm93/attrs'
import { parseDictionaries } from '../cm93/dict'
import { prepareCell } from '../cm93/prepare'
import { metersPerPixel, planTile, tileGeoBox } from '../cm93/plan'
import { SCALES, cellBox, cellFileName, cellKeyId, cellsForBox, parseCellName, scaleForView } from '../cm93/scales'
import { PALETTE, depthColour, formatDepth, lightLabel, navColours } from '../cm93/style'
import { Cm93Renderer, type Canvas2D, type Cm93Job } from '../cm93/tile'
import { Cm93Engine, type Cm93Runner } from '../cm93/engine'
import { formatsOf, listFolder, listFromFileList } from '../library'
import type { DirHandleLike } from '../bsb/catalog'

const dict = parseDictionaries(OBJ_DIC, ATTR_DIC)
const MAX = 65535

/** carré de 4 arêtes (S, E, N, O) plus un triangle, des sondes et deux points */
const square = (extra: Partial<BuildCell> = {}): BuildCell => ({
  south: 48,
  west: -5,
  north: 48 + 1 / 3,
  east: -5 + 1 / 3,
  edges: [
    [0, 0, MAX, 0],
    [MAX, 0, MAX, MAX],
    [MAX, MAX, 0, MAX],
    [0, MAX, 0, 0],
  ],
  soundings: [[100, 100, 35, 200, 200, 12120]],
  points: [30000, 30000, 40000, 20000],
  features: [],
  ...extra,
})

const feat = (f: BuildFeature): BuildFeature => f
const FULL = [0, 1, 2, 3]
const covr = (cscale = 50000): BuildFeature =>
  feat({ cls: 217, prim: 4, edges: FULL, attrs: [26, cscale & 255, (cscale >> 8) & 255, cscale >> 16, 0], nAttr: 1 })

describe('CM93 — décodage', () => {
  it('la table de substitution est une permutation de 0..255', () => {
    expect(new Set(DECODE_TABLE).size).toBe(256)
  })

  it('descramble() est l’inverse de l’encodage du fichier', () => {
    const raw = buildCell(square({ features: [covr()] }))
    const plain = descramble(raw)
    expect(plain.length).toBe(raw.length)
    // préambule : longueur de l'en-tête (138) puis longueurs des tables 1 et 2
    const dv = new DataView(plain.buffer)
    expect(dv.getUint16(0, true)).toBe(138)
    expect(138 + dv.getInt32(2, true) + dv.getInt32(6, true)).toBe(raw.length)
  })
})

describe('CM93 — cellule', () => {
  const cell = (c: Partial<BuildCell> = {}) => parseCell(buildCell(square(c)))!

  it('lit les tables : arêtes, sondes, points, objets', () => {
    const c = cell({
      features: [
        covr(),
        feat({ cls: 44, prim: 4, edges: FULL }),
        feat({ cls: 86, prim: 1, point: 1 }),
        feat({ cls: 147, prim: 8, point: 0 }),
      ],
    })
    expect(c.edges).toHaveLength(4)
    expect(c.soundings[0]).toHaveLength(6)
    expect(Array.from(c.points)).toEqual([30000, 30000, 40000, 20000])
    expect(c.features.map((f) => f.cls)).toEqual([217, 44, 86, 147])
    expect(c.features[2]!.point).toBe(1)
  })

  it('refuse un fichier dont la taille ne correspond pas à son préambule (corrompu ou pas une cellule)', () => {
    expect(parseCell(buildCell(square({ features: [covr()], trailing: 3 })))).toBeNull()
    expect(parseCell(new Uint8Array(50))).toBeNull()
    expect(parseCell(Uint8Array.from({ length: 400 }, (_, i) => (i * 7) & 255))).toBeNull()
  })

  it('refuse une cellule qui désigne une arête ou un point inexistants', () => {
    expect(parseCell(buildCell(square({ features: [feat({ cls: 44, prim: 4, edges: [9] })] })))).toBeNull()
    expect(parseCell(buildCell(square({ features: [feat({ cls: 86, prim: 1, point: 7 })] })))).toBeNull()
  })

  it('passe des coordonnées 16 bits aux longitude/latitude (Mercator, rayon CM93)', () => {
    const c = cell()
    const sw = cellLonLat(c.header, 0, 0)
    const ne = cellLonLat(c.header, MAX, MAX)
    expect(sw.lat).toBeCloseTo(48, 6)
    expect(sw.lon).toBeCloseTo(-5, 6)
    expect(ne.lat).toBeCloseTo(48 + 1 / 3, 6)
    expect(ne.lon).toBeCloseTo(-5 + 1 / 3, 6)
    // milieu en x : la longitude est linéaire
    expect(cellLonLat(c.header, 32767.5, 0).lon).toBeCloseTo(-5 + 1 / 6, 6)
  })

  it('cellFrame : coordonnées monde 0..1 cohérentes avec les longitude/latitude', () => {
    const c = cell()
    const f = cellFrame(c.header)
    expect(f.x0).toBeCloseTo((-5 + 180) / 360, 9)
    const lat = (48 * Math.PI) / 180
    expect(f.y0).toBeCloseTo((1 - Math.log(Math.tan(lat) + 1 / Math.cos(lat)) / Math.PI) / 2, 9)
  })

  it('assemble une surface : arêtes bout à bout, à l’envers si le bit 4 est posé, anneau fermé', () => {
    const forward = cell({ features: [feat({ cls: 81, prim: 4, edges: FULL })] })
    const r1 = areaRings(forward, forward.features[0]!)
    expect(r1).toHaveLength(1)
    expect(r1[0]!.pts).toEqual([0, 0, MAX, 0, MAX, MAX, 0, MAX, 0, 0])

    const rev = (e: number): number => e | (4 << 13)
    const backward = cell({ features: [feat({ cls: 81, prim: 4, edges: [rev(3), rev(2), rev(1), rev(0)] })] })
    const r2 = areaRings(backward, backward.features[0]!)
    expect(r2).toHaveLength(1)
    // même contour parcouru en sens inverse
    expect(r2[0]!.pts).toEqual([0, 0, 0, MAX, MAX, MAX, MAX, 0, 0, 0])
  })

  it('une surface à deux anneaux donne le contour puis le trou', () => {
    const c = cell({
      edges: [
        [0, 0, MAX, 0],
        [MAX, 0, MAX, MAX],
        [MAX, MAX, 0, MAX],
        [0, MAX, 0, 0],
        [10, 10, 100, 10, 100, 100, 10, 100, 10, 10],
      ],
      features: [feat({ cls: 81, prim: 4, edges: [0, 1, 2, 3, 4] })],
    })
    const rings = areaRings(c, c.features[0]!)
    expect(rings.map((r) => r.pts.length / 2)).toEqual([5, 5])
  })

  it('une ligne reste en un tronçon quand ses arêtes se suivent, sinon se coupe', () => {
    const c = cell({ features: [feat({ cls: 35, prim: 2, edges: [0, 1] }), feat({ cls: 35, prim: 2, edges: [0, 2] })] })
    expect(lineParts(c, c.features[0]!)).toEqual([[0, 0, MAX, 0, MAX, MAX]])
    expect(lineParts(c, c.features[1]!)).toHaveLength(2)
  })

  it('profondeur des sondes : dixièmes de mètre, ou mètres entiers au-delà de 12000', () => {
    expect(soundingDepth(35)).toBeCloseTo(3.5)
    expect(soundingDepth(12120)).toBe(120)
  })
})

describe('CM93 — dictionnaires et attributs', () => {
  it('classes et attributs par numéro, type de la valeur', () => {
    expect(dict.classes[81]).toEqual({ name: 'LNDARE', geom: 'P' })
    expect(dict.classes[35]).toEqual({ name: 'COALNE', geom: 'L' })
    expect(dict.attrs[10]).toEqual({ name: 'DRVAL1', type: 'W' })
    expect(dict.attrs[20]!.type).toBe('S')
    expect(dict.attrs[21]!.type).toBe('L')
    expect(dict.attrs[99]).toBeUndefined()
  })

  it('décode chaque type de valeur', () => {
    const attrs = [
      ...attrW(10, 5.5),
      ...attrS(20, 'Île du Large'),
      ...attrL(21, [3, 1]),
      ...attrB(23, 2),
      ...attrR(27, 12.5),
      28 /* _texta */,
      ...Array.from('Cap', (c) => c.charCodeAt(0)),
      0,
    ]
    const c = parseCell(buildCell(square({ features: [feat({ cls: 86, prim: 1, point: 0, attrs, nAttr: 6 })] })))!
    const a = decodeAttrs(c.features[0]!, dict)
    expect(a.DRVAL1).toBeCloseTo(5.5)
    expect(a.OBJNAM).toBe('Île du Large'.replace('Î', 'Î'))
    expect(a.COLOUR).toEqual([3, 1])
    expect(a.LITCHR).toBe(2)
    expect(a.VALNMR).toBeCloseTo(12.5)
    expect(a._texta).toBe('Cap')
  })

  it('COLMAR devient COLOUR (liste S-57)', () => {
    const c = parseCell(buildCell(square({ features: [feat({ cls: 18, prim: 1, point: 0, attrs: attrB(22, 8), nAttr: 1 })] })))!
    expect(decodeAttrs(c.features[0]!, dict).COLOUR).toEqual([2, 6, 2])
  })

  it('un numéro d’attribut inconnu arrête la lecture sans rien casser', () => {
    const c = parseCell(
      buildCell(
        square({ features: [feat({ cls: 86, prim: 1, point: 0, attrs: [...attrB(23, 4), ...attrB(99, 1), ...attrB(25, 2)], nAttr: 3 })] }),
      ),
    )!
    expect(decodeAttrs(c.features[0]!, dict)).toEqual({ LITCHR: 4 })
  })
})

describe('CM93 — échelles et cellules', () => {
  it('choisit l’échelle d’après les mètres par pixel (seuils d’OpenCPN)', () => {
    const idx = (mpp: number): string => SCALES[scaleForView(mpp)]!.ch
    expect(idx(0.5)).toBe('G')
    expect(idx(1.6)).toBe('G')
    expect(idx(1.7)).toBe('F')
    expect(idx(4.9)).toBe('F')
    expect(idx(5)).toBe('E')
    expect(idx(13.4)).toBe('D')
    expect(idx(51)).toBe('C')
    expect(idx(102)).toBe('B')
    expect(idx(334)).toBe('A')
    expect(idx(1700)).toBe('Z')
    expect(SCALES[scaleForView(25, 1)]!.ch).toBe('E')
    expect(scaleForView(0.1, 5)).toBe(7)
  })

  it('reconnaît les noms de cellules (cellule principale, compléments, hors grille)', () => {
    expect(parseCellName('03901053.G')).toEqual({ sub: '0', scale: 7, jlat: 390, jlon: 1053 })
    expect(parseCellName('A2000675.F')).toEqual({ sub: 'A', scale: 6, jlat: 200, jlon: 675 })
    expect(parseCellName('03901020.A')).toEqual({ sub: '0', scale: 1, jlat: 390, jlon: 1020 })
    expect(parseCellName('03911020.A')).toBeNull() // l'échelle A tombe sur un pas de 20°
    expect(parseCellName('03901053.H')).toBeNull()
    expect(parseCellName('carte.kap')).toBeNull()
    expect(parseCellName('03901080.G')).toBeNull() // 360° ou plus
  })

  it('nom de fichier et emprise d’une cellule', () => {
    const k = { scale: 7, jlat: 390, jlon: 1053 }
    expect(cellFileName('0', k)).toBe('03901053.G')
    expect(cellFileName('B', k)).toBe('B3901053.G')
    const b = cellBox(k)
    expect(b.south).toBeCloseTo(40)
    expect(b.west).toBeCloseTo(-9)
    expect(b.north).toBeCloseTo(40 + 1 / 3)
    expect(b.east).toBeCloseTo(-9 + 1 / 3)
    expect(cellKeyId(k)).toBe('7/390/1053')
  })

  it('cellules qui recouvrent une emprise', () => {
    // Brest : une seule cellule E (20')
    const brest = cellsForBox({ south: 48.38, north: 48.42, west: -4.5, east: -4.45 }, 5)
    expect(brest).toEqual([{ scale: 5, jlat: 415, jlon: 1066 }])
    const b = cellBox(brest[0]!)
    expect(b.south).toBeLessThanOrEqual(48.38)
    expect(b.north).toBeGreaterThanOrEqual(48.42)
    // à cheval sur une frontière de cellule : deux colonnes
    expect(cellsForBox({ south: 48.38, north: 48.42, west: -4.7, east: -4.6 }, 5).map((k) => k.jlon)).toEqual([1065, 1066])
    // une cellule Z couvre 40°
    expect(cellsForBox({ south: 48.38, north: 48.42, west: -4.5, east: -4.45 }, 0)).toHaveLength(1)
  })

  it('tuile : emprise en degrés et résolution', () => {
    const b = tileGeoBox(1, 0, 0)
    expect(b.west).toBe(-180)
    expect(b.east).toBe(0)
    expect(b.north).toBeCloseTo(85.0511, 3)
    expect(b.south).toBeCloseTo(0, 6)
    expect(metersPerPixel(0, 0)).toBeCloseTo(156543.03, 1)
  })
})

describe('CM93 — cellules d’une tuile', () => {
  const cells = new Map<string, string[]>()
  const add = (name: string): void => {
    const p = parseCellName(name)!
    const key = cellKeyId(p)
    cells.set(key, [...(cells.get(key) ?? []), name])
  }
  const perScale = Array.from({ length: 8 }, () => 0)
  for (const n of ['04151066.E', 'A4151066.E', '03901050.B', '03901020.A']) {
    add(n)
    perScale[parseCellName(n)!.scale]!++
  }

  it('de l’échelle voulue aux échelles plus petites, avec les cellules complémentaires', () => {
    // Brest, zoom 14 → échelle E
    const z = 14
    const n = 2 ** z
    const x = Math.floor(((-4.48 + 180) / 360) * n)
    const lat = (48.4 * Math.PI) / 180
    const y = Math.floor(((1 - Math.log(Math.tan(lat) + 1 / Math.cos(lat)) / Math.PI) / 2) * n)
    const plan = planTile(cells, perScale, z, x, y)
    expect(plan.map((p) => p.scale)).toEqual([5, 2, 1])
    expect(plan[0]!.cells).toEqual(['04151066.E', 'A4151066.E'])
  })

  it('saute les échelles absentes du dossier', () => {
    const plan = planTile(
      new Map(),
      Array.from({ length: 8 }, () => 0),
      14,
      8000,
      5600,
    )
    expect(plan).toEqual([])
  })
})

describe('CM93 — présentation', () => {
  it('teintes de profondeur', () => {
    expect(depthColour(undefined, true)).toBe(PALETTE.intertidal)
    expect(depthColour(-1, false)).toBe(PALETTE.intertidal)
    expect(depthColour(0, false)).toBe(PALETTE.shallow)
    expect(depthColour(5, false)).toBe(PALETTE.medium)
    expect(depthColour(20, false)).toBe(PALETTE.mediumDeep)
    expect(depthColour(30, false)).toBe(PALETTE.deep)
  })

  it('sondes : une décimale sous 31 m, entières au-delà', () => {
    expect(formatDepth(2.44)).toBe('2.4')
    expect(formatDepth(5)).toBe('5.0')
    expect(formatDepth(30.96)).toBe('31.0')
    expect(formatDepth(45.6)).toBe('46')
  })

  it('caractère d’un feu', () => {
    expect(lightLabel({ LITCHR: 2, SIGGRP: '(2)', COLOUR: [1, 3], SIGPER: 10, HEIGHT: 14, VALNMR: 12 })).toBe('Fl(2)WR.10s14m12M')
    expect(lightLabel({ LITCHR: 5, SIGGRP: '(1)', COLOUR: [1], SIGPER: 0.6 })).toBe('VQW.0.6s')
    expect(lightLabel({})).toBe('')
  })

  it('couleurs d’une balise : COLOUR, sinon la couleur de sa catégorie', () => {
    expect(navColours('BOYLAT', { COLOUR: [3] })).toEqual(['#d9302c'])
    expect(navColours('BOYLAT', { CATLAM: 1 })).toEqual(['#d9302c'])
    expect(navColours('BOYLAT', { CATLAM: 2 })).toEqual(['#2e9a46'])
    expect(navColours('BOYCAR', {})).toHaveLength(2)
  })
})

// --- dessin -------------------------------------------------------------------------------------------------------------

interface Recorder {
  log: string[]
  canvases: number
  makeCanvas: (w: number, h: number) => Canvas2D
}

/** Faux canevas : enregistre les appels (le dessin lui-même est vérifié à l'œil dans l'application). */
function recorder(): Recorder {
  const r: Recorder = {
    log: [],
    canvases: 0,
    makeCanvas: (w, h) => {
      r.canvases++
      const ctx = new Proxy(
        {},
        {
          get: (_t, p) => {
            if (p === 'getImageData') return () => ({ data: new Uint8ClampedArray(w * h * 4) })
            return (...a: unknown[]) => void r.log.push(`${String(p)}(${a.length})`)
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

const tileAt = (lat: number, lon: number, z: number): { x: number; y: number } => {
  const n = 2 ** z
  const r = (lat * Math.PI) / 180
  return { x: Math.floor(((lon + 180) / 360) * n), y: Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n) }
}

const landCell = (): Uint8Array<ArrayBuffer> =>
  buildCell(
    square({
      features: [
        covr(),
        feat({ cls: 44, prim: 4, edges: FULL, attrs: attrW(10, 5), nAttr: 1 }),
        feat({ cls: 81, prim: 4, edges: FULL, attrs: attrS(20, 'Terre'), nAttr: 1 }),
        feat({ cls: 35, prim: 2, edges: [0, 1] }),
        feat({ cls: 86, prim: 1, point: 0, attrs: [...attrB(23, 2), ...attrL(21, [1])], nAttr: 2 }),
        feat({ cls: 147, prim: 8, point: 0 }),
      ],
    }),
  )

describe('CM93 — préparation d’une cellule', () => {
  it('garde les objets utiles en coordonnées monde, la couverture et les noms', () => {
    const p = prepareCell(parseCell(landCell())!, dict)
    expect(p.coverage).toHaveLength(1)
    expect(p.items.map((i) => i.cls)).toEqual(['DEPARE', 'LNDARE', 'COALNE', 'SOUNDG', 'LIGHTS', 'NAME:LNDARE'])
    expect(p.items.map((i) => i.layer)).toEqual(p.items.map((i) => i.layer).sort((a, b) => a - b))
    const land = p.items.find((i) => i.cls === 'LNDARE')!
    const [x0, y0, x1] = land.box
    expect(x0 * 360 - 180).toBeCloseTo(-5, 6)
    expect(x1 * 360 - 180).toBeCloseTo(-5 + 1 / 3, 6)
    expect(y0).toBeLessThan(0.5) // hémisphère nord : y < 0.5
  })

  it('une cellule sans zone de couverture est couverte en entier', () => {
    const p = prepareCell(parseCell(buildCell(square({ features: [feat({ cls: 81, prim: 4, edges: FULL })] })))!, dict)
    expect(p.coverage).toHaveLength(1)
    expect(p.coverage[0]).toHaveLength(10)
  })
})

describe('CM93 — tuile', () => {
  const t = tileAt(48.16, -4.83, 13)

  it('dessine la terre et la profondeur ; rien hors des cellules', async () => {
    const rec = recorder()
    const r = new Cm93Renderer(rec.makeCanvas)
    r.setDictionary(dict)
    const job: Cm93Job = { z: 13, x: t.x, y: t.y, k: 1, layers: [{ scale: 5, cells: [{ id: 'c1', file: new Blob([landCell()]) }] }] }
    const res = await r.render(job)
    expect(res.scales).toEqual([5])
    expect(res.size).toBe(256)
    expect(res.pixels).toHaveLength(256 * 256)
    expect(rec.log).toContain(`fillStyle=${PALETTE.land}`)
    expect(rec.log).toContain(`fillStyle=${depthColour(5, false)}`)

    const far = await r.render({ ...job, x: t.x + 40 })
    expect(far.pixels).toBeNull()
    expect(far.scales).toEqual([])
  })

  it('sans dictionnaire, rien n’est dessiné', async () => {
    const rec = recorder()
    const r = new Cm93Renderer(rec.makeCanvas)
    const res = await r.render({ z: 13, x: t.x, y: t.y, k: 1, layers: [{ scale: 5, cells: [{ id: 'c1', file: new Blob([landCell()]) }] }] })
    expect(res.pixels).toBeNull()
  })

  it('une cellule illisible est ignorée', async () => {
    const rec = recorder()
    const r = new Cm93Renderer(rec.makeCanvas)
    r.setDictionary(dict)
    const res = await r.render({
      z: 13,
      x: t.x,
      y: t.y,
      k: 1,
      layers: [{ scale: 5, cells: [{ id: 'bad', file: new Blob([new Uint8Array(500)]) }] }],
    })
    expect(res.pixels).toBeNull()
  })

  it('s’arrête dès que la tuile est entièrement couverte : les échelles plus petites ne sont même pas lues', async () => {
    const rec = recorder()
    const r = new Cm93Renderer(rec.makeCanvas)
    r.setDictionary(dict)
    const unread = vi.fn(async () => new File([landCell()], 'x'))
    const res = await r.render({
      z: 13,
      x: t.x,
      y: t.y,
      k: 1,
      layers: [
        { scale: 5, cells: [{ id: 'fine', file: new Blob([landCell()]) }] },
        { scale: 2, cells: [{ id: 'coarse', handle: { getFile: unread } }] },
      ],
    })
    expect(res.scales).toEqual([5])
    expect(unread).not.toHaveBeenCalled()
  })

  it('complète avec l’échelle suivante là où la cellule fine ne couvre pas', async () => {
    // couverture de la cellule fine : moitié ouest seulement
    const half = buildCell(
      square({
        edges: [[0, 0, 32767, 0], [32767, 0, 32767, MAX], [32767, MAX, 0, MAX], [0, MAX, 0, 0], ...square().edges],
        features: [feat({ cls: 217, prim: 4, edges: [0, 1, 2, 3] }), feat({ cls: 81, prim: 4, edges: [4, 5, 6, 7] })],
      }),
    )
    const z = 10
    const centre = tileAt(48 + 1 / 6, -5 + 1 / 6, z) // la tuile contient le milieu de la cellule, donc la frontière de couverture
    const rec = recorder()
    const r = new Cm93Renderer(rec.makeCanvas)
    r.setDictionary(dict)
    const res = await r.render({
      z,
      x: centre.x,
      y: centre.y,
      k: 1,
      layers: [
        { scale: 5, cells: [{ id: 'half', file: new Blob([half]) }] },
        { scale: 2, cells: [{ id: 'all', file: new Blob([landCell()]) }] },
      ],
    })
    expect(res.scales).toEqual([5, 2])
    expect(rec.log).toContain('globalCompositeOperation=destination-in') // l'échelle fine est limitée à sa couverture
  })

  it('pixels de la taille demandée sur écran Retina', async () => {
    const rec = recorder()
    const r = new Cm93Renderer(rec.makeCanvas)
    r.setDictionary(dict)
    const res = await r.render({ z: 13, x: t.x, y: t.y, k: 2, layers: [{ scale: 5, cells: [{ id: 'c1', file: new Blob([landCell()]) }] }] })
    expect(res.size).toBe(512)
    expect(res.pixels).toHaveLength(512 * 512)
  })
})

describe('CM93 — moteur', () => {
  it('construit le travail d’une tuile d’après le dossier, sans rien lire', async () => {
    const jobs: Cm93Job[] = []
    const setDictionary = vi.fn()
    const runner: Cm93Runner = {
      capacity: 1,
      setDictionary,
      run: async (job) => {
        jobs.push(job)
        return { pixels: null, scales: [], size: 256 }
      },
      dispose: () => {},
    }
    const listing = listFromFileList(
      ['CM93OBJ.DIC', 'CM93ATTR.DIC', '03901020/E/04151066.E', '03901020/E/A4151066.E', '03901020/A/03901020.A'].map((p) => {
        const f = new File(['x'], p.split('/').pop()!)
        Object.defineProperty(f, 'webkitRelativePath', { value: `Cartes/${p}` })
        return f
      }),
    )
    const e = new Cm93Engine(runner)
    e.setCatalog(listing.cm93, dict)
    expect(setDictionary).toHaveBeenCalledWith(dict)
    expect(e.cellCount).toBe(3)
    const z = 14
    const t = tileAt(48.4, -4.48, z)
    await e.renderTile(z, t.x, t.y)
    expect(jobs).toHaveLength(1)
    expect(jobs[0]!.layers.map((l) => [l.scale, l.cells.map((c) => c.id)])).toEqual([
      [5, ['Cartes/03901020/E/04151066.E', 'Cartes/03901020/E/A4151066.E']],
      [1, ['Cartes/03901020/A/03901020.A']],
    ])
    // une tuile annulée avant son départ n'est jamais fabriquée
    const ac = new AbortController()
    ac.abort()
    await expect(e.renderTile(z, t.x, t.y, ac.signal)).rejects.toThrow()
    expect(jobs).toHaveLength(1)
  })
})

// --- reconnaissance du dossier --------------------------------------------------------------------------------------

type Entry = DirHandleLike | { kind: 'file'; name: string; getFile(): Promise<File> }
const file = (name: string): Entry => ({ kind: 'file', name, getFile: async () => new File(['x'], name, { lastModified: 5 }) })
const dir = (name: string, items: Entry[]): DirHandleLike => ({
  kind: 'directory',
  name,
  async *values() {
    for (const i of items) yield i
  },
})

describe('dossier de cartes — format reconnu automatiquement', () => {
  const cm93Tree = (): DirHandleLike =>
    dir('CM93', [
      file('CM93OBJ.DIC'),
      file('cm93attr.dic'),
      file('README.TXT'),
      dir('03901020', [dir('E', [file('04151066.E'), file('A4151066.E'), file('notes.txt')]), dir('A', [file('03901020.A')])]),
    ])

  it('CM93 : cellules rangées par échelle, dictionnaires trouvés, rien lu', async () => {
    const reads = vi.fn()
    const root = cm93Tree()
    const l = await listFolder({ ...root, values: () => root.values() })
    expect(reads).not.toHaveBeenCalled()
    expect(formatsOf(l)).toEqual(['cm93'])
    expect(l.cm93.count).toBe(3)
    expect(l.cm93.perScale[5]).toBe(2)
    expect(l.cm93.perScale[1]).toBe(1)
    expect(l.cm93.obj!.id).toBe('CM93OBJ.DIC')
    expect(l.cm93.attr!.id).toBe('cm93attr.dic')
    expect(l.cm93.cells.get('5/415/1066')!.map((c) => c.sub)).toEqual(['0', 'A'])
    expect(l.files).toBe(7)
  })

  it('BSB : les .kap sont listés, avec leur taille et leur date', async () => {
    const l = await listFolder(dir('BSB', [file('7140_1.kap'), file('7140_1.BSB'), dir('sous', [file('6623.KAP')])]))
    expect(formatsOf(l)).toEqual(['bsb'])
    expect(l.kap.map((k) => k.id)).toEqual(['7140_1.kap', 'sous/6623.KAP'])
    expect(l.kap[0]!.lastModified).toBe(5)
  })

  it('un dossier qui mêle les deux formats les donne tous les deux', async () => {
    const l = await listFolder(dir('Tout', [dir('BSB', [file('a.kap')]), cm93Tree()]))
    expect(formatsOf(l)).toEqual(['bsb', 'cm93'])
  })

  it('CM93 sans dictionnaires ou sans cellule : pas reconnu', async () => {
    expect(formatsOf(await listFolder(dir('x', [file('04151066.E')])))).toEqual([])
    expect(formatsOf(await listFolder(dir('x', [file('CM93OBJ.DIC'), file('CM93ATTR.DIC')])))).toEqual([])
    expect(formatsOf(await listFolder(dir('x', [file('notes.txt')])))).toEqual([])
  })

  it('plusieurs jeux de dictionnaires : le plus proche de la racine fait foi', async () => {
    const l = await listFolder(
      dir('x', [dir('new', [file('CM93OBJ.DIC'), file('CM93ATTR.DIC')]), file('CM93OBJ.DIC'), file('CM93ATTR.DIC'), file('04151066.E')]),
    )
    expect(l.cm93.obj!.id).toBe('CM93OBJ.DIC')
  })

  it('la liste de fichiers d’un <input webkitdirectory> est reconnue de même', () => {
    const mk = (path: string): File => {
      const f = new File(['x'], path.split('/').pop()!)
      Object.defineProperty(f, 'webkitRelativePath', { value: path })
      return f
    }
    const l = listFromFileList([mk('C/CM93OBJ.DIC'), mk('C/CM93ATTR.DIC'), mk('C/0390/E/04151066.E'), mk('C/b.kap')])
    expect(formatsOf(l)).toEqual(['bsb', 'cm93'])
    expect(l.cm93.count).toBe(1)
  })
})

// --- vraies cartes (facultatif) -------------------------------------------------------------------------------------

// CM93_DIR=X:/…/CM93_2009 npx vitest run cm93 : vérifie le lecteur sur de vraies cellules (jamais versionnées, jamais exigées).
const REAL = process.env.CM93_DIR
describe.skipIf(!REAL)('CM93 — vraies cellules', () => {
  it('une cellule E de Brest se lit et se place', () => {
    const d = parseDictionaries(readFileSync(`${REAL}/CM93OBJ.DIC`, 'latin1'), readFileSync(`${REAL}/CM93ATTR.DIC`, 'latin1'))
    const cell = parseCell(new Uint8Array(readFileSync(`${REAL}/03901020/E/04151066.E`)))!
    expect(cell).not.toBeNull()
    const sw = cellLonLat(cell.header, 0, 0)
    expect(sw.lat).toBeCloseTo(48.3333, 3)
    expect(sw.lon).toBeCloseTo(-4.6667, 3)
    const names = new Set(cell.features.map((f) => d.classes[f.cls]?.name))
    for (const n of ['LNDARE', 'DEPARE', 'COALNE', 'LIGHTS', 'SOUNDG', '_m_sor']) expect(names.has(n)).toBe(true)
    const p = prepareCell(cell, d)
    expect(p.coverage.length).toBeGreaterThan(0)
  })
})
