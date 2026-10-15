import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { buildGpx, parseGpx } from '../gpx'
import { DEFAULT_COLOR, DEFAULT_SYMBOL } from '../symbols'
import { DEFAULT_EXPORT_NAME, MAX_GPX_SETS, gpxFileName, mergeGpxSets, mergedGpxText, readGpxSet, type GpxSet } from '../gpxSets'
import { LIMITS, type Route, type Waypoint } from '../types'
import { useGpxSets } from '@/stores/gpxSets'

const real = readFileSync(fileURLToPath(new URL('../../../public/data/waypoints_GP39.gpx', import.meta.url)), 'utf8')

const wp = (id: number, name: string, lat: number, lon: number, symbol = 0, color = 2): Waypoint => ({
  id,
  name,
  lat,
  lon,
  symbol,
  color,
  comment: '',
  display: true,
})

function setOf(id: number, fileName: string, wpts: Waypoint[], routes: Route[] = []): GpxSet {
  const r = readGpxSet(id, fileName, buildGpx(wpts, routes))
  if (!r.ok) throw new Error(r.error)
  return r.set
}

const route = (no: number, name: string, ...ids: number[]): Route => ({
  no,
  name,
  comment: '',
  points: ids.map((wptId) => ({ wptId, skip: false })),
})

describe('lecture d’un fichier GPX chargé à part', () => {
  it('lit le fichier réel : 2252 waypoints', () => {
    const r = readGpxSet(1, 'waypoints_GP39.gpx', real)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.set.waypoints).toHaveLength(2252)
    expect(r.set.waypoints.map((w) => w.id)).toEqual(Array.from({ length: 2252 }, (_, i) => i + 1))
    expect(r.set.fileName).toBe('waypoints_GP39.gpx')
    expect(r.set.warnings.join(' ')).toContain('sans <name>')
  })

  it('refuse un fichier sans waypoint ni route, en nommant le fichier (traces seules, XML invalide)', () => {
    const trackOnly = '<gpx version="1.1"><trk><trkseg><trkpt lat="48" lon="-4"/></trkseg></trk></gpx>'
    for (const xml of [trackOnly, 'pas du xml', '']) {
      const r = readGpxSet(7, 'trace.gpx', xml)
      expect(r.ok).toBe(false)
      if (!r.ok) expect(r.error).toContain('trace.gpx')
    }
  })
})

describe('fusion', () => {
  it('concatène les waypoints dans l’ordre des fichiers, ids renumérotés de 1 à n', () => {
    const a = setOf(1, 'a.gpx', [wp(1, 'A1', 48, -4), wp(2, 'A2', 48.1, -4)])
    const b = setOf(2, 'b.gpx', [wp(1, 'B1', 49, -3)])
    const m = mergeGpxSets([a, b], { dedupe: true })
    expect(m.waypoints.map((w) => w.name)).toEqual(['A1', 'A2', 'B1'])
    expect(m.waypoints.map((w) => w.id)).toEqual([1, 2, 3])
    expect(m.stats).toMatchObject({ waypoints: 3, routes: 0, duplicates: 0 })
    expect(m.warnings).toEqual([])
  })

  it('rien à fusionner : résultat vide', () => {
    const m = mergeGpxSets([], { dedupe: true })
    expect(m.waypoints).toHaveLength(0)
    expect(m.routes).toHaveLength(0)
  })

  it('le même fichier chargé deux fois : la 2e copie est supprimée, ou tout conservé si l’option est décochée', () => {
    const r = readGpxSet(1, 'x.gpx', real)
    if (!r.ok) throw new Error(r.error)
    const twice = mergeGpxSets([r.set, { ...r.set, id: 2 }], { dedupe: true })
    expect(twice.waypoints).toHaveLength(2252)
    expect(twice.stats.duplicates).toBe(2252)
    expect(twice.warnings.join(' ')).toContain('2252 doublon(s) supprimé(s)')
    expect(mergeGpxSets([r.set, { ...r.set, id: 2 }], { dedupe: false }).waypoints).toHaveLength(2 * 2252)
  })

  it('un fichier seul est exporté sans perte : ses propres répétitions (feux à secteurs d’une même position) sont conservées', () => {
    // waypoints_GP39.gpx contient 262 points identiques (violets, sans nom, même position)
    const r = readGpxSet(1, 'x.gpx', real)
    if (!r.ok) throw new Error(r.error)
    const m = mergeGpxSets([r.set], { dedupe: true })
    expect(m.waypoints).toHaveLength(2252)
    expect(m.stats.duplicates).toBe(0)
    const a = setOf(1, 'a.gpx', [wp(1, 'P', 48, -4), wp(2, 'P', 48, -4)])
    const b = setOf(2, 'b.gpx', [wp(1, 'P', 48, -4), wp(2, 'P', 48, -4)])
    // 2 dans A (conservés), 2 dans B (déjà présents dans A : supprimés)
    expect(mergeGpxSets([a, b], { dedupe: true }).waypoints).toHaveLength(2)
  })

  it('un doublon exige le même nom, la même position (à 1 m près), le même symbole et la même couleur', () => {
    const a = setOf(1, 'a.gpx', [wp(1, 'P', 48, -4, 0, 2)])
    const same = setOf(2, 'b.gpx', [wp(1, 'P', 48.000001, -4.000001, 0, 2)]) // ≈ 0,15 m
    const otherColor = setOf(3, 'c.gpx', [wp(1, 'P', 48, -4, 0, 3)])
    const otherSymbol = setOf(4, 'd.gpx', [wp(1, 'P', 48, -4, 8, 2)])
    const otherName = setOf(5, 'e.gpx', [wp(1, 'Q', 48, -4, 0, 2)])
    const far = setOf(6, 'f.gpx', [wp(1, 'P', 48.001, -4, 0, 2)]) // ≈ 111 m
    const m = mergeGpxSets([a, same, otherColor, otherSymbol, otherName, far], { dedupe: true })
    expect(m.waypoints.map((w) => `${w.name}/${w.symbol}/${w.color}`)).toEqual(['P/0/2', 'P/0/3', 'P/8/2', 'Q/0/2', 'P/0/2'])
    expect(m.stats.duplicates).toBe(1)
  })

  it('conserve les attributs : symbole, couleur, commentaire, affichage', () => {
    const w: Waypoint = { id: 1, name: 'SKULL', lat: 47.5, lon: -3.5, symbol: 8, color: 0, comment: 'A&B', display: false }
    const m = mergeGpxSets([setOf(1, 'a.gpx', [w])], { dedupe: true })
    expect(m.waypoints[0]).toMatchObject({ name: 'SKULL', symbol: 8, color: 0, comment: 'A&B', display: false })
  })

  it('les routes sont renumérotées de 1 à n et leurs points pointent sur les waypoints fusionnés', () => {
    const a = setOf(1, 'a.gpx', [wp(1, 'A1', 48, -4), wp(2, 'A2', 48.1, -4)], [route(1, 'RA', 1, 2)])
    // B contient A2 (doublon supprimé) puis B3 : sa route doit retrouver A2 dans la liste fusionnée
    const b = setOf(2, 'b.gpx', [wp(1, 'A2', 48.1, -4), wp(2, 'B3', 49, -3)], [route(7, 'RB', 1, 2)])
    const m = mergeGpxSets([a, b], { dedupe: true })
    expect(m.waypoints.map((w) => w.name)).toEqual(['A1', 'A2', 'B3'])
    expect(m.routes.map((r) => [r.no, r.name])).toEqual([
      [1, 'RA'],
      [2, 'RB'],
    ])
    expect(m.routes[1]!.points.map((p) => p.wptId)).toEqual([2, 3])
    // aller-retour par le format GP39_WptRte.gpx
    const back = parseGpx(mergedGpxText(m))
    expect(back.waypoints).toHaveLength(3)
    expect(back.routes.map((r) => r.points.map((p) => p.name))).toEqual([
      ['A1', 'A2'],
      ['A2', 'B3'],
    ])
  })

  it('une route identique dans deux fichiers n’est gardée qu’une fois (sauf si les doublons sont conservés)', () => {
    const mk = (id: number): GpxSet => setOf(id, `f${id}.gpx`, [wp(1, 'A1', 48, -4), wp(2, 'A2', 48.1, -4)], [route(1, 'RT', 1, 2)])
    const m = mergeGpxSets([mk(1), mk(2)], { dedupe: true })
    expect(m.routes).toHaveLength(1)
    expect(m.waypoints).toHaveLength(2)
    expect(mergeGpxSets([mk(1), mk(2)], { dedupe: false }).routes).toHaveLength(2)
  })

  it('une route venue d’un autre logiciel (rtept sans wpt) : un waypoint est créé par point, partagé si même position', () => {
    const xml = `<?xml version="1.0"?><gpx version="1.1">
      <rte><name>R1</name><rtept lat="48.0" lon="-4.0"><name>ALPHA</name></rtept><rtept lat="48.5" lon="-4.5"><name>BETA</name></rtept></rte>
      <rte><name>R2</name><rtept lat="48.5" lon="-4.5"><name>BETA</name></rtept><rtept lat="49.0" lon="-5.0"/></rte>
    </gpx>`
    const r = readGpxSet(1, 'opencpn.gpx', xml)
    if (!r.ok) throw new Error(r.error)
    const m = mergeGpxSets([r.set], { dedupe: true })
    expect(m.waypoints.map((w) => w.name)).toEqual(['ALPHA', 'BETA', ''])
    expect(m.waypoints.every((w) => w.symbol === DEFAULT_SYMBOL && w.color === DEFAULT_COLOR && w.display)).toBe(true)
    expect(m.stats.createdFromRoutes).toBe(3)
    expect(m.routes.map((x) => x.points.map((p) => p.wptId))).toEqual([
      [1, 2],
      [2, 3],
    ])
    expect(m.warnings.join(' ')).toContain('waypoint créé')
    expect(parseGpx(mergedGpxText(m)).routes[1]!.points).toHaveLength(2)
  })

  it('respecte la limite de 10 000 waypoints du GP-39 et le signale', () => {
    const many = (id: number, from: number): GpxSet =>
      setOf(
        id,
        `f${id}.gpx`,
        Array.from({ length: 6000 }, (_, i) => wp(i + 1, `W${from + i}`, 40 + (from + i) * 1e-4, 5)),
      )
    const m = mergeGpxSets([many(1, 0), many(2, 6000)], { dedupe: true })
    expect(m.waypoints).toHaveLength(LIMITS.waypoints)
    expect(m.stats.droppedWaypoints).toBe(2000)
    expect(m.warnings.join(' ')).toContain('2000 waypoint(s) ignoré(s)')
    expect(new Set(m.waypoints.map((w) => w.id)).size).toBe(LIMITS.waypoints)
  })

  it('respecte la limite de 100 routes et le signale', () => {
    const wpts = Array.from({ length: 101 }, (_, i) => wp(i + 1, `W${i}`, 40 + i * 0.01, 5))
    const routes = wpts.map((w, i) => route(i + 1, `R${i}`, w.id))
    const m = mergeGpxSets([setOf(1, 'a.gpx', wpts, routes)], { dedupe: true })
    expect(m.routes).toHaveLength(LIMITS.routes)
    expect(m.stats.droppedRoutes).toBe(1)
    expect(m.routes.at(-1)!.no).toBe(100)
    expect(m.warnings.join(' ')).toContain('1 route(s) ignorée(s)')
  })

  it('le fichier fusionné se relit tel quel (waypoints et routes de 3 fichiers)', () => {
    const r = readGpxSet(1, 'waypoints_GP39.gpx', real)
    if (!r.ok) throw new Error(r.error)
    const b = setOf(2, 'b.gpx', [wp(1, 'B1', 52.1, -9.8, 9, 4), wp(2, 'B2', 52.2, -9.7, 2, 1)], [route(1, 'IRL', 1, 2)])
    const c = setOf(3, 'c.gpx', [wp(1, 'C1', 50.1, -5.1)])
    const m = mergeGpxSets([r.set, b, c], { dedupe: true })
    const xml = mergedGpxText(m)
    expect(xml.startsWith('<?xml')).toBe(true)
    const back = parseGpx(xml)
    expect(back.waypoints).toHaveLength(m.waypoints.length)
    expect(back.waypoints.find((w) => w.name === 'B1')).toMatchObject({ symbol: 9, color: 4 })
    expect(back.routes).toHaveLength(1)
    expect(back.routes[0]!.name).toBe('IRL')
  })
})

describe('nom du fichier exporté', () => {
  it('ajoute .gpx, sans le doubler et sans tenir compte de la casse', () => {
    expect(gpxFileName('mon fichier')).toBe('mon fichier.gpx')
    expect(gpxFileName('mon fichier.gpx')).toBe('mon fichier.gpx')
    expect(gpxFileName('Brest.GPX')).toBe('Brest.gpx')
    expect(gpxFileName('  espaces autour  ')).toBe('espaces autour.gpx')
  })

  it('remplace les caractères interdits par « _ » et garde les accents', () => {
    expect(gpxFileName('a/b\\c:d*e?f"g<h>i|j')).toBe('a_b_c_d_e_f_g_h_i_j.gpx')
    expect(gpxFileName('Bretagne été 2026')).toBe('Bretagne été 2026.gpx')
    expect(gpxFileName('a\u0001b\u001fc')).toBe('a_b_c.gpx')
  })

  it('nom vide ou fait uniquement de points/espaces : retombe sur le nom reconnu par le GP-39', () => {
    for (const raw of ['', '   ', '...', ' . ', '.gpx']) expect(gpxFileName(raw)).toBe(`${DEFAULT_EXPORT_NAME}.gpx`)
    expect(DEFAULT_EXPORT_NAME).toBe('GP39_WptRte')
  })

  it('pas de point ni d’espace en fin de nom (interdit sous Windows)', () => {
    expect(gpxFileName('nom.')).toBe('nom.gpx')
    expect(gpxFileName('nom.gpx.')).toBe('nom.gpx')
  })

  it('évite les noms de périphériques Windows', () => {
    expect(gpxFileName('CON')).toBe('_CON.gpx')
    expect(gpxFileName('nul.txt')).toBe('_nul.txt.gpx')
    expect(gpxFileName('com1')).toBe('_com1.gpx')
    expect(gpxFileName('console')).toBe('console.gpx')
  })

  it('limite la longueur du nom à 96 caractères (100 avec .gpx)', () => {
    const n = gpxFileName('x'.repeat(300))
    expect(n).toBe(`${'x'.repeat(96)}.gpx`)
    expect(n.length).toBe(100)
  })
})

describe('store des fichiers GPX chargés à part', () => {
  beforeEach(() => setActivePinia(createPinia()))
  const gpx1 = (n: number): string => buildGpx([wp(1, `W${n}`, 48 + n * 0.1, -4)], [])

  it(`accepte ${MAX_GPX_SETS} fichiers au plus puis refuse le suivant, sans le charger`, () => {
    const s = useGpxSets()
    for (let i = 1; i <= MAX_GPX_SETS; i++) expect(s.add(`f${i}.gpx`, gpx1(i)).ok).toBe(true)
    expect(s.count).toBe(5)
    expect(s.full).toBe(true)
    const r = s.add('f6.gpx', gpx1(6))
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toContain('5 fichiers GPX au maximum')
    expect(s.count).toBe(5)
  })

  it('retirer un fichier libère une place ; les ids ne sont jamais réutilisés', () => {
    const s = useGpxSets()
    for (let i = 1; i <= 5; i++) s.add(`f${i}.gpx`, gpx1(i))
    const ids = s.sets.map((x) => x.id)
    s.remove(ids[2]!)
    expect(s.count).toBe(4)
    expect(s.full).toBe(false)
    const r = s.add('nouveau.gpx', gpx1(9))
    expect(r.ok).toBe(true)
    if (r.ok) expect(ids).not.toContain(r.set.id)
    expect(s.sets.map((x) => x.fileName)).toEqual(['f1.gpx', 'f2.gpx', 'f4.gpx', 'f5.gpx', 'nouveau.gpx'])
  })

  it('un fichier invalide n’occupe pas de place', () => {
    const s = useGpxSets()
    expect(s.add('vide.gpx', '<gpx/>').ok).toBe(false)
    expect(s.count).toBe(0)
  })

  it('la fusion suit les fichiers, l’option « doublons » et se vide avec « tout retirer »', () => {
    const s = useGpxSets()
    s.add('a.gpx', gpx1(1))
    s.add('b.gpx', gpx1(1)) // même waypoint
    expect(s.merged.waypoints).toHaveLength(1)
    s.dedupe = false
    expect(s.merged.waypoints).toHaveLength(2)
    s.dedupe = true
    s.clear()
    expect(s.count).toBe(0)
    expect(s.merged.waypoints).toHaveLength(0)
  })

  it('nom d’export et option « doublons » : valeurs par défaut', () => {
    const s = useGpxSets()
    expect(s.exportName).toBe(DEFAULT_EXPORT_NAME)
    expect(s.dedupe).toBe(true)
  })
})
