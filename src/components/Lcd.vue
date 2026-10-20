<template>
  <div ref="wrap" class="lcd-wrap">
    <div class="stage" :style="stageStyle">
      <template v-if="dev.power === 'on'">
        <PlotterScreen v-if="mode === 0" :scale="scale" />
        <HighwayScreen v-else-if="mode === 1" />
        <SteeringScreen v-else-if="mode === 2" />
        <NavDataScreen v-else-if="mode === 3" />
        <SatScreen v-else-if="mode === 4" />
        <UserScreen v-else-if="mode === 5" :which="5" />
        <UserScreen v-else-if="mode === 6" :which="6" />

        <TextOverlay />

        <!-- icône d'alarme -->
        <div v-if="dev.alarms.icon" class="alarm-icon" :class="{ flash: true }">
          <svg viewBox="0 0 24 24" width="24" height="24">
            <path d="M12 2a6 6 0 0 0-6 6v4l-2 4h16l-2-4V8a6 6 0 0 0-6-6zm-2 17a2 2 0 0 0 4 0z" fill="#111" />
          </svg>
        </div>
        <div v-if="dev.alarms.banner" class="alarm-banner">{{ dev.alarms.banner }}</div>
        <div v-if="ui.toast" class="toast">{{ ui.toast }}</div>
        <div v-if="dev.powerOffCountdown !== null" class="poweroff">
          <div>Power off</div>
          <div class="cd">{{ dev.powerOffCountdown }}</div>
        </div>
      </template>
      <div v-else-if="dev.power === 'booting'" class="boot">
        <div class="brand">ÉMULATEUR</div>
        <div class="model">compatible GP-39</div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useDevice } from '@/stores/device'
import { startUiHousekeeping, ui } from '@/gp39/ui/state'
import { LCD_H, LCD_W } from '@/gp39/layout'
import PlotterScreen from './screens/PlotterScreen.vue'
import HighwayScreen from './screens/HighwayScreen.vue'
import SteeringScreen from './screens/SteeringScreen.vue'
import NavDataScreen from './screens/NavDataScreen.vue'
import SatScreen from './screens/SatScreen.vue'
import UserScreen from './screens/UserScreen.vue'
import TextOverlay from './screens/TextOverlay.vue'

const dev = useDevice()
const wrap = ref<HTMLElement | null>(null)
const scale = ref(1)
const mode = computed(() => dev.settings.display)

let ro: ResizeObserver | undefined
let stopHousekeeping: (() => void) | undefined
onMounted(() => {
  stopHousekeeping = startUiHousekeeping()
  const update = (): void => {
    if (wrap.value) scale.value = wrap.value.clientWidth / LCD_W
  }
  update()
  ro = new ResizeObserver(update)
  if (wrap.value) ro.observe(wrap.value)
})
onBeforeUnmount(() => {
  ro?.disconnect()
  stopHousekeeping?.()
})

/** Luminosité du LCD selon BRILL (1-7). */
const stageStyle = computed(() => ({
  width: `${LCD_W}px`,
  height: `${LCD_H}px`,
  transform: `scale(${scale.value})`,
  filter: dev.power === 'off' ? 'none' : `brightness(${0.62 + 0.38 * (dev.settings.brillLcd / 7)})`,
}))
</script>

<style scoped lang="scss">
.lcd-wrap {
  position: relative;
  width: 100%;
  height: 100%;
  overflow: hidden;
  background: #050506;
}
.stage {
  position: absolute;
  left: 0;
  top: 0;
  transform-origin: 0 0;
  background: #f3f4f5;
  overflow: hidden;
  user-select: none;
}
.alarm-icon {
  position: absolute;
  right: 6px;
  top: 4px;
  &.flash svg {
    animation: flash 1s steps(2, jump-none) infinite;
  }
}
@keyframes flash {
  50% {
    opacity: 0;
  }
}
.alarm-banner {
  position: absolute;
  left: 60px;
  right: 60px;
  top: 100px;
  height: 56px;
  line-height: 52px;
  text-align: center;
  background: #fff;
  border: 3px solid #000;
  font-family: 'VT323', monospace;
  font-size: 30px;
  z-index: 5;
}
.toast {
  position: absolute;
  left: 50%;
  bottom: 40px;
  transform: translateX(-50%);
  background: #000;
  color: #fff;
  font-family: 'VT323', monospace;
  font-size: 22px;
  padding: 2px 12px;
  z-index: 6;
  white-space: nowrap;
}
.poweroff {
  position: absolute;
  left: 150px;
  top: 90px;
  width: 180px;
  background: #fff;
  border: 3px solid #000;
  text-align: center;
  font-family: 'VT323', monospace;
  font-size: 26px;
  z-index: 7;
  .cd {
    font-size: 60px;
    line-height: 56px;
  }
}
.boot {
  position: absolute;
  inset: 0;
  background: #fff;
  color: #111;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  .brand {
    font-family: 'Roboto Condensed', Arial, sans-serif;
    font-weight: 700;
    letter-spacing: 10px;
    font-size: 48px;
    color: #4a4f55;
  }
  .model {
    font-family: 'VT323', monospace;
    font-size: 30px;
    margin-top: 6px;
  }
}
</style>
