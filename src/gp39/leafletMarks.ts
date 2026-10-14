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

export class WaypointCanvasLayer extends L.Layer {
  private map: L.Map | null = null
  private canvas: HTMLCanvasElement | null = null
  private placed: Placed[] = []
  private tip: L.Tooltip | null = null
  private lastHover = 0
  private padX = 0
  private padY = 0

  constructor(private readonly source: () => readonly Waypoint[]) {
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
    for (const wpt of this.source()) {
      if (!wpt.display || !bounds.contains([wpt.lat, wpt.lon])) continue
      const p = map.latLngToContainerPoint([wpt.lat, wpt.lon])
      const x = p.x + this.padX
      const y = p.y + this.padY
      const k = wpt.symbol * 7 + wpt.color
      drawSprite(ctx, (sprites[k] ??= markSprite(wpt.symbol, wpt.color, sizePx * dpr, true)), x, y, dpr)
      placed.push({ x: p.x, y: p.y, w: wpt })
    }
    this.placed = placed
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
    const html = waypointTooltip(best.w)
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
