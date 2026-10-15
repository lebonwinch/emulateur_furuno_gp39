<template>
  <div class="lcdscreen user">
    <!-- numérique -->
    <template v-if="cfg.kind === 'Digital'">
      <div v-for="(c, i) in cells" :key="i" class="dcell" :class="[`n${cfg.layout}`, `c${i}`, { sel: selected === i }]">
        <div class="head">
          <span class="lbl">{{ c.label }}</span>
          <span class="unit">{{ c.unit }}</span>
        </div>
        <div v-if="!c.lines" class="val" :class="{ small: c.small }">{{ c.value }}</div>
        <div v-else class="val lines">
          <div v-for="(l, li) in c.lines" :key="li">{{ l }}</div>
        </div>
      </div>
    </template>

    <!-- compteur de vitesse -->
    <template v-else-if="cfg.kind === 'Speedometer'">
      <svg class="dial" viewBox="-120 -120 240 240" width="260" height="260">
        <circle r="116" fill="#fff" stroke="#222" stroke-width="3" />
        <g v-for="t in speedTicks" :key="t.v">
          <line :x1="t.x1" :y1="t.y1" :x2="t.x2" :y2="t.y2" stroke="#111" :stroke-width="t.major ? 3 : 1.5" />
          <text v-if="t.label" :x="t.tx" :y="t.ty" text-anchor="middle" dominant-baseline="middle" class="dl" :class="{ big: t.big }">
            {{ t.label }}
          </text>
        </g>
        <g :transform="`rotate(${needle})`">
          <polygon points="-3,0 3,0 1.5,-92 -1.5,-92" fill="#d4281d" />
          <polygon points="-3,0 3,0 4,18 -4,18" fill="#d4281d" />
        </g>
        <circle r="9" fill="#fff" stroke="#222" stroke-width="2.5" />
      </svg>
      <div class="sright">
        <div class="r">
          <span class="lbl">COG {{ v.refLetter.value }}(°)</span>
          <div class="sv">{{ v.cog.value }}</div>
        </div>
        <div class="r posn">
          <span class="lbl">POSN</span>
          <div>{{ v.lat.value }}</div>
          <div>{{ v.lon.value }}</div>
        </div>
        <div class="r">
          <div class="sv big">{{ v.sog.value }}</div>
          <span class="lbl low">SOG ({{ v.sUnit.value }})</span>
        </div>
      </div>
    </template>

    <!-- COG -->
    <template v-else-if="cfg.kind === 'COG'">
      <svg class="rose" viewBox="-240 -250 480 260" width="480" height="260">
        <defs>
          <clipPath id="roseclip"><rect x="-240" y="-250" width="480" height="256" /></clipPath>
        </defs>
        <g clip-path="url(#roseclip)">
          <circle r="226" fill="#fff" stroke="#222" stroke-width="3" />
          <!-- secteurs bâbord / tribord -->
          <path :d="sector(-95, 0)" fill="#d4281d" />
          <path :d="sector(0, 95)" fill="#27a838" />
          <circle r="196" fill="#fff" />
          <g v-for="t in roseTicks" :key="t.d">
            <line :x1="t.x1" :y1="t.y1" :x2="t.x2" :y2="t.y2" stroke="#111" :stroke-width="t.major ? 3 : 1.5" />
            <text
              v-if="t.label"
              :x="t.tx"
              :y="t.ty"
              text-anchor="middle"
              dominant-baseline="middle"
              class="rl"
              :transform="`rotate(${t.rot} ${t.tx} ${t.ty})`"
            >
              {{ t.label }}
            </text>
          </g>
          <line x1="0" y1="0" x2="0" y2="-196" stroke="#d4281d" stroke-width="4" />
          <circle r="8" fill="#fff" stroke="#222" stroke-width="2.5" />
        </g>
      </svg>
      <div class="cogbox">
        <span class="lbl">COG {{ v.refLetter.value }}(°)</span>
        <div class="cv">{{ v.cog.value }}</div>
      </div>
      <div class="sogbox">
        <span class="lbl">SOG ({{ v.sUnit.value }})</span>
        <div class="sv">{{ v.sog.value }}</div>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { formatAngle, formatRange } from '@/gp39/format'
import { useDisplayValues } from '@/gp39/ui/display'
import { ui } from '@/gp39/ui/state'
import { PLOTTER_RANGES } from '@/gp39/types'
import type { UserCell } from '@/gp39/types'

const props = defineProps<{ which: 5 | 6 }>()
const v = useDisplayValues()
const dev = v.dev
const cfg = computed(() => (props.which === 5 ? dev.settings.user1 : dev.settings.user2))
void PLOTTER_RANGES

interface CellView {
  label: string
  unit: string
  value: string
  small?: boolean
  lines?: string[]
}

function cellView(c: UserCell): CellView {
  const u = dev.settings.units
  switch (c) {
    case 'ODO':
      return { label: 'ODO', unit: `(${v.dUnit.value})`, value: formatRange(dev.odometer, u) }
    case 'Trip':
      return { label: 'Trip', unit: `(${v.dUnit.value})`, value: dev.trip.toFixed(1) }
    case 'Time':
      return { label: 'Time', unit: '', value: v.time.value, small: true }
    case 'Date':
      return { label: 'Date', unit: '', value: v.date.value, small: true }
    case 'POSN':
      return { label: 'POSN', unit: '', value: '', lines: [v.lat.value, v.lon.value] }
    case 'Volts':
      return { label: 'Volts', unit: '(V)', value: dev.sim.volts.toFixed(1) }
    case 'SOG':
      return { label: 'SOG', unit: `(${v.sUnit.value})`, value: v.sog.value }
    case 'COG':
      return { label: 'COG', unit: `${v.refLetter.value}(°)`, value: v.cog.value }
    case 'RNG':
      return { label: 'RNG', unit: `(${v.dUnit.value})`, value: v.rng.value }
    case 'BRG':
      return { label: 'BRG', unit: `${v.refLetter.value}(°)`, value: v.brg.value }
    case 'XTE':
      return { label: 'XTE', unit: `(${v.dUnit.value})`, value: v.xte.value }
    case 'TTG':
      return { label: 'TTG', unit: '', value: `${v.ttg.value.h}H${v.ttg.value.m}M`, small: true }
    case 'ETA':
      return { label: 'ETA', unit: '', value: '', lines: [v.eta.value.date, v.eta.value.time] }
    case 'WPT':
      return {
        label: 'WPT',
        unit: v.hasDest.value ? v.dev.nav.destName : '',
        value: '',
        lines: [`${v.rng.value} ${v.dUnit.value}`, `${v.brg.value === '---' ? '---' : formatAngle(v.brgDeg.value)}°${v.refLetter.value}`],
      }
    default:
      return { label: '', unit: '', value: '' }
  }
}

const cells = computed(() => cfg.value.cells.slice(0, cfg.value.layout).map(cellView))
const selected = computed(() =>
  ui.userCell && ui.userCell.which === props.which && Date.now() < ui.userCell.until ? ui.userCell.cell : -1,
)

// ---- compteur de vitesse : cadran de 270°
const maxSpeed = computed(() => cfg.value.speedoRange)
const SWEEP = 270
const START = -135
const needle = computed(() => START + (Math.min(dev.ship.sog, maxSpeed.value * 1.05) / maxSpeed.value) * SWEEP)
const speedTicks = computed(() => {
  const out: {
    v: number
    major: boolean
    big: boolean
    label: string
    x1: number
    y1: number
    x2: number
    y2: number
    tx: number
    ty: number
  }[] = []
  const max = maxSpeed.value
  const majorStep = max / 8
  const n = 40
  for (let i = 0; i <= n; i++) {
    const val = (i / n) * max
    const a = ((START + (i / n) * SWEEP) * Math.PI) / 180
    const major = i % 5 === 0
    const r1 = major ? 88 : 98
    out.push({
      v: i,
      major,
      big: false,
      label: major ? String(Math.round(val)) : '',
      x1: Math.sin(a) * 106,
      y1: -Math.cos(a) * 106,
      x2: Math.sin(a) * r1,
      y2: -Math.cos(a) * r1,
      tx: Math.sin(a) * 74,
      ty: -Math.cos(a) * 74,
    })
  }
  void majorStep
  return out
})

// ---- rose COG
const roseTicks = computed(() => {
  const c = v.cogDeg.value
  const out: {
    d: number
    major: boolean
    label: string
    x1: number
    y1: number
    x2: number
    y2: number
    tx: number
    ty: number
    rot: number
  }[] = []
  const names: Record<number, string> = { 0: 'N', 90: 'E', 180: 'S', 270: 'W' }
  for (let d = -100; d <= 100; d += 5) {
    const abs = (((Math.round(c) + d) % 360) + 360) % 360
    const a = ((d - (c - Math.round(c))) * Math.PI) / 180
    const major = abs % 10 === 0
    const lab = abs % 30 === 0
    out.push({
      d,
      major,
      label: lab ? (names[abs] ?? String(abs)) : '',
      x1: Math.sin(a) * 196,
      y1: -Math.cos(a) * 196,
      x2: Math.sin(a) * (major ? 176 : 184),
      y2: -Math.cos(a) * (major ? 176 : 184),
      tx: Math.sin(a) * 150,
      ty: -Math.cos(a) * 150,
      rot: (a * 180) / Math.PI,
    })
  }
  return out
})
function sector(a0: number, a1: number): string {
  const R = 226
  const p = (a: number): string => `${(Math.sin((a * Math.PI) / 180) * R).toFixed(1)} ${(-Math.cos((a * Math.PI) / 180) * R).toFixed(1)}`
  return `M0 0L${p(a0)}A${R} ${R} 0 0 1 ${p(a1)}Z`
}
</script>

<style scoped lang="scss">
.dcell {
  position: absolute;
  border: 1px solid #c9ccd1;
  padding: 3px 8px 0;
  &.sel {
    outline: 3px solid #000;
    outline-offset: -3px;
  }
  &.n1 {
    inset: 0;
  }
  &.n2.c0 {
    left: 0;
    right: 0;
    top: 0;
    height: 136px;
  }
  &.n2.c1 {
    left: 0;
    right: 0;
    top: 136px;
    height: 136px;
  }
  &.n3.c0 {
    left: 0;
    right: 0;
    top: 0;
    height: 136px;
  }
  &.n3.c1 {
    left: 0;
    width: 240px;
    top: 136px;
    height: 136px;
  }
  &.n3.c2 {
    left: 240px;
    right: 0;
    top: 136px;
    height: 136px;
  }
  &.n4.c0 {
    left: 0;
    width: 240px;
    top: 0;
    height: 136px;
  }
  &.n4.c1 {
    left: 240px;
    right: 0;
    top: 0;
    height: 136px;
  }
  &.n4.c2 {
    left: 0;
    width: 240px;
    top: 136px;
    height: 136px;
  }
  &.n4.c3 {
    left: 240px;
    right: 0;
    top: 136px;
    height: 136px;
  }
  .head {
    display: flex;
    justify-content: space-between;
  }
  .val {
    text-align: right;
    font-size: 92px;
    line-height: 96px;
    letter-spacing: -2px;
    &.small {
      font-size: 54px;
      line-height: 80px;
    }
    &.lines {
      font-size: 34px;
      line-height: 40px;
      padding-top: 18px;
      letter-spacing: 0;
    }
  }
  &.n1 .val {
    font-size: 160px;
    line-height: 200px;
  }
}
.dial {
  position: absolute;
  left: 4px;
  top: 6px;
}
.dl {
  font-size: 26px;
  font-style: italic;
  fill: #111;
  font-weight: 700;
}
.sright {
  position: absolute;
  left: 268px;
  right: 6px;
  top: 0;
  bottom: 0;
  .r {
    position: relative;
    padding: 6px 4px 0;
  }
  .sv {
    text-align: right;
    font-size: 70px;
    line-height: 70px;
    &.big {
      font-size: 90px;
      line-height: 92px;
    }
  }
  .posn {
    margin-top: 8px;
    font-size: 24px;
    line-height: 28px;
    text-align: right;
    .lbl {
      position: absolute;
      left: 4px;
      top: 6px;
    }
  }
  .lbl.low {
    position: absolute;
    left: 4px;
    bottom: -8px;
  }
}
.rose {
  position: absolute;
  left: 0;
  top: 0;
}
.rl {
  font-size: 28px;
  font-style: italic;
  font-weight: 700;
  fill: #111;
}
.cogbox {
  position: absolute;
  left: 188px;
  top: 78px;
  width: 104px;
  text-align: center;
  .cv {
    font-size: 50px;
    line-height: 50px;
  }
}
.sogbox {
  position: absolute;
  left: 130px;
  top: 164px;
  width: 220px;
  height: 104px;
  background: #fff;
  border: 2px solid #1b1b1b;
  text-align: center;
  .lbl {
    display: block;
    text-align: left;
    padding-left: 8px;
    font-size: 11px;
  }
  .sv {
    font-size: 84px;
    line-height: 76px;
    letter-spacing: -2px;
  }
}
</style>
