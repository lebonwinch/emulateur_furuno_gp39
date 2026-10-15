// Éditeur de waypoints : calques (un par fichier GPX importé), suppression en lot, déplacement, export — sans navigateur.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useDevice } from '@/stores/device'
import { DEVICE_LAYER_NAME } from '../layers'
import { parseGpx } from '../gpx'
import { LIMITS } from '../types'

const real = readFileSync(fileURLToPath(new URL('../../../public/data/waypoints_GP39.gpx', import.meta.url)), 'utf8')

const wptXml = (name: string, lat: number, lon: number, symbol = 0, color = 2): string =>
  `<wpt lat="${lat}" lon="${lon}"><name>${name}</name><extensions><GP39Symbol>${symbol}</GP39Symbol><FECColor>${color}</FECColor></extensions></wpt>`
const gpx = (...items: string[]): string => `<?xml version="1.0"?><gpx version="1.1">${items.join('')}</gpx>`

function fresh() {
  setActivePinia(createPinia())
  return useDevice()
}

describe('calques : création des waypoints sur l’appareil', () => {
  let dev: ReturnType<typeof fresh>
  beforeEach(() => (dev = fresh()))

  it('un waypoint créé (MARK, MOB…) va dans le calque « Appareil », créé une seule fois', () => {
    const a = dev.addWaypoint({ lat: 47, lon: -3 })!
    const b = dev.addWaypoint({ lat: 47.1, lon: -3 })!
    expect(dev.layers.map((l) => l.name)).toEqual([DEVICE_LAYER_NAME])
    expect(a.layer).toBe(dev.layers[0]!.id)
    expect(b.layer).toBe(a.layer)
  })

  it('un calque explicite est respecté ; un calque inconnu retombe sur « Appareil »', () => {
    const l = dev.addLayer('Mon calque')
    expect(dev.addWaypoint({ lat: 47, lon: -3, layer: l.id })!.layer).toBe(l.id)
    const fallback = dev.addWaypoint({ lat: 47, lon: -3, layer: 999 })!
    expect(dev.layers.find((x) => x.id === fallback.layer)!.name).toBe(DEVICE_LAYER_NAME)
  })
})

describe('calques : import d’un fichier GPX', () => {
  let dev: ReturnType<typeof fresh>
  beforeEach(() => (dev = fresh()))

  it('remplacer : un seul calque, nommé d’après le fichier, qui porte tous les waypoints', () => {
    dev.addWaypoint({ lat: 1, lon: 1, name: 'OLD' })
    const r = dev.importGpx(real, 'replace', 'waypoints_GP39.gpx')
    expect(r.waypoints).toBe(2252)
    expect(dev.layers).toHaveLength(1)
    expect(dev.layers[0]!.name).toBe('waypoints_GP39.gpx')
    expect(r.layerId).toBe(dev.layers[0]!.id)
    expect(dev.waypoints.every((w) => w.layer === r.layerId)).toBe(true)
    expect(dev.layerCounts.get(r.layerId!)).toBe(2252)
  })

  it('ajouter : un nouveau calque par fichier, les précédents sont conservés', () => {
    const a = dev.importGpx(gpx(wptXml('A1', 48, -4), wptXml('A2', 48.1, -4)), 'merge', 'a.gpx')
    const b = dev.importGpx(gpx(wptXml('B1', 49, -3)), 'merge', 'b.gpx')
    expect(dev.layers.map((l) => l.name)).toEqual(['a.gpx', 'b.gpx'])
    expect(dev.layerCounts.get(a.layerId!)).toBe(2)
    expect(dev.layerCounts.get(b.layerId!)).toBe(1)
    expect(dev.waypoints.map((w) => `${w.name}:${w.layer === a.layerId ? 'a' : 'b'}`)).toEqual(['A1:a', 'A2:a', 'B1:b'])
  })

  it('un fichier sans waypoint (routes seules, trace) ne crée pas de calque', () => {
    const r = dev.importGpx(gpx('<trk><trkseg><trkpt lat="48" lon="-4"/></trkseg></trk>'), 'merge', 'trace.gpx')
    expect(r.layerId).toBeNull()
    expect(dev.layers).toHaveLength(0)
    const r2 = dev.importGpx(gpx('<rte><name>R</name><rtept lat="48" lon="-4"/></rte>'), 'merge', 'route.gpx')
    expect(r2.waypoints).toBe(0)
    expect(r2.layerId).toBeNull()
    expect(dev.layers).toHaveLength(0)
  })

  it('ignorer les doublons : ce qui existe déjà (nom, position, symbole, couleur) n’est pas réimporté', () => {
    const xml = gpx(wptXml('A1', 48, -4), wptXml('A2', 48.1, -4))
    dev.importGpx(xml, 'merge', 'a.gpx')
    const again = dev.importGpx(xml, 'merge', 'copie.gpx', { skipDuplicates: true })
    expect(again.waypoints).toBe(0)
    expect(again.layerId).toBeNull() // aucun calque vide créé
    expect(again.warnings.join(' ')).toContain('2 doublon(s)')
    expect(dev.waypoints).toHaveLength(2)
    // sans l'option : tout est ajouté, dans un nouveau calque
    const forced = dev.importGpx(xml, 'merge', 'copie.gpx')
    expect(forced.waypoints).toBe(2)
    expect(dev.waypoints).toHaveLength(4)
  })

  it('un doublon partiel : seuls les nouveaux waypoints arrivent dans le nouveau calque', () => {
    dev.importGpx(gpx(wptXml('A1', 48, -4)), 'merge', 'a.gpx')
    const r = dev.importGpx(gpx(wptXml('A1', 48, -4), wptXml('N1', 50, -1), wptXml('A1', 48, -4, 8, 0)), 'merge', 'b.gpx', {
      skipDuplicates: true,
    })
    expect(r.waypoints).toBe(2) // N1 et A1 de symbole 8 (autre symbole = pas un doublon)
    expect(dev.waypoints.filter((w) => w.layer === r.layerId).map((w) => w.name)).toEqual(['N1', 'A1'])
  })

  it('le nom du calque est nettoyé ; « Import » à défaut', () => {
    dev.importGpx(gpx(wptXml('A', 1, 1)), 'merge', '  mon\u0001fichier.gpx ')
    dev.importGpx(gpx(wptXml('B', 2, 2)), 'merge', '')
    expect(dev.layers.map((l) => l.name)).toEqual(['monfichier.gpx', 'Import'])
  })

  it('« remplacer » repart de zéro : routes, destination et anciens calques disparaissent', () => {
    dev.importGpx(gpx(wptXml('A', 1, 1)), 'merge', 'a.gpx')
    dev.importGpx(gpx(wptXml('B', 2, 2)), 'replace', 'b.gpx')
    expect(dev.layers.map((l) => l.name)).toEqual(['b.gpx'])
    expect(dev.waypoints.map((w) => w.name)).toEqual(['B'])
  })

  it('au-delà de 10 000 waypoints : le calque ne reçoit que ce qui rentre, et rien (pas de calque) quand c’est plein', () => {
    const many = (n: number, p: string): string => gpx(...Array.from({ length: n }, (_, i) => wptXml(`${p}${i}`, 40 + i * 1e-4, 5)))
    const first = dev.importGpx(many(LIMITS.waypoints - 1, 'A'), 'merge', 'a.gpx')
    expect(first.waypoints).toBe(LIMITS.waypoints - 1)
    const second = dev.importGpx(many(5, 'B'), 'merge', 'b.gpx')
    expect(second.waypoints).toBe(1)
    expect(second.warnings.join(' ')).toContain('4 waypoint(s) ignoré(s)')
    const third = dev.importGpx(many(5, 'C'), 'merge', 'c.gpx')
    expect(third.waypoints).toBe(0)
    expect(third.layerId).toBeNull()
    expect(dev.layers.map((l) => l.name)).toEqual(['a.gpx', 'b.gpx'])
  })
})

describe('calques : gestion', () => {
  let dev: ReturnType<typeof fresh>
  beforeEach(() => (dev = fresh()))

  it('renommer, masquer/afficher ; un nom vide garde l’ancien', () => {
    const l = dev.addLayer('Ancien')
    expect(dev.renameLayer(l.id, '  Nouveau  ')).toBe(true)
    expect(dev.layers[0]!.name).toBe('Nouveau')
    dev.renameLayer(l.id, '   ')
    expect(dev.layers[0]!.name).toBe('Nouveau')
    expect(dev.renameLayer(999, 'x')).toBe(false)
    dev.setLayerVisible(l.id, false)
    expect(dev.layers[0]!.visible).toBe(false)
    dev.setLayerVisible(l.id, true)
    expect(dev.layers[0]!.visible).toBe(true)
  })

  it('les identifiants de calques sont uniques, même après suppression', () => {
    const a = dev.addLayer('a')
    const b = dev.addLayer('b')
    dev.deleteLayer(b.id)
    const c = dev.addLayer('c')
    expect(new Set([a.id, b.id, c.id]).size).toBeGreaterThanOrEqual(2)
    expect(dev.layers.map((l) => l.id)).toEqual([a.id, c.id])
  })

  it('déplacer des waypoints vers un autre calque', () => {
    const a = dev.addLayer('a')
    const b = dev.addLayer('b')
    const ids = [1, 2, 3].map((i) => dev.addWaypoint({ lat: 40 + i, lon: 1, layer: a.id })!.id)
    expect(dev.moveWaypointsToLayer([ids[0]!, ids[1]!], b.id)).toBe(2)
    expect(dev.layerCounts.get(a.id)).toBe(1)
    expect(dev.layerCounts.get(b.id)).toBe(2)
    expect(dev.moveWaypointsToLayer([ids[0]!], b.id)).toBe(0) // déjà dedans
    expect(dev.moveWaypointsToLayer(ids, 999)).toBe(0) // calque inconnu
  })

  it('updateWaypoint accepte un calque existant, ignore un calque inconnu', () => {
    const a = dev.addLayer('a')
    const w = dev.addWaypoint({ lat: 47, lon: -3 })!
    dev.updateWaypoint(w.id, { layer: a.id })
    expect(w.layer).toBe(a.id)
    dev.updateWaypoint(w.id, { layer: 999 })
    expect(w.layer).toBe(a.id)
  })

  it('supprimer un calque supprime ses waypoints (et eux seuls)', () => {
    const a = dev.addLayer('a')
    const b = dev.addLayer('b')
    for (let i = 0; i < 3; i++) dev.addWaypoint({ lat: 40 + i, lon: 1, layer: a.id })
    dev.addWaypoint({ lat: 50, lon: 1, layer: b.id })
    expect(dev.deleteLayer(a.id)).toEqual({ deleted: 3, blocked: 0 })
    expect(dev.layers.map((l) => l.name)).toEqual(['b'])
    expect(dev.waypoints).toHaveLength(1)
    expect(dev.deleteLayer(999)).toBeNull()
  })

  it('le waypoint de la destination en cours n’est pas effacé : le calque reste avec lui', () => {
    const a = dev.addLayer('a')
    const ids = [0, 1, 2].map((i) => dev.addWaypoint({ lat: 40 + i, lon: 1, layer: a.id })!.id)
    dev.setDestWaypoint(ids[1]!)
    expect(dev.deleteLayer(a.id)).toEqual({ deleted: 2, blocked: 1 })
    expect(dev.layers.map((l) => l.name)).toEqual(['a'])
    expect(dev.waypoints.map((w) => w.id)).toEqual([ids[1]])
  })

  it('« tout effacer » vide aussi les calques', () => {
    dev.importGpx(gpx(wptXml('A', 1, 1)), 'merge', 'a.gpx')
    dev.deleteAllWaypoints()
    expect(dev.layers).toHaveLength(0)
    expect(dev.waypoints).toHaveLength(0)
  })
})

describe('suppression en lot', () => {
  let dev: ReturnType<typeof fresh>
  beforeEach(() => (dev = fresh()))

  it('supprime plusieurs waypoints d’un coup, ignore les identifiants inconnus, les retire des routes', () => {
    const ids = [1, 2, 3, 4].map((i) => dev.addWaypoint({ lat: 40 + i, lon: 1 })!.id)
    const r = dev.addRoute('R1')!
    r.points.push(...ids.map((wptId) => ({ wptId, skip: false })))
    expect(dev.deleteWaypoints([ids[0]!, ids[2]!, 12345])).toEqual({ deleted: 2, blocked: 0 })
    expect(dev.waypoints.map((w) => w.id)).toEqual([ids[1], ids[3]])
    expect(dev.routes[0]!.points.map((p) => p.wptId)).toEqual([ids[1], ids[3]])
  })

  it('protège la destination (waypoint) et les points de la route suivie', () => {
    const ids = [1, 2, 3].map((i) => dev.addWaypoint({ lat: 40 + i, lon: 1 })!.id)
    dev.setDestWaypoint(ids[0]!)
    expect(dev.deleteWaypoints(ids)).toEqual({ deleted: 2, blocked: 1 })
    expect(dev.waypoints.map((w) => w.id)).toEqual([ids[0]])

    const f = fresh()
    const rid = [1, 2, 3].map((i) => f.addWaypoint({ lat: 40 + i, lon: 1 })!.id)
    const route = f.addRoute('R')!
    route.points.push(...rid.map((wptId) => ({ wptId, skip: false })))
    expect(f.setDestRoute(route.no, 'Forward')).toBe(true)
    expect(f.deleteWaypoints(rid)).toEqual({ deleted: 0, blocked: 3 })
  })

  it('deleteWaypoint (un seul) garde sa règle : faux si utilisé, faux si inconnu', () => {
    const w = dev.addWaypoint({ lat: 41, lon: 1 })!
    dev.setDestWaypoint(w.id)
    expect(dev.deleteWaypoint(w.id)).toBe(false)
    dev.cancelDest()
    expect(dev.deleteWaypoint(w.id)).toBe(true)
    expect(dev.deleteWaypoint(w.id)).toBe(false)
  })

  it('3 000 waypoints supprimés en une opération', () => {
    const r = dev.importGpx(gpx(...Array.from({ length: 3000 }, (_, i) => wptXml(`W${i}`, 40 + i * 1e-3, 3))), 'replace', 'gros.gpx')
    expect(r.waypoints).toBe(3000)
    const res = dev.deleteWaypoints(dev.waypoints.map((w) => w.id))
    expect(res.deleted).toBe(3000)
    expect(dev.waypoints).toHaveLength(0)
  })
})

describe('création / édition d’un waypoint depuis l’éditeur', () => {
  it('crée dans un calque avec symbole et couleur par défaut, puis modifie tous les champs', () => {
    const dev = fresh()
    const l = dev.addLayer('Nouveaux')
    const w = dev.addWaypoint({ lat: 47.123456789, lon: -3.5, layer: l.id })!
    expect(w.symbol).toBe(0)
    expect(w.color).toBe(2)
    expect(w.display).toBe(true)
    expect(w.name).toBe('WP0001')
    dev.updateWaypoint(w.id, {
      name: 'BOUEE123456',
      comment: 'un commentaire très long',
      symbol: 8,
      color: 0,
      display: false,
      lat: 48,
      lon: -4,
    })
    expect(w).toMatchObject({ name: 'BOUEE123', comment: 'un commentair', symbol: 8, color: 0, display: false, lat: 48, lon: -4 })
  })

  it('un waypoint édité est exporté tel quel et se relit', () => {
    const dev = fresh()
    const l = dev.addLayer('c')
    const w = dev.addWaypoint({ lat: 47, lon: -3, layer: l.id, name: 'EDIT' })!
    dev.updateWaypoint(w.id, { symbol: 9, color: 4, comment: 'drapeau' })
    const back = parseGpx(dev.exportGpx())
    expect(back.waypoints).toHaveLength(1)
    expect(back.waypoints[0]).toMatchObject({ name: 'EDIT', symbol: 9, color: 4, comment: 'drapeau', display: true })
  })
})

describe('export : tous les waypoints dans un seul fichier', () => {
  it('exporte tous les calques ; avec un filtre, seulement ceux demandés ; jamais le Quick Point', () => {
    const dev = fresh()
    const a = dev.importGpx(gpx(wptXml('A1', 48, -4), wptXml('A2', 48.1, -4)), 'merge', 'a.gpx')
    const b = dev.importGpx(gpx(wptXml('B1', 49, -3)), 'merge', 'b.gpx')
    dev.setQuickPoint(47, -2)
    expect(dev.waypoints.some((w) => w.qp)).toBe(true)
    const all = parseGpx(dev.exportGpx())
    expect(all.waypoints.map((w) => w.name)).toEqual(['A1', 'A2', 'B1'])
    const onlyB = parseGpx(dev.exportGpx(new Set([b.layerId!])))
    expect(onlyB.waypoints.map((w) => w.name)).toEqual(['B1'])
    const onlyA = parseGpx(dev.exportGpx(new Set([a.layerId!])))
    expect(onlyA.waypoints.map((w) => w.name)).toEqual(['A1', 'A2'])
    expect(parseGpx(dev.exportGpx(new Set())).waypoints).toHaveLength(0)
  })

  it('les routes suivent : exportées entières ou pas du tout quand on filtre les calques', () => {
    const dev = fresh()
    const a = dev.importGpx(gpx(wptXml('A1', 48, -4), wptXml('A2', 48.1, -4)), 'merge', 'a.gpx')
    const b = dev.importGpx(gpx(wptXml('B1', 49, -3)), 'merge', 'b.gpx')
    const [a1, a2, b1] = dev.waypoints
    const r1 = dev.addRoute('INTRA')!
    r1.points.push({ wptId: a1!.id, skip: false }, { wptId: a2!.id, skip: false })
    const r2 = dev.addRoute('INTER')!
    r2.points.push({ wptId: a2!.id, skip: false }, { wptId: b1!.id, skip: false })
    expect(parseGpx(dev.exportGpx()).routes.map((r) => r.name)).toEqual(['INTRA', 'INTER'])
    expect(parseGpx(dev.exportGpx(new Set([a.layerId!]))).routes.map((r) => r.name)).toEqual(['INTRA'])
    expect(parseGpx(dev.exportGpx(new Set([a.layerId!, b.layerId!]))).routes.map((r) => r.name)).toEqual(['INTRA', 'INTER'])
  })

  it('le fichier réel : 2252 waypoints exportés puis relus à l’identique (symbole, couleur, commentaire)', () => {
    const dev = fresh()
    dev.importGpx(real, 'replace', 'waypoints_GP39.gpx')
    const back = parseGpx(dev.exportGpx())
    const src = parseGpx(real)
    expect(back.waypoints).toHaveLength(2252)
    expect(back.waypoints.map((w) => [w.symbol, w.color, w.comment, w.name])).toEqual(
      src.waypoints.map((w) => [w.symbol, w.color, w.comment, w.name]),
    )
  })
})
