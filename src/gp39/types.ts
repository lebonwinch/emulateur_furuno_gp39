import type { NavMethod } from './geo'
import type { DateFormat, PosFormat, TimeFormat, Units } from './format'

/** Capacités du GP-39 (manuel §3, §4, spécifications). */
export const LIMITS = {
  waypoints: 10000,
  routes: 100,
  routeWaypoints: 30,
  trackPoints: 3000,
  nameLen: 8,
  commentLen: 13,
  routeNameLen: 6,
  routeCommentLen: 18,
} as const

export interface Waypoint {
  /** identifiant interne unique (non affiché) */
  id: number
  /** nom GP-39, 0 à 8 caractères (un GPX peut contenir des points sans nom) */
  name: string
  lat: number
  lon: number
  /** GP39Symbol : 0-9 */
  symbol: number
  /** FECColor : 0-6 */
  color: number
  /** GP39Comment : 0-13 caractères */
  comment: string
  /** GP39Flag : affiché sur le plotter */
  display: boolean
  /** vrai pour le Quick Point (« QP ») créé par GO TO ; jamais exporté */
  qp?: boolean
  /** calque (un par fichier GPX importé) ; absent des anciennes données, rattaché alors au calque « Appareil » */
  layer?: number
}

/** Calque de l'éditeur de waypoints : regroupe les waypoints d'un même fichier source. */
export interface Layer {
  id: number
  name: string
  /** affiché sur la carte de l'éditeur (le plotter de l'appareil n'est pas concerné) */
  visible: boolean
}

export interface RoutePoint {
  wptId: number
  /** point « Skip » temporairement désélectionné */
  skip: boolean
}

export interface Route {
  /** numéro 1-100 */
  no: number
  /** nom, 6 caractères max */
  name: string
  /** commentaire, 18 caractères max */
  comment: string
  points: RoutePoint[]
}

export interface TrackPoint {
  lat: number
  lon: number
  /** couleur de tracé 0-6 (couleur de la trace au moment de l'enregistrement) */
  color: number
  /** vrai si le point démarre un nouveau tronçon (téléportation / reprise d'enregistrement) */
  gap?: boolean
}

export type DestKind = 'waypoint' | 'qp' | 'route' | 'mob'

export interface Destination {
  kind: DestKind
  /** waypoint visé (pour kind=route : waypoint courant de la route) */
  wptId: number
  /** départ du tronçon courant (position du bateau à l'activation, ou point précédent de la route) */
  from: { lat: number; lon: number }
  routeNo?: number
  /** index dans la route (dans route.points) du point visé */
  routeIdx?: number
  direction?: 'Forward' | 'Reverse'
}

export interface MobMark {
  lat: number
  lon: number
}

export type Fix = '---' | '2D' | '3D' | 'S2D' | 'S3D' | 'DOP' | 'Q2D' | 'Q3D' | 'SIM'

export interface Satellite {
  prn: number
  /** élévation 0-90° */
  elev: number
  /** azimut 0-359° */
  az: number
  /** rapport signal/bruit 0-50 (barres) */
  snr: number
  geo?: boolean
}

export type UserDisplayKind = 'Digital' | 'Speedometer' | 'COG' | 'Off'
export type UserCell =
  | 'ODO'
  | 'Trip'
  | 'Time'
  | 'Date'
  | 'POSN'
  | 'Volts'
  | 'SOG'
  | 'COG'
  | 'RNG'
  | 'BRG'
  | 'XTE'
  | 'TTG'
  | 'ETA'
  | 'WPT'
  | 'None'

export interface UserDisplayCfg {
  kind: UserDisplayKind
  /** nombre de cellules du mode Digital : 1, 2, 3 ou 4 (voir UserDisplayMenu) */
  layout: 1 | 2 | 3 | 4
  cells: [UserCell, UserCell, UserCell, UserCell]
  /** échelle du compteur de vitesse (kn) */
  speedoRange: 20 | 40 | 80
}

export interface Settings {
  brillLcd: number
  brillKey: number
  display: number

  // Plotter Setup
  autoWpt: { on: boolean; deg: number; sec: number }
  cogLine: boolean
  cogRef: 'True' | 'Mag'
  magVar: { mode: 'Auto' | 'Manual'; value: number }
  wptName: 'Disp Goto' | 'Disp All' | 'Disp Route'
  ttgEtaSpd: { mode: 'Auto' | 'Manual'; avgSec: number; manualKn: number }
  /** index dans PLOTTER_RANGES */
  plotterRange: number
  highwayRange: number

  // Tracks
  trackRecord: 'Off' | 'Distance' | 'Auto'
  trackInterval: number
  trackColor: number
  trackShow: boolean

  // Alarms
  buzzer: 'Short' | 'Long' | 'Cont.'
  alarmArrival: { mode: 'Off' | 'Arrival' | 'Anchor'; nm: number }
  alarmXte: { on: boolean; nm: number }
  alarmSpeed: { on: boolean; kn: number }
  alarmSbas: boolean
  alarmTime: { on: boolean; hhmm: number }
  alarmTrip: { on: boolean; nm: number }
  alarmOdo: { on: boolean; nm: number }

  // GPS Setup
  datum: 'WGS84' | 'WGS72' | 'Other'
  datumOther: number
  navigation: NavMethod
  smoothPos: number
  smoothSC: number
  latOffset: number
  lonOffset: number
  disableSv: number[]
  svElev: number
  rollOver: number

  // SBAS
  sbasMode: 'SBAS' | 'GPS'
  sbasSearch: 'Auto' | 'Manual'
  sbasSat: number
  qzssPositioning: boolean
  qzssCorrection: boolean

  // I/O Setup
  data1: 'REM1' | 'REM2' | 'AP' | 'GPS'
  nmeaVersion: '1.5' | '2.0' | '3.0'

  // User Display
  user1: UserDisplayCfg
  user2: UserDisplayCfg

  // Pos/TD Setup
  posFormat: PosFormat

  // System
  keyBeep: boolean
  language: 'English' | 'French' | 'Spanish' | 'Vietnamese' | 'Malay' | 'Indonesian' | 'Simplified Chinese' | 'Thai'
  units: Units
  timeOffsetMin: number
  dst: boolean
  timeDisplay: TimeFormat
  dateDisplay: DateFormat
  operationMode: 'GP-39' | 'SCX-21'
}

/** Échelles de portée (NM) du plotter et du highway. */
export const PLOTTER_RANGES = [0.02, 0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 40, 80, 160, 320] as const
export const HIGHWAY_RANGES = [0.2, 0.4, 0.8, 1, 2, 4, 8, 16] as const

export const DISPLAY_NAMES = ['Plotter', 'Highway', 'Steering', 'Nav Data', 'Satellite', 'User 1', 'User 2'] as const
export type DisplayMode = 0 | 1 | 2 | 3 | 4 | 5 | 6
