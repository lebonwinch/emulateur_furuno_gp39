<template>
  <div class="overlay" v-if="views.length">
    <template v-for="(v, i) in views" :key="i">
      <!-- liste plein écran -->
      <div v-if="v.kind === 'list'" class="win full">
        <div class="title">{{ v.title }}</div>
        <div v-if="v.header" class="hdr tvrow">
          <span v-for="(h, hi) in v.header" :key="hi" :style="{ width: v.cols[hi] + 'ch' }">{{ h }}</span>
        </div>
        <div class="rows">
          <div
            v-for="r in windowRows(v)"
            :key="r.i"
            class="tvrow"
            :class="{
              sel: r.i === v.idx && v.mode !== 'settings' && !r.row.info,
              dis: r.row.disabled,
            }"
          >
            <template v-if="v.mode === 'settings'">
              <span
                v-for="(c, ci) in r.row.cells"
                :key="ci"
                class="cell"
                :class="{
                  act: r.i === v.idx && r.row.editable?.[v.cell] === ci,
                }"
                :style="{ width: (v.cols[ci] ?? 8) + 'ch' }"
              >
                <CellContent :cell="c" />
              </span>
            </template>
            <template v-else>
              <span v-for="(c, ci) in r.row.cells" :key="ci" class="cell" :style="{ width: (v.cols[ci] ?? 36) + 'ch' }">
                <CellContent :cell="c" />
              </span>
            </template>
          </div>
        </div>
        <div class="scroll" :style="scrollStyle(v)"><i :style="thumbStyle(v)" /></div>
        <div class="footer">{{ v.footer ?? '[MENU]:Cancel [ENT]:Enter ▲/▼:Sel.' }}</div>
      </div>

      <!-- fenêtre de choix -->
      <div
        v-else-if="v.kind === 'select'"
        class="win pop"
        :style="popStyle(v.at, v.options.length > v.max ? v.max : v.options.length, widthOf(v))"
      >
        <div v-if="v.title" class="ptitle">{{ v.title }}</div>
        <div v-for="(o, oi) in v.options.slice(v.top, v.top + v.max)" :key="oi" class="popopt" :class="{ sel: oi + v.top === v.idx }">
          <span v-if="v.icons" class="ico" v-html="v.icons[oi + v.top]" />
          <span>{{ o }}</span>
        </div>
        <div v-if="v.options.length > v.max" class="pscroll">
          <i
            :style="{
              top: (v.top / v.options.length) * 100 + '%',
              height: (v.max / v.options.length) * 100 + '%',
            }"
          />
        </div>
      </div>

      <!-- éditeur de champ -->
      <div v-else-if="v.kind === 'edit'" class="win pop edit" :style="popStyle(v.at, 1, v.slots.length + 4)">
        <div class="editrow">
          <span v-for="(s, si) in v.slots" :key="si" class="ch" :class="{ cur: si === v.pos }"
            ><b v-if="si === v.pos" class="ar up">▲</b>{{ v.buf[si] === ' ' ? '&nbsp;' : v.buf[si]
            }}<b v-if="si === v.pos" class="ar dn">▼</b></span
          >
          <span v-if="v.suffix" class="suffix">{{ v.suffix }}</span>
        </div>
      </div>

      <!-- confirmation -->
      <div v-else-if="v.kind === 'confirm'" class="win full dialog">
        <div class="title">{{ v.title }}</div>
        <div class="msg">
          <div v-for="(l, li) in v.lines" :key="li" class="line">{{ l || ' ' }}</div>
        </div>
        <div class="choices">
          <span v-for="(o, oi) in v.options" :key="oi" class="choice" :class="{ sel: oi === v.idx }">{{ o }}</span>
        </div>
        <div class="footer">[MENU]:Cancel [ENT]:Enter ▲/▼:Sel.</div>
      </div>

      <!-- message -->
      <div v-else-if="v.kind === 'message'" class="win full dialog">
        <div class="title">{{ v.title }}</div>
        <div class="msg">
          <div v-for="(l, li) in v.lines" :key="li" class="line">{{ l || ' ' }}</div>
        </div>
      </div>

      <!-- fenêtre de portée -->
      <div v-else-if="v.kind === 'zoom'" class="win zoomwin">
        <div class="ar">▲</div>
        <div class="zv">{{ zoomText }}</div>
        <div class="ar">▼</div>
        <div class="zr">({{ zoomRange }})</div>
      </div>

      <!-- luminosité -->
      <div v-else-if="v.kind === 'brill'" class="win pop brillwin">
        <div class="bl"
          ><span>LCD</span><span class="bars"><i v-for="n in 7" :key="n" :class="{ on: n <= dev.settings.brillLcd }" /></span
        ></div>
        <div class="bl"
          ><span>Key</span><span class="bars"><i v-for="n in 7" :key="n" :class="{ on: n <= dev.settings.brillKey }" /></span
        ></div>
        <div class="bh">◀▶ LCD ▲▼ Key</div>
      </div>

      <!-- test système -->
      <div v-else-if="v.kind === 'test'" class="win full">
        <div class="title">Menu >System >Self Test >System Test</div>
        <div class="rows testrows">
          <div class="tvrow"><span class="cell" style="width: 22ch">1 ROM, RAM</span>OK</div>
          <div class="tvrow"><span class="cell" style="width: 22ch">2 Data1</span>-</div>
          <div class="tvrow"><span class="cell" style="width: 22ch">3 USB</span>OK</div>
          <div class="tvrow"><span class="cell" style="width: 22ch">4 GPS</span>OK</div>
          <div class="tvrow"><span class="cell" style="width: 22ch">5 Program</span>2051625-01.02</div>
          <div class="tvrow"><span class="cell" style="width: 22ch">6 GPS Ver</span>4850-465021</div>
          <div class="tvrow keys">
            <span v-for="k in KEY_LABELS" :key="k.name" class="kt" :class="{ red: v.pressed.has(k.name) }">{{ k.label }}</span>
          </div>
        </div>
        <div class="footer">Press each key. [MENU] x3: close</div>
      </div>

      <!-- test LCD -->
      <div v-else-if="v.kind === 'lcdtest'" class="lcdtest" :style="lcdTestStyle(v.step)" />
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, defineComponent, h } from 'vue'
import { COLOR_NAMES, markSvg } from '@/gp39/symbols'
import { distUnit, toDistUnit } from '@/gp39/format'
import { HIGHWAY_RANGES, PLOTTER_RANGES } from '@/gp39/types'
import { useDevice } from '@/stores/device'
import { ui } from '@/gp39/ui/state'
import type { Cell, EditView, ListRow, ListView, SelectView, View } from '@/gp39/ui/types'

const dev = useDevice()
const VISIBLE = 7

/** Cellule de liste : texte, pictogramme de waypoint + couleur, ou texte grisé. */
const CellContent = defineComponent({
  props: { cell: { type: [String, Object] as unknown as () => Cell, required: true } },
  setup(p) {
    return () => {
      const c = p.cell
      if (typeof c === 'string') return c
      if ('mark' in c)
        return h('span', { class: 'markcell' }, [
          h('span', { class: 'ico', innerHTML: markSvg(c.mark[0], c.mark[1], 16) }),
          h('span', COLOR_NAMES[c.mark[1]] ?? ''),
        ])
      if ('icon' in c) return h('span', { class: 'ico', innerHTML: markSvg(c.icon[0], c.icon[1], 16) })
      if ('dim' in c) return h('span', { class: 'dim' }, c.dim)
      return ''
    }
  },
})

const KEY_LABELS = [
  { name: 'up', label: '▲' },
  { name: 'down', label: '▼' },
  { name: 'left', label: '◀' },
  { name: 'right', label: '▶' },
  { name: 'menu', label: 'MENU' },
  { name: 'ent', label: 'ENT' },
  { name: 'disp', label: 'DISP' },
  { name: 'goto', label: 'GOTO' },
  { name: 'mark', label: 'MARK' },
]

const FULL = new Set(['list', 'test', 'lcdtest', 'confirm', 'message'])

/** Vues à dessiner : la dernière vue plein écran et tout ce qui la recouvre. */
const views = computed<View[]>(() => {
  const st = ui.stack
  let base = -1
  for (let i = st.length - 1; i >= 0; i--) {
    if (FULL.has(st[i]!.kind)) {
      base = i
      break
    }
  }
  return st.slice(Math.max(0, base))
})

function windowRows(v: ListView): { i: number; row: ListRow }[] {
  v.visible = v.header ? VISIBLE - 1 : VISIBLE
  const n = v.count()
  const out: { i: number; row: ListRow }[] = []
  for (let i = v.top; i < Math.min(n, v.top + (v.visible ?? VISIBLE)); i++) out.push({ i, row: v.row(i) })
  return out
}

function scrollStyle(v: ListView): Record<string, string> {
  return { display: v.count() > (v.visible ?? VISIBLE) ? 'block' : 'none' }
}
function thumbStyle(v: ListView): Record<string, string> {
  const n = Math.max(1, v.count())
  const vis = v.visible ?? VISIBLE
  return { top: (v.top / n) * 100 + '%', height: Math.min(100, (vis / n) * 100) + '%' }
}

function widthOf(v: SelectView): number {
  if (v.width) return v.width + (v.icons ? 3 : 2)
  return Math.max(6, ...v.options.map((o) => o.length)) + 2 + (v.icons ? 3 : 0)
}

/** Position d'une fenêtre : au coin (x, y) LCD, recadrée dans l'écran. */
function popStyle(at: { x: number; y: number } | undefined, lines: number, widthCh: number): Record<string, string> {
  const hpx = lines * 24 + 12
  const wpx = widthCh * 11.2 + 12
  const x = at ? Math.min(at.x, 480 - wpx - 4) : (480 - wpx) / 2
  const y = at ? Math.min(at.y, 272 - hpx - 4) : (272 - hpx) / 2
  return { left: Math.max(2, x) + 'px', top: Math.max(2, y) + 'px', minWidth: widthCh + 'ch' }
}

const isHighway = computed(() => dev.settings.display === 1)
/** Nombre sans décimales parasites (1.852 → « 1.85 », 320 → « 320 »). */
const fmtNum = (v: number): string => String(Number(v.toFixed(2)))

const zoomText = computed(() => {
  const r = isHighway.value ? HIGHWAY_RANGES[dev.settings.highwayRange] : PLOTTER_RANGES[dev.settings.plotterRange]
  const v = toDistUnit(r ?? 0.5, dev.settings.units)
  return `${fmtNum(v)}${distUnit(dev.settings.units)}`
})
const zoomRange = computed(() => {
  const a = isHighway.value ? HIGHWAY_RANGES[0] : PLOTTER_RANGES[0]
  const b = isHighway.value ? HIGHWAY_RANGES[HIGHWAY_RANGES.length - 1] : PLOTTER_RANGES[PLOTTER_RANGES.length - 1]
  return `${fmtNum(toDistUnit(a ?? 0, dev.settings.units))}~${fmtNum(toDistUnit(b ?? 0, dev.settings.units))}${distUnit(dev.settings.units)}`
})

const LCD_COLORS = [
  '#f00',
  '#0f0',
  '#00f',
  'linear-gradient(90deg,#000,#f00)',
  'linear-gradient(90deg,#000,#0f0)',
  'linear-gradient(90deg,#000,#00f)',
  '#fff',
  '#000',
  'linear-gradient(90deg,#000,#fff)',
]
function lcdTestStyle(step: number): Record<string, string> {
  return { background: LCD_COLORS[Math.min(step, LCD_COLORS.length - 1)] ?? '#fff' }
}
void (null as unknown as EditView)
</script>

<style scoped lang="scss">
.overlay {
  position: absolute;
  inset: 0;
  pointer-events: none;
  font-family: 'VT323', 'Courier New', monospace;
  font-size: 26px;
  line-height: 26px;
  color: #000;
}
.win {
  position: absolute;
  background: #fff;
  border: 2px solid #1b1b1b;
}
.win.full {
  inset: 2px;
  border: 2px solid #1b1b1b;
  background: #fff;
}
.title {
  height: 26px;
  padding: 0 6px;
  background: linear-gradient(#e9e9e9, #cfcfcf);
  border-bottom: 2px solid #1b1b1b;
  white-space: pre;
}
.hdr {
  height: 26px;
  padding: 0 6px;
  border-bottom: 1px solid #000;
  background: #f1f1f1;
}
.rows {
  padding: 1px 6px 0 6px;
  height: 188px;
  overflow: hidden;
}
.tvrow {
  display: flex;
  height: 26px;
  white-space: pre;
  align-items: center;
  &.sel {
    background: #000;
    color: #fff;
    :deep(.dim) {
      color: #bbb;
    }
  }
  &.dis {
    color: #888;
  }
}
.cell {
  display: inline-block;
  overflow: hidden;
  white-space: pre;
  &.act {
    background: #000;
    color: #fff;
  }
}
.dim {
  color: #777;
}
:deep(.markcell) {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}
:deep(.ico) {
  display: inline-flex;
  align-items: center;
  width: 20px;
}
.scroll {
  position: absolute;
  right: 3px;
  top: 30px;
  bottom: 30px;
  width: 9px;
  border: 1px solid #000;
  border-radius: 4px;
  background: #fff;
  i {
    position: absolute;
    left: 0;
    right: 0;
    background: #000;
    border-radius: 3px;
    min-height: 8px;
  }
}
.footer {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  height: 28px;
  padding: 1px 6px 0;
  border-top: 2px solid #aaa;
  background: linear-gradient(#e7e7e7, #d2d2d2);
  white-space: pre;
}
.pop {
  padding: 3px 4px;
}
.ptitle {
  border-bottom: 1px solid #000;
  margin-bottom: 2px;
}
.popopt {
  height: 24px;
  line-height: 24px;
  padding: 0 4px;
  display: flex;
  align-items: center;
  white-space: pre;
  &.sel {
    background: #000;
    color: #fff;
  }
}
.pscroll {
  position: absolute;
  right: 2px;
  top: 3px;
  bottom: 3px;
  width: 6px;
  border: 1px solid #000;
  i {
    position: absolute;
    left: 0;
    right: 0;
    background: #000;
  }
}
.edit .editrow {
  display: flex;
  align-items: center;
  height: 40px;
  padding: 0 3px;
}
.ch {
  position: relative;
  display: inline-block;
  min-width: 11.2px;
  text-align: center;
  height: 24px;
  line-height: 24px;
  &.cur {
    background: #000;
    color: #fff;
  }
  .ar {
    position: absolute;
    left: 0;
    right: 0;
    font-size: 9px;
    line-height: 9px;
    color: #000;
    font-weight: 400;
    &.up {
      top: -11px;
    }
    &.dn {
      bottom: -11px;
    }
  }
}
.suffix {
  margin-left: 8px;
}
.dialog .msg {
  height: 176px;
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
}
.choices {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 40px;
  display: flex;
  justify-content: center;
  gap: 60px;
}
.choice {
  padding: 0 6px;
  &.sel {
    background: #000;
    color: #fff;
  }
}
.zoomwin {
  left: 120px;
  top: 80px;
  width: 96px;
  text-align: center;
  padding: 2px 0;
  .ar {
    font-size: 16px;
    line-height: 14px;
  }
  .zv {
    font-size: 26px;
    line-height: 28px;
  }
  .zr {
    font-size: 20px;
    line-height: 22px;
    border-top: 1px solid #000;
    margin-top: 2px;
  }
}
.brillwin {
  left: 130px;
  top: 76px;
  width: 200px;
  .bl {
    display: flex;
    justify-content: space-between;
    align-items: center;
    height: 28px;
  }
  .bars {
    display: inline-flex;
    gap: 3px;
    i {
      width: 12px;
      height: 14px;
      border: 1px solid #000;
      &.on {
        background: #000;
      }
    }
  }
  .bh {
    font-size: 18px;
    text-align: center;
  }
}
.testrows .keys {
  margin-top: 8px;
  gap: 8px;
  .kt {
    border: 1px solid #000;
    padding: 0 4px;
    font-size: 20px;
    &.red {
      background: #d40000;
      color: #fff;
    }
  }
}
.lcdtest {
  position: absolute;
  inset: 0;
}
</style>
