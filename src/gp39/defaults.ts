import type { Settings, UserDisplayCfg } from './types'

const user = (kind: UserDisplayCfg['kind']): UserDisplayCfg => ({
  kind,
  layout: 4,
  // exemple du manuel §7.6 : Volts / SOG / Trip / COG
  cells: ['Volts', 'SOG', 'Trip', 'COG'],
  speedoRange: 40,
})

export function defaultSettings(): Settings {
  return {
    brillLcd: 7,
    brillKey: 3,
    display: 0,

    autoWpt: { on: false, deg: 60, sec: 10 },
    cogLine: true,
    cogRef: 'Mag',
    magVar: { mode: 'Auto', value: 0 },
    wptName: 'Disp Goto',
    ttgEtaSpd: { mode: 'Auto', avgSec: 60, manualKn: 20 },
    plotterRange: 6, // 2 NM (assez large pour voir plusieurs balises à la première ouverture)
    highwayRange: 4, // 2 NM

    trackRecord: 'Distance',
    trackInterval: 0.1,
    trackColor: 6, // Brown
    trackShow: true,

    buzzer: 'Short',
    alarmArrival: { mode: 'Off', nm: 0.1 },
    alarmXte: { on: false, nm: 0.25 },
    alarmSpeed: { on: false, kn: 30 },
    alarmSbas: false,
    alarmTime: { on: false, hhmm: 0 },
    alarmTrip: { on: false, nm: 100 },
    alarmOdo: { on: false, nm: 1000 },

    datum: 'WGS84',
    datumOther: 3,
    navigation: 'Rhumb Line',
    smoothPos: 0,
    smoothSC: 5,
    latOffset: 0,
    lonOffset: 0,
    disableSv: [],
    svElev: 5,
    rollOver: 2034,

    sbasMode: 'SBAS',
    sbasSearch: 'Auto',
    sbasSat: 123,
    qzssPositioning: false,
    qzssCorrection: false,

    data1: 'REM1',
    nmeaVersion: '3.0',

    user1: { ...user('Speedometer'), cells: ['Volts', 'SOG', 'Trip', 'COG'] },
    user2: { ...user('COG'), cells: ['Time', 'POSN', 'RNG', 'BRG'] },

    posFormat: "xx.xxx'",

    keyBeep: true,
    language: 'English',
    units: 'NM, kn',
    timeOffsetMin: -new Date().getTimezoneOffset(),
    dst: false,
    timeDisplay: '24Hour',
    dateDisplay: 'MM/DD/YY',
    operationMode: 'GP-39',
  }
}

/** D'où vient la position : du simulateur, ou du GPS de l'appareil (géolocalisation du navigateur). */
export type PositionSource = 'sim' | 'device'

/** Configuration du simulateur (hors réglages « matériels » du GP-39). */
export interface SimConfig {
  /** source de la position ; en mode `device`, les autres réglages de simulation sont sans effet */
  source: PositionSource
  /** le bateau avance selon SOG/COG */
  moving: boolean
  /** vitesse simulée (kn) */
  speed: number
  /** cap simulé (°, vrai) — ignoré en mode « Auto » (route circulaire) */
  course: number
  courseMode: 'Auto' | 'Manual'
  /** menu System > Demo : affiche « SIM » à la place de l'état du fix */
  demo: boolean
  /** état de fix forcé, ou `auto` pour le déduire de la constellation */
  forcedFix: 'auto' | '---' | '2D' | '3D' | 'S2D' | 'S3D' | 'DOP' | 'Q2D' | 'Q3D'
  /** tension d'alimentation affichée (V) */
  volts: number
  /** altitude affichée (m) */
  altitude: number
}

export function defaultSim(): SimConfig {
  return {
    source: 'sim',
    moving: false,
    speed: 5,
    course: 90,
    courseMode: 'Manual',
    demo: false,
    forcedFix: 'auto',
    volts: 12.6,
    altitude: 12,
  }
}

/** Position de départ : rade de Lorient (centre de gravité du jeu de données Bretagne). */
export const DEFAULT_SHIP = { lat: 47.7208, lon: -3.3517 }
