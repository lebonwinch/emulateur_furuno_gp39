// GO TO sur le plotter : Quick Point à l'endroit du curseur, ou menu contextuel d'un waypoint ; même quand la mémoire de waypoints est pleine.
import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useDevice } from '@/stores/device'
import { LIMITS } from '@/gp39/types'
import { press, setDisplay } from '@/gp39/ui/controller'
import { closeAllViews, topView, ui } from '@/gp39/ui/state'
import type { SelectView } from '@/gp39/ui/types'

function fresh() {
  setActivePinia(createPinia())
  closeAllViews()
  ui.cursor = null
  ui.cursorUntil = 0
  ui.moving = null
  ui.toast = ''
  const dev = useDevice()
  dev.sim.forcedFix = '3D'
  dev.power = 'on'
  dev.tick()
  setDisplay(0)
  return dev
}

/** le curseur du plotter est posé en un point (la carte est centrée dessus) */
function cursorAt(lat: number, lon: number): void {
  ui.center = { lat, lon }
  ui.cursor = { lat, lon }
  ui.cursorUntil = Date.now() + 7000
}

/** remplit la mémoire de waypoints (10 000) */
function fillMemory(dev: ReturnType<typeof useDevice>): void {
  for (let i = 0; dev.waypoints.length < LIMITS.waypoints; i++) dev.addWaypoint({ lat: 10 + i * 1e-4, lon: 10, name: `W${i}` })
}

describe('GO TO avec le curseur', () => {
  let dev: ReturnType<typeof fresh>
  beforeEach(() => {
    dev = fresh()
  })

  it('curseur en mer : Quick Point à cet endroit, qui devient la destination', () => {
    cursorAt(dev.ship.lat + 0.02 / 60, dev.ship.lon)
    press('goto')
    expect(dev.dest?.kind).toBe('qp')
    expect(dev.waypoints.filter((w) => w.qp)).toHaveLength(1)
    expect(dev.nav.rng).toBeCloseTo(0.02, 2)
    expect(ui.cursor).toBeNull()
    expect(topView()).toBeUndefined()
  })

  it('curseur sur un waypoint : son menu contextuel Goto / Move / Edit / Delete, puis Goto lui donne la route', () => {
    const w = dev.addWaypoint({ lat: dev.ship.lat + 0.3 / 60, lon: dev.ship.lon, name: 'BOUEE1' })!
    cursorAt(w.lat, w.lon)
    press('goto')
    const menu = topView() as SelectView
    expect(menu.kind).toBe('select')
    expect(menu.options).toEqual(['Goto', 'Move', 'Edit', 'Delete'])
    expect(dev.waypoints.some((x) => x.qp)).toBe(false)
    press('ent') // Goto
    expect(dev.dest).toMatchObject({ kind: 'waypoint', wptId: w.id })
    expect(topView()).toBeUndefined()
    expect(dev.nav.destName).toBe('BOUEE1')
  })

  it('sans curseur : le menu Goto (QP, listes de waypoints et de routes)', () => {
    press('goto')
    expect((topView() as SelectView).options).toEqual(['QP', 'WPT-Alphabet', 'WPT-Distance', 'Route-Alphabet', 'Route-Distance'])
  })

  it('un nouveau Quick Point remplace le précédent', () => {
    cursorAt(dev.ship.lat + 0.01, dev.ship.lon)
    press('goto')
    cursorAt(dev.ship.lat, dev.ship.lon + 0.01)
    press('goto')
    expect(dev.waypoints.filter((w) => w.qp)).toHaveLength(1)
    expect(dev.dest?.kind).toBe('qp')
  })
})

describe('mémoire de waypoints pleine (10 000)', () => {
  let dev: ReturnType<typeof fresh>
  beforeEach(() => {
    dev = fresh()
    dev.deleteAllWaypoints()
    fillMemory(dev)
    expect(dev.waypoints).toHaveLength(LIMITS.waypoints)
  })

  it('GO TO crée quand même le Quick Point, sans destination perdue en silence', () => {
    cursorAt(dev.ship.lat + 0.02 / 60, dev.ship.lon)
    press('goto')
    expect(dev.dest?.kind).toBe('qp')
    expect(dev.waypoints.filter((w) => w.qp)).toHaveLength(1)
    dev.tick()
    expect(dev.dest?.kind).toBe('qp')
    expect(dev.nav.hasDest).toBe(true)
  })

  it('les Quick Points suivants se remplacent, sans faire grossir la mémoire', () => {
    for (let i = 0; i < 3; i++) {
      cursorAt(dev.ship.lat + 0.01 * (i + 1), dev.ship.lon)
      press('goto')
    }
    expect(dev.waypoints.filter((w) => w.qp)).toHaveLength(1)
    expect(dev.waypoints).toHaveLength(LIMITS.waypoints + 1)
  })

  it('curseur sur un waypoint : le menu contextuel s’ouvre et Goto fonctionne', () => {
    const w = dev.waypoints[5]!
    cursorAt(w.lat, w.lon)
    press('goto')
    expect((topView() as SelectView).options[0]).toBe('Goto')
    press('ent')
    expect(dev.dest).toMatchObject({ kind: 'waypoint', wptId: w.id })
  })

  it('MARK et ENT/CNTR sur la mer disent que la mémoire est pleine au lieu de ne rien faire', () => {
    press('mark')
    expect(ui.toast).toBe('WAYPOINT MEMORY FULL')
    expect(dev.waypoints).toHaveLength(LIMITS.waypoints)
    ui.toast = ''
    cursorAt(dev.ship.lat + 1, dev.ship.lon)
    press('ent')
    expect(ui.toast).toBe('WAYPOINT MEMORY FULL')
  })

  it('l’import ne dépasse pas la limite, avec un compte d’ignorés correct (Quick Point compris)', () => {
    cursorAt(dev.ship.lat + 0.01, dev.ship.lon)
    press('goto') // 10 001 éléments avec le Quick Point
    const xml = `<?xml version="1.0"?><gpx version="1.1" creator="t"><wpt lat="1" lon="1"><name>X</name></wpt><wpt lat="2" lon="2"><name>Y</name></wpt></gpx>`
    const r = dev.importGpx(xml, 'merge', 't.gpx')
    expect(r.waypoints).toBe(0)
    expect(r.warnings.join(' ')).toContain('2 waypoint(s) ignoré(s)')
  })
})

describe('le Quick Point est temporaire', () => {
  let dev: ReturnType<typeof fresh>
  beforeEach(() => {
    dev = fresh()
  })
  const setQp = (): void => {
    cursorAt(dev.ship.lat + 0.01, dev.ship.lon)
    press('goto')
  }
  const qps = (): number => dev.waypoints.filter((w) => w.qp).length

  it('il reste tant qu’il est visé', () => {
    setQp()
    for (let i = 0; i < 5; i++) dev.tick()
    expect(qps()).toBe(1)
    expect(dev.dest?.kind).toBe('qp')
  })

  it('annuler la destination par son menu contextuel (Cancel Goto, Yes) le supprime de la liste', () => {
    const before = dev.waypoints.length
    setQp()
    expect(dev.waypoints).toHaveLength(before + 1)
    const qp = dev.waypoints.find((w) => w.qp)!
    cursorAt(qp.lat, qp.lon)
    press('ent') // menu contextuel du point visé
    expect((topView() as SelectView).options).toEqual(['Cancel Goto'])
    press('ent') // Cancel Goto → confirmation
    press('up') // Yes
    press('ent')
    expect(dev.dest).toBeNull()
    expect(qps()).toBe(0)
    expect(dev.waypoints).toHaveLength(before)
  })

  it('cancelDest, ou une autre destination, le supprime aussi', () => {
    setQp()
    dev.cancelDest()
    expect(qps()).toBe(0)

    setQp()
    const w = dev.addWaypoint({ lat: dev.ship.lat + 0.1, lon: dev.ship.lon, name: 'AUTRE' })!
    dev.setDestWaypoint(w.id)
    expect(qps()).toBe(0)
    expect(dev.dest).toMatchObject({ kind: 'waypoint', wptId: w.id })
  })

  it('une route comme destination le supprime', () => {
    setQp()
    const a = dev.addWaypoint({ lat: 1, lon: 1, name: 'A' })!
    const b = dev.addWaypoint({ lat: 1.1, lon: 1, name: 'B' })!
    const r = dev.addRoute('R1')!
    r.points.push({ wptId: a.id, skip: false }, { wptId: b.id, skip: false })
    expect(dev.setDestRoute(r.no, 'Forward')).toBe(true)
    expect(qps()).toBe(0)
  })

  it('un Quick Point laissé sans destination par une ancienne session disparaît au premier tour', () => {
    dev.addWaypoint({ lat: dev.ship.lat, lon: dev.ship.lon, name: 'QP', qp: true })
    expect(qps()).toBe(1)
    dev.tick()
    expect(qps()).toBe(0)
  })

  it('un point ordinaire n’est jamais touché, et la mémoire pleine retrouve sa place après annulation', () => {
    dev.deleteAllWaypoints()
    fillMemory(dev)
    setQp()
    expect(dev.waypoints).toHaveLength(LIMITS.waypoints + 1)
    dev.cancelDest()
    expect(dev.waypoints).toHaveLength(LIMITS.waypoints)
    expect(dev.waypoints.every((w) => !w.qp)).toBe(true)
  })
})

describe('menu Goto (sans curseur)', () => {
  it('l’option QP place le curseur sur le bateau pour viser ensuite (manuel §5.1, note 2)', () => {
    const dev = fresh()
    press('goto')
    press('ent') // QP
    expect(topView()).toBeUndefined()
    expect(ui.cursor).toMatchObject({ lat: dev.ship.lat, lon: dev.ship.lon })
  })
})
