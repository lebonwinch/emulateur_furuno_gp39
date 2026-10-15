// État complet du GP-39 émulé : réglages, waypoints, routes, traces, navigation, simulation GPS, alarmes.

import { defineStore } from 'pinia'
import { computed, reactive, ref, shallowRef, triggerRef, watch } from 'vue'
import { bearing, crossTrack, distance, magneticVariation, norm360, rhumbDestination, type LatLon } from '@/gp39/geo'
import { buildGpx, parseGpx } from '@/gp39/gpx'
import { defaultSettings, defaultSim, DEFAULT_SHIP, type SimConfig } from '@/gp39/defaults'
import { debounce, kvClear, kvGet, kvSet } from '@/gp39/persist'
import { computeFix, createSatellites, stepSatellites, FIX_IS_DIFFERENTIAL, type FixInfo } from '@/gp39/sim'
import { startAlarmBuzzer, stopAlarmBuzzer } from '@/gp39/audio'
import { DEFAULT_COLOR, DEFAULT_SYMBOL } from '@/gp39/symbols'
import {
  LIMITS,
  PLOTTER_RANGES,
  type Destination,
  type Fix,
  type MobMark,
  type Route,
  type Satellite,
  type Settings,
  type TrackPoint,
  type Waypoint,
} from '@/gp39/types'

const DB_KEYS = {
  settings: 'settings',
  sim: 'sim',
  waypoints: 'waypoints',
  routes: 'routes',
  track: 'track',
  dest: 'dest',
  mob: 'mob',
  ship: 'ship',
  counters: 'counters',
} as const

export type Power = 'off' | 'booting' | 'on'

export interface NavData {
  hasDest: boolean
  destName: string
  dest: LatLon | null
  /** distance au point visé (NM) */
  rng: number
  /** relèvement vrai vers le point visé (°) */
  brgTrue: number
  /** écart traversier (NM), positif = à droite de la route */
  xte: number
  ttgHours: number | null
  eta: Date | null
}

export const useDevice = defineStore('device', () => {
  // ---------------------------------------------------------------- état
  const settings = reactive<Settings>(defaultSettings())
  const sim = reactive<SimConfig>(defaultSim())
  const ready = ref(false)

  const waypoints = shallowRef<Waypoint[]>([])
  const wptVersion = ref(0)
  const routes = ref<Route[]>([])
  const track = shallowRef<TrackPoint[]>([])
  const trackVersion = ref(0)
  const mob = ref<MobMark | null>(null)
  const dest = ref<Destination | null>(null)

  const ship = reactive({ lat: DEFAULT_SHIP.lat, lon: DEFAULT_SHIP.lon, sog: 0, cog: 0, hasCog: false })
  const odometer = ref(0)
  const trip = ref(0)
  const nowMs = ref(Date.now())

  const power = ref<Power>('on')
  const powerOffCountdown = ref<number | null>(null)
  const sats = shallowRef<Satellite[]>(createSatellites())
  const fixInfo = ref<FixInfo>({ fix: '---', used: [], hdop: 9.9, pdop: 9.9 })
  /** secondes écoulées depuis la mise sous tension (acquisition du fix) */
  const sinceFix = ref(0)

  const importWarnings = ref<string[]>([])

  let nextId = 1
  let pendingGap = true
  const sogSamples: number[] = []

  // ---------------------------------------------------------------- waypoints
  const wptById = computed(() => {
    void wptVersion.value
    return new Map(waypoints.value.map((w) => [w.id, w]))
  })

  function touchWaypoints(): void {
    wptVersion.value++
    triggerRef(waypoints)
  }

  function nameSet(): Set<string> {
    return new Set(waypoints.value.map((w) => w.name))
  }

  /** Plus petit numéro libre : WP0001, WP0002… (manuel §3.1.1). */
  function nextWaypointName(): string {
    const used = nameSet()
    for (let n = 1; n < 100000; n++) {
      const name = `WP${String(n).padStart(4, '0')}`
      if (!used.has(name)) return name
    }
    return 'WP9999'
  }

  function addWaypoint(p: Partial<Waypoint> & LatLon): Waypoint | null {
    if (waypoints.value.length >= LIMITS.waypoints) return null
    const w: Waypoint = {
      id: nextId++,
      name: (p.name ?? nextWaypointName()).slice(0, LIMITS.nameLen),
      lat: p.lat,
      lon: p.lon,
      symbol: p.symbol ?? DEFAULT_SYMBOL,
      color: p.color ?? DEFAULT_COLOR,
      comment: (p.comment ?? '').slice(0, LIMITS.commentLen),
      display: p.display ?? true,
      ...(p.qp ? { qp: true } : {}),
    }
    waypoints.value.push(w)
    touchWaypoints()
    return w
  }

  function addWaypointAtShip(): Waypoint | null {
    return addWaypoint({ lat: ship.lat, lon: ship.lon, comment: commentNow() })
  }

  /** Commentaire par défaut : date/heure courante (manuel §3.1.3). */
  function commentNow(): string {
    const d = new Date(nowMs.value + (settings.timeOffsetMin + (settings.dst ? 60 : 0)) * 60000)
    const p = (n: number): string => String(n).padStart(2, '0')
    return `${p(d.getUTCMonth() + 1)}/${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`
  }

  function updateWaypoint(id: number, patch: Partial<Omit<Waypoint, 'id'>>): boolean {
    const w = wptById.value.get(id)
    if (!w) return false
    if (patch.name !== undefined) w.name = patch.name.slice(0, LIMITS.nameLen)
    if (patch.comment !== undefined) w.comment = patch.comment.slice(0, LIMITS.commentLen)
    if (patch.lat !== undefined) w.lat = patch.lat
    if (patch.lon !== undefined) w.lon = patch.lon
    if (patch.symbol !== undefined) w.symbol = patch.symbol
    if (patch.color !== undefined) w.color = patch.color
    if (patch.display !== undefined) w.display = patch.display
    touchWaypoints()
    return true
  }

  function isWaypointInUse(id: number): boolean {
    const d = dest.value
    if (!d) return false
    if (d.kind === 'waypoint' || d.kind === 'qp') return d.wptId === id
    if (d.kind === 'route') return currentRouteSeq().includes(id)
    return false
  }

  /** Efface un waypoint. Interdit pour le point de destination en cours (manuel §3.5). */
  function deleteWaypoint(id: number): boolean {
    if (isWaypointInUse(id)) return false
    waypoints.value = waypoints.value.filter((w) => w.id !== id)
    for (const r of routes.value) r.points = r.points.filter((p) => p.wptId !== id)
    touchWaypoints()
    return true
  }

  function deleteAllWaypoints(): void {
    waypoints.value = []
    for (const r of routes.value) r.points = []
    dest.value = null
    touchWaypoints()
  }

  /** Quick Point : waypoint « QP » vert qui remplace le précédent, et devient la destination. */
  function setQuickPoint(lat: number, lon: number): void {
    const old = waypoints.value.find((w) => w.qp)
    if (old) {
      waypoints.value = waypoints.value.filter((w) => w !== old)
      for (const r of routes.value) r.points = r.points.filter((p) => p.wptId !== old.id)
    }
    const w = addWaypoint({ lat, lon, name: 'QP', symbol: 0, color: 2, qp: true })
    if (!w) return
    dest.value = { kind: 'qp', wptId: w.id, from: { lat: ship.lat, lon: ship.lon } }
    touchWaypoints()
  }

  // ---------------------------------------------------------------- routes
  function routeByNo(no: number): Route | undefined {
    return routes.value.find((r) => r.no === no)
  }

  function nextRouteNo(): number | null {
    for (let n = 1; n <= LIMITS.routes; n++) if (!routeByNo(n)) return n
    return null
  }

  function addRoute(name?: string): Route | null {
    const no = nextRouteNo()
    if (no == null) return null
    const r: Route = { no, name: (name ?? `RT${String(no).padStart(2, '0')}`).slice(0, LIMITS.routeNameLen), comment: '', points: [] }
    routes.value.push(r)
    routes.value.sort((a, b) => a.no - b.no)
    return r
  }

  function deleteRoute(no: number): boolean {
    if (dest.value?.kind === 'route' && dest.value.routeNo === no) return false
    routes.value = routes.value.filter((r) => r.no !== no)
    return true
  }

  function deleteAllRoutes(): void {
    routes.value = []
    if (dest.value?.kind === 'route') dest.value = null
  }

  /** Suite effective de waypoints d'une route (points « skip » exclus), dans le sens demandé. */
  function routeSequence(r: Route, direction: 'Forward' | 'Reverse'): number[] {
    const ids = r.points.filter((p) => !p.skip && wptById.value.has(p.wptId)).map((p) => p.wptId)
    return direction === 'Reverse' ? ids.reverse() : ids
  }

  function currentRouteSeq(): number[] {
    const d = dest.value
    if (!d || d.kind !== 'route' || d.routeNo == null) return []
    const r = routeByNo(d.routeNo)
    return r ? routeSequence(r, d.direction ?? 'Forward') : []
  }

  // ---------------------------------------------------------------- destination
  function setDestWaypoint(id: number): void {
    if (!wptById.value.has(id)) return
    dest.value = { kind: 'waypoint', wptId: id, from: { lat: ship.lat, lon: ship.lon } }
  }

  function setDestRoute(no: number, direction: 'Forward' | 'Reverse'): boolean {
    const r = routeByNo(no)
    if (!r) return false
    const seq = routeSequence(r, direction)
    if (seq.length < 1) return false
    dest.value = {
      kind: 'route',
      wptId: seq[0]!,
      routeNo: no,
      routeIdx: 0,
      direction,
      from: { lat: ship.lat, lon: ship.lon },
    }
    return true
  }

  function setDestMob(): void {
    if (!mob.value) return
    dest.value = { kind: 'mob', wptId: -1, from: { lat: ship.lat, lon: ship.lon } }
  }

  function cancelDest(): void {
    dest.value = null
  }

  /** Inverse le sens de la route en cours (manuel §5.3). */
  function reverseRoute(direction: 'Forward' | 'Reverse'): void {
    const d = dest.value
    if (!d || d.kind !== 'route' || d.routeNo == null) return
    setDestRoute(d.routeNo, direction)
  }

  function markMob(): void {
    mob.value = { lat: ship.lat, lon: ship.lon }
  }

  // ---------------------------------------------------------------- magnétisme
  const magVar = computed(() => {
    if (settings.magVar.mode === 'Manual') return settings.magVar.value
    try {
      return magneticVariation(ship.lat, ship.lon, new Date(nowMs.value))
    } catch {
      return 0
    }
  })

  /** Convertit un cap/relèvement vrai dans la référence choisie (Mag/True). */
  function toDisplayAngle(trueDeg: number): number {
    return settings.cogRef === 'Mag' ? norm360(trueDeg - magVar.value) : norm360(trueDeg)
  }

  // ---------------------------------------------------------------- navigation
  const shipPos = computed<LatLon>(() => ({ lat: ship.lat, lon: ship.lon }))

  const destTarget = computed<{ pos: LatLon; name: string } | null>(() => {
    const d = dest.value
    if (!d) return null
    if (d.kind === 'mob') return mob.value ? { pos: { lat: mob.value.lat, lon: mob.value.lon }, name: 'MOB' } : null
    const w = wptById.value.get(d.wptId)
    return w ? { pos: { lat: w.lat, lon: w.lon }, name: w.name } : null
  })

  const avgSpeed = computed(() => {
    if (settings.ttgEtaSpd.mode === 'Manual') return settings.ttgEtaSpd.manualKn
    void nowMs.value
    const n = Math.min(sogSamples.length, Math.max(1, settings.ttgEtaSpd.avgSec))
    if (!n) return ship.sog
    let s = 0
    for (let i = sogSamples.length - n; i < sogSamples.length; i++) s += sogSamples[i]!
    return s / n
  })

  const nav = computed<NavData>(() => {
    const t = destTarget.value
    const d = dest.value
    if (!t || !d) {
      return { hasDest: false, destName: '', dest: null, rng: 0, brgTrue: 0, xte: 0, ttgHours: null, eta: null }
    }
    const m = settings.navigation
    const rng = distance(shipPos.value, t.pos, m)
    const brgTrue = bearing(shipPos.value, t.pos, m)
    const xte = m === 'Rhumb Line' ? crossTrack(d.from, t.pos, shipPos.value) : 0
    const sp = avgSpeed.value
    const ttgHours = sp > 0.05 ? rng / sp : null
    const eta = ttgHours != null ? new Date(nowMs.value + ttgHours * 3600000) : null
    return { hasDest: true, destName: t.name, dest: t.pos, rng, brgTrue, xte, ttgHours, eta }
  })

  /** Waypoints à afficher avec leur nom en mode « Disp Route ». */
  const routeWaypointIds = computed(() => new Set(currentRouteSeq()))

  // ---------------------------------------------------------------- GPS / simulation
  const fix = computed<Fix>(() => (sim.demo ? 'SIM' : fixInfo.value.fix))
  const hasFix = computed(() => power.value === 'on' && (sim.demo || fixInfo.value.fix !== '---'))

  function setShipPosition(lat: number, lon: number, opts: { jump?: boolean } = {}): void {
    ship.lat = Math.max(-89.9, Math.min(89.9, lat))
    ship.lon = ((((lon + 180) % 360) + 360) % 360) - 180
    if (opts.jump !== false) pendingGap = true
    if (dest.value) {
      // un déplacement manuel ne doit pas fausser l'écart traversier : le tronçon repart d'ici
      dest.value.from = { lat: ship.lat, lon: ship.lon }
    }
  }

  function recordTrack(): void {
    if (settings.trackRecord === 'Off' || !hasFix.value) return
    const t = track.value
    const last = t[t.length - 1]
    const range = PLOTTER_RANGES[settings.plotterRange] ?? 0.5
    const interval = settings.trackRecord === 'Distance' ? settings.trackInterval : Math.max(0.002, range / 120)
    if (last && !pendingGap && distance(last, ship) < Math.max(interval, 0.0005)) return
    const p: TrackPoint = { lat: ship.lat, lon: ship.lon, color: settings.trackColor }
    if (pendingGap) p.gap = true
    pendingGap = false
    t.push(p)
    if (t.length > LIMITS.trackPoints) t.splice(0, t.length - LIMITS.trackPoints)
    trackVersion.value++
    triggerRef(track)
  }

  function clearTrack(color?: number): void {
    track.value = color == null ? [] : track.value.filter((p) => p.color !== color)
    pendingGap = true
    trackVersion.value++
  }

  const trackMemoryPct = computed(() => Math.round((track.value.length / LIMITS.trackPoints) * 100))

  // ---------------------------------------------------------------- alarmes
  const alarms = reactive({
    /** messages d'alarme actifs (condition toujours vraie) */
    active: [] as string[],
    /** message à signaler à l'écran jusqu'à appui sur une touche */
    banner: '' as string,
    icon: false,
  })
  const acknowledged = new Set<string>()
  let lastTimeAlarmMinute = -1

  function setAlarm(name: string, on: boolean): void {
    const idx = alarms.active.indexOf(name)
    if (on && idx < 0) {
      alarms.active.push(name)
      if (!acknowledged.has(name)) {
        alarms.banner = name
        startAlarmBuzzer(settings.buzzer)
      }
    } else if (!on && idx >= 0) {
      alarms.active.splice(idx, 1)
      acknowledged.delete(name)
    }
    alarms.icon = alarms.active.length > 0
  }

  /** Touche pressée : coupe le buzzer et efface le bandeau, l'icône reste tant que la condition dure. */
  function acknowledgeAlarms(): boolean {
    const had = !!alarms.banner
    alarms.banner = ''
    stopAlarmBuzzer()
    for (const a of alarms.active) acknowledged.add(a)
    return had
  }

  function evaluateAlarms(): void {
    if (power.value !== 'on') return
    const s = settings
    const n = nav.value
    const aArr = s.alarmArrival
    setAlarm('ARRIVAL ALARM!', aArr.mode === 'Arrival' && n.hasDest && n.rng <= aArr.nm)
    setAlarm('ANCHOR WATCH ALARM!', aArr.mode === 'Anchor' && n.hasDest && n.rng >= aArr.nm)
    setAlarm('XTE ALARM!', s.alarmXte.on && n.hasDest && Math.abs(n.xte) >= s.alarmXte.nm)
    setAlarm('SPEED ALARM!', s.alarmSpeed.on && ship.sog >= s.alarmSpeed.kn)
    setAlarm('TRIP ALARM!', s.alarmTrip.on && trip.value >= s.alarmTrip.nm)
    setAlarm('ODOMETER ALARM!', s.alarmOdo.on && odometer.value >= s.alarmOdo.nm)
    setAlarm('NO DIFFERENTIAL SIGNAL!', s.alarmSbas && hasFix.value && !FIX_IS_DIFFERENTIAL(fixInfo.value.fix))
    if (s.alarmTime.on) {
      const d = new Date(nowMs.value + (s.timeOffsetMin + (s.dst ? 60 : 0)) * 60000)
      const hhmm = d.getUTCHours() * 100 + d.getUTCMinutes()
      const minuteKey = d.getUTCHours() * 60 + d.getUTCMinutes()
      if (hhmm === s.alarmTime.hhmm && minuteKey !== lastTimeAlarmMinute) {
        lastTimeAlarmMinute = minuteKey
        setAlarm('TIME ALARM!', true)
      } else if (hhmm !== s.alarmTime.hhmm) {
        lastTimeAlarmMinute = -1 // réarmé pour le lendemain
        setAlarm('TIME ALARM!', false)
      }
    } else {
      lastTimeAlarmMinute = -1
      setAlarm('TIME ALARM!', false)
    }
    setAlarm('GPS NO FIX!', sinceFix.value > 45 && fixInfo.value.fix === '---' && !sim.demo)
  }

  // ---------------------------------------------------------------- boucle de simulation (1 Hz)
  let timer: ReturnType<typeof setInterval> | undefined
  let tSec = 0

  /**
   * Une route en cours de navigation peut être modifiée (ajout, suppression, skip) : on resynchronise le point visé
   * sur la suite effective ; s'il a disparu, on vise le point le plus proche.
   */
  function syncRouteTarget(): void {
    const d = dest.value
    if (!d || d.kind !== 'route' || d.routeNo == null) return
    const seq = currentRouteSeq()
    if (!seq.length) {
      dest.value = null
      return
    }
    const at = seq.indexOf(d.wptId)
    if (at >= 0) {
      if (d.routeIdx !== at) dest.value = { ...d, routeIdx: at }
      return
    }
    let best = 0
    let bestD = Infinity
    seq.forEach((id, i) => {
      const w = wptById.value.get(id)
      const dd = w ? distance(shipPos.value, w) : Infinity
      if (dd < bestD) {
        bestD = dd
        best = i
      }
    })
    const prev = best > 0 ? wptById.value.get(seq[best - 1]!) : undefined
    dest.value = {
      ...d,
      wptId: seq[best]!,
      routeIdx: best,
      from: prev ? { lat: prev.lat, lon: prev.lon } : { lat: ship.lat, lon: ship.lon },
    }
  }

  function advanceRoute(): void {
    const d = dest.value
    if (!d || d.kind !== 'route' || d.routeNo == null) return
    const seq = currentRouteSeq()
    const idx = (seq.indexOf(d.wptId) >= 0 ? seq.indexOf(d.wptId) : (d.routeIdx ?? 0)) + 1
    if (idx >= seq.length) {
      dest.value = null // arrivée au dernier point
      return
    }
    const prev = wptById.value.get(seq[idx - 1]!)
    dest.value = { ...d, wptId: seq[idx]!, routeIdx: idx, from: prev ? { lat: prev.lat, lon: prev.lon } : d.from }
  }

  function checkArrival(): void {
    const d = dest.value
    const n = nav.value
    if (!d || !n.hasDest || d.kind !== 'route') return
    const radius = Math.max(0.05, settings.alarmArrival.mode === 'Arrival' ? settings.alarmArrival.nm : 0)
    // point atteint ou dépassé (le relèvement a tourné de plus de 90° par rapport au tronçon)
    const legBrg = bearing(d.from, n.dest!, 'Rhumb Line')
    const passed = Math.abs(((n.brgTrue - legBrg + 540) % 360) - 180) > 90 && n.rng < 0.5
    if (n.rng <= radius || passed) advanceRoute()
  }

  let demoHeading = 0

  const cogHistory: { t: number; cog: number }[] = []

  /** Plotter Setup > Auto WPT Ent : un waypoint est inscrit quand le cap change de `deg` en `sec` secondes. */
  function autoWaypoint(): void {
    const a = settings.autoWpt
    if (!a.on || ship.sog < 0.3 || !ship.hasCog) {
      cogHistory.length = 0
      return
    }
    cogHistory.push({ t: tSec, cog: ship.cog })
    while (cogHistory.length && cogHistory[0]!.t < tSec - a.sec) cogHistory.shift()
    const oldest = cogHistory[0]
    if (oldest && cogHistory.length > 1 && Math.abs(((ship.cog - oldest.cog + 540) % 360) - 180) >= a.deg) {
      addWaypointAtShip()
      cogHistory.length = 0
    }
  }

  function tick(): void {
    nowMs.value = Date.now()
    tSec += 1
    if (power.value === 'off') return
    sinceFix.value += power.value === 'on' ? 1 : 0

    stepSatellites(sats.value, 1, tSec)
    triggerRef(sats)
    const fi = computeFix(sats.value, {
      minElev: settings.svElev,
      disabled: settings.disableSv,
      sbas: settings.sbasMode === 'SBAS',
      qzss: settings.qzssPositioning,
      forced: sim.forcedFix,
    })
    // délai d'acquisition simulé : pas de fix pendant les premières secondes
    if (sinceFix.value < 4 && sim.forcedFix === 'auto') fi.fix = '---'
    fixInfo.value = fi

    if (power.value !== 'on') return

    // mouvement du bateau
    if (sim.moving || sim.demo) {
      let cog = sim.course
      const sp = sim.speed
      if (sim.courseMode === 'Auto') {
        demoHeading = norm360(demoHeading + 3)
        cog = demoHeading
      } else demoHeading = sim.course
      const dNm = (sp * 1) / 3600
      const p = rhumbDestination(shipPos.value, cog, dNm)
      ship.lat = p.lat
      ship.lon = p.lon
      ship.sog = sp
      ship.cog = cog
      ship.hasCog = true
      trip.value += dNm
      odometer.value += dNm
    } else {
      ship.sog = 0
    }
    sogSamples.push(ship.sog)
    if (sogSamples.length > 1000) sogSamples.splice(0, sogSamples.length - 1000)

    recordTrack()
    autoWaypoint()
    syncRouteTarget()
    if (dest.value && !destTarget.value) dest.value = null // point visé supprimé
    evaluateAlarms() // avant checkArrival : l'alarme d'arrivée doit voir le point atteint
    checkArrival()
  }

  let lastTickAt = Date.now()

  /** Cadence de 1 Hz ; si l'onglet a été mis en veille par le navigateur, rattrape le temps écoulé (max 5 min). */
  function scheduledTick(): void {
    const now = Date.now()
    const n = Math.min(300, Math.max(1, Math.round((now - lastTickAt) / 1000)))
    lastTickAt = now
    for (let i = 0; i < n; i++) tick()
  }

  function start(): void {
    if (timer) return
    lastTickAt = Date.now()
    timer = setInterval(scheduledTick, 1000)
    tick()
  }

  function stop(): void {
    if (timer) clearInterval(timer)
    timer = undefined
  }

  // ---------------------------------------------------------------- alimentation
  let bootTimer: ReturnType<typeof setTimeout> | undefined
  let offTimer: ReturnType<typeof setInterval> | undefined

  function powerOn(): void {
    if (power.value !== 'off') return
    power.value = 'booting'
    sinceFix.value = 0
    bootTimer = setTimeout(() => {
      power.value = 'on'
      pendingGap = true
    }, 1800)
  }

  /** Maintien de la touche BRILL : compte à rebours de 3 s avant arrêt (manuel §1.2). */
  function beginPowerOff(): void {
    if (power.value !== 'on' || offTimer) return
    powerOffCountdown.value = 3
    offTimer = setInterval(() => {
      const c = (powerOffCountdown.value ?? 1) - 1
      if (c <= 0) {
        cancelPowerOff()
        powerOffNow()
      } else powerOffCountdown.value = c
    }, 1000)
  }

  function cancelPowerOff(): void {
    if (offTimer) clearInterval(offTimer)
    offTimer = undefined
    powerOffCountdown.value = null
  }

  let offDelay: ReturnType<typeof setTimeout> | undefined

  /** Appui sur BRILL : le compte à rebours démarre si la touche reste enfoncée au-delà de `ms`. */
  function beginPowerOffAfter(ms: number): void {
    if (offDelay) clearTimeout(offDelay)
    offDelay = setTimeout(beginPowerOff, ms)
  }

  /** Relâchement de BRILL ; renvoie true si un compte à rebours était en cours (appui long annulé). */
  function cancelPowerOffAttempt(): boolean {
    if (offDelay) clearTimeout(offDelay)
    offDelay = undefined
    const counting = powerOffCountdown.value !== null
    if (counting) cancelPowerOff()
    return counting
  }

  function powerOffNow(): void {
    if (bootTimer) clearTimeout(bootTimer)
    stopAlarmBuzzer()
    power.value = 'off'
  }

  // ---------------------------------------------------------------- import / export
  function replaceWaypoints(list: Omit<Waypoint, 'id'>[], merge: boolean): { added: number; warnings: string[] } {
    const warnings: string[] = []
    let base = merge ? waypoints.value.slice() : []
    let incoming = list
    const room = LIMITS.waypoints - base.length
    if (incoming.length > room) {
      warnings.push(`${incoming.length - room} waypoint(s) ignoré(s) (limite ${LIMITS.waypoints})`)
      incoming = incoming.slice(0, room)
    }
    const added: Waypoint[] = incoming.map((w) => ({ ...w, id: nextId++ }))
    base = base.concat(added)
    waypoints.value = base
    touchWaypoints()
    return { added: added.length, warnings }
  }

  /** Charge un fichier GPX (équivalent de Load WPT/RTE ← USB : remplace tout, ou fusionne). */
  function importGpx(xml: string, mode: 'replace' | 'merge' = 'replace'): { waypoints: number; routes: number; warnings: string[] } {
    const parsed = parseGpx(xml)
    if (!parsed.waypoints.length && !parsed.routes.length) {
      // fichier sans <wpt> ni <rte> (trace seule, XML invalide…) : on ne touche à rien
      const warnings = ['Aucun waypoint ni route dans ce fichier : rien n’a été modifié', ...parsed.warnings]
      importWarnings.value = warnings
      return { waypoints: 0, routes: 0, warnings }
    }
    if (mode === 'replace') {
      routes.value = []
      dest.value = null
    }
    const r = replaceWaypoints(parsed.waypoints, mode === 'merge')
    const warnings = [...parsed.warnings, ...r.warnings]
    // routes : rattachement aux waypoints par nom (ou par coordonnées)
    let nRoutes = 0
    for (const ir of parsed.routes) {
      const route = addRoute(ir.name || undefined)
      if (!route) {
        warnings.push(`route ${ir.name || '?'} ignorée (limite ${LIMITS.routes})`)
        break
      }
      route.name = ir.name.slice(0, LIMITS.routeNameLen) || route.name
      route.comment = ir.comment
      for (const p of ir.points) {
        const close = (x: Waypoint): boolean => Math.abs(x.lat - p.lat) < 1e-5 && Math.abs(x.lon - p.lon) < 1e-5
        // même nom ET même position ; à défaut, simple coïncidence de position
        const w = waypoints.value.find((x) => x.name && x.name === p.name && close(x)) ?? waypoints.value.find(close)
        if (w) route.points.push({ wptId: w.id, skip: p.skip })
        else warnings.push(`route ${route.name} : point ${p.name || '?'} introuvable`)
      }
      nRoutes++
    }
    importWarnings.value = warnings
    return { waypoints: r.added, routes: nRoutes, warnings }
  }

  function exportGpx(): string {
    return buildGpx(waypoints.value, routes.value)
  }

  async function loadDefaultDataset(): Promise<void> {
    const base = import.meta.env.BASE_URL ?? '/'
    try {
      const res = await fetch(`${base}data/waypoints_GP39.gpx`)
      if (!res.ok) throw new Error(String(res.status))
      importGpx(await res.text(), 'replace')
    } catch (e) {
      importWarnings.value = [`Jeu de données par défaut introuvable : ${(e as Error).message}`]
    }
  }

  // ---------------------------------------------------------------- persistance
  async function hydrate(): Promise<void> {
    const [s, sm, w, r, t, d, mb, sh, c] = await Promise.all([
      kvGet<Settings>(DB_KEYS.settings),
      kvGet<SimConfig>(DB_KEYS.sim),
      kvGet<Waypoint[]>(DB_KEYS.waypoints),
      kvGet<Route[]>(DB_KEYS.routes),
      kvGet<TrackPoint[]>(DB_KEYS.track),
      kvGet<Destination | null>(DB_KEYS.dest),
      kvGet<MobMark | null>(DB_KEYS.mob),
      kvGet<{ lat: number; lon: number; cog: number }>(DB_KEYS.ship),
      kvGet<{ trip: number; odo: number }>(DB_KEYS.counters),
    ])
    if (s) Object.assign(settings, { ...defaultSettings(), ...s })
    if (sm) Object.assign(sim, { ...defaultSim(), ...sm, demo: false })
    if (w && w.length) {
      waypoints.value = w
      nextId = Math.max(0, ...w.map((x) => x.id)) + 1
      touchWaypoints()
    } else if (!w) {
      await loadDefaultDataset()
    }
    if (r) routes.value = r
    if (t) {
      track.value = t
      trackVersion.value++
    }
    dest.value = d ?? null
    mob.value = mb ?? null
    if (sh) {
      ship.lat = sh.lat
      ship.lon = sh.lon
      ship.cog = sh.cog
    }
    if (c) {
      trip.value = c.trip
      odometer.value = c.odo
    }
    ready.value = true
  }

  const saveSettings = debounce(() => void kvSet(DB_KEYS.settings, JSON.parse(JSON.stringify(settings))), 400)
  const saveSim = debounce(() => void kvSet(DB_KEYS.sim, JSON.parse(JSON.stringify(sim))), 400)
  const saveWaypoints = debounce(
    () =>
      void kvSet(
        DB_KEYS.waypoints,
        waypoints.value.map((x) => ({ ...x })),
      ),
    800,
  )
  const saveRoutes = debounce(() => void kvSet(DB_KEYS.routes, JSON.parse(JSON.stringify(routes.value))), 600)
  const saveTrack = debounce(
    () =>
      void kvSet(
        DB_KEYS.track,
        track.value.map((x) => ({ ...x })),
      ),
    3000,
    10000,
  )
  const saveDest = debounce(() => {
    void kvSet(DB_KEYS.dest, dest.value ? JSON.parse(JSON.stringify(dest.value)) : null)
    void kvSet(DB_KEYS.mob, mob.value ? { ...mob.value } : null)
  }, 400)
  const saveShip = debounce(
    () => {
      void kvSet(DB_KEYS.ship, { lat: ship.lat, lon: ship.lon, cog: ship.cog })
      void kvSet(DB_KEYS.counters, { trip: trip.value, odo: odometer.value })
    },
    2000,
    5000,
  )

  /** Enregistre immédiatement tout ce qui est en attente (onglet masqué ou fermé). */
  function flushPersistence(): void {
    for (const f of [saveSettings, saveSim, saveWaypoints, saveRoutes, saveTrack, saveDest, saveShip]) f.flush()
  }

  function startPersistence(): void {
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', () => document.visibilityState === 'hidden' && flushPersistence())
      window.addEventListener('pagehide', flushPersistence)
    }
    watch(settings, saveSettings, { deep: true })
    watch(sim, saveSim, { deep: true })
    watch(wptVersion, saveWaypoints)
    watch(routes, saveRoutes, { deep: true })
    watch(trackVersion, saveTrack)
    watch([dest, mob], saveDest, { deep: true })
    watch(() => [ship.lat, ship.lon, trip.value, odometer.value], saveShip)
  }

  /** Remet l'appareil à zéro (équivalent « Factory Reset » + rechargement du jeu de données par défaut). */
  async function factoryReset(reloadDefault = true): Promise<void> {
    await kvClear()
    Object.assign(settings, defaultSettings())
    Object.assign(sim, defaultSim())
    routes.value = []
    track.value = []
    trackVersion.value++
    mob.value = null
    dest.value = null
    trip.value = 0
    odometer.value = 0
    ship.lat = DEFAULT_SHIP.lat
    ship.lon = DEFAULT_SHIP.lon
    ship.sog = 0
    waypoints.value = []
    touchWaypoints()
    if (reloadDefault) await loadDefaultDataset()
  }

  return {
    // état
    settings,
    sim,
    ready,
    waypoints,
    wptVersion,
    routes,
    track,
    trackVersion,
    mob,
    dest,
    ship,
    odometer,
    trip,
    nowMs,
    power,
    powerOffCountdown,
    sats,
    fixInfo,
    fix,
    hasFix,
    sinceFix,
    importWarnings,
    alarms,
    // dérivés
    wptById,
    shipPos,
    destTarget,
    nav,
    magVar,
    avgSpeed,
    routeWaypointIds,
    trackMemoryPct,
    // actions
    toDisplayAngle,
    addWaypoint,
    addWaypointAtShip,
    updateWaypoint,
    deleteWaypoint,
    deleteAllWaypoints,
    isWaypointInUse,
    nextWaypointName,
    setQuickPoint,
    routeByNo,
    addRoute,
    deleteRoute,
    deleteAllRoutes,
    routeSequence,
    setDestWaypoint,
    setDestRoute,
    setDestMob,
    cancelDest,
    reverseRoute,
    markMob,
    setShipPosition,
    clearTrack,
    acknowledgeAlarms,
    start,
    stop,
    tick,
    powerOn,
    beginPowerOff,
    beginPowerOffAfter,
    cancelPowerOffAttempt,
    cancelPowerOff,
    powerOffNow,
    importGpx,
    exportGpx,
    loadDefaultDataset,
    hydrate,
    startPersistence,
    factoryReset,
    touchWaypoints,
  }
})
