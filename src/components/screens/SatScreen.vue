<template>
  <div class="lcdscreen sat">
    <div class="status">{{ v.fixText.value }}</div>
    <div class="dop"><b>DOP</b><br />{{ dopText }}</div>
    <div class="alt">{{ altText }}</div>
    <div v-if="pages > 1" class="page">{{ ui.satPage + 1 }}/{{ pages }}</div>

    <svg class="ring" viewBox="-124 -124 248 248" width="248" height="248">
      <circle r="116" fill="#7a7d80" />
      <circle r="100" fill="#fff" />
      <circle :r="100 * (45 / (90 - elvMask))" fill="none" stroke="#777" stroke-width="1" stroke-dasharray="2 4" />
      <text y="-104" text-anchor="middle" class="n">N</text>
      <g v-for="s in plotted" :key="s.prn" :transform="`translate(${s.x} ${s.y})`">
        <rect x="-11" y="-8" width="22" height="16" rx="3" :fill="s.used ? '#000' : '#fff'" stroke="#000" stroke-width="1.4" />
        <text y="5" text-anchor="middle" class="sn" :fill="s.used ? '#fff' : '#000'">{{ s.geo ? 'S' : s.prn }}</text>
      </g>
    </svg>

    <div v-if="!dev.isSim" class="devgps">DEVICE GPS<br />No satellite data</div>

    <div class="bars">
      <div v-for="r in rows" :key="r.prn" class="b">
        <span class="chip" :class="{ used: r.used }">{{ r.prn }}</span>
        <span class="bar"><i :style="{ width: r.pct + '%' }" /></span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useDisplayValues } from '@/gp39/ui/display'
import { ui } from '@/gp39/ui/state'

const v = useDisplayValues()
const dev = v.dev

const elvMask = computed(() => Math.min(60, Math.max(0, dev.settings.svElev)))

const all = computed(() => dev.sats.slice().sort((a, b) => a.prn - b.prn))
const pages = computed(() => Math.ceil(all.value.length / 13))
const rows = computed(() =>
  all.value.slice(ui.satPage * 13, ui.satPage * 13 + 13).map((s) => ({
    prn: s.prn,
    pct: Math.round((Math.min(50, s.snr) / 50) * 100),
    used: dev.fixInfo.used.includes(s.prn),
  })),
)
const plotted = computed(() =>
  all.value
    .filter((s) => s.elev > 0)
    .map((s) => {
      const r = (100 * (90 - Math.max(elvMask.value, s.elev))) / (90 - elvMask.value)
      const a = (s.az * Math.PI) / 180
      return { prn: s.prn, geo: !!s.geo, used: dev.fixInfo.used.includes(s.prn), x: Math.sin(a) * r, y: -Math.cos(a) * r }
    }),
)
const dopText = computed(() => (dev.fixInfo.fix === '---' ? '--' : dev.fixInfo.hdop.toFixed(2)))
const altText = computed(() => (dev.altitude === null ? '-- m' : `${dev.altitude.toFixed(1)} m`))
</script>

<style scoped lang="scss">
.status {
  position: absolute;
  left: 8px;
  top: 4px;
  font-size: 22px;
}
.dop {
  position: absolute;
  left: 254px;
  top: 4px;
  width: 46px;
  font-size: 17px;
  line-height: 18px;
  text-align: center;
  b {
    font-size: 14px;
  }
}
.alt {
  position: absolute;
  left: 12px;
  bottom: 6px;
  font-size: 18px;
}
.devgps {
  position: absolute;
  left: 302px;
  top: 4px;
  font-size: 17px;
  line-height: 20px;
}
.page {
  position: absolute;
  left: 142px;
  bottom: 4px;
  font-size: 18px;
}
.ring {
  position: absolute;
  left: 8px;
  top: 12px;
}
.n {
  font-size: 15px;
  fill: #fff;
  font-weight: 700;
}
.sn {
  font-size: 13px;
  font-weight: 700;
  font-family: 'Roboto Condensed', Arial, sans-serif;
}
.bars {
  position: absolute;
  left: 302px;
  top: 4px;
  width: 174px;
  .b {
    display: flex;
    align-items: center;
    height: 20px;
  }
  .chip {
    width: 28px;
    height: 16px;
    border: 1.5px solid #000;
    border-radius: 3px;
    background: #fff;
    text-align: center;
    font-size: 14px;
    line-height: 13px;
    margin-right: 6px;
    &.used {
      background: #000;
      color: #fff;
    }
  }
  .bar {
    flex: 1;
    height: 11px;
    border: 1px solid #555;
    background: #fff;
    position: relative;
    i {
      position: absolute;
      left: 0;
      top: 0;
      bottom: 0;
      background: #000;
    }
  }
}
</style>
