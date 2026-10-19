// Couche Leaflet du dossier de cartes : une tuile = un canevas rempli par les moteurs de chaque format présent (Workers), annulée si la
// tuile quitte l'écran. Si le dossier contient plusieurs formats (BSB raster, MBTiles raster, CM93 vectoriel), la tuile les superpose :
// à chaque emplacement, la source la plus lisible est au-dessus (voir `tileCompose`).

import L from 'leaflet'
import { CHARTS_MIN_ZOOM_RASTER } from './basemaps'
import type { BsbEngine } from './bsb/engine'
import { TILE } from './bsb/tiles'
import type { Cm93Engine } from './cm93/engine'
import type { MbtilesEngine } from './mbtiles/engine'
import { mbtilesRank } from './mbtiles/plan'
import { CM93_RANK, bsbRank, stackOrder, type TilePart } from './tileCompose'

export const BSB_ATTRIBUTION = 'Cartes marines BSB (dossier local de l’utilisateur) — non destinées à la navigation'
export const CM93_ATTRIBUTION = 'Cartes marines CM93 (dossier local de l’utilisateur) — non destinées à la navigation'

export interface ChartEngines {
  bsb: BsbEngine | null
  cm93: Cm93Engine | null
  mbtiles: MbtilesEngine | null
}

const aborted = (e: unknown): boolean => e instanceof DOMException && e.name === 'AbortError'

function pixelCanvas(pixels: Uint32Array, size: number): HTMLCanvasElement {
  const c = document.createElement('canvas')
  c.width = size
  c.height = size
  c.getContext('2d')?.putImageData(new ImageData(new Uint8ClampedArray(pixels.buffer as ArrayBuffer), size, size), 0, 0)
  return c
}

class ChartsGridLayer extends L.GridLayer {
  private aborters = new WeakMap<HTMLElement, AbortController>()

  constructor(
    private readonly engines: ChartEngines,
    private readonly ratio: number,
    options: L.GridLayerOptions,
  ) {
    super(options)
    this.on('tileunload', (e: L.TileEvent) => this.aborters.get(e.tile)?.abort())
  }

  protected override createTile(coords: L.Coords, done: L.DoneCallback): HTMLElement {
    const size = TILE * this.ratio
    const tile = document.createElement('canvas')
    tile.width = size
    tile.height = size
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
        const x = ((coords.x % n) + n) % n
        const { bsb, cm93, mbtiles } = this.engines
        // une carte raster BSB aux petits zooms couvrirait des milliers de milles : son moteur n'est interrogé que dès le zoom 5
        const [b, m, c] = await Promise.allSettled([
          bsb && coords.z >= CHARTS_MIN_ZOOM_RASTER ? bsb.renderTile(coords.z, x, coords.y, ac.signal) : undefined,
          mbtiles?.renderTile(coords.z, x, coords.y, ac.signal),
          cm93?.renderTile(coords.z, x, coords.y, ac.signal),
        ])
        // un format qui échoue (fichier illisible) ne prive pas la tuile des autres ; l'erreur n'est rapportée que si tout a échoué
        const settled = [b, m, c]
        const failed = settled.filter((r): r is PromiseRejectedResult => r.status === 'rejected')
        if (failed.some((r) => aborted(r.reason))) return
        const parts: TilePart[] = []
        if (b.status === 'fulfilled' && b.value?.pixels) parts.push({ pixels: b.value.pixels, size: TILE, rank: bsbRank(b.value.best) })
        if (m.status === 'fulfilled' && m.value?.pixels)
          parts.push({ pixels: m.value.pixels, size: m.value.size, rank: mbtilesRank(m.value.best ?? 0) })
        if (c.status === 'fulfilled' && c.value?.pixels) parts.push({ pixels: c.value.pixels, size: c.value.size, rank: CM93_RANK })
        if (failed.length && !parts.length) throw failed[0]!.reason
        this.compose(tile, size, parts)
        done(undefined, tile)
      } catch (e) {
        if (aborted(e)) return // tuile quittée avant d'être prête : rien à signaler
        done(e instanceof Error ? e : new Error(String(e)), tile)
      }
    }
    void paint()
    return tile
  }

  private compose(tile: HTMLCanvasElement, size: number, parts: TilePart[]): void {
    const ctx = tile.getContext('2d')
    if (!ctx || !parts.length) return
    const only = parts.length === 1 ? parts[0]! : null
    if (only && only.size === size) {
      ctx.putImageData(new ImageData(new Uint8ClampedArray(only.pixels.buffer as ArrayBuffer), size, size), 0, 0)
      return
    }
    for (const p of stackOrder(parts)) ctx.drawImage(pixelCanvas(p.pixels, p.size), 0, 0, size, size)
  }
}

/** Pixels de canevas par pixel CSS pour le dessin vectoriel : 2 sur écran Retina, sinon 1. */
export const chartsPixelRatio = (): number => (typeof window !== 'undefined' && window.devicePixelRatio >= 1.5 ? 2 : 1)

/** Couche des cartes du dossier ; transparente là où aucune carte ne couvre la zone. `attribution` : sources des fichiers MBTiles. */
export function createChartsLayer(
  engines: ChartEngines,
  options: { zIndex?: number; minZoom?: number; maxZoom?: number; mbtilesAttribution?: string } = {},
): L.GridLayer {
  const attribution = [
    engines.bsb ? BSB_ATTRIBUTION : '',
    engines.cm93 ? CM93_ATTRIBUTION : '',
    engines.mbtiles ? (options.mbtilesAttribution ?? '') : '',
  ]
    .filter(Boolean)
    .join(' · ')
  return new ChartsGridLayer(engines, engines.cm93 || engines.mbtiles ? chartsPixelRatio() : 1, {
    tileSize: TILE,
    attribution,
    minZoom: options.minZoom ?? 5,
    maxZoom: options.maxZoom ?? 19,
    // tuiles coûteuses : on ne recharge qu'à la fin d'un déplacement/zoom, avec une petite marge autour de l'écran
    updateWhenIdle: true,
    updateWhenZooming: false,
    keepBuffer: 2,
    ...(options.zIndex !== undefined ? { zIndex: options.zIndex } : {}),
  })
}
