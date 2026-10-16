// Couche Leaflet des cartes BSB : une tuile = un canevas rempli par le moteur (Workers), annulée si la tuile quitte l'écran.

import L from 'leaflet'
import type { BsbEngine } from './engine'
import { TILE } from './tiles'

export const BSB_ATTRIBUTION = 'Cartes marines BSB (dossier local de l’utilisateur) — non destinées à la navigation'

class BsbGridLayer extends L.GridLayer {
  private aborters = new WeakMap<HTMLElement, AbortController>()

  constructor(
    private readonly engine: BsbEngine,
    options: L.GridLayerOptions,
  ) {
    super(options)
    this.on('tileunload', (e: L.TileEvent) => this.aborters.get(e.tile)?.abort())
  }

  protected override createTile(coords: L.Coords, done: L.DoneCallback): HTMLElement {
    const tile = document.createElement('canvas')
    tile.width = TILE
    tile.height = TILE
    const n = 2 ** coords.z
    if (coords.y < 0 || coords.y >= n) {
      // hors du monde (au-delà des pôles) : tuile vide
      queueMicrotask(() => done(undefined, tile))
      return tile
    }
    const ac = new AbortController()
    this.aborters.set(tile, ac)
    const paint = async (): Promise<void> => {
      try {
        // x ramené dans [0, 2^z[ (la carte peut se répéter horizontalement)
        const r = await this.engine.renderTile(coords.z, ((coords.x % n) + n) % n, coords.y, ac.signal)
        if (r.pixels) {
          const rgba = new Uint8ClampedArray(r.pixels.buffer as ArrayBuffer)
          tile.getContext('2d')?.putImageData(new ImageData(rgba, TILE, TILE), 0, 0)
        }
        done(undefined, tile)
      } catch (e) {
        if (e instanceof DOMException && e.name === 'AbortError') return // tuile quittée avant d'être prête : rien à signaler
        done(e instanceof Error ? e : new Error(String(e)), tile)
      }
    }
    void paint()
    return tile
  }
}

/** Couche des cartes du moteur ; transparente là où aucune carte ne couvre la zone. */
export function createBsbLayer(engine: BsbEngine, options: { zIndex?: number; minZoom?: number; maxZoom?: number } = {}): L.GridLayer {
  return new BsbGridLayer(engine, {
    tileSize: TILE,
    attribution: BSB_ATTRIBUTION,
    minZoom: options.minZoom ?? 5,
    maxZoom: options.maxZoom ?? 19,
    // tuiles coûteuses : on ne recharge qu'à la fin d'un déplacement/zoom, avec une petite marge autour de l'écran
    updateWhenIdle: true,
    updateWhenZooming: false,
    keepBuffer: 2,
    ...(options.zIndex !== undefined ? { zIndex: options.zIndex } : {}),
  })
}
