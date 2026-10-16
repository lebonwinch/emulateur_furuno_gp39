// Fabrication d'une tuile CM93 : plusieurs échelles superposées (la plus détaillée au-dessus), chacune limitée à la zone que ses
// cellules couvrent réellement (les polygones `_m_sor`), comme le « quilt » d'OpenCPN. Même code dans un Worker et en direct.

import { parseCell } from './cell'
import type { Cm93Dict } from './dict'
import { addRing, boxesTouch, drawItems, tileWorldBox, type Ctx, type Env } from './draw'
import { prepareCell, type PreparedCell } from './prepare'

export const TILE = 256

/** Où lire une cellule : un `File` déjà obtenu, ou une poignée de fichier du navigateur (lecture à la demande, dans le Worker). */
export interface CellSource {
  id: string
  file?: Blob
  handle?: { getFile(): Promise<File> }
}

export interface Cm93Job {
  z: number
  x: number
  y: number
  /** pixels de canevas par pixel CSS (1, ou 2 sur écran Retina) */
  k: number
  /** échelles à superposer, de la plus détaillée à la moins détaillée : leurs cellules recouvrant la tuile */
  layers: { scale: number; cells: CellSource[] }[]
}

export interface Cm93Result {
  /** pixels RGBA de la tuile (côté TILE · k), ou null si aucune cellule ne la couvre */
  pixels: Uint32Array | null
  /** échelles qui ont dessiné (indices 0 = Z … 7 = G) */
  scales: number[]
  /** côté des pixels renvoyés */
  size: number
}

export interface Canvas2D {
  width: number
  height: number
  getContext(type: '2d'): Ctx | null
}
export type MakeCanvas = (w: number, h: number) => Canvas2D

/** Cellules préparées gardées en mémoire (quelques centaines de Ko chacune) ; les plus anciennes sont oubliées. */
const CELLS_MAX = 32

const insidePolygon = (ring: Float64Array, x: number, y: number): boolean => {
  let inside = false
  for (let i = 0, j = ring.length - 2; i < ring.length; j = i, i += 2) {
    const xi = ring[i]!
    const yi = ring[i + 1]!
    const xj = ring[j]!
    const yj = ring[j + 1]!
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

export class Cm93Renderer {
  private dict: Cm93Dict | null = null
  private cells = new Map<string, Promise<PreparedCell | null>>()

  constructor(private readonly makeCanvas: MakeCanvas) {}

  /** Nouveaux dictionnaires (nouveau dossier) : les cellules déjà préparées ne valent plus rien. */
  setDictionary(dict: Cm93Dict | null): void {
    this.dict = dict
    this.cells.clear()
  }

  private cell(src: CellSource): Promise<PreparedCell | null> {
    let p = this.cells.get(src.id)
    if (p) {
      this.cells.delete(src.id) // ré-insertion : ordre d'usage
    } else {
      const dict = this.dict
      p = (async () => {
        if (!dict) return null
        const file = src.file ?? (await src.handle?.getFile())
        if (!file) return null
        const cell = parseCell(new Uint8Array(await file.arrayBuffer()))
        return cell ? prepareCell(cell, dict) : null
      })()
      p.catch(() => this.cells.delete(src.id)) // une lecture ratée sera retentée
      while (this.cells.size >= CELLS_MAX) this.cells.delete(this.cells.keys().next().value as string)
    }
    this.cells.set(src.id, p)
    return p
  }

  async render(job: Cm93Job): Promise<Cm93Result> {
    const size = TILE * job.k
    const base: Env = { z: job.z, tx: job.x, ty: job.y, k: job.k, size, scale: 0 }
    const box = tileWorldBox(base, 0)
    // points d'essai pour savoir si la tuile est entièrement couverte (et s'arrêter avant les échelles plus petites)
    const samples: [number, number][] = []
    for (let i = 0; i < 9; i++) {
      for (let j = 0; j < 9; j++) samples.push([box[0] + ((box[2] - box[0]) * (i + 0.5)) / 9, box[1] + ((box[3] - box[1]) * (j + 0.5)) / 9])
    }
    let missing = samples
    const used: { scale: number; cells: PreparedCell[]; full: boolean }[] = []
    for (const layer of job.layers) {
      const cells = (await Promise.all(layer.cells.map((c) => this.cell(c)))).filter(
        (c): c is PreparedCell => !!c && boxesTouch(c.box, box),
      )
      if (!cells.length) continue
      const rings = cells.flatMap((c) => c.coverage)
      const left = missing.filter(([x, y]) => !rings.some((r) => insidePolygon(r, x, y)))
      if (left.length === missing.length) continue // la couverture de cette échelle ne touche pas la tuile
      used.push({ scale: layer.scale, cells, full: left.length === 0 })
      missing = left
      if (!missing.length) break
    }
    if (!used.length) return { pixels: null, scales: [], size }

    const out = this.makeCanvas(size, size)
    const octx = out.getContext('2d')
    if (!octx) throw new Error('Canevas 2D indisponible')
    // du moins détaillé au plus détaillé : chaque échelle recouvre la précédente là où elle a des données
    for (const layer of used.slice().reverse()) {
      const lc = this.makeCanvas(size, size)
      const lctx = lc.getContext('2d')
      if (!lctx) throw new Error('Canevas 2D indisponible')
      const env: Env = { ...base, scale: layer.scale }
      const items = layer.cells.flatMap((c) => c.items).sort((a, b) => a.layer - b.layer)
      // fond : eau profonde dans la zone couverte (les surfaces de profondeur et la terre viennent par-dessus)
      lctx.fillStyle = '#ffffff'
      for (const c of layer.cells) for (const r of c.coverage) fillRing(lctx, env, r)
      drawItems(lctx, env, items)
      if (!layer.full) {
        // on ne garde que la zone couverte
        const mc = this.makeCanvas(size, size)
        const mctx = mc.getContext('2d')
        if (!mctx) throw new Error('Canevas 2D indisponible')
        mctx.fillStyle = '#000000'
        for (const c of layer.cells) for (const r of c.coverage) fillRing(mctx, env, r)
        lctx.globalCompositeOperation = 'destination-in'
        lctx.drawImage(mc as unknown as CanvasImageSource, 0, 0)
        lctx.globalCompositeOperation = 'source-over'
      }
      octx.drawImage(lc as unknown as CanvasImageSource, 0, 0)
    }
    const data = octx.getImageData(0, 0, size, size)
    return { pixels: new Uint32Array(data.data.buffer), scales: used.map((u) => u.scale), size }
  }
}

function fillRing(ctx: Ctx, env: Env, ring: Float64Array): void {
  ctx.beginPath()
  if (addRing(ctx, env, ring)) ctx.fill()
}
