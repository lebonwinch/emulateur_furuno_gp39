<template>
  <div class="lcdscreen steer">
    <div class="top">
      <span class="fix">{{ v.fixText.value }}</span>
      <span class="ref">{{ v.refWord.value }}</span>
      <span class="dest">{{ v.dev.nav.hasDest ? v.dev.nav.destName : '' }}</span>
      <span class="time">{{ v.time.value }}</span>
    </div>

    <!-- bande de cap -->
    <svg class="tape" viewBox="0 0 460 52" width="460" height="52">
      <defs>
        <linearGradient id="capsule" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="#8a8f96" />
          <stop offset="0.5" stop-color="#d9dde2" />
          <stop offset="1" stop-color="#7d838b" />
        </linearGradient>
        <clipPath id="capclip"><rect x="2" y="2" width="456" height="48" rx="24" /></clipPath>
      </defs>
      <rect x="1" y="1" width="458" height="50" rx="25" fill="url(#capsule)" stroke="#3a3d41" stroke-width="2" />
      <g clip-path="url(#capclip)">
        <g v-for="t in ticks" :key="t.deg">
          <line :x1="t.x" :y1="t.major ? 6 : 10" :x2="t.x" :y2="t.major ? 16 : 16" stroke="#111" stroke-width="2" />
          <text v-if="t.label" :x="t.x" y="42" text-anchor="middle" class="tl" :class="{ card: t.card }">{{ t.label }}</text>
        </g>
        <polygon
          v-if="marker !== null"
          :points="`${marker - 8},0 ${marker + 8},0 ${marker},12`"
          fill="#e0261b"
          stroke="#fff"
          stroke-width="0.8"
        />
      </g>
    </svg>

    <div class="r3">
      <div class="cell l">
        <span class="lbl">SOG</span>
        <span class="big">{{ v.sog.value }}</span
        ><span class="un">{{ v.sUnit.value }}</span>
      </div>
      <svg class="ship" viewBox="0 0 20 30" width="20" height="30"><polygon points="10,0 20,12 20,30 0,30 0,12" fill="#111" /></svg>
      <div class="cell r">
        <span class="lbl">COG {{ v.refLetter.value }}</span>
        <span class="big">{{ v.cog.value }}</span
        ><span class="deg">°</span>
      </div>
    </div>
    <div class="sep" style="top: 143px" />
    <div class="r4">
      <div class="cell l">
        <span class="lbl">RNG</span>
        <span class="mid">{{ v.rng.value }}</span
        ><span class="un">{{ v.dUnit.value }}</span>
      </div>
      <div class="cell r">
        <span class="lbl">BRG {{ v.refLetter.value }}</span>
        <span class="mid">{{ v.brg.value }}</span
        ><span class="deg2">{{ v.hasDest.value ? '°' : '' }}</span>
      </div>
    </div>
    <div class="sep" style="top: 190px" />
    <div class="r5">
      <div class="cell l">
        <span class="lbl">TTG</span>
        <span class="mid">{{ v.ttg.value.h }}<small>H</small> {{ v.ttg.value.m }}<small>M</small></span>
      </div>
      <div class="cell r">
        <span class="lbl">ETA</span>
        <span class="eta">{{ v.eta.value.date }}<br />{{ v.eta.value.time }}</span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useDisplayValues } from '@/gp39/ui/display'

const v = useDisplayValues()
const PX_PER_DEG = 4
const CENTER = 230

/** Graduations de la bande de cap (cap actuel au centre). */
const ticks = computed(() => {
  const c = v.cogDeg.value
  const out: { deg: number; x: number; major: boolean; label: string; card: boolean }[] = []
  const lo = Math.floor((c - 62) / 10) * 10
  for (let d = lo; d <= c + 62; d += 10) {
    const x = CENTER + (d - c) * PX_PER_DEG
    const norm = ((d % 360) + 360) % 360
    const major = norm % 30 === 0
    const names: Record<number, string> = { 0: 'N', 90: 'E', 180: 'S', 270: 'W' }
    out.push({ deg: d, x, major, label: major ? (names[norm] ?? String(norm)) : '', card: norm % 90 === 0 })
  }
  return out
})

/** Position (px) du repère rouge « relèvement de la destination ». */
const marker = computed<number | null>(() => {
  const b = v.brgDeg.value
  if (b == null) return null
  let diff = ((b - v.cogDeg.value + 540) % 360) - 180
  diff = Math.max(-57, Math.min(57, diff))
  return CENTER + diff * PX_PER_DEG
})
</script>

<style scoped lang="scss">
.top {
  position: absolute;
  top: 3px;
  left: 8px;
  right: 8px;
  height: 24px;
  display: flex;
  align-items: baseline;
  font-size: 22px;
  .ref {
    margin-left: 18px;
  }
  .dest {
    font-size: 14px;
    margin-left: 34px;
    font-family: 'VT323', monospace;
  }
  .time {
    margin-left: auto;
  }
}
.tape {
  position: absolute;
  left: 10px;
  top: 30px;
}
.tl {
  font-size: 27px;
  font-weight: 700;
  font-style: italic;
  fill: #111;
  &.card {
    font-size: 33px;
    font-style: normal;
  }
}
.cell {
  position: relative;
  display: flex;
  align-items: flex-end;
  .lbl {
    position: absolute;
    top: 0;
    left: 0;
  }
}
.r3 {
  position: absolute;
  top: 84px;
  left: 6px;
  right: 6px;
  height: 58px;
  display: flex;
  align-items: flex-end;
  .cell {
    flex: 1;
    padding-top: 12px;
    height: 100%;
    &.l {
      justify-content: flex-end;
      padding-right: 6px;
    }
    &.r {
      justify-content: flex-end;
      padding-right: 20px;
      .lbl {
        left: 30px;
      }
    }
  }
  .ship {
    position: absolute;
    left: 232px;
    top: 4px;
  }
  .big {
    font-size: 62px;
    line-height: 56px;
    letter-spacing: -1px;
  }
  .un {
    font-size: 17px;
    margin-bottom: 4px;
  }
  .deg {
    font-size: 40px;
    align-self: flex-start;
    margin-top: 4px;
  }
}
.r4,
.r5 {
  position: absolute;
  left: 6px;
  right: 6px;
  display: flex;
  .cell {
    flex: 1;
    justify-content: flex-end;
    padding-right: 10px;
  }
  .mid {
    font-size: 40px;
    line-height: 40px;
  }
  .un {
    font-size: 16px;
    margin-bottom: 4px;
    margin-left: 3px;
  }
  .deg2 {
    font-size: 28px;
    align-self: flex-start;
  }
  small {
    font-size: 20px;
  }
}
.r4 {
  top: 146px;
  height: 42px;
}
.r5 {
  top: 193px;
  height: 52px;
  .eta {
    font-size: 20px;
    line-height: 22px;
    text-align: right;
  }
}
</style>
