// GPS de l'appareil : conversion des positions du navigateur, état du fix, vitesse et cap, suivi et erreurs.
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  DeviceGps,
  Freshness,
  GPS_STATUS_TEXT,
  Kinematics,
  MS_TO_KN,
  detectGeolocation,
  fixFromAccuracy,
  hdopFromAccuracy,
  permissionState,
  statusFromError,
  toDeviceFix,
  type DeviceFix,
  type GpsStatus,
} from '../deviceGps'
import { rhumbDestination, type LatLon } from '../geo'
import { fakeGeolocation, pos, T0 } from './fakeGeolocation'

const fix = (p: LatLon, o: Partial<DeviceFix> = {}): DeviceFix => ({
  lat: p.lat,
  lon: p.lon,
  accuracy: 5,
  altitude: 12,
  speedKn: null,
  heading: null,
  time: T0,
  ...o,
})

describe('toDeviceFix', () => {
  it('convertit la vitesse de m/s en nœuds et garde le cap, l’altitude et la précision', () => {
    const f = toDeviceFix(pos(47.7, -3.35, { speed: 5.144444, heading: 123, altitude: 8.5, accuracy: 12, t: T0 + 5 }))!
    expect(f).toMatchObject({ lat: 47.7, lon: -3.35, accuracy: 12, altitude: 8.5, heading: 123, time: T0 + 5 })
    expect(f.speedKn).toBeCloseTo(10, 3)
    expect(MS_TO_KN).toBeCloseTo(1.943844, 5)
  })

  it('les mesures absentes ou absurdes deviennent null (le navigateur donne NaN ou null selon l’appareil)', () => {
    const f = toDeviceFix(pos(47.7, -3.35, { speed: NaN, heading: NaN, altitude: null }))!
    expect(f).toMatchObject({ speedKn: null, heading: null, altitude: null })
    expect(toDeviceFix(pos(47.7, -3.35, { speed: -1, heading: 360 }))).toMatchObject({ speedKn: null, heading: null })
    expect(toDeviceFix(pos(47.7, -3.35, { accuracy: NaN }))!.accuracy).toBe(Infinity)
    expect(toDeviceFix(pos(47.7, -3.35, { accuracy: -3 }))!.accuracy).toBe(Infinity)
  })

  it('rejette une position hors du globe', () => {
    expect(toDeviceFix(pos(91, 0))).toBeNull()
    expect(toDeviceFix(pos(0, 181))).toBeNull()
    expect(toDeviceFix(pos(NaN, 0))).toBeNull()
    expect(toDeviceFix(pos(0, Infinity))).toBeNull()
  })

  it('sans horodatage valable, prend l’heure de réception', () => {
    expect(toDeviceFix({ ...pos(1, 1), timestamp: 0 }, 4242)!.time).toBe(4242)
  })
})

describe('état du fix d’après la précision', () => {
  it('bonne précision : 3D si l’altitude est connue, sinon 2D', () => {
    expect(fixFromAccuracy(5, true)).toBe('3D')
    expect(fixFromAccuracy(50, true)).toBe('3D')
    expect(fixFromAccuracy(5, false)).toBe('2D')
  })

  it('précision médiocre : DOP ; au-delà de 500 m ou inconnue : pas de fix', () => {
    expect(fixFromAccuracy(51, true)).toBe('DOP')
    expect(fixFromAccuracy(500, false)).toBe('DOP')
    expect(fixFromAccuracy(501, true)).toBe('---')
    expect(fixFromAccuracy(Infinity, true)).toBe('---')
    expect(fixFromAccuracy(NaN, true)).toBe('---')
  })

  it('HDOP estimé : borné entre 0,8 et 9,9', () => {
    expect(hdopFromAccuracy(1)).toBe(0.8)
    expect(hdopFromAccuracy(10)).toBe(2)
    expect(hdopFromAccuracy(5000)).toBe(9.9)
    expect(hdopFromAccuracy(Infinity)).toBe(9.9)
  })

  it('chaque état annoncé a un texte, et les erreurs du navigateur sont reconnues', () => {
    const all: GpsStatus[] = [
      'off',
      'prompt',
      'starting',
      'tracking',
      'lost',
      'imprecise',
      'denied',
      'unavailable',
      'timeout',
      'unsupported',
      'insecure',
    ]
    for (const s of all) expect(GPS_STATUS_TEXT[s].length, s).toBeGreaterThan(5)
    expect(statusFromError({ code: 1, message: '' })).toBe('denied')
    expect(statusFromError({ code: 2, message: '' })).toBe('unavailable')
    expect(statusFromError({ code: 3, message: '' })).toBe('timeout')
    expect(statusFromError({ code: 99, message: '' })).toBe('unavailable')
  })
})

describe('Freshness : durée de validité d’une position', () => {
  it('GPS précis : 5 s ; position approximative : 1 min', () => {
    const f = new Freshness()
    expect(f.staleMs(5)).toBe(5000)
    expect(f.staleMs(50)).toBe(5000)
    expect(f.staleMs(51)).toBe(60_000)
    expect(f.staleMs(Infinity)).toBe(60_000)
  })

  it('un GPS à 1 Hz garde 5 s', () => {
    const f = new Freshness()
    for (let s = 0; s < 30; s++) f.note(T0 + s * 1000)
    expect(f.staleMs(5)).toBe(5000)
  })

  it('s’adapte à l’intervalle constaté : 3 fois la moyenne, plafonné à 5 min', () => {
    const f = new Freshness()
    for (let s = 0; s < 10; s++) f.note(T0 + s * 40_000)
    expect(f.staleMs(5)).toBe(120_000)
    const slow = new Freshness()
    for (let s = 0; s < 10; s++) slow.note(T0 + s * 200_000)
    expect(slow.staleMs(5)).toBe(300_000)
  })

  it('un intervalle aberrant (veille de l’onglet) est ignoré ; reset repart de zéro', () => {
    const f = new Freshness()
    f.note(T0)
    f.note(T0 + 1000)
    f.note(T0 + 3_600_000)
    expect(f.staleMs(5)).toBe(5000)
    for (let s = 1; s < 6; s++) f.note(T0 + 3_600_000 + s * 40_000)
    expect(f.staleMs(5)).toBeGreaterThan(5000)
    f.reset()
    expect(f.staleMs(5)).toBe(5000)
  })
})

describe('Kinematics : vitesse et cap', () => {
  const start: LatLon = { lat: 47.7, lon: -3.35 }

  /** n secondes de route au cap `cog` à `kn` nœuds, une position par seconde */
  function sail(k: Kinematics, kn: number, cog: number, seconds: number, o: Partial<DeviceFix> = {}, from = start) {
    let p = from
    let last = { sogKn: 0, cog: null as number | null }
    for (let s = 0; s <= seconds; s++) {
      last = k.update(fix(p, { time: T0 + s * 1000, ...o }))
      p = rhumbDestination(p, cog, kn / 3600)
    }
    return last
  }

  it('privilégie la vitesse et le cap donnés par l’appareil', () => {
    const k = new Kinematics()
    expect(k.update(fix(start, { speedKn: 7.3, heading: 215 }))).toEqual({ sogKn: 7.3, cog: 215 })
  })

  it('une vitesse inférieure à 0,2 nœud est du bruit : arrêt, et pas de cap (en dessous de 0,5 nœud non plus)', () => {
    const k = new Kinematics()
    expect(k.update(fix(start, { speedKn: 0.1, heading: 90, time: T0 }))).toEqual({ sogKn: 0, cog: null })
    expect(k.update(fix(start, { speedKn: 0.3, heading: 90, time: T0 + 1000 }))).toEqual({ sogKn: 0.3, cog: null })
    expect(k.update(fix(start, { speedKn: 0.6, heading: 90, time: T0 + 2000 }))).toEqual({ sogKn: 0.6, cog: 90 })
  })

  it('sans vitesse de l’appareil, la calcule d’après les déplacements', () => {
    const r = sail(new Kinematics(), 6, 90, 10)
    expect(r.sogKn).toBeCloseTo(6, 1)
    expect(r.cog).toBeCloseTo(90, 0)
    const n = sail(new Kinematics(), 12, 0, 10)
    expect(n.sogKn).toBeCloseTo(12, 1)
    expect(n.cog).toBeCloseTo(0, 0) // plein nord
  })

  it('pas de vitesse calculée avant 4 s d’historique', () => {
    expect(sail(new Kinematics(), 6, 90, 3)).toEqual({ sogKn: 0, cog: null })
  })

  it('un bateau lent et bien localisé est détecté en remontant plus loin dans l’historique', () => {
    const r = sail(new Kinematics(), 2, 45, 29, { accuracy: 5 })
    expect(r.sogKn).toBeCloseTo(2, 1)
    expect(r.cog).toBeCloseTo(45, 0)
  })

  it('un récepteur immobile dont la position « bouge » dans sa marge d’erreur ne fait pas avancer le bateau', () => {
    const k = new Kinematics()
    const wobbleM = [0, 20, -20, 10, -10, 20, -20, 0, 15, -15, 20, -20, 5, -5, 20, -20]
    let last = { sogKn: -1, cog: 0 as number | null }
    wobbleM.forEach((m, s) => {
      last = k.update(fix({ lat: start.lat + m / 1852 / 60, lon: start.lon }, { accuracy: 30, time: T0 + s * 1000 }))
    })
    expect(last).toEqual({ sogKn: 0, cog: null })
  })

  it('une précision inconnue ne permet aucune vitesse calculée', () => {
    expect(sail(new Kinematics(), 10, 90, 12, { accuracy: Infinity })).toEqual({ sogKn: 0, cog: null })
  })

  it('une horloge qui recule ou des positions rejouées repartent de zéro (jamais de vitesse négative)', () => {
    const k = new Kinematics()
    sail(k, 6, 90, 10)
    const r = k.update(fix(start, { time: T0 + 2000 }))
    expect(r).toEqual({ sogKn: 0, cog: null })
  })

  it('reset oublie l’historique', () => {
    const k = new Kinematics()
    sail(k, 6, 90, 10)
    k.reset()
    expect(k.update(fix(start, { time: T0 + 11_000 }))).toEqual({ sogKn: 0, cog: null })
  })
})

describe('DeviceGps : suivi de la position', () => {
  it('demande une position précise, sans cache, avec un délai de 20 s, et transmet les positions valides', () => {
    const g = fakeGeolocation()
    const seen: DeviceFix[] = []
    const gps = new DeviceGps(g.provider)
    gps.start((f) => seen.push(f), vi.fn())
    expect(gps.active).toBe(true)
    expect(g.calls.options).toEqual({ enableHighAccuracy: true, maximumAge: 0, timeout: 20000 })
    g.emit(pos(47.7, -3.35, { accuracy: 8 }))
    g.emit(pos(NaN, 0)) // inexploitable : ignorée
    g.emit(pos(47.71, -3.36))
    expect(seen.map((f) => [f.lat, f.lon])).toEqual([
      [47.7, -3.35],
      [47.71, -3.36],
    ])
  })

  it('refus d’autorisation : arrête la surveillance ; délai ou indisponibilité : la garde', () => {
    const g = fakeGeolocation()
    const errors: [GpsStatus, string][] = []
    const gps = new DeviceGps(g.provider)
    gps.start(vi.fn(), (s, m) => errors.push([s, m]))
    g.fail(3, 'Timeout expired')
    g.fail(2, 'position unavailable')
    expect(gps.active).toBe(true)
    expect(g.calls.cleared).toEqual([])
    g.fail(1, 'User denied Geolocation')
    expect(gps.active).toBe(false)
    expect(g.calls.cleared).toEqual([1])
    expect(errors).toEqual([
      ['timeout', 'Timeout expired'],
      ['unavailable', 'position unavailable'],
      ['denied', 'User denied Geolocation'],
    ])
  })

  it('redémarrer remplace la surveillance précédente ; arrêter est sans effet s’il n’y en a pas', () => {
    const g = fakeGeolocation()
    const gps = new DeviceGps(g.provider)
    gps.stop()
    expect(g.calls.cleared).toEqual([])
    gps.start(vi.fn(), vi.fn())
    gps.start(vi.fn(), vi.fn())
    expect(g.calls.cleared).toEqual([1])
    gps.stop()
    gps.stop()
    expect(g.calls.cleared).toEqual([1, 2])
    expect(gps.active).toBe(false)
  })

  it('si le navigateur lève une exception au démarrage, signale « indisponible »', () => {
    const errors: [GpsStatus, string][] = []
    const gps = new DeviceGps({
      watchPosition: () => {
        throw new Error('SecurityError')
      },
      clearWatch: vi.fn(),
    })
    gps.start(vi.fn(), (s, m) => errors.push([s, m]))
    expect(errors).toEqual([['unavailable', 'SecurityError']])
    expect(gps.active).toBe(false)
  })
})

describe('détection de la géolocalisation du navigateur', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('API absente : non prise en charge', () => {
    vi.stubGlobal('navigator', {})
    expect(detectGeolocation()).toEqual({ provider: null, status: 'unsupported' })
  })

  it('page non sécurisée (HTTP hors localhost) : le navigateur refusera, on le dit avant', () => {
    vi.stubGlobal('navigator', { geolocation: fakeGeolocation().provider })
    vi.stubGlobal('isSecureContext', false)
    expect(detectGeolocation()).toEqual({ provider: null, status: 'insecure' })
  })

  it('page sécurisée : fournit l’API', () => {
    const g = fakeGeolocation()
    vi.stubGlobal('navigator', { geolocation: g.provider })
    vi.stubGlobal('isSecureContext', true)
    expect(detectGeolocation()).toEqual({ provider: g.provider, status: 'ok' })
  })

  it('autorisation déjà donnée, refusée, à demander, ou inconnue (API Permissions absente ou en échec)', async () => {
    const withState = (state: string) => vi.stubGlobal('navigator', { permissions: { query: async () => ({ state }) } })
    withState('granted')
    expect(await permissionState()).toBe('granted')
    withState('denied')
    expect(await permissionState()).toBe('denied')
    withState('prompt')
    expect(await permissionState()).toBe('prompt')
    withState('autre')
    expect(await permissionState()).toBe('unknown')
    vi.stubGlobal('navigator', {})
    expect(await permissionState()).toBe('unknown')
    vi.stubGlobal('navigator', {
      permissions: {
        query: async () => {
          throw new TypeError('geolocation is not a valid permission name')
        },
      },
    })
    expect(await permissionState()).toBe('unknown')
  })
})
