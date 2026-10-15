// Tests d'intégration : touches de la façade → vues, store, navigation (sans navigateur).
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useDevice } from '@/stores/device'
import { press, setDisplay } from '@/gp39/ui/controller'
import { closeAllViews, topView, ui } from '@/gp39/ui/state'
import { openWaypointForm } from '@/gp39/ui/menus'
import { rhumbDestination } from '@/gp39/geo'
import type { ListView, SelectView } from '@/gp39/ui/types'

const realGpx = readFileSync(fileURLToPath(new URL('../../../public/data/waypoints_GP39.gpx', import.meta.url)), 'utf8')

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

const list = (): ListView => topView() as ListView
const select = (): SelectView => topView() as SelectView

describe('waypoints par MARK / curseur', () => {
  let dev: ReturnType<typeof fresh>
  beforeEach(() => {
    dev = fresh()
  })

  it('MARK crée WP0001, WP0002… à la position du bateau', () => {
    press('mark')
    press('mark')
    expect(dev.waypoints.map((w) => w.name)).toEqual(['WP0001', 'WP0002'])
    expect(dev.waypoints[0]).toMatchObject({ lat: dev.ship.lat, lon: dev.ship.lon, symbol: 0, color: 2 })
  })

  it('réutilise le plus petit numéro libre', () => {
    press('mark')
    press('mark')
    const first = dev.waypoints[0]!
    expect(dev.deleteWaypoint(first.id)).toBe(true)
    press('mark')
    expect(dev.waypoints.map((w) => w.name).sort()).toEqual(['WP0001', 'WP0002'])
  })

  it('sans position GPS, MARK n’enregistre rien', () => {
    dev.sim.forcedFix = '---'
    dev.tick()
    press('mark')
    expect(dev.waypoints).toHaveLength(0)
  })

  it('le 1er appui sur une flèche affiche le curseur, le suivant le déplace ; ENT crée un waypoint', () => {
    press('right')
    expect(ui.cursor).not.toBeNull()
    const p0 = { ...ui.cursor! }
    press('right')
    expect(ui.cursor!.lon).toBeGreaterThan(p0.lon)
    press('right', false, 30)
    press('right', false, 30)
    press('ent')
    expect(dev.waypoints).toHaveLength(1)
    expect(dev.waypoints[0]!.name).toBe('WP0001')
  })

  it('ENT sur un waypoint ouvre le menu Goto / Move / Edit / Delete', () => {
    press('mark')
    ui.cursor = { lat: dev.ship.lat, lon: dev.ship.lon }
    ui.cursorUntil = Date.now() + 5000
    press('ent')
    expect(topView()!.kind).toBe('select')
    expect(select().options).toEqual(['Goto', 'Move', 'Edit', 'Delete'])
  })

  it('maintien de ENT recentre le plotter sur le bateau', () => {
    ui.center = { lat: 10, lon: 10 }
    press('ent', true)
    expect(ui.center.lat).toBeCloseTo(dev.ship.lat, 6)
  })
})

describe('destination et navigation', () => {
  let dev: ReturnType<typeof fresh>
  beforeEach(() => {
    dev = fresh()
  })

  it('GO TO avec curseur : Quick Point « QP », remplacé à chaque nouvel appui', () => {
    ui.cursor = { lat: dev.ship.lat + 0.01, lon: dev.ship.lon }
    ui.cursorUntil = Date.now() + 5000
    press('goto')
    expect(dev.dest?.kind).toBe('qp')
    ui.cursor = { lat: dev.ship.lat + 0.02, lon: dev.ship.lon }
    ui.cursorUntil = Date.now() + 5000
    press('goto')
    expect(dev.waypoints.filter((w) => w.name === 'QP')).toHaveLength(1)
    expect(dev.nav.rng).toBeCloseTo(1.2, 1)
    expect(Math.round(dev.nav.brgTrue)).toBe(0)
  })

  it('RNG/BRG/TTG/ETA vers un waypoint à 6 NM plein Est à 6 kn', () => {
    const t = rhumbDestination(dev.shipPos, 90, 6)
    const w = dev.addWaypoint({ lat: t.lat, lon: t.lon })!
    dev.sim.moving = true
    dev.sim.speed = 6
    dev.sim.course = 90
    dev.sim.courseMode = 'Manual'
    dev.setDestWaypoint(w.id)
    for (let i = 0; i < 70; i++) dev.tick()
    expect(dev.nav.rng).toBeGreaterThan(5.7)
    expect(dev.nav.rng).toBeLessThan(5.9)
    expect(Math.abs(dev.nav.xte)).toBeLessThan(0.01)
    expect(dev.nav.ttgHours).toBeGreaterThan(0.9)
    expect(dev.nav.ttgHours).toBeLessThan(1.02)
    expect(dev.trip).toBeGreaterThan(0.1)
  })

  it('refuse d’effacer le waypoint de destination', () => {
    const w = dev.addWaypoint({ lat: dev.ship.lat + 0.1, lon: dev.ship.lon })!
    dev.setDestWaypoint(w.id)
    expect(dev.deleteWaypoint(w.id)).toBe(false)
    dev.cancelDest()
    expect(dev.deleteWaypoint(w.id)).toBe(true)
  })

  it('MOB : appui long → dialogue « Goto MOB ? » → Yes crée la destination', () => {
    press('mark', true)
    expect(dev.mob).toMatchObject({ lat: dev.ship.lat, lon: dev.ship.lon })
    expect(topView()!.kind).toBe('confirm')
    press('ent')
    expect(dev.dest?.kind).toBe('mob')
  })

  it('route : enchaîne les waypoints et se termine à l’arrivée', () => {
    const a = dev.addWaypoint({ lat: dev.ship.lat + 0.001, lon: dev.ship.lon })!
    const b = dev.addWaypoint({ lat: dev.ship.lat + 0.01, lon: dev.ship.lon })!
    const r = dev.addRoute()!
    r.points.push({ wptId: a.id, skip: false }, { wptId: b.id, skip: false })
    expect(dev.setDestRoute(r.no, 'Forward')).toBe(true)
    expect(dev.dest?.wptId).toBe(a.id)
    dev.setShipPosition(a.lat, a.lon, { jump: false })
    dev.tick()
    expect(dev.dest?.wptId).toBe(b.id)
    dev.setShipPosition(b.lat, b.lon, { jump: false })
    dev.tick()
    expect(dev.dest).toBeNull()
  })

  it('route en sens inverse et point « skip »', () => {
    const ids = [0, 1, 2].map((i) => dev.addWaypoint({ lat: dev.ship.lat + 0.01 * (i + 1), lon: dev.ship.lon })!.id)
    const r = dev.addRoute()!
    r.points = ids.map((id) => ({ wptId: id, skip: false }))
    r.points[1]!.skip = true
    expect(dev.routeSequence(r, 'Forward')).toEqual([ids[0], ids[2]])
    expect(dev.routeSequence(r, 'Reverse')).toEqual([ids[2], ids[0]])
  })
})

describe('menus', () => {
  let dev: ReturnType<typeof fresh>
  beforeEach(() => {
    dev = fresh()
  })

  it('MENU sur le plotter : fenêtre de portée puis menu principal', () => {
    press('menu')
    expect(topView()!.kind).toBe('zoom')
    press('down')
    expect(dev.settings.plotterRange).toBe(7) // 2 NM (défaut) → 5 NM
    press('menu')
    expect(list().title).toBe('Menu')
    expect(list().row(0).cells[0]).toBe('Ship To Center *')
  })

  it('hors plotter, MENU ouvre directement le menu et « Ship To Center » est absent', () => {
    setDisplay(2)
    press('menu')
    expect(list().row(0).cells[0]).toBe('Tracks')
  })

  it('Plotter Setup > COG Line : Off', () => {
    press('menu')
    press('menu')
    // Ship To Center, Tracks, Waypoints, Routes, Plotter Setup
    for (let i = 0; i < 4; i++) press('down')
    press('ent')
    expect(list().title).toBe('Menu >Plotter Setup')
    press('down') // COG Line
    press('ent')
    expect(select().options).toEqual(['Off', 'On'])
    press('up') // Off
    press('ent')
    expect(dev.settings.cogLine).toBe(false)
  })

  it('MENU remonte d’un niveau, DISP ferme tout', () => {
    press('menu')
    press('menu')
    press('ent') // Ship To Center ferme le menu
    expect(topView()).toBeUndefined()
    press('menu')
    press('menu')
    press('down')
    press('ent') // Tracks
    expect(list().title).toBe('Menu >Tracks')
    press('menu')
    expect(list().title).toBe('Menu')
    press('disp')
    expect(topView()).toBeUndefined()
  })

  it('formulaire Waypoint Info : nom saisi au clavier, doublon refusé', () => {
    const a = dev.addWaypoint({ lat: 47, lon: -3, name: 'AAA' })!
    dev.addWaypoint({ lat: 47.1, lon: -3, name: 'BBB' })
    openWaypointForm(a.id)
    expect(list().title).toBe('Menu >Waypoints >Waypoint Info')
    press('ent') // édition du nom
    const ed = topView()!
    expect(ed.kind).toBe('edit')
    for (const ch of 'CCC') ed.typed!(ch)
    press('ent')
    expect(dev.wptById.get(a.id)!.name).toBe('CCC')
    // doublon
    press('ent')
    const ed2 = topView()!
    for (const ch of 'BBB') ed2.typed!(ch)
    press('ent')
    expect(dev.wptById.get(a.id)!.name).toBe('CCC')
  })

  it('nouveau waypoint : créé en quittant le formulaire par MENU', () => {
    openWaypointForm(null)
    expect(dev.waypoints).toHaveLength(0)
    press('menu')
    expect(dev.waypoints).toHaveLength(1)
    expect(dev.waypoints[0]!.name).toBe('WP0001')
  })
})

describe('alarmes', () => {
  it('alarme d’arrivée : bandeau, icône, acquittement par une touche', () => {
    const dev = fresh()
    const w = dev.addWaypoint({ lat: dev.ship.lat + 0.0005, lon: dev.ship.lon })!
    dev.settings.alarmArrival = { mode: 'Arrival', nm: 0.1 }
    dev.setDestWaypoint(w.id)
    dev.tick()
    expect(dev.alarms.active).toContain('ARRIVAL ALARM!')
    expect(dev.alarms.banner).toBe('ARRIVAL ALARM!')
    press('disp') // la 1re touche ne fait que couper l'alarme
    expect(dev.alarms.banner).toBe('')
    expect(dev.alarms.icon).toBe(true)
    dev.cancelDest()
    dev.tick()
    expect(dev.alarms.icon).toBe(false)
  })

  it('alarme de vitesse', () => {
    const dev = fresh()
    dev.settings.alarmSpeed = { on: true, kn: 4 }
    dev.sim.moving = true
    dev.sim.speed = 5
    dev.tick()
    expect(dev.alarms.active).toContain('SPEED ALARM!')
  })
})

describe('simulation', () => {
  it('déplacement à 6 kn cap 90° pendant 10 min ≈ 1 NM, trace enregistrée', () => {
    const dev = fresh()
    dev.settings.trackInterval = 0.05
    dev.sim.moving = true
    dev.sim.speed = 6
    dev.sim.course = 90
    dev.sim.courseMode = 'Manual'
    const lon0 = dev.ship.lon
    for (let i = 0; i < 600; i++) dev.tick()
    const nm = (dev.ship.lon - lon0) * 60 * Math.cos((dev.ship.lat * Math.PI) / 180)
    expect(nm).toBeGreaterThan(0.95)
    expect(nm).toBeLessThan(1.05)
    expect(dev.track.length).toBeGreaterThan(15)
    expect(dev.trackMemoryPct).toBeGreaterThanOrEqual(0)
  })

  it('Auto WPT Ent : un waypoint est inscrit quand le cap change de 60° en 10 s', () => {
    const dev = fresh()
    dev.settings.autoWpt = { on: true, deg: 60, sec: 10 }
    dev.sim.moving = true
    dev.sim.speed = 5
    dev.sim.courseMode = 'Manual'
    dev.sim.course = 90
    for (let i = 0; i < 5; i++) dev.tick()
    expect(dev.waypoints).toHaveLength(0)
    dev.sim.course = 170 // virage de 80°
    dev.tick()
    expect(dev.waypoints).toHaveLength(1)
  })

  it('un déplacement manuel coupe la trace (nouveau tronçon) sans fausser le XTE', () => {
    const dev = fresh()
    const w = dev.addWaypoint({ lat: dev.ship.lat + 0.1, lon: dev.ship.lon })!
    dev.setDestWaypoint(w.id)
    dev.setShipPosition(dev.ship.lat, dev.ship.lon + 0.05)
    expect(dev.nav.xte).toBeCloseTo(0, 3)
  })
})

describe('import / export', () => {
  it('charge waypoints_GP39.gpx, exporte et recharge à l’identique', () => {
    const dev = fresh()
    const r = dev.importGpx(realGpx, 'replace')
    expect(r.waypoints).toBe(2252)
    const xml = dev.exportGpx()
    const dev2 = fresh()
    const r2 = dev2.importGpx(xml, 'replace')
    expect(r2.waypoints).toBe(2252)
    expect(dev2.waypoints.filter((w) => w.symbol === 8)).toHaveLength(44)
  })

  it('applique la limite de 10 000 waypoints', () => {
    const dev = fresh()
    const many = Array.from({ length: 10050 }, (_, i) => `<wpt lat="${47 + i * 1e-5}" lon="-3"><name>W${i}</name></wpt>`).join('')
    const r = dev.importGpx(`<gpx>${many}</gpx>`, 'replace')
    expect(dev.waypoints).toHaveLength(10000)
    expect(r.warnings.join(' ')).toContain('limite')
  })
})

describe('routes et User displays par les menus', () => {
  it('Routes > [New] > ajout de deux waypoints depuis la liste, puis Goto Forward', () => {
    const dev = fresh()
    dev.addWaypoint({ lat: dev.ship.lat + 0.01, lon: dev.ship.lon, name: 'AAA' })
    dev.addWaypoint({ lat: dev.ship.lat + 0.02, lon: dev.ship.lon, name: 'BBB' })
    press('menu')
    press('menu')
    for (let i = 0; i < 3; i++) press('down') // Routes
    press('ent')
    press('ent') // Alphabet
    expect(list().title).toBe('Menu >Routes >Route List')
    press('ent') // [New]
    expect(list().title).toBe('Menu >Routes >Route Info')
    expect(dev.routes).toHaveLength(1)
    // lignes : Name, Comment, « 1 : -------- »
    press('down')
    press('down')
    press('ent') // ligne vide → tri
    press('ent') // Alphabet
    expect(list().title).toBe('Menu >Waypoints >Waypoint List')
    press('ent') // 1er waypoint (AAA) ; la liste de sélection n'a pas de ligne [New]
    expect(dev.routes[0]!.points).toHaveLength(1)
    expect(dev.wptById.get(dev.routes[0]!.points[0]!.wptId)!.name).toBe('AAA')
    // ajoute BBB sur la nouvelle ligne vide
    press('down') // la ligne vide « 2 » (le curseur était resté sur la ligne « 1 »)
    press('ent')
    press('ent') // Alphabet
    press('down') // BBB
    press('ent')
    expect(dev.routes[0]!.points.map((p) => dev.wptById.get(p.wptId)!.name)).toEqual(['AAA', 'BBB'])
    // retour à la liste des routes puis Goto > Forward
    press('menu')
    expect(list().title).toBe('Menu >Routes >Route List')
    press('down') // la route
    press('ent')
    expect(select().options).toEqual(['Goto', 'Edit', 'Delete'])
    press('ent') // Goto
    press('ent') // Forward
    expect(dev.dest?.kind).toBe('route')
    expect(topView()).toBeUndefined()
    expect(dev.settings.display).toBe(0)
  })

  it('User display 1 (Digital) : ENT affiche le curseur de cellule, ENT choisit la donnée', () => {
    const dev = fresh()
    dev.settings.user1.kind = 'Digital'
    dev.settings.user1.layout = 4
    setDisplay(5)
    press('ent')
    expect(ui.userCell).toMatchObject({ which: 5, cell: 0 })
    press('right')
    expect(ui.userCell?.cell).toBe(1)
    press('down')
    expect(ui.userCell?.cell).toBe(3)
    press('ent')
    expect(topView()!.kind).toBe('select')
    const opts = select().options
    const i = opts.indexOf('XTE')
    const steps = i - select().idx
    for (let k = 0; k < steps; k++) press('down')
    press('ent')
    expect(dev.settings.user1.cells[3]).toBe('XTE')
  })

  it('DISP fait défiler les 7 écrans et saute User 2 s’il est sur Off', () => {
    const dev = fresh()
    dev.settings.user2.kind = 'Off'
    const seen: number[] = [dev.settings.display]
    for (let i = 0; i < 6; i++) {
      press('disp')
      seen.push(dev.settings.display)
    }
    expect(seen).toEqual([0, 1, 2, 3, 4, 5, 0])
    press('disp', true) // sens inverse
    expect(dev.settings.display).toBe(5)
  })

  it('alarme horaire : se déclenche à l’heure réglée', () => {
    const dev = fresh()
    const d = new Date(dev.nowMs + (dev.settings.timeOffsetMin + (dev.settings.dst ? 60 : 0)) * 60000)
    dev.settings.alarmTime = { on: true, hhmm: d.getUTCHours() * 100 + d.getUTCMinutes() }
    dev.tick()
    expect(dev.alarms.active).toContain('TIME ALARM!')
  })
})
