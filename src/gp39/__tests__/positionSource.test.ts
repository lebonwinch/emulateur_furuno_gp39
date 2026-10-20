// Deux sources de position : le simulateur, ou le GPS de l'appareil (géolocalisation du navigateur, simulée ici par une fausse API).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useDevice } from '@/stores/device'
import { defaultSim } from '@/gp39/defaults'
import { MS_TO_KN } from '@/gp39/deviceGps'
import { rhumbDestination } from '@/gp39/geo'
import { shipJustLeftMap } from '@/gp39/ui/plotter'
import { kvClear, kvSet } from '@/gp39/persist'
import { press, setDisplay } from '@/gp39/ui/controller'
import { closeAllViews, topView, ui } from '@/gp39/ui/state'
import type { ListRow, ListView, SelectView } from '@/gp39/ui/types'
import { fakeGeolocation, pos, T0 } from './fakeGeolocation'

function fresh() {
  setActivePinia(createPinia())
  closeAllViews()
  ui.toast = ''
  ui.cursor = null
  ui.cursorUntil = 0
  ui.moving = null
  const dev = useDevice()
  dev.power = 'on'
  return { dev, g: fakeGeolocation() }
}

/** le temps passe d'une seconde (ou plus) et l'appareil fait un tour de boucle */
function advance(dev: ReturnType<typeof useDevice>, ms = 1000): void {
  vi.setSystemTime(Date.now() + ms)
  dev.tick()
}

const KN10 = 10 / MS_TO_KN // 10 nœuds, en m/s

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(T0)
})
afterEach(async () => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  await kvClear()
})

describe('source simulée (par défaut)', () => {
  it('le simulateur fournit position, satellites, altitude et tension', () => {
    const { dev } = fresh()
    expect(dev.sim.source).toBe('sim')
    expect(dev.isSim).toBe(true)
    expect(dev.gps.status).toBe('off')
    expect(dev.sats.length).toBeGreaterThan(0)
    expect(dev.volts).toBe(12.6)
    expect(dev.altitude).toBe(12)
    expect(dev.setShipPosition(48, -4)).toBe(true)
    expect(dev.ship).toMatchObject({ lat: 48, lon: -4 })
  })
})

describe('passage au GPS de l’appareil', () => {
  it('arrête le simulateur : plus de déplacement, de démo ni de satellites, et pas de fix avant la première position', () => {
    const { dev, g } = fresh()
    dev.sim.moving = true
    dev.sim.demo = true
    dev.setPositionSource('device', g.provider)
    expect(dev.sim).toMatchObject({ source: 'device', moving: false, demo: false })
    expect(dev.isSim).toBe(false)
    expect(dev.sats).toEqual([])
    expect(dev.fix).toBe('---')
    expect(dev.hasFix).toBe(false)
    expect(dev.gps.status).toBe('starting')
    expect(g.calls.watch).toBe(1)
    expect(dev.volts).toBeNull()
    expect(dev.altitude).toBeNull()
  })

  it('le bateau ne peut plus être placé à la main : setShipPosition refuse et ne change rien', () => {
    const { dev, g } = fresh()
    dev.setPositionSource('device', g.provider)
    const before = { lat: dev.ship.lat, lon: dev.ship.lon }
    expect(dev.setShipPosition(1, 2)).toBe(false)
    expect({ lat: dev.ship.lat, lon: dev.ship.lon }).toEqual(before)
  })

  it('choisir deux fois la même source ne relance pas le suivi', () => {
    const { dev, g } = fresh()
    dev.setPositionSource('device', g.provider)
    dev.setPositionSource('device')
    expect(g.calls.watch).toBe(1)
  })

  it('sans API de géolocalisation, l’état le dit', () => {
    vi.stubGlobal('navigator', {})
    const { dev } = fresh()
    dev.setPositionSource('device')
    expect(dev.gps.status).toBe('unsupported')
    vi.stubGlobal('navigator', { geolocation: fakeGeolocation().provider })
    vi.stubGlobal('isSecureContext', false)
    dev.enableDeviceGps()
    expect(dev.gps.status).toBe('insecure')
  })
})

describe('positions reçues de l’appareil', () => {
  it('place le bateau, donne l’état du fix, l’altitude et le HDOP estimé', () => {
    const { dev, g } = fresh()
    dev.setPositionSource('device', g.provider)
    g.emit(pos(47.5, -3.1, { accuracy: 8, altitude: 20 }))
    expect(dev.ship).toMatchObject({ lat: 47.5, lon: -3.1 })
    expect(dev.fix).toBe('3D')
    expect(dev.hasFix).toBe(true)
    expect(dev.gps).toMatchObject({ status: 'tracking', accuracy: 8, altitude: 20 })
    expect(dev.altitude).toBe(20)
    expect(dev.fixInfo.hdop).toBeCloseTo(1.6, 5)
    expect(dev.fixInfo.used).toEqual([])
  })

  it('l’état du fix suit la précision : 2D sans altitude, DOP si médiocre', () => {
    const { dev, g } = fresh()
    dev.setPositionSource('device', g.provider)
    g.emit(pos(47.5, -3.1, { altitude: null, t: T0 }))
    expect(dev.fix).toBe('2D')
    expect(dev.altitude).toBeNull()
    g.emit(pos(47.5, -3.1, { accuracy: 80, t: T0 + 1000 }))
    expect(dev.fix).toBe('DOP')
  })

  it('une position trop vague (adresse IP, ville) est ignorée : le bateau reste en place, sans fix', () => {
    const { dev, g } = fresh()
    dev.setPositionSource('device', g.provider)
    const before = { lat: dev.ship.lat, lon: dev.ship.lon }
    g.emit(pos(10, 10, { accuracy: 800 }))
    expect({ lat: dev.ship.lat, lon: dev.ship.lon }).toEqual(before)
    expect(dev.gps).toMatchObject({ status: 'imprecise', accuracy: 800 })
    expect(dev.fix).toBe('---')
    g.emit(pos(47.5, -3.1, { t: T0 + 1000 }))
    expect(dev.gps.status).toBe('tracking')
    expect(dev.fix).toBe('3D')
  })

  it('vitesse et cap viennent de l’appareil ; le parcours (trip, odomètre) s’en déduit seconde par seconde', () => {
    const { dev, g } = fresh()
    dev.setPositionSource('device', g.provider)
    g.emit(pos(47.5, -3.1, { speed: KN10, heading: 270 }))
    expect(dev.ship.sog).toBeCloseTo(10, 5)
    expect(dev.ship.cog).toBe(270)
    expect(dev.ship.hasCog).toBe(true)
    const trip = dev.trip
    const odo = dev.odometer
    dev.tick()
    expect(dev.trip - trip).toBeCloseTo(10 / 3600, 8)
    expect(dev.odometer - odo).toBeCloseTo(10 / 3600, 8)
  })

  it('à l’arrêt : vitesse nulle, pas de cap, et le parcours n’augmente pas', () => {
    const { dev, g } = fresh()
    dev.setPositionSource('device', g.provider)
    g.emit(pos(47.5, -3.1, { speed: 0, heading: 90 }))
    expect(dev.ship.sog).toBe(0)
    expect(dev.ship.hasCog).toBe(false)
    const trip = dev.trip
    for (let i = 0; i < 3; i++) dev.tick()
    expect(dev.trip).toBe(trip)
  })

  it('sans nouvelle position pendant plus de 5 s : plus de fix, bateau tenu pour arrêté ; revient avec la position suivante', () => {
    const { dev, g } = fresh()
    dev.setPositionSource('device', g.provider)
    g.emit(pos(47.5, -3.1, { speed: KN10, heading: 90 }))
    advance(dev, 4000)
    expect(dev.fix).toBe('3D')
    expect(dev.gps.status).toBe('tracking')
    advance(dev, 2000)
    expect(dev.fix).toBe('---')
    expect(dev.hasFix).toBe(false)
    expect(dev.ship.sog).toBe(0)
    expect(dev.gps.status).toBe('lost')
    expect(dev.altitude).toBeNull()
    g.emit(pos(47.5, -3.09, { t: T0 + 6000 }))
    expect(dev.gps.status).toBe('tracking')
    expect(dev.fix).toBe('3D')
  })

  it('les réglages du simulateur (état de fix forcé, démo, déplacement) n’ont aucun effet', () => {
    const { dev, g } = fresh()
    dev.setPositionSource('device', g.provider)
    g.emit(pos(47.5, -3.1))
    dev.sim.forcedFix = '---'
    dev.sim.demo = true
    dev.sim.moving = true
    dev.sim.speed = 30
    dev.tick()
    expect(dev.fix).toBe('3D')
    expect(dev.hasFix).toBe(true)
    expect(dev.ship).toMatchObject({ lat: 47.5, lon: -3.1, sog: 0 })
  })
})

describe('trace, route et alarmes', () => {
  it('la trace commence par une coupure ; un saut de plus d’1 NM en ouvre une autre, un petit déplacement non', () => {
    const { dev, g } = fresh()
    dev.settings.trackRecord = 'Distance'
    dev.settings.trackInterval = 0.001
    dev.setPositionSource('device', g.provider)
    g.emit(pos(47.5, -3.1, { t: T0 }))
    dev.tick()
    g.emit(pos(47.5 + 0.003 / 60, -3.1, { t: T0 + 1000 }))
    dev.tick()
    g.emit(pos(47.5 + 2 / 60, -3.1, { t: T0 + 2000 }))
    dev.tick()
    expect(dev.track.map((p) => !!p.gap)).toEqual([true, false, true])
  })

  it('le tronçon de la route repart de la première position réelle après un changement de source, puis ne bouge plus', () => {
    const { dev, g } = fresh()
    const w = dev.addWaypoint({ lat: 47.8, lon: -3.0 })!
    dev.setDestWaypoint(w.id)
    dev.setPositionSource('device', g.provider)
    g.emit(pos(47.6, -3.2, { t: T0 }))
    expect(dev.dest!.from).toEqual({ lat: 47.6, lon: -3.2 })
    g.emit(pos(47.61, -3.19, { t: T0 + 1000 }))
    expect(dev.dest!.from).toEqual({ lat: 47.6, lon: -3.2 })
  })

  it('un fix perdu depuis plus de 45 s déclenche GPS NO FIX! ; une position la fait cesser', () => {
    const { dev, g } = fresh()
    dev.setPositionSource('device', g.provider)
    g.emit(pos(47.5, -3.1)) // GPS précis : périmée au bout de 5 s
    for (let i = 0; i < 50; i++) advance(dev)
    expect(dev.fix).toBe('---')
    expect(dev.alarms.active).not.toContain('GPS NO FIX!')
    advance(dev)
    expect(dev.alarms.active).toContain('GPS NO FIX!')
    g.emit(pos(47.5, -3.1, { t: Date.now() }))
    dev.tick()
    expect(dev.alarms.active).not.toContain('GPS NO FIX!')
  })

  it('jamais de fix (en attente de la première position, ou positions trop vagues d’un ordinateur de bureau) : pas d’alarme, l’état du GPS suffit', () => {
    const { dev, g } = fresh()
    dev.setPositionSource('device', g.provider)
    for (let i = 0; i < 100; i++) advance(dev)
    expect(dev.alarms.active).not.toContain('GPS NO FIX!')
    g.emit(pos(47.5, -3.1, { accuracy: 1500 }))
    for (let i = 0; i < 100; i++) advance(dev)
    expect(dev.gps.status).toBe('imprecise')
    expect(dev.alarms.active).not.toContain('GPS NO FIX!')
  })

  it('NO DIFFERENTIAL SIGNAL! n’a de sens que sur les satellites simulés', () => {
    const sim = fresh()
    sim.dev.settings.alarmSbas = true
    sim.dev.sim.forcedFix = '3D'
    sim.dev.tick()
    expect(sim.dev.alarms.active).toContain('NO DIFFERENTIAL SIGNAL!')

    const { dev, g } = fresh()
    dev.settings.alarmSbas = true
    dev.setPositionSource('device', g.provider)
    g.emit(pos(47.5, -3.1))
    dev.tick()
    expect(dev.fix).toBe('3D')
    expect(dev.alarms.active).not.toContain('NO DIFFERENTIAL SIGNAL!')
  })
})

describe('GO TO en mode « GPS de l’appareil »', () => {
  /** une seconde passe, `n` fois */
  function wait(dev: ReturnType<typeof useDevice>, n: number): void {
    for (let i = 0; i < n; i++) advance(dev)
  }
  /** le curseur du plotter est placé quelque part, puis GO TO */
  function goTo(dev: ReturnType<typeof useDevice>): void {
    setDisplay(0)
    ui.cursor = { lat: dev.ship.lat + 0.01, lon: dev.ship.lon }
    ui.cursorUntil = Date.now() + 7000
    press('goto')
  }

  it('avec un fix : le Quick Point est créé et visé dès la première pression', () => {
    const { dev, g } = fresh()
    dev.setPositionSource('device', g.provider)
    g.emit(pos(47.5, -3.1))
    wait(dev, 2)
    goTo(dev)
    expect(dev.dest?.kind).toBe('qp')
    expect(ui.cursor).toBeNull()
  })

  it('une position approximative (Wi-Fi), notifiée une seule fois, reste un fix : pas de fausse alarme qui avale la touche', () => {
    const { dev, g } = fresh()
    dev.setPositionSource('device', g.provider)
    g.emit(pos(47.5, -3.1, { accuracy: 80 }))
    wait(dev, 55)
    expect(dev.fix).toBe('DOP')
    expect(dev.alarms.banner).toBe('')
    goTo(dev)
    expect(dev.dest?.kind).toBe('qp')
  })

  it('la même position approximative finit par être perdue, au bout d’une minute sans nouvelle notification', () => {
    const { dev, g } = fresh()
    dev.setPositionSource('device', g.provider)
    g.emit(pos(47.5, -3.1, { accuracy: 80 }))
    wait(dev, 61)
    expect(dev.fix).toBe('---')
    expect(dev.gps.status).toBe('lost')
  })

  it('localisation refusée : aucune alarme « GPS NO FIX! » (l’état du GPS le dit déjà) et GO TO agit du premier coup', () => {
    const { dev, g } = fresh()
    dev.setPositionSource('device', g.provider)
    g.fail(1, 'User denied Geolocation')
    wait(dev, 100)
    expect(dev.alarms.active).not.toContain('GPS NO FIX!')
    goTo(dev)
    expect(dev.dest?.kind).toBe('qp')
  })

  it('fix perdu depuis plus de 45 s : l’alarme sonne ; la première touche l’acquitte (comme le GP-39), la suivante agit', () => {
    const { dev, g } = fresh()
    dev.setPositionSource('device', g.provider)
    g.emit(pos(47.5, -3.1))
    wait(dev, 60)
    expect(dev.alarms.banner).toBe('GPS NO FIX!')
    goTo(dev)
    expect(dev.dest).toBeNull()
    expect(dev.alarms.banner).toBe('')
    goTo(dev)
    expect(dev.dest?.kind).toBe('qp')
  })
})

describe('plotter : la carte et le bateau', () => {
  const east = (from: { lat: number; lon: number }, nm: number) => rhumbDestination(from, 90, nm)

  it('le bateau qui sort de la carte en avançant ramène la carte sur lui', () => {
    fresh()
    ui.center = { lat: 47.5, lon: -3.1 }
    expect(shipJustLeftMap(ui.center, east(ui.center, 10))).toBe(true)
  })

  it('un mouvement dans la carte, ou une position qui varie de quelques mètres, ne recentre rien', () => {
    fresh()
    ui.center = { lat: 47.5, lon: -3.1 }
    expect(shipJustLeftMap(ui.center, east(ui.center, 0.1))).toBe(false)
    expect(shipJustLeftMap(east(ui.center, 0.1), east(ui.center, 0.1005))).toBe(false)
  })

  it('une carte qu’on a fait défiler loin du bateau reste où elle est, même quand le GPS donne une nouvelle position (cible de GO TO)', () => {
    fresh()
    const ship = { lat: 47.5, lon: -3.1 }
    ui.center = east(ship, 10) // la carte a été déplacée de 10 NM vers l'est : le bateau est hors de l'écran
    expect(shipJustLeftMap(ship, { lat: ship.lat + 0.00003, lon: ship.lon })).toBe(false)
    expect(shipJustLeftMap(ship, east(ship, 0.5))).toBe(false)
  })

  it('le bateau qui revient dans la carte puis en ressort la ramène sur lui', () => {
    fresh()
    const ship = { lat: 47.5, lon: -3.1 }
    ui.center = east(ship, 10)
    expect(shipJustLeftMap(east(ship, 10), east(ship, 20))).toBe(true)
  })
})

describe('erreurs et nouvel essai', () => {
  it('refus : état « refusé », suivi arrêté ; « Activer » le relance ; délai et indisponibilité sont passagers', () => {
    const { dev, g } = fresh()
    dev.setPositionSource('device', g.provider)
    g.fail(1, 'User denied Geolocation')
    expect(dev.gps).toMatchObject({ status: 'denied', message: 'User denied Geolocation' })
    expect(g.calls.cleared).toEqual([1])
    dev.enableDeviceGps()
    expect(g.calls.watch).toBe(2)
    expect(dev.gps).toMatchObject({ status: 'starting', message: '' })
    g.fail(3, 'Timeout expired')
    expect(dev.gps.status).toBe('timeout')
    g.fail(2, 'unavailable')
    expect(dev.gps.status).toBe('unavailable')
    g.emit(pos(47.5, -3.1))
    expect(dev.gps.status).toBe('tracking')
  })

  it('Reset > GPS : nouvelle acquisition, le fix est perdu jusqu’à la prochaine position', () => {
    const { dev, g } = fresh()
    dev.setPositionSource('device', g.provider)
    g.emit(pos(47.5, -3.1))
    expect(dev.fix).toBe('3D')
    dev.resetGps()
    expect(dev.fix).toBe('---')
    expect(dev.gps.status).toBe('starting')
    expect(g.calls.watch).toBe(2)
    expect(dev.sinceFix).toBe(0)
  })
})

describe('retour à la simulation', () => {
  it('arrête le suivi, rend les satellites ; le bateau reste où il était et peut être déplacé ; une position tardive est ignorée', () => {
    const { dev, g } = fresh()
    dev.setPositionSource('device', g.provider)
    g.emit(pos(47.5, -3.1, { speed: KN10, heading: 45 }))
    dev.setPositionSource('sim')
    expect(dev.isSim).toBe(true)
    expect(dev.gps.status).toBe('off')
    expect(g.calls.cleared).toEqual([1])
    expect(dev.sats.length).toBeGreaterThan(0)
    expect(dev.ship).toMatchObject({ lat: 47.5, lon: -3.1, sog: 0 })
    expect(dev.volts).toBe(12.6)
    g.emit(pos(10, 10))
    expect(dev.ship).toMatchObject({ lat: 47.5, lon: -3.1 })
    expect(dev.setShipPosition(48, -4)).toBe(true)
    expect(dev.ship).toMatchObject({ lat: 48, lon: -4 })
  })

  it('« Factory Reset » repasse en simulation', async () => {
    const { dev, g } = fresh()
    dev.setPositionSource('device', g.provider)
    await dev.factoryReset(false)
    expect(dev.sim.source).toBe('sim')
    expect(dev.isSim).toBe(true)
    expect(g.calls.cleared).toEqual([1])
    expect(dev.sats.length).toBeGreaterThan(0)
  })
})

describe('menu System > Demo (touches de la façade)', () => {
  /** descend jusqu'à la ligne dont le premier libellé commence par `label`, puis ENT */
  function enterRow(label: string): void {
    const list = () => topView() as ListView
    for (let i = 0; i < list().count(); i++) {
      const first = list().row(list().idx).cells[0]
      if (typeof first === 'string' && first.startsWith(label)) {
        press('ent')
        return
      }
      press('down')
    }
    throw new Error(`ligne « ${label} » introuvable dans ${list().title}`)
  }
  function openDemo(): void {
    closeAllViews()
    setDisplay(2) // hors plotter : MENU ouvre directement le menu
    press('menu')
    enterRow('System')
    enterRow('Demo')
    expect((topView() as ListView).title).toBe('Menu >System >Demo')
  }
  const rowAt = (i: number): ListRow => (topView() as ListView).row(i)

  it('Mode > On repasse en simulation et lance la démo', () => {
    const { dev, g } = fresh()
    dev.setPositionSource('device', g.provider)
    openDemo()
    press('ent') // ligne Mode : la liste de choix s'ouvre
    expect((topView() as SelectView).options).toEqual(['Off', 'On'])
    press('down')
    press('ent')
    expect(dev.sim.source).toBe('sim')
    expect(dev.sim.demo).toBe(true)
    expect(dev.gps.status).toBe('off')
    expect(g.calls.cleared).toEqual([1])
  })

  it('une latitude saisie à la main est refusée en mode appareil, avec un message', () => {
    const { dev, g } = fresh()
    dev.setPositionSource('device', g.provider)
    g.emit(pos(47.5, -3.1))
    openDemo()
    expect(rowAt(3).cells[0]).toBe('Latitude')
    for (let i = 0; i < 3; i++) press('down')
    press('ent')
    press('ent') // valide la valeur affichée, inchangée
    expect(ui.toast).toBe('USING DEVICE GPS')
    expect(dev.ship).toMatchObject({ lat: 47.5, lon: -3.1 })
  })
})

describe('rechargement de l’application en mode « GPS de l’appareil »', () => {
  const stubBrowser = (state: string | null) => {
    const g = fakeGeolocation()
    vi.stubGlobal('navigator', {
      geolocation: g.provider,
      ...(state ? { permissions: { query: async () => ({ state }) } } : {}),
    })
    vi.stubGlobal('isSecureContext', true)
    return g
  }
  const persistDevice = async () => {
    await kvSet('sim', { ...defaultSim(), source: 'device', demo: true })
    await kvSet('waypoints', [])
    await kvSet('dest', { kind: 'waypoint', wptId: 1, from: { lat: 47, lon: -3 } })
  }

  it('hydrate relit la source ; autorisation déjà accordée : le suivi reprend seul', async () => {
    const g = stubBrowser('granted')
    await persistDevice()
    const { dev } = fresh()
    await dev.hydrate()
    expect(dev.sim).toMatchObject({ source: 'device', demo: false })
    expect(dev.sats).toEqual([])
    expect(dev.fix).toBe('---')
    await vi.waitFor(() => expect(dev.gps.status).toBe('starting'))
    expect(g.calls.watch).toBe(1)
    // la route en cours garde son tronçon d'origine : le bateau n'a pas été déplacé à la main
    g.emit(pos(47.6, -3.2))
    expect(dev.dest!.from).toEqual({ lat: 47, lon: -3 })
    expect(dev.fix).toBe('3D')
  })

  it('autorisation à demander ou inconnue : attend un clic, qui lance le suivi', async () => {
    for (const state of ['prompt', null]) {
      const g = stubBrowser(state)
      const { dev } = fresh()
      dev.sim.source = 'device'
      await dev.resumeDeviceGps()
      expect(dev.gps.status).toBe('prompt')
      expect(g.calls.watch).toBe(0)
      dev.enableDeviceGps()
      expect(dev.gps.status).toBe('starting')
      expect(g.calls.watch).toBe(1)
    }
  })

  it('autorisation refusée : le dit sans interroger le GPS', async () => {
    const g = stubBrowser('denied')
    const { dev } = fresh()
    dev.sim.source = 'device'
    await dev.resumeDeviceGps()
    expect(dev.gps.status).toBe('denied')
    expect(g.calls.watch).toBe(0)
  })

  it('un enregistrement d’avant ce mode (sans « source ») reste en simulation, sans rien démarrer', async () => {
    const g = stubBrowser('granted')
    const { source, ...old } = defaultSim()
    expect(source).toBe('sim')
    await kvSet('sim', old)
    await kvSet('waypoints', [])
    const { dev } = fresh()
    await dev.hydrate()
    expect(dev.sim.source).toBe('sim')
    expect(dev.sats.length).toBeGreaterThan(0)
    expect(dev.gps.status).toBe('off')
    expect(g.calls.watch).toBe(0)
  })

  it('en simulation, rien ne démarre', async () => {
    const g = stubBrowser('granted')
    const { dev } = fresh()
    await dev.resumeDeviceGps()
    expect(dev.gps.status).toBe('off')
    expect(g.calls.watch).toBe(0)
  })
})
