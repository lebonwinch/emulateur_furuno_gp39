<template>
  <div
    ref="rootEl"
    class="plotter"
    @wheel.prevent="onWheel"
    @pointerdown="onDown"
    @pointermove="onMove"
    @pointerup="onUp"
    @pointercancel="onUp"
  >
    <canvas ref="canvasEl" class="plotter-canvas" :width="px(480)" :height="px(272)" />

    <!-- panneau de gauche -->
    <div class="panel">
      <div class="row top">
        <span class="status">{{ dev.fix }}</span>
        <span class="datum">{{ datumLetter }}</span>
      </div>
      <div class="row range">
        <span class="br">[</span><span class="rv">{{ rangeText }}</span
        ><span class="ru">{{ distUnitLabel }}</span
        ><span class="br">]</span>
      </div>
      <div class="data">
        <div class="lbl">
          <b>{{ topLabel }}</b
          ><i v-if="cursorOn">+</i>
          <u>{{ topUnit }}</u>
        </div>
        <div class="val">{{ topValue }}</div>
      </div>
      <div class="data">
        <div class="lbl">
          <b>{{ botLabel }}</b
          ><i v-if="cursorOn">+</i>
          <u>{{ botUnit }}</u>
        </div>
        <div class="val">{{ botValue }}</div>
      </div>
    </div>

    <!-- bandeau de position -->
    <div class="strip">
      <span v-if="cursorOn" class="plus">+</span>
      <span class="pos">{{ latText }}</span>
      <span class="pos">{{ lonText }}</span>
    </div>

    <div v-if="dev.nav.hasDest" class="destname">{{ dev.nav.destName }}</div>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { bearing, distance, gridStepMin, type LatLon } from '@/gp39/geo'
import { distUnit, formatAngle, formatCoord, formatRange, formatSpeed, gridLabel, toDistUnit } from '@/gp39/format'
import { PLOTTER, LCD_H, LCD_W } from '@/gp39/layout'
import { COLORS, drawMark } from '@/gp39/symbols'
import { drawSprite, markSprite } from '@/gp39/sprites'
import { PLOTTER_RANGES } from '@/gp39/types'
import { useDevice } from '@/stores/device'
import { ui } from '@/gp39/ui/state'
import { centerOnShip, inMap, legPoints, MAP_CX, MAP_CY, plotterProjection, showCursor, zoomPlotter } from '@/gp39/ui/plotter'

const props = defineProps<{ scale: number }>()
const rootEl = ref<HTMLElement | null>(null)

// ---- souris / doigt : clic = curseur, glisser = déplacement de la carte (équivalent du CursorPad)
let drag: { sx: number; sy: number; center: { lat: number; lon: number }; moved: boolean } | null = null

/** Coordonnées de l'évènement dans le repère du LCD (480 × 272). */
function lcdXY(e: PointerEvent): [number, number] {
  const r = rootEl.value!.getBoundingClientRect()
  const k = r.width / LCD_W
  return [(e.clientX - r.left) / k, (e.clientY - r.top) / k]
}

function onDown(e: PointerEvent): void {
  if (ui.stack.length || e.button > 0) return
  const [x, y] = lcdXY(e)
  if (!inMap(x, y)) return
  drag = { sx: x, sy: y, center: { ...ui.center }, moved: false }
  rootEl.value?.setPointerCapture(e.pointerId)
}

function onMove(e: PointerEvent): void {
  if (!drag) return
  const [x, y] = lcdXY(e)
  const dx = x - drag.sx
  const dy = y - drag.sy
  if (!drag.moved && Math.hypot(dx, dy) < 5) return
  drag.moved = true
  ui.center = plotterProjection(drag.center).fromPx(MAP_CX - dx, MAP_CY - dy)
}

function onUp(e: PointerEvent): void {
  if (!drag) return
  const d = drag
  drag = null
  rootEl.value?.releasePointerCapture(e.pointerId)
  if (d.moved) return
  const [x, y] = lcdXY(e)
  const p = plotterProjection().fromPx(x, y)
  const cur = showCursor()
  cur.lat = p.lat
  cur.lon = p.lon
}

let lastWheel = 0
/** Molette : zoom du plotter (portée suivante / précédente). */
function onWheel(e: WheelEvent): void {
  const now = performance.now()
  if (now - lastWheel < 120) return
  lastWheel = now
  zoomPlotter(e.deltaY > 0 ? 1 : -1)
}

const dev = useDevice()
const canvasEl = ref<HTMLCanvasElement | null>(null)
const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1
const px = (n: number): number => Math.max(1, Math.round(n * props.scale * dpr))

// ------------------------------------------------------------ panneau
// le curseur disparaît tout seul au bout de 7 s (voir startUiHousekeeping) : ui.cursor devient null
const cursorOn = computed(() => !!ui.cursor && Date.now() < ui.cursorUntil)

const datumLetter = computed(() => (dev.settings.datum === 'WGS84' ? 'W' : dev.settings.datum === 'WGS72' ? 'T' : 'L'))
const unitsFmt = computed(() => dev.settings.units)
const distUnitLabel = computed(() => distUnit(unitsFmt.value))
const rangeText = computed(() => {
  const r = PLOTTER_RANGES[dev.settings.plotterRange] ?? 0.5
  const v = toDistUnit(r, unitsFmt.value)
  return v < 1 ? v.toFixed(2) : v < 10 ? v.toFixed(v % 1 ? 1 : 2) : v.toFixed(v % 1 ? 1 : 0)
})
const refLetter = computed(() => (dev.settings.cogRef === 'Mag' ? 'M' : 'T'))

const cursorRngBrg = computed(() => {
  if (!ui.cursor) return null
  const c: LatLon = ui.cursor
  return {
    rng: distance(dev.shipPos, c, dev.settings.navigation),
    brg: dev.toDisplayAngle(bearing(dev.shipPos, c, dev.settings.navigation)),
  }
})

const mode = computed<'cursor' | 'dest' | 'cog'>(() => (cursorOn.value && cursorRngBrg.value ? 'cursor' : dev.nav.hasDest ? 'dest' : 'cog'))
const topLabel = computed(() => (mode.value === 'cog' ? 'SOG' : 'RNG'))
const botLabel = computed(() => (mode.value === 'cog' ? 'COG' : 'BRG'))
const topUnit = computed(() => (mode.value === 'cog' ? '(kn)' : `(${distUnit(unitsFmt.value)})`))
const botUnit = computed(() => `${refLetter.value}(°)`)
const topValue = computed(() => {
  if (mode.value === 'cog') return formatSpeed(dev.ship.sog, unitsFmt.value)
  const r = mode.value === 'cursor' ? cursorRngBrg.value!.rng : dev.nav.rng
  return formatRange(r, unitsFmt.value)
})
const botValue = computed(() => {
  if (mode.value === 'cog') return formatAngle(dev.toDisplayAngle(dev.ship.cog))
  return formatAngle(mode.value === 'cursor' ? cursorRngBrg.value!.brg : dev.toDisplayAngle(dev.nav.brgTrue))
})

const showPos = computed<LatLon>(() => (cursorOn.value && ui.cursor ? ui.cursor : dev.shipPos))
const latText = computed(() => formatCoord(showPos.value.lat, true, dev.settings.posFormat))
const lonText = computed(() => formatCoord(showPos.value.lon, false, dev.settings.posFormat))

// ------------------------------------------------------------ dessin de la carte
let raf = 0
function schedule(): void {
  if (raf) return
  raf = requestAnimationFrame(() => {
    raf = 0
    draw()
  })
}

/** Dépendances réactives qui déclenchent un nouveau dessin. */
watch(
  () => [
    props.scale,
    ui.center.lat,
    ui.center.lon,
    ui.cursor?.lat,
    ui.cursor?.lon,
    ui.cursorUntil,
    ui.moving?.id,
    dev.settings.plotterRange,
    dev.settings.wptName,
    dev.settings.cogLine,
    dev.settings.trackShow,
    dev.ship.lat,
    dev.ship.lon,
    dev.ship.cog,
    dev.wptVersion,
    dev.trackVersion,
    dev.dest,
    dev.mob?.lat,
    dev.settings.posFormat,
  ],
  schedule,
  { deep: true },
)
onMounted(schedule)
onBeforeUnmount(() => cancelAnimationFrame(raf))

/** Quand le bateau sort de la carte, il revient au centre de l'écran (manuel §2.3). */
watch(
  () => [dev.ship.lat, dev.ship.lon],
  () => {
    if (ui.moving || (ui.cursor && Date.now() < ui.cursorUntil)) return
    const [x, y] = plotterProjection().toPx(dev.ship.lat, dev.ship.lon)
    if (!inMap(x, y, 6)) centerOnShip()
  },
)

function roundRectPath(c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  c.beginPath()
  c.moveTo(x + r, y)
  c.arcTo(x + w, y, x + w, y + h, r)
  c.arcTo(x + w, y + h, x, y + h, r)
  c.arcTo(x, y + h, x, y, r)
  c.arcTo(x, y, x + w, y, r)
  c.closePath()
}

function draw(): void {
  const cv = canvasEl.value
  if (!cv) return
  const ctx = cv.getContext('2d')
  if (!ctx) return
  const s = props.scale * dpr
  ctx.setTransform(s, 0, 0, s, 0, 0)
  ctx.clearRect(0, 0, LCD_W, LCD_H)

  const { mapX, mapY, mapW, mapH } = PLOTTER
  const mer = plotterProjection()

  // cadre + fond de la carte
  ctx.save()
  roundRectPath(ctx, mapX, mapY, mapW, mapH, 5)
  ctx.fillStyle = '#ffffff'
  ctx.fill()
  ctx.lineWidth = 1.6
  ctx.strokeStyle = '#7c8591'
  ctx.stroke()
  roundRectPath(ctx, mapX + 0.5, mapY + 0.5, mapW - 1, mapH - 1, 5)
  ctx.clip()

  const pxPerNm = mapW / (PLOTTER_RANGES[dev.settings.plotterRange] ?? 0.5)
  const tl = mer.fromPx(mapX, mapY)
  const br = mer.fromPx(mapX + mapW, mapY + mapH)

  // ---- graticule
  const lat0 = ui.center.lat
  const cosLat = Math.cos((lat0 * Math.PI) / 180)
  const latStep = gridStepMin(1 / pxPerNm, 46) / 60
  const lonStep = gridStepMin(1 / (pxPerNm * cosLat), 108) / 60
  const decimals = latStep * 60 >= 1 ? 0 : latStep * 60 >= 0.005 ? 3 : 4
  ctx.save()
  ctx.strokeStyle = '#6f6f6f'
  ctx.lineWidth = 1
  ctx.setLineDash([3, 3])
  ctx.fillStyle = '#303030'
  ctx.font = '8px Arial, Helvetica, sans-serif'
  ctx.textBaseline = 'bottom'
  for (let k = Math.ceil(br.lat / latStep); k * latStep <= tl.lat; k++) {
    const lat = k * latStep
    const [, y] = mer.toPx(lat, ui.center.lon)
    if (y < mapY || y > mapY + mapH) continue
    ctx.beginPath()
    ctx.moveTo(mapX, Math.round(y) + 0.5)
    ctx.lineTo(mapX + mapW, Math.round(y) + 0.5)
    ctx.stroke()
    ctx.textAlign = 'right'
    ctx.fillText(gridLabel(lat, true, decimals), mapX + mapW - 4, y - 2)
  }
  const lonDecimals = lonStep * 60 >= 1 ? 0 : lonStep * 60 >= 0.005 ? 3 : 4
  for (let k = Math.ceil(tl.lon / lonStep); k * lonStep <= br.lon; k++) {
    const lon = k * lonStep
    const [x] = mer.toPx(ui.center.lat, lon)
    if (x < mapX || x > mapX + mapW) continue
    ctx.beginPath()
    ctx.moveTo(Math.round(x) + 0.5, mapY)
    ctx.lineTo(Math.round(x) + 0.5, mapY + mapH)
    ctx.stroke()
    ctx.textAlign = 'left'
    ctx.fillText(gridLabel(lon, false, lonDecimals), x + 3, mapY + mapH - 2)
  }
  ctx.restore()

  // ---- trace
  if (dev.settings.trackShow && dev.track.length > 1) {
    ctx.lineWidth = 1.6
    ctx.lineJoin = 'round'
    let prevColor = -1
    let open = false
    let prevX = 0
    let prevY = 0
    for (let i = 0; i < dev.track.length; i++) {
      const p = dev.track[i]!
      const [x, y] = mer.toPx(p.lat, p.lon)
      if (!open || p.gap || p.color !== prevColor) {
        if (open) ctx.stroke()
        ctx.beginPath()
        ctx.strokeStyle = COLORS[p.color] ?? COLORS[6]
        // changement de couleur sans coupure : le nouveau tronçon part du point précédent pour rester continu
        if (open && !p.gap) {
          ctx.moveTo(prevX, prevY)
          ctx.lineTo(x, y)
        } else ctx.moveTo(x, y)
        prevColor = p.color
        open = true
      } else ctx.lineTo(x, y)
      prevX = x
      prevY = y
    }
    if (open) ctx.stroke()
  }

  // ---- route (tronçons) et destination
  const shipPx = mer.toPx(dev.ship.lat, dev.ship.lon)
  const route = legPoints()
  if (route.length > 1) {
    ctx.strokeStyle = '#2540c8'
    ctx.lineWidth = 1.5
    ctx.beginPath()
    route.forEach((p, i) => {
      const [x, y] = mer.toPx(p.lat, p.lon)
      if (i === 0) ctx.moveTo(x, y)
      else ctx.lineTo(x, y)
    })
    ctx.stroke()
  }
  const t = dev.destTarget
  if (t) {
    const [dx, dy] = mer.toPx(t.pos.lat, t.pos.lon)
    ctx.strokeStyle = '#1740e0'
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.moveTo(shipPx[0], shipPx[1])
    ctx.lineTo(dx, dy)
    ctx.stroke()
    // chevrons de direction
    const L = Math.hypot(dx - shipPx[0], dy - shipPx[1])
    if (L > 24) {
      const ang = Math.atan2(dy - shipPx[1], dx - shipPx[0])
      ctx.lineWidth = 1.4
      for (let d = 14; d < L - 6; d += 18) {
        const cx = shipPx[0] + Math.cos(ang) * d
        const cy = shipPx[1] + Math.sin(ang) * d
        ctx.beginPath()
        ctx.moveTo(cx - Math.cos(ang - 0.6) * 6, cy - Math.sin(ang - 0.6) * 6)
        ctx.lineTo(cx, cy)
        ctx.lineTo(cx - Math.cos(ang + 0.6) * 6, cy - Math.sin(ang + 0.6) * 6)
        ctx.stroke()
      }
    }
  }

  // ---- waypoints
  const mode = dev.settings.wptName
  const showName = (id: number): boolean => {
    if (mode === 'Disp All') return true
    const d = dev.dest
    if (d && (d.kind === 'waypoint' || d.kind === 'qp') && d.wptId === id) return true
    if (mode === 'Disp Goto') return d?.kind === 'route' && d.wptId === id
    return mode === 'Disp Route' && dev.routeWaypointIds.has(id)
  }
  ctx.font = 'bold 9px Arial, Helvetica, sans-serif'
  ctx.textBaseline = 'middle'
  ctx.textAlign = 'left'
  ctx.lineJoin = 'round'
  const x0 = mapX - 10
  const x1 = mapX + mapW + 10
  const y0 = mapY - 10
  const y1 = mapY + mapH + 10
  // pictogrammes pré-rendus (drawImage) : 10 000 waypoints restent fluides
  const sprites: (HTMLCanvasElement | undefined)[] = []
  for (const w of dev.waypoints) {
    if (!w.display) continue
    const [x, y] = mer.toPx(w.lat, w.lon)
    if (x < x0 || x > x1 || y < y0 || y > y1) continue
    const k = w.symbol * 7 + w.color
    drawSprite(ctx, (sprites[k] ??= markSprite(w.symbol, w.color, 11 * s)), x, y, s)
    if (w.name && showName(w.id)) {
      ctx.lineWidth = 3
      ctx.strokeStyle = '#fff'
      ctx.strokeText(w.name, x + 8, y - 1)
      ctx.fillStyle = '#000'
      ctx.fillText(w.name, x + 8, y - 1)
    }
  }

  // waypoint en cours de déplacement (fantôme)
  if (ui.moving && ui.cursor) {
    const w = dev.wptById.get(ui.moving.id)
    if (w) {
      const [x, y] = mer.toPx(ui.cursor.lat, ui.cursor.lon)
      ctx.globalAlpha = 0.6
      drawMark(ctx, w.symbol, w.color, x, y, 13)
      ctx.globalAlpha = 1
    }
  }

  // ---- MOB
  if (dev.mob) {
    const [mx, my] = mer.toPx(dev.mob.lat, dev.mob.lon)
    ctx.fillStyle = COLORS[0]
    ctx.font = 'bold 14px Arial, Helvetica, sans-serif'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText('M', mx, my)
    ctx.fillStyle = '#000'
    ctx.fillRect(mx - 11, my - 19, 22, 9)
    ctx.fillStyle = '#fff'
    ctx.font = 'bold 8px Arial, Helvetica, sans-serif'
    ctx.fillText('MOB', mx, my - 14.5)
  }

  // ---- ligne de route fond (COG) et bateau
  const cogRad = (dev.ship.cog * Math.PI) / 180
  if (dev.settings.cogLine && dev.ship.hasCog) {
    ctx.strokeStyle = '#111'
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(shipPx[0], shipPx[1])
    ctx.lineTo(shipPx[0] + Math.sin(cogRad) * 500, shipPx[1] - Math.cos(cogRad) * 500)
    ctx.stroke()
  }
  ctx.save()
  ctx.translate(shipPx[0], shipPx[1])
  ctx.rotate(cogRad)
  ctx.beginPath()
  ctx.moveTo(0, -10)
  ctx.lineTo(6, 8)
  ctx.lineTo(0, 4)
  ctx.lineTo(-6, 8)
  ctx.closePath()
  ctx.fillStyle = '#0a0a0a'
  ctx.fill()
  ctx.restore()

  // ---- curseur
  if (ui.cursor && Date.now() < ui.cursorUntil && !ui.moving) {
    const [cx, cy] = mer.toPx(ui.cursor.lat, ui.cursor.lon)
    ctx.strokeStyle = '#000'
    ctx.lineWidth = 2.4
    ctx.beginPath()
    ctx.moveTo(cx - 7, cy)
    ctx.lineTo(cx + 7, cy)
    ctx.moveTo(cx, cy - 7)
    ctx.lineTo(cx, cy + 7)
    ctx.stroke()
  }
  ctx.restore()
}
</script>

<style scoped lang="scss">
.plotter {
  position: absolute;
  inset: 0;
  touch-action: none;
  font-family: 'Roboto Condensed', 'Arial Narrow', Arial, sans-serif;
  color: #1b1b1b;
}
.plotter-canvas {
  position: absolute;
  left: 0;
  top: 0;
  width: 480px;
  height: 272px;
}
.panel {
  position: absolute;
  left: 0;
  top: 0;
  width: 112px;
  height: 236px;
}
.row {
  height: 28px;
  display: flex;
  align-items: baseline;
  padding: 3px 4px 0 6px;
  font-weight: 700;
  font-size: 24px;
  line-height: 24px;
  white-space: nowrap;
}
.row.top .datum {
  margin-left: 12px;
}
.row.range {
  font-size: 22px;
  border-bottom: 1px solid #c9ccd1;
  height: 30px;
  align-items: flex-end;
  padding-bottom: 3px;
}
.row.range .br {
  font-size: 30px;
  font-weight: 400;
  margin-top: -4px;
}
.row.range .rv {
  margin-left: 1px;
}
.row.range .ru {
  font-size: 13px;
  margin: 0 1px 2px 3px;
}
.data {
  height: 82px;
  border-bottom: 1px solid #c9ccd1;
  padding: 4px 6px 0 6px;
  position: relative;
}
.data:last-child {
  border-bottom: 0;
}
.lbl {
  font-size: 11px;
  font-weight: 700;
  line-height: 12px;
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  b {
    font-weight: 700;
    letter-spacing: 0.3px;
  }
  i {
    font-style: normal;
    font-size: 13px;
    margin-right: auto;
    margin-left: 1px;
  }
  u {
    text-decoration: none;
    font-size: 10px;
    font-weight: 600;
  }
}
.val {
  font-size: 54px;
  font-weight: 700;
  line-height: 56px;
  text-align: right;
  letter-spacing: -1px;
}
.strip {
  position: absolute;
  left: 4px;
  right: 6px;
  top: 238px;
  height: 34px;
  display: flex;
  align-items: center;
  gap: 18px;
  font-weight: 700;
  font-size: 28px;
  white-space: nowrap;
  .plus {
    font-size: 24px;
    width: 14px;
    text-align: center;
  }
  .pos {
    flex: 1;
    text-align: center;
  }
}
.destname {
  position: absolute;
  left: 124px;
  top: 6px;
  font-size: 11px;
  font-weight: 700;
  background: rgba(255, 255, 255, 0.85);
  padding: 0 2px;
}
</style>
