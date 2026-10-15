<template>
  <div ref="root" class="gp39" :class="{ lit: dev.power === 'on', compact }" :style="keyLight">
    <div class="logo">FURUNO</div>

    <div class="lcd-frame">
      <div class="lcd-glass">
        <Lcd />
      </div>
    </div>

    <div class="rightpanel" />

    <!-- CursorPad -->
    <svg class="pad" viewBox="-50 -50 100 100" aria-label="CursorPad">
      <circle r="47" class="pad-ring" />
      <circle r="45" class="pad-inner" />
      <text y="3.4" text-anchor="middle" class="pad-txt">GP-39</text>
      <polygon points="0,-39 -4.2,-33 4.2,-33" class="pad-arrow" />
      <polygon points="0,39 -4.2,33 4.2,33" class="pad-arrow" />
      <polygon points="-39,0 -33,-4.2 -33,4.2" class="pad-arrow" />
      <polygon points="39,0 33,-4.2 33,4.2" class="pad-arrow" />
      <circle v-for="d in diagonals" :key="d.key" :cx="d.x" :cy="d.y" r="1.7" class="pad-dot" />
      <path
        v-for="s in sectors"
        :key="s.key"
        :d="s.d"
        class="hit"
        :class="{ on: pressed.has(s.key) }"
        @pointerdown.prevent="down(s.key, $event)"
        @pointerup.prevent="up(s.key, $event)"
        @pointercancel="up(s.key, $event)"
        @pointerleave="up(s.key, $event)"
      />
    </svg>

    <!-- touches -->
    <button
      v-for="k in KEYS"
      :key="k.name"
      class="key"
      :class="[k.name, { on: pressed.has(k.name) }]"
      :style="{ left: (compact ? k.cx : k.x) + '%', top: (compact ? k.cy : k.y) + '%' }"
      :aria-label="k.aria"
      type="button"
      @pointerdown.prevent="down(k.name, $event)"
      @pointerup.prevent="up(k.name, $event)"
      @pointercancel="up(k.name, $event)"
      @pointerleave="up(k.name, $event)"
      @contextmenu.prevent
    >
      <template v-if="k.name === 'brill'">
        <svg viewBox="0 0 24 24" class="pwr">
          <path d="M12 3v8" />
          <path d="M7 6.5a7 7 0 1 0 10 0" />
        </svg>
        <span>BRILL</span>
      </template>
      <template v-else>
        <span v-for="(l, i) in k.lines" :key="i">{{ l }}</span>
      </template>
    </button>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref } from 'vue'
import { useDevice } from '@/stores/device'
import { brillDown, brillUp, press, typeChar, openZoom } from '@/gp39/ui/controller'
import { topView } from '@/gp39/ui/state'
import { zoomPlotter } from '@/gp39/ui/plotter'
import type { KeyName } from '@/gp39/ui/types'
import Lcd from './Lcd.vue'

const dev = useDevice()
const root = ref<HTMLElement | null>(null)
/** disposition compacte (écran étroit) : LCD pleine largeur, touches plus grandes dessous */
const compact = ref(false)
let ro: ResizeObserver | undefined

interface KeyDef {
  name: KeyName
  lines: string[]
  /** centre de la touche en % de la largeur / de la hauteur de la façade */
  x: number
  y: number
  /** idem en disposition compacte (téléphone) */
  cx: number
  cy: number
  aria: string
}

// géométrie relevée sur la photo du manuel (§1.1)
const KEYS: KeyDef[] = [
  { name: 'menu', lines: ['MENU'], x: 78.8, y: 46.2, cx: 60, cy: 60, aria: 'MENU' },
  { name: 'ent', lines: ['ENT', 'CNTR'], x: 90.4, y: 46.2, cx: 84, cy: 60, aria: 'ENT/CNTR' },
  { name: 'disp', lines: ['DISP'], x: 78.8, y: 61.3, cx: 60, cy: 72, aria: 'DISP' },
  { name: 'goto', lines: ['GO TO'], x: 90.4, y: 61.3, cx: 84, cy: 72, aria: 'GO TO' },
  { name: 'mark', lines: ['MARK', 'MOB'], x: 78.8, y: 77.3, cx: 60, cy: 84, aria: 'MARK/MOB' },
  { name: 'brill', lines: ['BRILL'], x: 90.4, y: 77.3, cx: 84, cy: 84, aria: 'BRILL / power' },
]

// secteurs du CursorPad : 8 directions de 45°
const DIR_ORDER: KeyName[] = ['up', 'upright', 'right', 'downright', 'down', 'downleft', 'left', 'upleft']
const sectors = DIR_ORDER.map((key, i) => {
  const a0 = ((i * 45 - 22.5 - 90) * Math.PI) / 180
  const a1 = ((i * 45 + 22.5 - 90) * Math.PI) / 180
  const r0 = 15
  const r1 = 47
  const p = (r: number, a: number): string => `${(Math.cos(a) * r).toFixed(2)} ${(Math.sin(a) * r).toFixed(2)}`
  return { key, d: `M${p(r0, a0)}L${p(r1, a0)}A${r1} ${r1} 0 0 1 ${p(r1, a1)}L${p(r0, a1)}A${r0} ${r0} 0 0 0 ${p(r0, a0)}Z` }
})
const diagonals = [
  { key: 'a', x: 27.6, y: -27.6 },
  { key: 'b', x: 27.6, y: 27.6 },
  { key: 'c', x: -27.6, y: 27.6 },
  { key: 'd', x: -27.6, y: -27.6 },
]

/** Éclairage des touches (BRILL, deuxième réglage). */
const keyLight = computed(() => ({ '--keyglow': String(0.15 + (dev.settings.brillKey / 7) * 0.85) }))

// ---------------------------------------------------------------- gestion des appuis
const pressed = reactive(new Set<string>())
const ARROWS = new Set<string>(['up', 'down', 'left', 'right', 'upleft', 'upright', 'downleft', 'downright'])
const LONG_MS: Partial<Record<KeyName, number>> = { ent: 1000, mark: 1000, disp: 1500 }

interface Hold {
  timer?: ReturnType<typeof setTimeout>
  rep?: ReturnType<typeof setInterval>
  long: boolean
  n: number
}
const holds = new Map<string, Hold>()

function down(k: KeyName, ev?: Event): void {
  if (pressed.has(k)) return // déjà enfoncée (2e pointeur, répétition clavier)
  if (ev && 'pointerId' in ev) (ev.target as Element)?.setPointerCapture?.((ev as PointerEvent).pointerId)
  pressed.add(k)
  if (k === 'brill') return brillDown()
  const h: Hold = { long: false, n: 0 }
  holds.set(k, h)
  if (ARROWS.has(k)) {
    press(k, false, 0)
    h.timer = setTimeout(() => {
      h.rep = setInterval(() => press(k, false, ++h.n), 70)
    }, 380)
    return
  }
  if (k === 'menu' || k === 'goto') return void press(k)
  h.timer = setTimeout(() => {
    h.long = true
    press(k, true)
  }, LONG_MS[k] ?? 1000)
}

function up(k: KeyName, ev?: Event): void {
  if (ev && 'pointerId' in ev) (ev.target as Element)?.releasePointerCapture?.((ev as PointerEvent).pointerId)
  // une touche qui n'a pas été enfoncée ne produit rien (pointerleave après pointerup, keyup d'une autre fenêtre…)
  if (!pressed.delete(k)) return
  if (k === 'brill') return brillUp()
  const h = holds.get(k)
  if (!h) return
  if (h.timer) clearTimeout(h.timer)
  if (h.rep) clearInterval(h.rep)
  holds.delete(k)
  if (!ARROWS.has(k) && k !== 'menu' && k !== 'goto' && !h.long) press(k, false)
}

// ---------------------------------------------------------------- clavier
const KEYMAP: Record<string, KeyName> = {
  ArrowUp: 'up',
  ArrowDown: 'down',
  ArrowLeft: 'left',
  ArrowRight: 'right',
  Home: 'upleft',
  PageUp: 'upright',
  End: 'downleft',
  PageDown: 'downright',
  Enter: 'ent',
  Escape: 'menu',
  m: 'menu',
  d: 'disp',
  g: 'goto',
  ' ': 'mark',
  k: 'mark',
  b: 'brill',
  p: 'brill',
}

/** Éléments qui gardent le clavier pour eux (saisie, curseurs, fenêtres Quasar). */
const OWN_KEYS = 'input, textarea, select, [contenteditable="true"], [role="slider"], .q-dialog, .q-menu'
/** Boutons et interrupteurs : Espace et Entrée servent à les activer. */
const ACTIVATABLE = 'button, a[href], [role="switch"], [role="checkbox"], [role="radio"], [role="button"], summary'

function isTyping(e: KeyboardEvent): boolean {
  const el = e.target as HTMLElement | null
  if (!el?.closest) return false
  if (el.closest(OWN_KEYS)) return true
  return (e.key === ' ' || e.key === 'Enter') && !!el.closest(ACTIVATABLE) && !el.closest('.key')
}

/** Relâche toutes les touches (perte du focus : le keyup ne serait jamais reçu). */
function releaseAll(): void {
  if (pressed.has('brill')) dev.cancelPowerOffAttempt()
  for (const h of holds.values()) {
    if (h.timer) clearTimeout(h.timer)
    if (h.rep) clearInterval(h.rep)
  }
  holds.clear()
  pressed.clear()
}

function onVisibility(): void {
  if (document.hidden) releaseAll()
}

function onKeyDown(e: KeyboardEvent): void {
  if (e.ctrlKey || e.metaKey || e.altKey || isTyping(e)) return
  const top = topView()
  // saisie de texte dans un éditeur de champ
  if (top?.kind === 'edit' && e.key.length === 1) {
    if (typeChar(e.key)) e.preventDefault()
    return
  }
  if (dev.power === 'on' && !top && (e.key === '+' || e.key === '=')) return void zoomPlotter(-1)
  if (dev.power === 'on' && !top && (e.key === '-' || e.key === '_')) return void zoomPlotter(1)
  const k = KEYMAP[e.key] ?? KEYMAP[e.key.toLowerCase()]
  if (!k) return
  e.preventDefault()
  if (e.repeat) return
  down(k)
}

function onKeyUp(e: KeyboardEvent): void {
  const k = KEYMAP[e.key] ?? KEYMAP[e.key.toLowerCase()]
  if (!k) return
  up(k)
}

onMounted(() => {
  window.addEventListener('keydown', onKeyDown)
  window.addEventListener('keyup', onKeyUp)
  window.addEventListener('blur', releaseAll)
  document.addEventListener('visibilitychange', onVisibility)
  const update = (): void => {
    const w = (root.value?.parentElement ?? root.value)?.clientWidth ?? 1000
    compact.value = w < 560
  }
  update()
  ro = new ResizeObserver(update)
  if (root.value?.parentElement) ro.observe(root.value.parentElement)
})
onBeforeUnmount(() => {
  ro?.disconnect()
  window.removeEventListener('keydown', onKeyDown)
  window.removeEventListener('keyup', onKeyUp)
  window.removeEventListener('blur', releaseAll)
  document.removeEventListener('visibilitychange', onVisibility)
  releaseAll()
})

void openZoom
</script>

<style scoped lang="scss">
.gp39 {
  position: relative;
  width: 100%;
  aspect-ratio: 397 / 225;
  container-type: inline-size;
  border-radius: 2.2cqw;
  background: radial-gradient(120% 140% at 30% 0%, #2a2c31 0%, #17181b 55%, #101113 100%);
  box-shadow:
    0 0 0 0.35cqw #08090a,
    0 1.5cqw 3cqw rgba(0, 0, 0, 0.55),
    inset 0 0.25cqw 0.4cqw rgba(255, 255, 255, 0.12),
    inset 0 -0.3cqw 0.5cqw rgba(0, 0, 0, 0.6);
  user-select: none;
  touch-action: manipulation;
  --keyglow: 0.5;
}
.logo {
  position: absolute;
  left: 9.3%;
  top: 13%;
  font-family: Georgia, 'Times New Roman', serif;
  font-weight: 700;
  font-size: 3cqw;
  letter-spacing: 0.42cqw;
  color: #b7924f;
  text-shadow: 0 0.1cqw 0.1cqw rgba(0, 0, 0, 0.7);
}
.lcd-frame {
  position: absolute;
  left: 8.3%;
  top: 23.6%;
  width: 56.9%;
  height: 58.6%;
  background: linear-gradient(#0a0b0c, #1a1b1e);
  border-radius: 0.7cqw;
  box-shadow:
    inset 0 0 0.6cqw #000,
    0 0 0 0.2cqw #2c2e33;
}
.lcd-glass {
  position: absolute;
  left: 1.8%;
  top: 3%;
  width: 96.4%;
  height: 94%;
  background: #000;
  overflow: hidden;
  border-radius: 0.3cqw;
  box-shadow: inset 0 0 1.4cqw rgba(0, 0, 0, 0.8);
  &::after {
    // reflet de la vitre
    content: '';
    position: absolute;
    inset: 0;
    background: linear-gradient(115deg, rgba(255, 255, 255, 0.07) 0%, rgba(255, 255, 255, 0) 40%);
    pointer-events: none;
  }
}
.rightpanel {
  position: absolute;
  left: 68%;
  top: 6%;
  width: 29.5%;
  height: 88%;
  border-radius: 1.4cqw;
  background: linear-gradient(135deg, #1d1e22, #121316);
  box-shadow:
    inset 0 0 0.3cqw rgba(255, 255, 255, 0.1),
    inset 0 0 1.5cqw rgba(0, 0, 0, 0.5);
}
.pad {
  position: absolute;
  left: 76.8%;
  top: 14.2%;
  width: 13.6%;
  aspect-ratio: 1;
  .pad-ring {
    fill: #1a1b1f;
    stroke: #bdbdbd;
    stroke-width: 1.3;
  }
  .pad-inner {
    fill: #0f1013;
    stroke: #2c2d31;
    stroke-width: 1;
  }
  .pad-txt {
    fill: #d6d6d6;
    font-size: 11px;
    font-style: italic;
    font-weight: 700;
    font-family: Arial, sans-serif;
  }
  .pad-arrow {
    fill: #e8e8e8;
  }
  .pad-dot {
    fill: #bdbdbd;
  }
  .hit {
    fill: rgba(255, 255, 255, 0);
    cursor: pointer;
    &:hover {
      fill: rgba(255, 255, 255, 0.07);
    }
    &.on {
      fill: rgba(255, 255, 255, 0.2);
    }
  }
}
.key {
  position: absolute;
  width: 6.8%;
  height: 9.6%;
  transform: translate(-50%, -50%);
  border: 0.26cqw solid #c4c4c4;
  border-radius: 1.2cqw;
  background: radial-gradient(circle at 50% 30%, #25262b, #141519);
  color: #ececec;
  font-family: Arial, Helvetica, sans-serif;
  font-weight: 700;
  font-size: 1.28cqw;
  line-height: 1.1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 0;
  cursor: pointer;
  touch-action: none;
  &.on,
  &:active {
    background: radial-gradient(circle at 50% 30%, #3a3c43, #202228);
    transform: translate(-50%, -50%) scale(0.95);
  }
  .pwr {
    width: 38%;
    fill: none;
    stroke: #ececec;
    stroke-width: 2.4;
    stroke-linecap: round;
  }
  span {
    display: block;
    transform: scaleY(0.95);
  }
}
.gp39.lit .key {
  text-shadow: 0 0 calc(0.5cqw * var(--keyglow)) rgba(255, 255, 255, calc(0.5 * var(--keyglow)));
}

/* ---- disposition compacte (téléphone) ---- */
.gp39.compact {
  aspect-ratio: 1 / 1.32;
  .logo {
    left: 5%;
    top: 2.2%;
    font-size: 4.2cqw;
  }
  .lcd-frame {
    left: 2.5%;
    top: 7%;
    width: 95%;
    height: 41.5%;
  }
  .rightpanel {
    left: 2.5%;
    top: 51%;
    width: 95%;
    height: 46.5%;
  }
  .pad {
    left: 5%;
    top: 55%;
    width: 41%;
  }
  .key {
    width: 20%;
    height: 9.4%;
    font-size: 3.2cqw;
    border-radius: 3cqw;
    border-width: 0.5cqw;
  }
}
</style>
