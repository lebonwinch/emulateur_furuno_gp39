// Simulation du récepteur GPS : constellation de satellites, état du fix, DOP.

import type { Fix, Satellite } from './types'

/** PRN GPS « visibles » proposés par défaut. */
const GPS_PRN = [2, 5, 8, 11, 13, 15, 17, 22, 25, 28, 30, 32]

/** PRN SBAS visible depuis l'Europe (EGNOS) / Japon / Amérique : valeur par défaut = EGNOS. */
export const DEFAULT_GEO_PRN = 123

/** Petit générateur pseudo-aléatoire déterministe (mulberry32). */
function rng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function createSatellites(seed = 39): Satellite[] {
  const r = rng(seed)
  const sats: Satellite[] = GPS_PRN.map((prn, i) => ({
    prn,
    // répartition régulière en azimut, élévations variées
    az: (i * 30 + r() * 25) % 360,
    elev: 8 + r() * 78,
    snr: 18 + r() * 26,
  }))
  // un satellite de plus ou de moins selon la graine, pour varier les captures d'écran
  sats.push({ prn: DEFAULT_GEO_PRN, az: 165, elev: 29, snr: 31, geo: true })
  return sats
}

/** Fait évoluer lentement la constellation (azimuts qui tournent, élévations qui oscillent). */
export function stepSatellites(sats: Satellite[], dtSec: number, tSec: number): void {
  for (const s of sats) {
    if (s.geo) {
      // les satellites géostationnaires ne bougent (quasiment) pas ; le SNR varie à peine
      s.snr = 30 + 2 * Math.sin(tSec / 40 + s.prn)
      continue
    }
    s.az = (s.az + 0.012 * dtSec * (1 + (s.prn % 3) * 0.1)) % 360
    s.elev = Math.min(88, Math.max(3, s.elev + 0.004 * dtSec * Math.sin(tSec / 600 + s.prn)))
    const base = 14 + (s.elev / 90) * 30
    s.snr = Math.max(0, Math.min(50, base + 3 * Math.sin(tSec / 25 + s.prn)))
  }
}

export interface FixInfo {
  fix: Fix
  used: number[]
  hdop: number
  pdop: number
}

/**
 * Détermine l'état du fix à partir des satellites visibles.
 * `forced` permet de forcer un état depuis le panneau de simulation.
 */
export function computeFix(
  sats: Satellite[],
  opts: { minElev: number; disabled: number[]; sbas: boolean; qzss: boolean; forced: Fix | 'auto' },
): FixInfo {
  const usable = sats
    .filter((s) => !s.geo && s.elev >= opts.minElev && !opts.disabled.includes(s.prn))
    .sort((a, b) => b.elev - a.elev)
    .slice(0, 12)
  const geo = sats.find((s) => s.geo && s.elev >= opts.minElev)
  const n = usable.length
  const hdop = n >= 4 ? 0.75 + 4.5 / Math.sqrt(n) : 9.9
  const pdop = hdop * 1.4
  const used = usable.map((s) => s.prn)
  if (geo && opts.sbas && n >= 3) used.push(geo.prn)

  let fix: Fix
  if (opts.forced !== 'auto') fix = opts.forced
  else if (n < 3) fix = '---'
  else if (n === 3) fix = geo && opts.sbas ? 'S2D' : '2D'
  else if (hdop > 4) fix = 'DOP'
  else fix = geo && opts.sbas ? 'S3D' : '3D'
  return { fix, used, hdop, pdop }
}

export const FIX_IS_VALID = (f: Fix): boolean => f !== '---'
/** Indique si la correction différentielle est active (alarme « NO DIFFERENTIAL SIGNAL »). */
export const FIX_IS_DIFFERENTIAL = (f: Fix): boolean => f === 'S2D' || f === 'S3D' || f === 'Q2D' || f === 'Q3D'
