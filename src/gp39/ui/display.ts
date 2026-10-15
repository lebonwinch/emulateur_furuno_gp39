// Valeurs formatées partagées par les écrans Steering, Nav Data, Highway, User…

import { computed } from 'vue'
import {
  distUnit,
  formatAngle,
  formatCoord,
  formatDate,
  formatRange,
  formatSpeed,
  formatTime,
  formatTtg,
  formatXte,
  localDate,
  speedUnit,
} from '@/gp39/format'
import { useDevice } from '@/stores/device'

export function useDisplayValues() {
  const dev = useDevice()
  const s = dev.settings

  const local = computed(() => localDate(new Date(dev.nowMs), s.timeOffsetMin, s.dst))
  const fixText = computed(() => dev.fix)
  const datum = computed(() => (s.datum === 'WGS84' ? 'W' : s.datum === 'WGS72' ? 'T' : 'L'))
  const refLetter = computed(() => (s.cogRef === 'Mag' ? 'M' : 'T'))
  const refWord = computed(() => (s.cogRef === 'Mag' ? 'MAG' : 'TRUE'))
  const dUnit = computed(() => distUnit(s.units))
  const sUnit = computed(() => speedUnit(s.units))

  const sog = computed(() => formatSpeed(dev.ship.sog, s.units))
  const cogDeg = computed(() => dev.toDisplayAngle(dev.ship.cog))
  const cog = computed(() => formatAngle(cogDeg.value))
  const hasDest = computed(() => dev.nav.hasDest)
  const rng = computed(() => (dev.nav.hasDest ? formatRange(dev.nav.rng, s.units) : '---'))
  const brgDeg = computed(() => (dev.nav.hasDest ? dev.toDisplayAngle(dev.nav.brgTrue) : null))
  const brg = computed(() => (brgDeg.value == null ? '---' : formatAngle(brgDeg.value)))
  const xte = computed(() => (dev.nav.hasDest ? formatXte(dev.nav.xte, s.units) : '---'))
  const ttg = computed(() => (dev.nav.hasDest ? formatTtg(dev.nav.ttgHours) : { h: '--', m: '--' }))
  const eta = computed(() => {
    const e = dev.nav.eta
    if (!e || !dev.nav.hasDest) return { date: '--/--/--', time: '--:--:--' }
    const l = localDate(e, s.timeOffsetMin, s.dst)
    return { date: formatDate(l, s.dateDisplay), time: formatTime(l, s.timeDisplay) }
  })
  const time = computed(() => formatTime(local.value, s.timeDisplay))
  const date = computed(() => formatDate(local.value, s.dateDisplay))
  const lat = computed(() => formatCoord(dev.ship.lat, true, s.posFormat))
  const lon = computed(() => formatCoord(dev.ship.lon, false, s.posFormat))

  return {
    dev,
    local,
    fixText,
    datum,
    refLetter,
    refWord,
    dUnit,
    sUnit,
    sog,
    cogDeg,
    cog,
    hasDest,
    rng,
    brgDeg,
    brg,
    xte,
    ttg,
    eta,
    time,
    date,
    lat,
    lon,
  }
}

/** Sépare « 34°44.589'N » en parties pour afficher le sigle N/S/E/W en petit. */
export function splitCoord(t: string): { main: string; hemi: string } {
  return { main: t.slice(0, -1), hemi: t.slice(-1) }
}
