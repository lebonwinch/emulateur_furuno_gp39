// Présentation des objets CM93 : couleurs, étiquettes… Une version simplifiée des conventions de la carte électronique (S-52).
// Pur (ni DOM ni canevas) : testable sous Node.

import type { Attrs } from './attrs'

/** Couleurs S-57 (attribut COLOUR) */
export const NAV_COLOURS: Record<number, string> = {
  1: '#ffffff',
  2: '#1d1d1d',
  3: '#d9302c',
  4: '#2e9a46',
  5: '#2a5fd6',
  6: '#f4d03f',
  7: '#9a9a9a',
  8: '#8b5a2b',
  9: '#f0a30a',
  10: '#8a3fb5',
  11: '#f28a1d',
  12: '#e0309b',
  13: '#f7a8c4',
}

export const PALETTE = {
  land: '#c9b97a',
  landEdge: '#6b6350',
  built: '#d9c996',
  building: '#b3a37a',
  intertidal: '#a8cf8a',
  shallow: '#73b6ef',
  medium: '#a1cff7',
  mediumDeep: '#c6e3fb',
  deep: '#ffffff',
  lake: '#a1cff7',
  coast: '#5d5b52',
  contour: '#7d97a8',
  special: '#b5179e',
  text: '#222222',
  sounding: '#111111',
  soundingDeep: '#7c8a90',
  halo: 'rgba(255,255,255,0.85)',
} as const

/** Teinte d'une zone de profondeur d'après sa borne inférieure DRVAL1 (m) ; les zones qui découvrent sont « intertidales ». */
export function depthColour(drval1: number | undefined, intertidal: boolean): string {
  if (intertidal || (drval1 !== undefined && drval1 < 0)) return PALETTE.intertidal
  if (drval1 === undefined) return PALETTE.medium
  if (drval1 < 2) return PALETTE.shallow
  if (drval1 < 10) return PALETTE.medium
  if (drval1 < 30) return PALETTE.mediumDeep
  return PALETTE.deep
}

/** « 2.4 » sous 31 m, « 45 » au-delà (convention des cartes marines) */
export const formatDepth = (d: number): string => (d < 31 ? (Math.round(d * 10) / 10).toFixed(1) : String(Math.round(d)))

/** Couleurs d'un objet de balisage : attribut COLOUR, à défaut la couleur imposée par la catégorie (balises latérales). */
export function navColours(cls: string, a: Attrs): string[] {
  const list = Array.isArray(a.COLOUR) ? a.COLOUR : typeof a.COLOUR === 'number' ? [a.COLOUR] : []
  const codes = list.length
    ? list
    : cls.endsWith('LAT')
      ? [a.CATLAM === 2 || (Array.isArray(a.CATLAM) && a.CATLAM[0] === 2) ? 4 : 3]
      : cls.endsWith('CAR')
        ? [2, 6]
        : []
  return codes.map((c) => NAV_COLOURS[c] ?? '#9a9a9a')
}

/** Caractère d'un feu (LITCHR) en abrégé international */
const LITCHR: Record<number, string> = {
  1: 'F',
  2: 'Fl',
  3: 'LFl',
  4: 'Q',
  5: 'VQ',
  6: 'UQ',
  7: 'Iso',
  8: 'Oc',
  9: 'IQ',
  10: 'IVQ',
  11: 'IUQ',
  12: 'Mo',
  13: 'FFl',
  14: 'FlLFl',
  15: 'OcFl',
  16: 'FLFl',
  17: 'Al.Oc',
  18: 'Al.LFl',
  19: 'Al.Fl',
  20: 'Al.Gr',
  25: 'Q+LFl',
  26: 'VQ+LFl',
  27: 'UQ+LFl',
  28: 'Al',
  29: 'Al.FFl',
}

const LIGHT_LETTER: Record<number, string> = { 1: 'W', 3: 'R', 4: 'G', 5: 'Bu', 6: 'Y', 9: 'Am', 11: 'Or' }

const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined)

/** « Fl(2)WR.10s14m12M » : caractère, groupe, couleurs, période, hauteur, portée */
export function lightLabel(a: Attrs): string {
  const chr = LITCHR[num(a.LITCHR) ?? -1] ?? ''
  const grp = typeof a.SIGGRP === 'string' && a.SIGGRP !== '(1)' ? a.SIGGRP : ''
  const cols = (Array.isArray(a.COLOUR) ? a.COLOUR : []).map((c) => LIGHT_LETTER[c] ?? '').join('')
  const per = num(a.SIGPER)
  const h = num(a.HEIGHT)
  const r = num(a.VALNMR)
  const fmt = (n: number): string => String(Math.round(n * 10) / 10)
  const out = `${chr}${grp}${cols}${per !== undefined ? `.${fmt(per)}s` : ''}${h !== undefined ? `${fmt(h)}m` : ''}${r !== undefined ? `${fmt(r)}M` : ''}`
  return out === '' ? '' : out
}

/** Couleur du secteur d'un feu : le blanc s'affiche en jaune, comme sur les cartes */
export function lightSectorColour(a: Attrs): string {
  const c = Array.isArray(a.COLOUR) ? a.COLOUR[0] : undefined
  return c === 3 ? '#e8261f' : c === 4 ? '#1fa84f' : c === 5 ? '#2a5fd6' : '#f2c300'
}
