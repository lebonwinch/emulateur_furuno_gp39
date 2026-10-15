// Couche Leaflet qui dessine les waypoints avec leurs vrais pictogrammes GP-39 (GP39Symbol) et leurs couleurs (FECColor),
// au lieu de simples ronds colorés.

import L from 'leaflet'
import { waypointTooltip } from './symbols'
import { drawSprite, markSprite } from './sprites'
import type { Waypoint } from './types'

interface Placed {
  x: number
  y: number
  w: Waypoint
}

/** Taille (px CSS) des pictogrammes selon le zoom de la carte. */
function markSize(zoom: number): number {
  return zoom >= 15 ? 22 : zoom >= 13 ? 18 : zoom >= 11 ? 14 : zoom >= 9 ? 11 : 9
}

export interface WaypointLayerOptions {
  /** waypoints sélectionnés : entourés d'un anneau orange (éditeur) */
  selected?: () => ReadonlySet<number>
  /** dessine aussi les waypoints dont GP39Flag vaut 0 (pâles) : l'éditeur doit pouvoir les voir et les modifier */
  showHidden?: boolean
  /** HTML ajouté à l'info-bulle (ex. nom du calque) ; déjà échappé */
  extra?: (w: Waypoint) => string
}

export class WaypointCanvasLayer extends L.Layer {
  private map: L.Map | null = null
  private canvas: HTMLCanvasElement | null = null
  private placed: Placed[] = []
  private tip: L.Tooltip | null = null
  private lastHover = 0
  private padX = 0
  private padY = 0

  constructor(
    private readonly source: () => readonly Waypoint[],
    private readonly cfg: WaypointLayerOptions = {},
  ) {
    super()
  }

  override onAdd(map: L.Map): this {
    this.map = map
    const canvas = L.DomUtil.create('canvas', 'gp39-wpt-canvas') as HTMLCanvasElement
    canvas.style.position = 'absolute'
    canvas.style.pointerEvents = 'none'
    canvas.style.zIndex = '350'
    map.getPane('overlayPane')?.appendChild(canvas)
    this.canvas = canvas
    map.on('mousemove', this.onMove)
    map.on('mouseout', this.hideTip)
    this.redraw()
    return this
  }

  override onRemove(map: L.Map): this {
    map.off('mousemove', this.onMove)
    map.off('mouseout', this.hideTip)
    this.hideTip()
    this.canvas?.remove()
    this.canvas = null
    this.map = null
    return this
  }

  override getEvents(): { [name: string]: L.LeafletEventHandlerFn } {
    return { moveend: this.redraw, zoomend: this.redraw, resize: this.redraw }
  }

  /** Redessine toute la couche (changement de vue ou de données). */
  redraw = (): void => {
    const map = this.map
    const canvas = this.canvas
    if (!map || !canvas) return
    const size = map.getSize()
    // marge d'un demi-écran de chaque côté : pas de bord vide pendant un déplacement de la carte
    this.padX = Math.round(size.x / 2)
    this.padY = Math.round(size.y / 2)
    const w = size.x + this.padX * 2
    const h = size.y + this.padY * 2
    const dpr = window.devicePixelRatio || 1
    canvas.width = Math.round(w * dpr)
    canvas.height = Math.round(h * dpr)
    canvas.style.width = `${w}px`
    canvas.style.height = `${h}px`
    L.DomUtil.setPosition(canvas, map.containerPointToLayerPoint([-this.padX, -this.padY]))
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, w, h)

    const bounds = map.getBounds().pad(0.6)
    const sizePx = markSize(map.getZoom())
    const sprites: (HTMLCanvasElement | undefined)[] = []
    const placed: Placed[] = []
    const selected = this.cfg.selected?.()
    for (const wpt of this.source()) {
      if ((!wpt.display && !this.cfg.showHidden) || !bounds.contains([wpt.lat, wpt.lon])) continue
      const p = map.latLngToContainerPoint([wpt.lat, wpt.lon])
      const x = p.x + this.padX
      const y = p.y + this.padY
      const k = wpt.symbol * 7 + wpt.color
      // un waypoint non affiché sur le plotter (GP39Flag 0) est pâle dans l'éditeur
      ctx.globalAlpha = wpt.display ? 1 : 0.4
      drawSprite(ctx, (sprites[k] ??= markSprite(wpt.symbol, wpt.color, sizePx * dpr, true)), x, y, dpr)
      ctx.globalAlpha = 1
      if (selected?.has(wpt.id)) {
        const r = sizePx * 0.9 + 3
        ctx.beginPath()
        ctx.arc(x, y, r + 1.5, 0, Math.PI * 2)
        ctx.lineWidth = 4.5
        ctx.strokeStyle = 'rgba(255,255,255,0.95)'
        ctx.stroke()
        ctx.beginPath()
        ctx.arc(x, y, r + 1.5, 0, Math.PI * 2)
        ctx.lineWidth = 2.5
        ctx.strokeStyle = '#ff6d00'
        ctx.stroke()
      }
      placed.push({ x: p.x, y: p.y, w: wpt })
    }
    this.placed = placed
  }

  /** Waypoint dessiné le plus proche d'un point de la carte (px du conteneur), à `tolerance` px au plus. */
  pick(point: L.Point, tolerance = 10): Waypoint | null {
    let best: Placed | null = null
    let bestD = (tolerance + 1) * (tolerance + 1)
    for (const p of this.placed) {
      const d = (p.x - point.x) ** 2 + (p.y - point.y) ** 2
      if (d <= bestD) {
        bestD = d
        best = p
      }
    }
    return best?.w ?? null
  }

  private hideTip = (): void => {
    if (this.tip && this.map) this.map.removeLayer(this.tip)
    this.tip = null
  }

  /** Survol : info-bulle du waypoint le plus proche (≤ 10 px). */
  private onMove = (e: L.LeafletMouseEvent): void => {
    const now = performance.now()
    if (now - this.lastHover < 60 || !this.map) return
    this.lastHover = now
    let best: Placed | null = null
    let bestD = 11 * 11
    for (const p of this.placed) {
      const d = (p.x - e.containerPoint.x) ** 2 + (p.y - e.containerPoint.y) ** 2
      if (d <= bestD) {
        bestD = d
        best = p
      }
    }
    if (!best) return this.hideTip()
    const ll = L.latLng(best.w.lat, best.w.lon)
    const html = waypointTooltip(best.w) + (this.cfg.extra?.(best.w) ?? '')
    if (this.tip) this.tip.setLatLng(ll).setContent(html)
    else {
      // position et contenu doivent être fixés AVANT l'ajout à la carte (Leaflet calcule la position à l'ajout)
      this.tip = L.tooltip({ direction: 'top', offset: [0, -8], opacity: 0.95 })
        .setLatLng(ll)
        .setContent(html)
      this.tip.addTo(this.map)
    }
  }
}
