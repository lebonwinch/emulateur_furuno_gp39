// Géométrie et interactions du plotter (portée, projection, curseur, sélection d'objets).

import { Mercator, type LatLon } from '@/gp39/geo'
import { PLOTTER } from '@/gp39/layout'
import { PLOTTER_RANGES } from '@/gp39/types'
import { useDevice } from '@/stores/device'
import { ui } from './state'

export const MAP_CX = PLOTTER.mapX + PLOTTER.mapW / 2
export const MAP_CY = PLOTTER.mapY + PLOTTER.mapH / 2

export const plotterRangeNm = (): number => PLOTTER_RANGES[useDevice().settings.plotterRange] ?? 0.5

/** Pixels (LCD) par NM : la portée horizontale correspond à la largeur de la carte. */
export const plotterPxPerNm = (): number => PLOTTER.mapW / plotterRangeNm()

export function plotterProjection(center: LatLon = ui.center): Mercator {
  return new Mercator(center, plotterPxPerNm(), MAP_CX, MAP_CY)
}

export function inMap(x: number, y: number, margin = 0): boolean {
  return (
    x >= PLOTTER.mapX + margin &&
    x <= PLOTTER.mapX + PLOTTER.mapW - margin &&
    y >= PLOTTER.mapY + margin &&
    y <= PLOTTER.mapY + PLOTTER.mapH - margin
  )
}

/**
 * Le bateau vient-il de sortir de la carte en avançant ? Alors il revient au centre de l'écran (manuel §2.3). S'il était déjà hors de la
 * carte parce qu'on l'a fait défiler (vers une cible de GO TO, par exemple), la carte reste où elle est : sinon, avec un GPS qui donne une
 * position chaque seconde, elle reviendrait sur le bateau avant qu'on ait pu placer le curseur.
 */
export function shipJustLeftMap(from: LatLon, to: LatLon): boolean {
  const mer = plotterProjection()
  const [x, y] = mer.toPx(to.lat, to.lon)
  if (inMap(x, y, 6)) return false
  const [fx, fy] = mer.toPx(from.lat, from.lon)
  return inMap(fx, fy, 6)
}

export function centerOnShip(): void {
  const dev = useDevice()
  ui.center = { lat: dev.ship.lat, lon: dev.ship.lon }
}

/** Zoom du plotter : delta > 0 = plus large (portée suivante). */
export function zoomPlotter(delta: number): void {
  const dev = useDevice()
  const i = Math.max(0, Math.min(PLOTTER_RANGES.length - 1, dev.settings.plotterRange + delta))
  dev.settings.plotterRange = i
}

/** Fait apparaître le curseur (7 s) ; s'il n'existe pas encore, il part de la position du bateau. */
export function showCursor(): LatLon {
  const dev = useDevice()
  if (!ui.cursor) ui.cursor = { lat: dev.ship.lat, lon: dev.ship.lon }
  ui.cursorUntil = Date.now() + 7000
  return ui.cursor
}

const DIRS: Record<string, [number, number]> = {
  up: [0, -1],
  down: [0, 1],
  left: [-1, 0],
  right: [1, 0],
  upleft: [-1, -1],
  upright: [1, -1],
  downleft: [-1, 1],
  downright: [1, 1],
}

/** Déplace le curseur ; au bord de la carte, c'est la carte qui défile (manuel §2.3). */
export function moveCursor(dir: string, repeat = 0): void {
  const d = DIRS[dir]
  if (!d) return
  const step = 5 + Math.min(repeat, 24) * 1.5
  const hadCursor = !!ui.cursor && Date.now() < ui.cursorUntil
  if (!hadCursor && !ui.moving) {
    // premier appui : le curseur apparaît sans bouger
    showCursor()
    return
  }
  const cur = showCursor()
  const mer = plotterProjection()
  const [cx, cy] = mer.toPx(cur.lat, cur.lon)
  const tx = cx + d[0] * step
  const ty = cy + d[1] * step
  const m = 6
  const minX = PLOTTER.mapX + m
  const maxX = PLOTTER.mapX + PLOTTER.mapW - m
  const minY = PLOTTER.mapY + m
  const maxY = PLOTTER.mapY + PLOTTER.mapH - m
  let ox = 0
  let oy = 0
  if (tx < minX) ox = tx - minX
  else if (tx > maxX) ox = tx - maxX
  if (ty < minY) oy = ty - minY
  else if (ty > maxY) oy = ty - maxY
  // le curseur avance de `step` ; s'il dépasse le bord, la carte défile de l'excédent
  ui.cursor = mer.fromPx(tx, ty)
  if (ox || oy) ui.center = mer.fromPx(MAP_CX + ox, MAP_CY + oy)
}

export type Picked = { type: 'wpt'; id: number } | { type: 'ship' } | { type: 'mob' } | { type: 'leg' } | null

/** Objet situé sous le curseur (rayon de 9 px). */
export function pickAtCursor(): Picked {
  const dev = useDevice()
  if (!ui.cursor) return null
  const mer = plotterProjection()
  const [cx, cy] = mer.toPx(ui.cursor.lat, ui.cursor.lon)
  const R2 = 9 * 9
  let best: number | null = null
  let bestD = R2
  for (const w of dev.waypoints) {
    if (!w.display) continue
    const [x, y] = mer.toPx(w.lat, w.lon)
    const dd = (x - cx) ** 2 + (y - cy) ** 2
    if (dd <= bestD) {
      bestD = dd
      best = w.id
    }
  }
  if (best != null) return { type: 'wpt', id: best }
  const [sx, sy] = mer.toPx(dev.ship.lat, dev.ship.lon)
  if ((sx - cx) ** 2 + (sy - cy) ** 2 <= 12 * 12) return { type: 'ship' }
  if (dev.mob) {
    const [mx, my] = mer.toPx(dev.mob.lat, dev.mob.lon)
    if ((mx - cx) ** 2 + (my - cy) ** 2 <= 12 * 12) return { type: 'mob' }
  }
  if (dev.dest?.kind === 'route') {
    const pts = legPoints()
    for (let i = 0; i + 1 < pts.length; i++) {
      const a = mer.toPx(pts[i]!.lat, pts[i]!.lon)
      const b = mer.toPx(pts[i + 1]!.lat, pts[i + 1]!.lon)
      if (distToSeg(cx, cy, a[0], a[1], b[0], b[1]) < 6) return { type: 'leg' }
    }
  }
  return null
}

/** Points de la route en cours de navigation (dans l'ordre de parcours). */
export function legPoints(): LatLon[] {
  const dev = useDevice()
  const d = dev.dest
  if (!d || d.kind !== 'route' || d.routeNo == null) return []
  const r = dev.routeByNo(d.routeNo)
  if (!r) return []
  return dev
    .routeSequence(r, d.direction ?? 'Forward')
    .map((id) => dev.wptById.get(id))
    .filter((w): w is NonNullable<typeof w> => !!w)
    .map((w) => ({ lat: w.lat, lon: w.lon }))
}

function distToSeg(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax
  const dy = by - ay
  const l2 = dx * dx + dy * dy
  let t = l2 ? ((px - ax) * dx + (py - ay) * dy) / l2 : 0
  t = Math.max(0, Math.min(1, t))
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy))
}

/** Position à l'écran (px LCD) d'un point géographique. */
export function pxOf(p: LatLon): [number, number] {
  return plotterProjection().toPx(p.lat, p.lon)
}
