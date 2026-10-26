// Éditeur de routes : noms et commentaires du GP-39, points d'une route, longueurs, contrôles, export GPX et enregistrement.
import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useDevice } from '@/stores/device'
import { buildGpx, parseGpx } from '@/gp39/gpx'
import {
  cleanRouteComment,
  cleanRouteName,
  deviceExportReport,
  draftFromRoute,
  emptyDraft,
  insertPoint,
  movePoint,
  nameCounts,
  removePoint,
  reversePoints,
  routeBounds,
  routeIssues,
  routeStats,
  toggleSkip,
  typeRouteName,
  validateDraft,
  type RouteContext,
} from '@/gp39/routes'
import { LIMITS, type Route, type RoutePoint, type Waypoint } from '@/gp39/types'

const wpt = (id: number, name: string, lat = 47 + id * 0.01, lon = -3): Waypoint => ({
  id,
  name,
  lat,
  lon,
  symbol: 0,
  color: 2,
  comment: '',
  display: true,
})
const pts = (...ids: number[]): RoutePoint[] => ids.map((wptId) => ({ wptId, skip: false }))
const ctxOf = (waypoints: Waypoint[], routes: Route[] = []): RouteContext => ({
  routes,
  byId: new Map(waypoints.map((w) => [w.id, w])),
  nameCount: nameCounts(waypoints),
})

describe('noms et commentaires du GP-39', () => {
  it('passent en majuscules, perdent les caractères que l’appareil ne saisit pas, et sont bornés', () => {
    expect(cleanRouteName('brest')).toBe('BREST')
    expect(cleanRouteName('Route 12')).toBe('ROUTE') // 6 caractères : « ROUTE  » → espace final retiré
    expect(cleanRouteName('a$b#c é')).toBe('ABC')
    expect(cleanRouteName('  x_y-1 ')).toBe('X_Y-1')
    expect(cleanRouteName('ABCDEFGHI')).toBe('ABCDEF')
    expect(cleanRouteComment('retour du large, 2e jour !')).toBe('RETOUR DU LARGE 2E') // 18 caractères, sans virgule ni point d'exclamation
    expect(cleanRouteComment('a'.repeat(40))).toHaveLength(LIMITS.routeCommentLen)
  })

  it('le filtre à la frappe garde les espaces (sinon on ne pourrait pas écrire « AB C »)', () => {
    expect(typeRouteName('ab ')).toBe('AB ')
    expect(typeRouteName('ab c')).toBe('AB C')
    expect(typeRouteName('ab c!')).toBe('AB C')
  })
})

describe('points d’une route', () => {
  it('ajoute à la fin ou à une position, sans modifier la liste reçue', () => {
    const base = pts(1, 2)
    const r = insertPoint(base, 3)
    expect(r).toMatchObject({ ok: true, index: 2 })
    if (r.ok) expect(r.points.map((p) => p.wptId)).toEqual([1, 2, 3])
    const mid = insertPoint(base, 9, 1)
    if (mid.ok) expect(mid.points.map((p) => p.wptId)).toEqual([1, 9, 2])
    expect(base.map((p) => p.wptId)).toEqual([1, 2])
  })

  it('refuse un waypoint identique à son voisin, accepte un retour au point de départ', () => {
    expect(insertPoint(pts(1, 2), 2).ok).toBe(false)
    expect(insertPoint(pts(1, 2), 1, 0).ok).toBe(false)
    expect(insertPoint(pts(1, 2, 3), 1)).toMatchObject({ ok: true }) // 1 → 2 → 3 → 1
    expect(insertPoint(pts(1, 2), 1, 1).ok).toBe(false) // entre 1 et 2 : voisin des deux
  })

  it('refuse le 31e waypoint', () => {
    const full = pts(...Array.from({ length: LIMITS.routeWaypoints }, (_, i) => i + 1))
    const r = insertPoint(full, 99)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toContain('30')
    expect(insertPoint(full.slice(0, 29), 99).ok).toBe(true)
  })

  it('supprime, déplace, ignore (skip) et inverse', () => {
    expect(removePoint(pts(1, 2, 3), 1).map((p) => p.wptId)).toEqual([1, 3])
    expect(movePoint(pts(1, 2, 3, 4), 0, 2).map((p) => p.wptId)).toEqual([2, 3, 1, 4])
    expect(movePoint(pts(1, 2, 3, 4), 3, 0).map((p) => p.wptId)).toEqual([4, 1, 2, 3])
    expect(movePoint(pts(1, 2), 0, 5).map((p) => p.wptId)).toEqual([1, 2]) // hors limites : inchangé
    expect(toggleSkip(pts(1, 2, 3), 1).map((p) => p.skip)).toEqual([false, true, false])
    expect(toggleSkip(toggleSkip(pts(1, 2), 0), 0).map((p) => p.skip)).toEqual([false, false])
    expect(reversePoints(pts(1, 2, 3)).map((p) => p.wptId)).toEqual([3, 2, 1])
  })
})

describe('longueur de la route', () => {
  // waypoints alignés vers le nord, espacés de 0,01° de latitude = 0,6 NM
  const ws = [wpt(1, 'A'), wpt(2, 'B'), wpt(3, 'C'), wpt(4, 'D')]
  const byId = new Map(ws.map((w) => [w.id, w]))

  it('somme les tronçons, avec leur longueur et leur relèvement', () => {
    const s = routeStats(pts(1, 2, 3), byId)
    expect(s.legs).toHaveLength(2)
    expect(s.legs[0]).toMatchObject({ index: 1 })
    expect(s.legs[0]!.nm).toBeCloseTo(0.6, 2)
    expect(s.legs[0]!.brg).toBeCloseTo(0, 1)
    expect(s.totalNm).toBeCloseTo(1.2, 2)
    expect(s.activePoints).toBe(3)
  })

  it('un point « skip » est sauté : le tronçon va du point précédent au suivant', () => {
    const p = toggleSkip(pts(1, 2, 3), 1)
    const s = routeStats(p, byId)
    expect(s.legs).toHaveLength(1)
    expect(s.legs[0]).toMatchObject({ index: 2 })
    expect(s.legs[0]!.from.id).toBe(1)
    expect(s.legs[0]!.to.id).toBe(3)
    expect(s.totalNm).toBeCloseTo(1.2, 2)
    expect(s.activePoints).toBe(2)
  })

  it('ignore un waypoint disparu, et une route vide ou à un point n’a aucun tronçon', () => {
    expect(routeStats(pts(1, 99, 3), byId).legs).toHaveLength(1)
    expect(routeStats([], byId)).toMatchObject({ legs: [], totalNm: 0, activePoints: 0 })
    expect(routeStats(pts(1), byId).totalNm).toBe(0)
  })

  it('le rectangle englobant sert à cadrer la carte', () => {
    expect(routeBounds(pts(2, 4), byId)).toEqual([
      { lat: 47.02, lon: -3 },
      { lat: 47.04, lon: -3 },
    ])
    expect(routeBounds([], byId)).toBeNull()
    expect(routeBounds(pts(99), byId)).toBeNull()
  })
})

describe('contrôle d’une route avant enregistrement', () => {
  const ws = [wpt(1, 'A'), wpt(2, 'B'), wpt(3, 'C')]
  const other: Route = { no: 5, name: 'BREST', comment: '', points: pts(1, 2) }

  it('une route correcte n’a ni erreur ni avertissement', () => {
    const d = { ...emptyDraft(), name: 'LORIEN', points: pts(1, 2, 3) }
    expect(validateDraft(d, ctxOf(ws))).toEqual({ errors: [], warnings: [] })
  })

  it('le nom est obligatoire et unique (sans tenir compte de la casse), sauf pour la route éditée elle-même', () => {
    expect(validateDraft({ ...emptyDraft(), name: '  ', points: pts(1, 2) }, ctxOf(ws)).errors.join(' ')).toContain('nom')
    expect(validateDraft({ ...emptyDraft(), name: 'brest', points: pts(1, 2) }, ctxOf(ws, [other])).errors.join(' ')).toContain('BREST')
    expect(validateDraft({ ...draftFromRoute(other) }, ctxOf(ws, [other])).errors).toEqual([])
  })

  it('moins de 2 waypoints : avertissement seulement (on peut enregistrer à tout moment)', () => {
    const v = validateDraft({ ...emptyDraft(), name: 'X', points: pts(1) }, ctxOf(ws))
    expect(v.errors).toEqual([])
    expect(v.warnings.join(' ')).toContain('incomplète')
    expect(validateDraft({ ...emptyDraft(), name: 'X' }, ctxOf(ws)).errors).toEqual([])
  })

  it('plus de 30 points, waypoint disparu ou sans nom : erreurs', () => {
    const many = pts(...Array.from({ length: 31 }, (_, i) => (i % 2 ? 1 : 2)))
    expect(validateDraft({ ...emptyDraft(), name: 'X', points: many }, ctxOf(ws)).errors.join(' ')).toContain('30')
    expect(validateDraft({ ...emptyDraft(), name: 'X', points: pts(1, 99) }, ctxOf(ws)).errors.join(' ')).toContain('existent plus')
    const unnamed = [wpt(1, 'A'), wpt(2, '')]
    expect(validateDraft({ ...emptyDraft(), name: 'X', points: pts(1, 2) }, ctxOf(unnamed)).errors.join(' ')).toContain('sans nom')
  })

  it('un nom porté par plusieurs waypoints, ou hors du jeu de caractères : avertissements', () => {
    const dup = [wpt(1, 'A'), wpt(2, 'A'), wpt(3, 'abc')]
    const v = validateDraft({ ...emptyDraft(), name: 'X', points: pts(1, 2, 3) }, ctxOf(dup))
    expect(v.errors).toEqual([])
    expect(v.warnings.join(' ')).toContain('plusieurs waypoints')
    expect(v.warnings.join(' ')).toContain('abc')
  })
})

describe('rapport avant export vers le GP-39', () => {
  const ws = [wpt(1, 'A'), wpt(2, 'B'), wpt(3, '')]

  it('signale ce qui empêcherait l’appareil de relire une route', () => {
    const routes: Route[] = [
      { no: 1, name: 'OK', comment: '', points: pts(1, 2) },
      { no: 2, name: 'SANSNOM', comment: '', points: pts(1, 3) },
      { no: 3, name: 'ok', comment: 'x', points: pts(2) },
    ]
    const r = deviceExportReport(ws, routes)
    expect(r.filter((f) => f.route === 'OK' && f.severity === 'error')).toEqual([])
    expect(r.some((f) => f.route === 'SANSNOM' && f.severity === 'error' && f.text.includes('sans nom'))).toBe(true)
    expect(r.some((f) => f.route === 'SANSNOM' && f.text.includes('corrigé'))).toBe(true) // 7 caractères
    expect(r.some((f) => f.route === 'ok' && f.text.includes('déjà utilisé'))).toBe(true)
    expect(r.some((f) => f.route === 'ok' && f.text.includes('incomplète'))).toBe(true)
  })

  it('plus de 100 routes : erreur', () => {
    const many: Route[] = Array.from({ length: 101 }, (_, i) => ({ no: i + 1, name: `R${i}`, comment: '', points: pts(1, 2) }))
    expect(deviceExportReport(ws, many).some((f) => f.severity === 'error' && f.text.includes('100'))).toBe(true)
  })

  it('aucun problème : rapport vide', () => {
    expect(deviceExportReport(ws, [{ no: 1, name: 'R1', comment: 'ALLER', points: pts(1, 2) }])).toEqual([])
  })

  it('routeIssues relève un waypoint disparu', () => {
    const r: Route = { no: 1, name: 'R1', comment: '', points: pts(1, 77) }
    expect(routeIssues(r, ctxOf(ws, [r])).errors.join(' ')).toContain('existent plus')
  })
})

describe('export et relecture GPX des routes', () => {
  const ws = [wpt(1, 'DEPART'), wpt(2, 'MILIEU'), wpt(3, 'ARRIVEE')]

  it('écrit nom et commentaire dans le jeu de caractères de l’appareil, avec le nom de chaque waypoint', () => {
    const xml = buildGpx(ws, [{ no: 3, name: 'lorient 2', comment: 'Aller, retour!', points: pts(1, 2, 3) }])
    const rte = /<rte>([\s\S]*?)<\/rte>/.exec(xml)![1]!
    expect(rte).toContain('<name>LORIEN</name>') // « lorient 2 » → majuscules, 6 caractères
    expect(rte).toContain('<cmt>ALLER RETOUR</cmt>')
    expect(rte).not.toContain('<number>') // le format du GP-39 n'en a pas
    expect(rte.match(/<rtept /g)).toHaveLength(3)
    expect(rte).toContain('<name>MILIEU</name>')
  })

  it('reproduit le format de route du GP-39 (RTE001 / MON ITINERAIRE / WP0001-WP0003)', () => {
    const wps = [wpt(1, 'WP0001', 47.64321, -2.912345), wpt(2, 'WP0002', 47.6521, -2.924567), wpt(3, 'WP0003', 47.66123, -2.931298)]
    const xml = buildGpx(wps, [{ no: 1, name: 'RTE001', comment: 'MON ITINERAIRE', points: pts(1, 2, 3) }])
    const rte = /<rte>[\s\S]*?<\/rte>/.exec(xml)![0].replace(/>\s+</g, '><')
    // exemple donné pour l'appareil (coordonnées à 6 décimales, écrites ici à 7 comme les <wpt> : même valeur)
    expect(rte).toBe(
      '<rte><name>RTE001</name><cmt>MON ITINERAIRE</cmt>' +
        '<rtept lat="47.6432100" lon="-2.9123450"><name>WP0001</name></rtept>' +
        '<rtept lat="47.6521000" lon="-2.9245670"><name>WP0002</name></rtept>' +
        '<rtept lat="47.6612300" lon="-2.9312980"><name>WP0003</name></rtept></rte>',
    )
    // les <wpt> viennent avant la route
    expect(xml.indexOf('<wpt')).toBeLessThan(xml.indexOf('<rte>'))
  })

  it('chaque point de route reprend exactement le nom et les coordonnées d’un <wpt> du même fichier', () => {
    const wps = Array.from({ length: 12 }, (_, i) => wpt(i + 1, `P${i}`, 47 + i * 0.013, -3 + i * 0.007))
    const xml = buildGpx(wps, [{ no: 1, name: 'R1', comment: '', points: pts(3, 1, 7, 12, 2) }])
    const wpts = [...xml.matchAll(/<wpt lat="([^"]+)" lon="([^"]+)">\s*<name>([^<]*)<\/name>/g)].map((m) => `${m[3]}|${m[1]}|${m[2]}`)
    const rtepts = [...xml.matchAll(/<rtept lat="([^"]+)" lon="([^"]+)">\s*<name>([^<]*)<\/name>/g)].map((m) => `${m[3]}|${m[1]}|${m[2]}`)
    expect(rtepts).toEqual(['P2', 'P0', 'P6', 'P11', 'P1'].map((n) => wpts.find((w) => w.startsWith(`${n}|`))!))
  })

  it('sans commentaire, <cmt> est quand même écrit (vide) ; les points « skip » ne sont pas exportés', () => {
    const xml = buildGpx(ws, [
      {
        no: 5,
        name: 'R5',
        comment: '',
        points: [
          { wptId: 1, skip: false },
          { wptId: 2, skip: true },
          { wptId: 3, skip: false },
        ],
      },
    ])
    const rte = /<rte>([\s\S]*?)<\/rte>/.exec(xml)![1]!
    expect(rte).toContain('<cmt></cmt>')
    expect(rte.match(/<rtept /g)).toHaveLength(2)
    expect(rte).not.toContain('MILIEU')
    expect(rte).not.toContain('GP39Skip')
  })

  it('le rapport d’export prévient que les points « skip » ne sont pas dans le fichier', () => {
    const route: Route = {
      no: 1,
      name: 'R1',
      comment: '',
      points: [
        { wptId: 1, skip: false },
        { wptId: 2, skip: true },
        { wptId: 3, skip: false },
      ],
    }
    const r = deviceExportReport(ws, [route])
    expect(r.some((f) => f.severity === 'warning' && f.text.includes('skip'))).toBe(true)
    expect(r.some((f) => f.severity === 'error')).toBe(false)
    const only: Route = {
      no: 2,
      name: 'R2',
      comment: '',
      points: [
        { wptId: 1, skip: false },
        { wptId: 2, skip: true },
      ],
    }
    expect(deviceExportReport(ws, [only]).some((f) => f.text.includes('incomplète'))).toBe(true)
  })

  it('une route ne dépasse pas 30 points ; un waypoint disparu n’y figure pas', () => {
    const many = Array.from({ length: 40 }, (_, i) => wpt(i + 1, `W${i}`))
    const xml = buildGpx(many, [
      { no: 1, name: 'LONG', comment: '', points: [...pts(...many.map((w) => w.id)), { wptId: 999, skip: false }] },
    ])
    expect(/<rte>([\s\S]*?)<\/rte>/.exec(xml)![1]!.match(/<rtept /g)).toHaveLength(LIMITS.routeWaypoints)
  })

  it('relire le fichier redonne les mêmes routes (points, ordre, commentaire)', () => {
    const route: Route = { no: 1, name: 'ALLER', comment: 'BREST LORIENT', points: pts(3, 1, 2) }
    const parsed = parseGpx(buildGpx(ws, [route]))
    expect(parsed.waypoints.map((w) => w.name)).toEqual(['DEPART', 'MILIEU', 'ARRIVEE'])
    expect(parsed.routes).toHaveLength(1)
    expect(parsed.routes[0]).toMatchObject({ name: 'ALLER', comment: 'BREST LORIENT' })
    expect(parsed.routes[0]!.points.map((p) => [p.name, p.skip])).toEqual([
      ['ARRIVEE', false],
      ['DEPART', false],
      ['MILIEU', false],
    ])
  })

  it('lit le format de route du GP-39 donné en exemple', () => {
    const xml = `<?xml version="1.0"?><gpx version="1.1">
<wpt lat="47.643210" lon="-2.912345"><name>WP0001</name></wpt><wpt lat="47.652100" lon="-2.924567"><name>WP0002</name></wpt><wpt lat="47.661230" lon="-2.931298"><name>WP0003</name></wpt>
<!-- Définition de la Route --> <rte> <name>RTE001</name> <cmt>MON ITINERAIRE</cmt>
<!-- Les points de la route (doivent reprendre exactement les noms des wpt ci-dessus) -->
<rtept lat="47.643210" lon="-2.912345"> <name>WP0001</name> </rtept> <rtept lat="47.652100" lon="-2.924567"> <name>WP0002</name> </rtept>
<rtept lat="47.661230" lon="-2.931298"> <name>WP0003</name> </rtept> </rte></gpx>`
    const p = parseGpx(xml)
    expect(p.routes).toHaveLength(1)
    expect(p.routes[0]).toMatchObject({ name: 'RTE001', comment: 'MON ITINERAIRE' })
    expect(p.routes[0]!.points.map((x) => x.name)).toEqual(['WP0001', 'WP0002', 'WP0003'])
  })

  it('le commentaire d’une route se lit aussi dans GP39Comment ou <desc>', () => {
    const xml = (inner: string): string => `<gpx><rte><name>R</name>${inner}<rtept lat="1" lon="1"><name>A</name></rtept></rte></gpx>`
    expect(parseGpx(xml('<cmt>UN</cmt>')).routes[0]!.comment).toBe('UN')
    expect(parseGpx(xml('<extensions><GP39Comment>DEUX</GP39Comment></extensions>')).routes[0]!.comment).toBe('DEUX')
    expect(parseGpx(xml('<desc>TROIS</desc>')).routes[0]!.comment).toBe('TROIS')
  })
})

describe('enregistrement d’une route dans l’appareil', () => {
  let dev: ReturnType<typeof useDevice>
  let ids: number[]
  beforeEach(() => {
    setActivePinia(createPinia())
    dev = useDevice()
    dev.deleteAllWaypoints()
    dev.routes.splice(0, dev.routes.length)
    ids = ['A', 'B', 'C', 'D'].map((n, i) => dev.addWaypoint({ lat: 47 + i * 0.01, lon: -3, name: n })!.id)
  })

  it('crée une route au plus petit numéro libre, avec nom et commentaire nettoyés', () => {
    const r = dev.saveRoute({
      no: null,
      name: 'brest',
      comment: 'aller!',
      points: ids.slice(0, 3).map((wptId) => ({ wptId, skip: false })),
    })
    expect(r.ok).toBe(true)
    expect(dev.routes).toHaveLength(1)
    expect(dev.routes[0]).toMatchObject({ no: 1, name: 'BREST', comment: 'ALLER' })
    expect(dev.routes[0]!.points.map((p) => p.wptId)).toEqual(ids.slice(0, 3))
    const second = dev.saveRoute({ no: null, name: 'R2', comment: '', points: [] })
    expect(second.ok && second.route.no).toBe(2)
  })

  it('met à jour la route existante, sans en créer une autre', () => {
    const first = dev.saveRoute({ no: null, name: 'R1', comment: '', points: ids.slice(0, 2).map((wptId) => ({ wptId, skip: false })) })
    const no = first.ok ? first.route.no : -1
    const draft = draftFromRoute(dev.routeByNo(no)!)
    draft.name = 'RENOM'
    draft.points = reversePoints(draft.points)
    expect(dev.saveRoute(draft).ok).toBe(true)
    expect(dev.routes).toHaveLength(1)
    expect(dev.routes[0]).toMatchObject({ no, name: 'RENOM' })
    expect(dev.routes[0]!.points.map((p) => p.wptId)).toEqual([ids[1], ids[0]])
  })

  it('refuse un nom absent ou déjà pris, et n’écrit alors rien', () => {
    dev.saveRoute({ no: null, name: 'BREST', comment: '', points: [] })
    const dup = dev.saveRoute({ no: null, name: 'brest', comment: '', points: [] })
    expect(dup.ok).toBe(false)
    const blank = dev.saveRoute({ no: null, name: ' ', comment: '', points: [] })
    expect(blank.ok).toBe(false)
    expect(dev.routes).toHaveLength(1)
  })

  it('refuse un waypoint disparu ; accepte une route incomplète (enregistrement à tout moment)', () => {
    expect(dev.saveRoute({ no: null, name: 'X', comment: '', points: [{ wptId: 99999, skip: false }] }).ok).toBe(false)
    expect(dev.saveRoute({ no: null, name: 'X', comment: '', points: [{ wptId: ids[0]!, skip: false }] }).ok).toBe(true)
  })

  it('la mémoire des routes (100) est limitée, avec un message', () => {
    for (let i = 0; i < LIMITS.routes; i++) expect(dev.saveRoute({ no: null, name: `R${i}`, comment: '', points: [] }).ok).toBe(true)
    const r = dev.saveRoute({ no: null, name: 'DE TROP', comment: '', points: [] })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.errors.join(' ')).toContain('100')
  })

  it('une route qu’on supprime disparaît ; celle qui est la destination en cours est refusée', () => {
    const a = dev.saveRoute({ no: null, name: 'A', comment: '', points: ids.slice(0, 2).map((wptId) => ({ wptId, skip: false })) })
    const b = dev.saveRoute({ no: null, name: 'B', comment: '', points: ids.slice(1, 3).map((wptId) => ({ wptId, skip: false })) })
    expect(a.ok && b.ok).toBe(true)
    if (!a.ok || !b.ok) return
    expect(dev.setDestRoute(a.route.no, 'Forward')).toBe(true)
    expect(dev.deleteRoute(a.route.no)).toBe(false)
    expect(dev.deleteRoute(b.route.no)).toBe(true)
    expect(dev.routes.map((r) => r.name)).toEqual(['A'])
  })

  it('l’export peut se faire avec ou sans les routes (les waypoints seuls restent au format vérifié sur l’appareil)', () => {
    dev.saveRoute({ no: null, name: 'R1', comment: 'ALLER', points: ids.slice(0, 2).map((wptId) => ({ wptId, skip: false })) })
    const full = dev.exportGpx(null, true)
    const wptOnly = dev.exportGpx(null, false)
    expect(full).toContain('<rte>')
    expect(full).toContain('<name>R1</name>')
    expect(wptOnly).not.toContain('<rte>')
    expect(wptOnly.match(/<wpt /g)).toHaveLength(4)
    expect(full.match(/<wpt /g)).toHaveLength(4)
  })

  it('l’import GPX d’une route la reconstitue : nom ramené au jeu de caractères, comment lu, points rattachés', () => {
    dev.deleteAllWaypoints()
    const xml = `<?xml version="1.0"?><gpx version="1.1">
<wpt lat="47.1" lon="-3.1"><name>P1</name></wpt><wpt lat="47.2" lon="-3.2"><name>P2</name></wpt><wpt lat="47.3" lon="-3.3"><name>P3</name></wpt>
<rte><name>Ma route 2</name><cmt>retour</cmt>
<rtept lat="47.1" lon="-3.1"><name>P1</name></rtept><rtept lat="47.3" lon="-3.3"><name>P3</name></rtept></rte></gpx>`
    const r = dev.importGpx(xml, 'merge', 'test.gpx')
    expect(r.routes).toBe(1)
    expect(dev.routes[0]).toMatchObject({ name: 'MA ROU', comment: 'RETOUR' })
    expect(dev.routes[0]!.points.map((p) => dev.wptById.get(p.wptId)!.name)).toEqual(['P1', 'P3'])
    expect(r.warnings.join(' ')).toContain('renommée')
  })
})
