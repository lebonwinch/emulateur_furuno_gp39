// Formatage des valeurs affichées par le GP-39 (positions, distances, vitesses, heures…).

export type PosFormat = "xx.xxx'" | `xx'xx.x"` | 'LC TD' | 'DE TD'
export type Units = 'NM, kn' | 'km, km/h' | 'sm, mph'
export type DateFormat = 'DD/MMM/YY' | 'MM/DD/YY'
export type TimeFormat = '12Hour' | '24Hour'

const pad = (n: number, w = 2): string => String(Math.trunc(n)).padStart(w, '0')

/** Latitude/longitude telle qu'affichée (ex. `34°08.326'N`). */
export function formatCoord(value: number, isLat: boolean, fmt: PosFormat = "xx.xxx'"): string {
  const hemi = isLat ? (value >= 0 ? 'N' : 'S') : value >= 0 ? 'E' : 'W'
  const abs = Math.abs(value)
  let deg = Math.floor(abs)
  const minTotal = (abs - deg) * 60
  const degW = isLat ? 2 : 3
  if (fmt === `xx'xx.x"`) {
    let min = Math.floor(minTotal)
    let sec = Math.round((minTotal - min) * 60 * 10) / 10
    if (sec >= 60) {
      sec = 0
      min += 1
    }
    if (min >= 60) {
      min = 0
      deg += 1
    }
    return `${pad(deg, degW)}°${pad(min)}'${sec.toFixed(1).padStart(4, '0')}"${hemi}`
  }
  let m = Math.round(minTotal * 1000) / 1000
  if (m >= 60) {
    m = 0
    deg += 1
  }
  return `${pad(deg, degW)}°${m.toFixed(3).padStart(6, '0')}'${hemi}`
}

export const formatLat = (lat: number, fmt?: PosFormat): string => formatCoord(lat, true, fmt)
export const formatLon = (lon: number, fmt?: PosFormat): string => formatCoord(lon, false, fmt)

/**
 * Étiquette de graticule du plotter, p. ex. `N 34 08.375` / `E 135 09.500`.
 * `decimals` = nombre de décimales des minutes.
 */
export function gridLabel(value: number, isLat: boolean, decimals: number): string {
  const hemi = isLat ? (value >= 0 ? 'N' : 'S') : value >= 0 ? 'E' : 'W'
  const abs = Math.abs(value)
  let deg = Math.floor(abs + 1e-9)
  let min = (abs - deg) * 60
  if (min > 59.9999) {
    min = 0
    deg += 1
  }
  const w = decimals > 0 ? 3 + decimals : 2
  return `${hemi} ${deg} ${min.toFixed(decimals).padStart(w, '0')}`
}

// ------------------------------------------------------------------ unités

const KM_PER_NM = 1.852
const SM_PER_NM = 1.150779

export function distUnit(u: Units): string {
  return u === 'NM, kn' ? 'NM' : u === 'km, km/h' ? 'km' : 'sm'
}
export function speedUnit(u: Units): string {
  return u === 'NM, kn' ? 'kn' : u === 'km, km/h' ? 'km/h' : 'mph'
}
export function toDistUnit(nm: number, u: Units): number {
  return u === 'NM, kn' ? nm : u === 'km, km/h' ? nm * KM_PER_NM : nm * SM_PER_NM
}
export function fromDistUnit(v: number, u: Units): number {
  return u === 'NM, kn' ? v : u === 'km, km/h' ? v / KM_PER_NM : v / SM_PER_NM
}

/** Distance (RNG, trip…) : 0.46 / 14.6 / 146. Plafonne à `*999` comme le GP-39. */
export function formatRange(nm: number, u: Units = 'NM, kn'): string {
  const v = toDistUnit(Math.abs(nm), u)
  if (v > 999) return '*999'
  if (v < 10) return v.toFixed(2)
  if (v < 100) return v.toFixed(1)
  return v.toFixed(0)
}

/** Vitesse (SOG) : 14.6 ; `*99` au-delà de 999. */
export function formatSpeed(kn: number, u: Units = 'NM, kn'): string {
  const v = u === 'NM, kn' ? kn : u === 'km, km/h' ? kn * KM_PER_NM : kn * SM_PER_NM
  if (v > 999) return '*99'
  if (v < 100) return v.toFixed(1)
  return v.toFixed(0)
}

/** XTE numérique : 7.845 ; `*9.99` au-delà de 99.99. */
export function formatXte(nm: number, u: Units = 'NM, kn'): string {
  const v = toDistUnit(Math.abs(nm), u)
  if (v > 99.99) return '*9.99'
  if (v < 10) return v.toFixed(3)
  return v.toFixed(2)
}

/** Cap / relèvement : 3 chiffres, 0 → 360. */
export function formatAngle(deg: number | null | undefined, digits = 3): string {
  if (deg == null || Number.isNaN(deg)) return '---'
  let d = Math.round(deg) % 360
  if (d < 0) d += 360
  return pad(d, digits)
}

/** TTG : `00H 15M` ; `*9H*9M` au-delà de 99H59M. */
export function formatTtg(hours: number | null): { h: string; m: string } {
  if (hours == null || !Number.isFinite(hours)) return { h: '--', m: '--' }
  const totalMin = Math.round(hours * 60)
  const h = Math.floor(totalMin / 60)
  const m = totalMin % 60
  if (h > 99) return { h: '*9', m: '*9' }
  return { h: pad(h), m: pad(m) }
}

// ------------------------------------------------------------------ date / heure

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC']

export function formatTime(d: Date, fmt: TimeFormat = '24Hour'): string {
  const hh = d.getUTCHours()
  const mm = pad(d.getUTCMinutes())
  const ss = pad(d.getUTCSeconds())
  if (fmt === '24Hour') return `${pad(hh)}:${mm}:${ss}`
  const h12 = hh % 12 === 0 ? 12 : hh % 12
  return `${pad(h12)}:${mm}:${ss}${hh < 12 ? 'AM' : 'PM'}`
}

export function formatDate(d: Date, fmt: DateFormat = 'MM/DD/YY'): string {
  const yy = pad(d.getUTCFullYear() % 100)
  const dd = pad(d.getUTCDate())
  if (fmt === 'DD/MMM/YY') return `${dd}/${MONTHS[d.getUTCMonth()]}/${yy}`
  return `${pad(d.getUTCMonth() + 1)}/${dd}/${yy}`
}

/** Décalage horaire « -8:00 » ↔ minutes. */
export function formatOffset(min: number): string {
  const sign = min < 0 ? '-' : '+'
  const a = Math.abs(min)
  return `${sign}${Math.floor(a / 60)}:${pad(a % 60)}`
}

/** Heure locale du GP-39 : UTC décalée (GMT + offset [+ 1 h si heure d'été]). */
export function localDate(utc: Date, offsetMin: number, dst: boolean): Date {
  return new Date(utc.getTime() + (offsetMin + (dst ? 60 : 0)) * 60000)
}
