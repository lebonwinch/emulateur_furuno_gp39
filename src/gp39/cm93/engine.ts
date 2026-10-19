// Moteur de tuiles CM93 : index des cellules du dossier, choix des cellules selon le zoom, file d'attente et exécuteurs (pool de
// Workers, ou en direct si les Workers sont indisponibles). Le pendant de `BsbEngine` pour le format vectoriel.

import type { ChartFileRef } from '../bsb/catalog'
import { fileSource } from '../fileSource'
import type { Cm93CellRef, Cm93Listing } from '../library'
import { TileQueue } from '../tileQueue'
import { WorkerPool, type PoolReply } from '../workerPool'
import type { Cm93Dict } from './dict'
import { planTile } from './plan'
import { Cm93Renderer, type CellSource, type Cm93Job, type Cm93Result } from './tile'

export interface Cm93Runner {
  readonly capacity: number
  setDictionary(dict: Cm93Dict | null): void
  run(job: Cm93Job): Promise<Cm93Result>
  dispose(): void
}

/** Exécution dans le fil courant (tests, ou navigateur sans Worker). */
export class InlineCm93Runner implements Cm93Runner {
  readonly capacity = 1
  private renderer = new Cm93Renderer((w, h) => {
    const c = document.createElement('canvas')
    c.width = w
    c.height = h
    return c
  })
  setDictionary(dict: Cm93Dict | null): void {
    this.renderer.setDictionary(dict)
  }
  run(job: Cm93Job): Promise<Cm93Result> {
    return this.renderer.render(job)
  }
  dispose(): void {}
}

interface Cm93Reply extends PoolReply {
  pixels?: ArrayBuffer | null
  scales?: number[]
  size?: number
}

/** Pool de Workers : une tuile à la fois par Worker. */
export class WorkerCm93Runner implements Cm93Runner {
  private readonly pool: WorkerPool<Cm93Reply>

  constructor(size: number) {
    this.pool = new WorkerPool<Cm93Reply>(
      size,
      () => new Worker(new URL('./cm93Worker.ts', import.meta.url), { type: 'module' }),
      'Erreur du Worker CM93',
    )
  }

  get capacity(): number {
    return this.pool.capacity
  }

  setDictionary(dict: Cm93Dict | null): void {
    this.pool.broadcast({ type: 'dict', dict })
  }

  async run(job: Cm93Job): Promise<Cm93Result> {
    const r = await this.pool.run({ type: 'job', job })
    return { pixels: r.pixels ? new Uint32Array(r.pixels) : null, scales: r.scales ?? [], size: r.size ?? 256 }
  }

  dispose(): void {
    this.pool.dispose()
  }
}

/** Pool de Workers si possible (taille : cœurs − 1, entre 1 et 4), sinon exécution dans le fil courant. */
export function createCm93Runner(): Cm93Runner {
  if (typeof Worker !== 'undefined' && typeof OffscreenCanvas !== 'undefined') {
    try {
      const cores = typeof navigator !== 'undefined' ? (navigator.hardwareConcurrency ?? 2) : 2
      return new WorkerCm93Runner(Math.max(1, Math.min(4, cores - 1)))
    } catch {
      /* Worker de module non supporté : repli ci-dessous */
    }
  }
  return new InlineCm93Runner()
}

/** Source d'une cellule pour le Worker (voir `fileSource`) */
const sourceOf = (ref: ChartFileRef): CellSource => ({ id: ref.id, ...fileSource(ref) })

export class Cm93Engine {
  private cells: ReadonlyMap<string, readonly Cm93CellRef[]> = new Map()
  private perScale: readonly number[] = []
  private readonly queue: TileQueue<Cm93Result>

  /** `pixelRatio` : pixels de canevas par pixel CSS (2 sur écran Retina : texte et traits restent nets) */
  constructor(
    private readonly runner: Cm93Runner,
    private readonly pixelRatio: () => number = () => 1,
  ) {
    this.queue = new TileQueue(
      () => this.runner.capacity,
      (z, x, y) => this.execute(z, x, y),
    )
  }

  /** Remplace le catalogue (nouveau dossier). Les tuiles en attente sont annulées. */
  setCatalog(listing: Cm93Listing | null, dict: Cm93Dict | null): void {
    this.queue.clear('Catalogue remplacé')
    this.cells = listing?.cells ?? new Map()
    this.perScale = listing?.perScale ?? []
    this.runner.setDictionary(dict)
  }

  get cellCount(): number {
    return this.perScale.reduce((a, b) => a + b, 0)
  }

  /** Tuile z/x/y (x déjà ramené dans [0, 2^z[), servie dernier arrivé, premier servi (voir `TileQueue`). */
  renderTile(z: number, x: number, y: number, signal?: AbortSignal): Promise<Cm93Result> {
    return this.queue.request(z, x, y, signal)
  }

  private async execute(z: number, x: number, y: number): Promise<Cm93Result> {
    const k = Math.max(1, Math.min(2, Math.round(this.pixelRatio())))
    const plan = planTile(this.cells, this.perScale, z, x, y)
    if (!plan.length) return { pixels: null, scales: [], size: 256 * k }
    return this.runner.run({
      z,
      x,
      y,
      k,
      layers: plan.map((l) => ({ scale: l.scale, cells: l.cells.map((c) => sourceOf(c.ref)) })),
    })
  }

  dispose(): void {
    this.setCatalog(null, null)
    this.runner.dispose()
  }
}
