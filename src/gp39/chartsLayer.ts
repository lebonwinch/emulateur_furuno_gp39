// Couche Leaflet du dossier de cartes : une tuile = un canevas rempli par les moteurs de chaque format présent (Workers), annulée si la
// tuile quitte l'écran. Si le dossier contient des cartes BSB (raster) et CM93 (vectoriel), la tuile les superpose : les BSB au-dessus
// tant qu'une carte BSB est à une échelle lisible, sinon le CM93 (qui, lui, choisit toujours son échelle d'après le zoom).

import L from 'leaflet'
import type { BsbEngine } from './bsb/engine'
import type { TileResult } from './bsb/runner'
import { TILE } from './bsb/tiles'
import { CHARTS_MIN_ZOOM_RASTER } from './basemaps'
import type { Cm93Engine } from './cm93/engine'
import type { Cm93Result } from './cm93/tile'

export const BSB_ATTRIBUTION = 'Cartes marines BSB (dossier local de l’utilisateur) — non destinées à la navigation'
export const CM93_ATTRIBUTION = 'Cartes marines CM93 (dossier local de l’utilisateur) — non destinées à la navigation'

export interface ChartEngines {
  bsb: BsbEngine | null
  cm93: Cm93Engine | null
}

/** Rang BSB jusqu'auquel une carte raster passe devant le CM93 : 0 = lisible, 1 = un peu trop détaillée (voir `chartTier`). */
const BSB_ON_TOP_MAX_TIER = 1

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
        const { bsb, cm93 } = this.engines
        // une carte raster aux petits zooms couvrirait des milliers de milles : le moteur BSB n'est interrogé que dès le zoom 5
        const [b, c] = await Promise.allSettled([
          bsb && coords.z >= CHARTS_MIN_ZOOM_RASTER ? bsb.renderTile(coords.z, x, coords.y, ac.signal) : undefined,
          cm93 ? cm93.renderTile(coords.z, x, coords.y, ac.signal) : undefined,
        ])
        // un format qui échoue (fichier illisible) ne prive pas la tuile de l'autre ; l'erreur n'est rapportée que si tout a échoué
        const failed = [b, c].filter((r): r is PromiseRejectedResult => r.status === 'rejected')
        if (failed.some((r) => aborted(r.reason))) return
        const ok = (r: PromiseSettledResult<TileResult | Cm93Result | undefined>): TileResult | Cm93Result | undefined =>
          r.status === 'fulfilled' ? r.value : undefined
        const rb = ok(b) as TileResult | undefined
        const rc = ok(c) as Cm93Result | undefined
        if (failed.length && !rb?.pixels && !rc?.pixels) throw failed[0]!.reason
        this.compose(tile, size, rb, rc)
        done(undefined, tile)
      } catch (e) {
        if (aborted(e)) return // tuile quittée avant d'être prête : rien à signaler
        done(e instanceof Error ? e : new Error(String(e)), tile)
      }
    }
    void paint()
    return tile
  }

  private compose(tile: HTMLCanvasElement, size: number, b: TileResult | undefined, c: Cm93Result | undefined): void {
    const ctx = tile.getContext('2d')
    if (!ctx) return
    const raster = b?.pixels ? b : undefined
    const vector = c?.pixels ? c : undefined
    if (raster && !vector && size === TILE) {
      ctx.putImageData(new ImageData(new Uint8ClampedArray(raster.pixels!.buffer as ArrayBuffer), TILE, TILE), 0, 0)
      return
    }
    const layers: [Uint32Array, number][] = []
    const bsbFirst = raster && (raster.best ?? 0) <= BSB_ON_TOP_MAX_TIER
    // du dessous au dessus
    if (bsbFirst) {
      if (vector) layers.push([vector.pixels!, vector.size])
      layers.push([raster.pixels!, TILE])
    } else {
      if (raster) layers.push([raster.pixels!, TILE])
      if (vector) layers.push([vector.pixels!, vector.size])
    }
    for (const [pixels, side] of layers) ctx.drawImage(pixelCanvas(pixels, side), 0, 0, size, size)
  }
}

/** Pixels de canevas par pixel CSS pour le dessin vectoriel : 2 sur écran Retina, sinon 1. */
export const chartsPixelRatio = (): number => (typeof window !== 'undefined' && window.devicePixelRatio >= 1.5 ? 2 : 1)

/** Couche des cartes du dossier ; transparente là où aucune carte ne couvre la zone. */
export function createChartsLayer(
  engines: ChartEngines,
  options: { zIndex?: number; minZoom?: number; maxZoom?: number } = {},
): L.GridLayer {
  const attribution = [engines.bsb ? BSB_ATTRIBUTION : '', engines.cm93 ? CM93_ATTRIBUTION : ''].filter(Boolean).join(' · ')
  return new ChartsGridLayer(engines, engines.cm93 ? chartsPixelRatio() : 1, {
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
