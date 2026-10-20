// Position GPS de l'appareil (API de géolocalisation du navigateur) : conversion en grandeurs du GP-39, sans Vue ni DOM (testable sous Node).
//
// Le navigateur ne donne ni satellites ni DOP : il donne une position, sa précision (m), parfois l'altitude, la vitesse et le cap. On en
// déduit un état de fix (---, 2D, 3D, DOP), un HDOP estimé, et, à défaut de vitesse ou de cap fournis, une vitesse et un cap calculés sur
// les derniers déplacements — avec une marge égale à la précision, pour qu'un récepteur immobile (ou un positionnement Wi-Fi qui « saute »
// de quelques dizaines de mètres) ne fasse pas avancer le bateau.

import { bearing, distance, type LatLon } from './geo'
import type { Fix } from './types'

/** nœuds par mètre/seconde */
export const MS_TO_KN = 3600 / 1852
/** au-delà, la position est trop vague pour placer le bateau (positionnement par adresse IP, par exemple) : pas de fix */
export const MAX_FIX_ACCURACY_M = 500
/** jusqu'à cette précision, le fix est « bon » (2D / 3D) ; au-delà : « DOP » (position utilisable mais approximative) */
export const GOOD_ACCURACY_M = 50
/** sans nouvelle position depuis ce délai, il n'y a plus de fix (GPS : une position par seconde) */
export const STALE_MS = 5000
/** idem pour une position approximative (Wi-Fi, adresse IP) : le navigateur ne la notifie que quand elle change, parfois à plusieurs minutes d'intervalle */
export const STALE_NETWORK_MS = 60_000
/** plafond du délai de validité, quel que soit l'intervalle constaté entre les positions */
export const STALE_MAX_MS = 300_000
/** erreur de mesure d'une pseudo-distance (m), pour estimer le HDOP à partir de la précision horizontale */
const UERE_M = 5

export const WATCH_OPTIONS = { enableHighAccuracy: true, maximumAge: 0, timeout: 20000 } as const

// --- l'API du navigateur, réduite à ce qu'on utilise (pour pouvoir la simuler) ---------------------------------------------

export interface GeoPositionLike {
  coords: {
    latitude: number
    longitude: number
    accuracy: number
    altitude: number | null
    altitudeAccuracy?: number | null
    heading: number | null
    speed: number | null
  }
  timestamp: number
}

export interface GeoErrorLike {
  /** 1 permission refusée, 2 position indisponible, 3 délai dépassé */
  code: number
  message: string
}

export interface GeolocationLike {
  watchPosition(
    success: (p: GeoPositionLike) => void,
    error: (e: GeoErrorLike) => void,
    options?: { enableHighAccuracy?: boolean; maximumAge?: number; timeout?: number },
  ): number
  clearWatch(id: number): void
}

export type GpsStatus =
  | 'off'
  | 'prompt'
  | 'starting'
  | 'tracking'
  | 'lost'
  | 'imprecise'
  | 'denied'
  | 'unavailable'
  | 'timeout'
  | 'unsupported'
  | 'insecure'

export const GPS_STATUS_TEXT: Record<GpsStatus, string> = {
  off: 'Position simulée',
  prompt: 'En attente de votre autorisation',
  starting: 'Recherche de la position…',
  tracking: 'Position reçue',
  lost: 'Signal perdu (plus de nouvelle position)',
  imprecise: 'Position trop imprécise (positionnement approximatif, pas de GPS)',
  denied: 'Localisation refusée',
  unavailable: 'Position indisponible',
  timeout: 'Pas de position reçue (délai dépassé)',
  unsupported: 'Ce navigateur ne sait pas donner la position',
  insecure: 'La localisation exige une page en HTTPS',
}

// --- positions --------------------------------------------------------------------------------------------------------------

export interface DeviceFix {
  lat: number
  lon: number
  /** précision horizontale (m) à 68 % ; Infinity si inconnue */
  accuracy: number
  altitude: number | null
  /** vitesse fournie par l'appareil (nœuds), ou null */
  speedKn: number | null
  /** cap fourni par l'appareil (° vrai), ou null */
  heading: number | null
  /** instant de la mesure (ms) */
  time: number
}

const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n)

/** Position du navigateur → `DeviceFix`, ou null si elle est inexploitable. */
export function toDeviceFix(p: GeoPositionLike, now = Date.now()): DeviceFix | null {
  const c = p.coords
  if (!finite(c.latitude) || !finite(c.longitude) || Math.abs(c.latitude) > 90 || Math.abs(c.longitude) > 180) return null
  return {
    lat: c.latitude,
    lon: c.longitude,
    accuracy: finite(c.accuracy) && c.accuracy >= 0 ? c.accuracy : Infinity,
    altitude: finite(c.altitude) ? c.altitude : null,
    speedKn: finite(c.speed) && c.speed >= 0 ? c.speed * MS_TO_KN : null,
    heading: finite(c.heading) && c.heading >= 0 && c.heading < 360 ? c.heading : null,
    time: finite(p.timestamp) && p.timestamp > 0 ? p.timestamp : now,
  }
}

/** État de fix du GP-39 correspondant à la précision d'une position. */
export function fixFromAccuracy(accuracy: number, hasAltitude: boolean): Fix {
  if (!(accuracy <= MAX_FIX_ACCURACY_M)) return '---'
  if (accuracy > GOOD_ACCURACY_M) return 'DOP'
  return hasAltitude ? '3D' : '2D'
}

/** HDOP estimé d'après la précision (le navigateur n'en donne pas) : 0,8 au mieux, 9,9 au pire. */
export const hdopFromAccuracy = (accuracy: number): number => Math.min(9.9, Math.max(0.8, accuracy / UERE_M))

/** Cause d'une erreur de géolocalisation du navigateur. */
export function statusFromError(e: GeoErrorLike): GpsStatus {
  return e.code === 1 ? 'denied' : e.code === 3 ? 'timeout' : 'unavailable'
}

/**
 * Durée de validité de la dernière position. Un GPS en donne une par seconde : 5 s sans nouvelle position, c'est un fix perdu. Une
 * position approximative (précision > 50 m : Wi-Fi, adresse IP — typique d'un ordinateur) n'est notifiée que lorsqu'elle change :
 * la tenir pour périmée au bout de 5 s ferait clignoter le fix et déclencherait de fausses alarmes. Le délai s'adapte à l'intervalle
 * constaté entre les positions (3 fois la moyenne, au plus `STALE_MAX_MS`).
 */
export class Freshness {
  private mean: number | null = null
  private last = 0

  reset(): void {
    this.mean = null
    this.last = 0
  }

  /** à chaque position exploitable reçue, à l'instant `at` (ms) */
  note(at: number): void {
    if (this.last && at > this.last) {
      const dt = at - this.last
      if (dt <= STALE_MAX_MS) this.mean = this.mean === null ? dt : 0.7 * this.mean + 0.3 * dt
    }
    this.last = at
  }

  /** délai sans nouvelle position au-delà duquel il n'y a plus de fix */
  staleMs(accuracy: number): number {
    const base = accuracy > GOOD_ACCURACY_M ? STALE_NETWORK_MS : STALE_MS
    return Math.min(STALE_MAX_MS, Math.max(base, 3 * (this.mean ?? 0)))
  }
}

// --- vitesse et cap ----------------------------------------------------------------------------------------------------------

interface Sample extends LatLon {
  accuracy: number
  time: number
}

export interface Motion {
  /** vitesse sur le fond (nœuds), 0 sous le seuil de bruit */
  sogKn: number
  /** cap sur le fond (° vrai), ou null si le bateau ne bouge pas assez pour en avoir un */
  cog: number | null
}

/** Vitesse en dessous de laquelle le bateau est tenu pour immobile */
export const MIN_SOG_KN = 0.2
/** Vitesse à partir de laquelle un cap a un sens (le cap d'un récepteur immobile est du bruit) */
export const MIN_COG_SOG_KN = 0.5
const WINDOW_MS = 30_000
const MIN_BASELINE_MS = 4000

/**
 * Vitesse et cap d'une suite de positions : ceux de l'appareil quand il les donne (mesure Doppler, plus fiable que des écarts de
 * position), sinon calculés entre la position actuelle et la plus récente des positions vieilles de 4 secondes ou plus dont l'écart
 * dépasse nettement l'incertitude des deux mesures (on remonte jusqu'à 30 s : un bateau lent ne se distingue du bruit qu'à la longue).
 * Un bateau qui vient de s'arrêter garde donc une vitesse qui décroît pendant 30 s au plus.
 */
export class Kinematics {
  private history: Sample[] = []

  reset(): void {
    this.history = []
  }

  update(f: DeviceFix): Motion {
    const now: Sample = { lat: f.lat, lon: f.lon, accuracy: f.accuracy, time: f.time }
    // positions rejouées ou horloge qui recule : on repart de zéro plutôt que de calculer des vitesses négatives
    if (this.history.length && f.time <= this.history[this.history.length - 1]!.time) this.history = []
    let derivedKn = 0
    let derivedCog: number | null = null
    for (let i = this.history.length - 1; i >= 0; i--) {
      const s = this.history[i]!
      const dt = f.time - s.time
      if (dt < MIN_BASELINE_MS) continue
      const dNm = distance(s, now)
      const noiseNm = Math.max(s.accuracy, f.accuracy) / 1852
      if (dNm >= 1.5 * noiseNm) {
        derivedKn = dNm / (dt / 3_600_000)
        derivedCog = bearing(s, now)
        break
      }
    }
    this.history.push(now)
    const cutoff = f.time - WINDOW_MS
    while (this.history.length > 1 && this.history[0]!.time < cutoff) this.history.shift()

    let sog = f.speedKn ?? derivedKn
    if (sog < MIN_SOG_KN) sog = 0
    const cog = sog >= MIN_COG_SOG_KN ? (f.heading ?? derivedCog) : null
    return { sogKn: sog, cog }
  }
}

// --- accès à la géolocalisation ------------------------------------------------------------------------------------------------

export type Detected = { provider: GeolocationLike; status: 'ok' } | { provider: null; status: 'unsupported' | 'insecure' }

/** La géolocalisation du navigateur, ou la raison pour laquelle elle n'est pas utilisable (pas d'API, page non sécurisée). */
export function detectGeolocation(): Detected {
  const nav = (globalThis as { navigator?: { geolocation?: GeolocationLike } }).navigator
  if (!nav?.geolocation) return { provider: null, status: 'unsupported' }
  if ((globalThis as { isSecureContext?: boolean }).isSecureContext === false) return { provider: null, status: 'insecure' }
  return { provider: nav.geolocation, status: 'ok' }
}

/** Autorisation de localisation déjà donnée ou refusée, sans la demander (l'API Permissions n'existe pas partout : « unknown »). */
export async function permissionState(): Promise<'granted' | 'prompt' | 'denied' | 'unknown'> {
  try {
    const perms = (globalThis as { navigator?: { permissions?: { query(d: { name: string }): Promise<{ state: string }> } } }).navigator
      ?.permissions
    if (!perms) return 'unknown'
    const s = (await perms.query({ name: 'geolocation' })).state
    return s === 'granted' || s === 'denied' || s === 'prompt' ? s : 'unknown'
  } catch {
    return 'unknown'
  }
}

/** Suivi continu de la position : une surveillance (`watchPosition`) qu'on démarre et qu'on arrête. */
export class DeviceGps {
  private id: number | null = null

  constructor(private readonly provider: GeolocationLike) {}

  get active(): boolean {
    return this.id !== null
  }

  start(onFix: (f: DeviceFix) => void, onError: (status: GpsStatus, message: string) => void): void {
    this.stop()
    try {
      this.id = this.provider.watchPosition(
        (p) => {
          const f = toDeviceFix(p)
          if (f) onFix(f)
        },
        (e) => {
          const status = statusFromError(e)
          // permission refusée : la surveillance ne reviendra pas d'elle-même ; les autres erreurs (délai, indisponible) sont passagères
          if (status === 'denied') this.stop()
          onError(status, e.message)
        },
        { ...WATCH_OPTIONS },
      )
    } catch (e) {
      this.id = null
      onError('unavailable', e instanceof Error ? e.message : String(e))
    }
  }

  stop(): void {
    if (this.id === null) return
    try {
      this.provider.clearWatch(this.id)
    } finally {
      this.id = null
    }
  }
}
