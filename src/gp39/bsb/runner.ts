// Fabrication d'une tuile à partir de cartes ouvertes : même code dans un Worker (UI fluide) et en direct (tests, repli).

import { blobSource } from './kap'
import { TILE, openChart, renderTile, type ChartInfo, type OpenChart } from './tiles'

/** Une tuile à produire : les cartes sont déjà choisies et ordonnées (voir `selectCharts`), avec leur fichier. */
export interface TileJob {
  z: number
  x: number
  y: number
  charts: { info: ChartInfo; file: Blob }[]
}

export interface TileResult {
  /** 256 × 256 pixels RGBA, ou null si aucune carte ne couvre la tuile */
  pixels: Uint32Array | null
  /** cartes qui ont réellement dessiné */
  used: string[]
}

/** Cartes ouvertes gardées en mémoire (modèle de calage + table de lignes : ~40 Ko chacune) ; les plus anciennes sont oubliées. */
const OPEN_CHARTS_MAX = 64

export class TileRenderer {
  private open = new Map<string, OpenChart>()

  private chart(info: ChartInfo, file: Blob): OpenChart | null {
    // clé = identifiant + taille : un fichier remplacé sur le disque est rouvert
    const key = `${info.id}|${info.size}|${file.size}`
    let oc = this.open.get(key)
    if (oc) {
      this.open.delete(key) // ré-insertion : ordre d'usage
    } else {
      oc = openChart(info, blobSource(file)) ?? undefined
      if (!oc) return null
      while (this.open.size >= OPEN_CHARTS_MAX) this.open.delete(this.open.keys().next().value as string)
    }
    this.open.set(key, oc)
    return oc
  }

  async render(job: TileJob): Promise<TileResult> {
    const charts = job.charts.map((c) => this.chart(c.info, c.file)).filter((c): c is OpenChart => !!c)
    if (!charts.length) return { pixels: null, used: [] }
    const pixels = new Uint32Array(TILE * TILE)
    const used = await renderTile(job.z, job.x, job.y, charts, pixels)
    return { pixels: used.length ? pixels : null, used }
  }
}
