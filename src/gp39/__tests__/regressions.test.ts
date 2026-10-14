// Régressions trouvées par la relecture indépendante du code.
import { describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useDevice } from '@/stores/device'
import { press, setDisplay } from '@/gp39/ui/controller'
import { closeAllViews, ui } from '@/gp39/ui/state'
import { numText, openWaypointForm } from '@/gp39/ui/menus'

function fresh() {
  setActivePinia(createPinia())
  closeAllViews()
  ui.cursor = null
  ui.cursorUntil = 0
  ui.moving = null
  const dev = useDevice()
  dev.sim.forcedFix = '3D'
  dev.power = 'on'
  dev.tick()
  setDisplay(0)
  return dev
}

describe('régressions', () => {
  it('alarme d’arrivée : se déclenche aussi pour les points d’une route', () => {
    const dev = fresh()
    const a = dev.addWaypoint({ lat: dev.ship.lat + 0.01, lon: dev.ship.lon })!
    const b = dev.addWaypoint({ lat: dev.ship.lat + 0.02, lon: dev.ship.lon })!
    const r = dev.addRoute()!
    r.points = [
      { wptId: a.id, skip: false },
      { wptId: b.id, skip: false },
    ]
    dev.settings.alarmArrival = { mode: 'Arrival', nm: 0.1 }
    dev.setDestRoute(r.no, 'Forward')
    dev.setShipPosition(a.lat - 0.0005, a.lon, { jump: false })
    dev.tick()
    expect(dev.alarms.active).toContain('ARRIVAL ALARM!')
    expect(dev.dest?.wptId).toBe(b.id) // et la route avance quand même
  })

  it('Quick Point : ne détruit pas un waypoint nommé « QP » créé par l’utilisateur', () => {
    const dev = fresh()
    const mine = dev.addWaypoint({ lat: 47, lon: -3, name: 'QP' })!
    dev.setQuickPoint(47.1, -3)
    expect(dev.wptById.has(mine.id)).toBe(true)
    dev.setQuickPoint(47.2, -3)
    // l'ancien Quick Point est remplacé, le waypoint de l'utilisateur reste
    expect(dev.waypoints.filter((w) => w.qp)).toHaveLength(1)
    expect(dev.wptById.has(mine.id)).toBe(true)
  })

  it('Quick Point remplacé : retiré aussi des routes', () => {
    const dev = fresh()
    dev.setQuickPoint(47.1, -3)
    const qp = dev.waypoints.find((w) => w.qp)!
    const r = dev.addRoute()!
    r.points = [{ wptId: qp.id, skip: false }]
    dev.setQuickPoint(47.2, -3)
    expect(r.points).toHaveLength(0)
  })

  it('import GPX sans waypoint ni route : rien n’est effacé', () => {
    const dev = fresh()
    dev.addWaypoint({ lat: 47, lon: -3, name: 'KEEP' })
    const r = dev.importGpx('<gpx><trk><trkseg><trkpt lat="47" lon="-3"/></trkseg></trk></gpx>', 'replace')
    expect(r.waypoints).toBe(0)
    expect(r.warnings.join(' ')).toContain('rien n’a été modifié')
    expect(dev.waypoints.map((w) => w.name)).toEqual(['KEEP'])
  })

  it('import GPX : guillemets simples et préfixes d’espace de noms', () => {
    const dev = fresh()
    const xml = "<gpx:gpx><gpx:wpt lat='47.5' lon='-3.25'><gpx:name>PFX</gpx:name></gpx:wpt></gpx:gpx>"
    const r = dev.importGpx(xml, 'replace')
    expect(r.waypoints).toBe(1)
    expect(dev.waypoints[0]).toMatchObject({ name: 'PFX', lat: 47.5, lon: -3.25 })
  })

  it('route en cours : supprimer un point déjà passé ne fait pas sauter le suivant', () => {
    const dev = fresh()
    const ids = [1, 2, 3, 4].map((i) => dev.addWaypoint({ lat: dev.ship.lat + 0.01 * i, lon: dev.ship.lon })!.id)
    const r = dev.addRoute()!
    r.points = ids.map((id) => ({ wptId: id, skip: false }))
    dev.setDestRoute(r.no, 'Forward')
    const w1 = dev.wptById.get(ids[0]!)!
    dev.setShipPosition(w1.lat, w1.lon, { jump: false })
    dev.tick() // WP1 atteint → cap sur WP2
    expect(dev.dest?.wptId).toBe(ids[1])
    r.points.shift() // l'utilisateur supprime WP1 de la route
    dev.tick()
    expect(dev.dest?.wptId).toBe(ids[1])
    const w2 = dev.wptById.get(ids[1]!)!
    dev.setShipPosition(w2.lat, w2.lon, { jump: false })
    dev.tick()
    expect(dev.dest?.wptId).toBe(ids[2]) // WP3, pas WP4
  })

  it('route en cours : la cible supprimée est remplacée par le point le plus proche', () => {
    const dev = fresh()
    const ids = [1, 2, 3].map((i) => dev.addWaypoint({ lat: dev.ship.lat + 0.01 * i, lon: dev.ship.lon })!.id)
    const r = dev.addRoute()!
    r.points = ids.map((id) => ({ wptId: id, skip: false }))
    dev.setDestRoute(r.no, 'Forward')
    r.points.shift() // supprime la cible courante
    dev.tick()
    expect(dev.dest?.kind).toBe('route')
    expect(dev.dest?.wptId).toBe(ids[1])
    r.points = []
    dev.tick()
    expect(dev.dest).toBeNull()
  })

  it('alarme horaire : réarmée après la minute (sonne chaque jour)', () => {
    vi.useFakeTimers()
    try {
      vi.setSystemTime(new Date('2026-10-13T10:00:30Z'))
      const dev = fresh()
      dev.settings.timeOffsetMin = 0
      dev.settings.dst = false
      dev.settings.alarmTime = { on: true, hhmm: 1000 }
      dev.tick()
      expect(dev.alarms.active).toContain('TIME ALARM!')
      vi.setSystemTime(new Date('2026-10-13T10:02:00Z'))
      dev.tick()
      expect(dev.alarms.active).not.toContain('TIME ALARM!')
      vi.setSystemTime(new Date('2026-10-14T10:00:10Z')) // lendemain
      dev.acknowledgeAlarms()
      dev.tick()
      expect(dev.alarms.active).toContain('TIME ALARM!')
    } finally {
      vi.useRealTimers()
    }
  })

  it('Waypoint Info : valider RNG ou BRG sans les changer ne déplace pas le waypoint', () => {
    const dev = fresh()
    const w = dev.addWaypoint({ lat: dev.ship.lat + 0.1234567, lon: dev.ship.lon + 0.0765432, name: 'FAR' })!
    const { lat, lon } = w
    openWaypointForm(w.id)
    for (let i = 0; i < 5; i++) press('down') // → RNG
    press('ent')
    press('ent') // valide sans modifier
    press('down') // BRG
    press('ent')
    press('ent')
    expect(dev.wptById.get(w.id)).toMatchObject({ lat, lon })
  })

  it('numText : valeur trop grande ramenée au maximum du champ', () => {
    expect(numText(12345.678, '9999.99')).toBe('9999.99')
    expect(numText(7.5, '99.99')).toBe('07.50')
    expect(numText(-3, '99')).toBe('00')
  })
})
