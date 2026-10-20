// Fausse géolocalisation du navigateur pour les tests : on y « émet » des positions et des erreurs comme le ferait le GPS.
import type { GeoErrorLike, GeolocationLike, GeoPositionLike } from '../deviceGps'

export interface PosOptions {
  accuracy?: number
  altitude?: number | null
  /** m/s, comme l'API du navigateur */
  speed?: number | null
  heading?: number | null
  /** instant de la mesure (ms) */
  t?: number
}

export const T0 = Date.UTC(2026, 5, 1, 12, 0, 0)

export function pos(lat: number, lon: number, o: PosOptions = {}): GeoPositionLike {
  return {
    coords: {
      latitude: lat,
      longitude: lon,
      accuracy: o.accuracy ?? 5,
      altitude: o.altitude === undefined ? 12 : o.altitude,
      heading: o.heading === undefined ? null : o.heading,
      speed: o.speed === undefined ? null : o.speed,
    },
    timestamp: o.t ?? T0,
  }
}

export function fakeGeolocation() {
  let ok: ((p: GeoPositionLike) => void) | null = null
  let err: ((e: GeoErrorLike) => void) | null = null
  const calls = { watch: 0, cleared: [] as number[], options: undefined as unknown }
  const provider: GeolocationLike = {
    watchPosition(success, error, options) {
      ok = success
      err = error
      calls.options = options
      return ++calls.watch
    },
    clearWatch(id) {
      calls.cleared.push(id)
    },
  }
  return {
    provider,
    calls,
    /** le GPS donne une position */
    emit: (p: GeoPositionLike): void => ok?.(p),
    /** le GPS signale une erreur (1 refusé, 2 indisponible, 3 délai dépassé) */
    fail: (code: number, message = 'erreur'): void => err?.({ code, message }),
  }
}
