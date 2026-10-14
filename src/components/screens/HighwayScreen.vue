<template>
  <div class="lcdscreen hw">
    <!-- panneau de gauche -->
    <div class="panel">
      <div class="blk">
        <div class="lbl"
          >BRG <i>{{ v.refLetter.value }}(°)</i></div
        >
        <div class="val">{{ v.brg.value }}</div>
      </div>
      <div class="blk">
        <div class="lbl"
          >COG <i>{{ v.refLetter.value }}(°)</i></div
        >
        <div class="val">{{ v.cog.value }}</div>
      </div>
      <div class="blk">
        <div class="lbl"
          >RNG <i>({{ v.dUnit.value }})</i></div
        >
        <div class="val">{{ v.rng.value }}</div>
      </div>
      <div class="blk">
        <div class="lbl"
          >SOG <i>({{ v.sUnit.value }})</i></div
        >
        <div class="val">{{ v.sog.value }}</div>
      </div>
    </div>

    <!-- vue 3D -->
    <svg class="scene" viewBox="0 0 364 194" width="364" height="194">
      <defs>
        <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="#b9bbbe" />
          <stop offset="1" stop-color="#eeeff0" />
        </linearGradient>
        <linearGradient id="ground" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="#f1f1f1" />
          <stop offset="1" stop-color="#cfd0d2" />
        </linearGradient>
        <clipPath id="vclip"><rect x="0" y="0" width="364" height="194" rx="6" /></clipPath>
      </defs>
      <g clip-path="url(#vclip)">
        <rect x="0" y="0" width="364" height="78" fill="url(#sky)" />
        <rect x="0" y="78" width="364" height="116" fill="url(#ground)" />
        <!-- grille de perspective -->
        <g stroke="#d9d9d9" stroke-width="1">
          <line v-for="n in 13" :key="'g' + n" x1="182" y1="78" :x2="-260 + n * 52" y2="194" />
        </g>
        <!-- route -->
        <polygon points="175,78 189,78 354,152 10,152" fill="#050505" />
        <line x1="182" y1="78" x2="182" y2="152" stroke="#fff" stroke-width="1.6" />
        <text x="182" y="112" text-anchor="middle" class="plus">+</text>
        <text x="92" y="146" text-anchor="middle" class="sc">{{ scaleLabel }}</text>
        <text x="272" y="146" text-anchor="middle" class="sc">{{ scaleLabel }}</text>
        <!-- règle d'XTE -->
        <rect x="4" y="154" width="356" height="34" fill="#454545" />
        <g stroke="#fff" stroke-width="1.5">
          <line
            v-for="t in 21"
            :key="'t' + t"
            :x1="4 + (t - 1) * 17.8"
            y1="158"
            :x2="4 + (t - 1) * 17.8"
            :y2="(t - 1) % 5 === 0 ? 172 : 166"
          />
        </g>
        <polygon
          v-if="v.hasDest.value"
          :points="`${xteX - 8},186 ${xteX + 8},186 ${xteX},168`"
          fill="#e0261b"
          stroke="#fff"
          stroke-width="1"
          :class="{ blink: overscale }"
        />
        <text v-else x="182" y="178" text-anchor="middle" class="north">N</text>
        <!-- nom du waypoint et flèche de barre -->
        <text v-if="v.hasDest.value" x="182" y="22" text-anchor="middle" class="wname">{{ v.dev.nav.destName }}</text>
        <polygon
          v-if="arrow === 'right'"
          points="296,84 326,84 326,74 352,96 326,118 326,108 296,108"
          fill="#30b83a"
          stroke="#1d7a25"
          stroke-width="1.2"
          :class="{ blink: overscale }"
        />
        <polygon
          v-if="arrow === 'left'"
          points="68,84 38,84 38,74 12,96 38,118 38,108 68,108"
          fill="#30b83a"
          stroke="#1d7a25"
          stroke-width="1.2"
          :class="{ blink: overscale }"
        />
      </g>
      <rect x="1" y="1" width="362" height="192" rx="6" fill="none" stroke="#6f7782" stroke-width="2" />
    </svg>

    <!-- bandeau bas -->
    <div class="strip">
      <div class="pos">
        <div>{{ v.lat.value }}</div>
        <div>{{ v.lon.value }}</div>
      </div>
      <div class="xte">
        <span class="xl">XTE</span>
        <svg class="own" viewBox="-12 -12 24 24" width="24" height="24">
          <g :transform="`rotate(${ownRot})`"><polygon points="0,-10 7,9 0,5 -7,9" fill="#111" /></g>
        </svg>
        <span class="xv">{{ v.xte.value }}</span>
        <span class="xu">{{ v.dUnit.value }}</span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { HIGHWAY_RANGES } from '@/gp39/types'
import { toDistUnit } from '@/gp39/format'
import { useDisplayValues } from '@/gp39/ui/display'

const v = useDisplayValues()

/** Demi-échelle de la règle XTE = moitié de la portée du highway. */
const half = computed(() => (HIGHWAY_RANGES[v.dev.settings.highwayRange] ?? 2) / 2)
const scaleLabel = computed(() => {
  const x = toDistUnit(half.value / 2, v.dev.settings.units)
  return x < 1 ? x.toFixed(2).replace(/0$/, '') : String(x)
})
const rawX = computed(() => (v.hasDest.value ? v.dev.nav.xte / half.value : 0))
const overscale = computed(() => Math.abs(rawX.value) > 1)
const xteX = computed(() => 182 + Math.max(-1, Math.min(1, rawX.value)) * 172)
const arrow = computed<'left' | 'right' | null>(() => {
  if (!v.hasDest.value || Math.abs(v.dev.nav.xte) < 0.0005) return null
  return v.dev.nav.xte > 0 ? 'left' : 'right'
})
/** Le repère du bateau montre le cap vers la destination (ou le cap fond sans destination). */
const ownRot = computed(() => {
  if (!v.hasDest.value) return v.cogDeg.value
  const d = v.brgDeg.value ?? 0
  return ((v.cogDeg.value - d + 540) % 360) - 180
})
</script>

<style scoped lang="scss">
.panel {
  position: absolute;
  left: 0;
  top: 0;
  width: 108px;
  height: 272px;
  background: #f3f4f5;
}
.blk {
  height: 68px;
  position: relative;
  border-bottom: 3px solid #d3d5d9;
  padding: 3px 5px 0 5px;
  &:last-child {
    border-bottom: 0;
  }
  .lbl {
    font-size: 12px;
    display: flex;
    justify-content: space-between;
    i {
      font-style: normal;
      font-size: 11px;
    }
  }
  .val {
    text-align: right;
    font-size: 48px;
    line-height: 50px;
    letter-spacing: -1px;
  }
}
.scene {
  position: absolute;
  left: 112px;
  top: 4px;
}
.plus {
  font-size: 14px;
  fill: #fff;
}
.sc {
  font-size: 15px;
  fill: #fff;
  font-family: 'Roboto Condensed', Arial, sans-serif;
}
.north {
  font-size: 22px;
  fill: #fff;
}
.wname {
  font-size: 14px;
  font-family: 'VT323', monospace;
  fill: #111;
  font-weight: 400;
}
.blink {
  animation: blink 0.8s steps(2, jump-none) infinite;
}
@keyframes blink {
  50% {
    opacity: 0.1;
  }
}
.strip {
  position: absolute;
  left: 112px;
  top: 202px;
  width: 364px;
  height: 66px;
  display: flex;
  align-items: center;
  .pos {
    width: 140px;
    font-size: 21px;
    line-height: 24px;
    text-align: center;
  }
  .xte {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 2px;
    padding-right: 4px;
    .xl {
      font-size: 13px;
      align-self: flex-start;
      margin-top: 8px;
    }
    .xv {
      font-size: 56px;
      line-height: 56px;
      letter-spacing: -1px;
    }
    .xu {
      font-size: 13px;
      align-self: flex-end;
      margin-bottom: 8px;
    }
  }
}
</style>
