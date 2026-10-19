// Moteur de tuiles MBTiles : catalogue des fichiers du dossier, choix des fichiers selon le zoom et la zone, file d'attente et
// exécuteurs (pool de Workers, ou en direct si les Workers sont indisponibles). Le pendant de `Cm93Engine` pour les tuiles raster.

import type { ChartFileRef } from '../bsb/catalog'
import { fileSource } from '../fileSource'
import { TileQueue } from '../tileQueue'
import { WorkerPool, type PoolReply } from '../workerPool'
import { planMbtiles, type MbEntry } from './plan'
import { MbtilesRenderer, browserDecode, type MbJob, type MbResult } from './render'

export interface MbRunner {
  readonly capacity: number
  /** oublie les bases ouvertes (nouveau dossier) */
  reset(): void
  run(job: MbJob): Promise<MbResult>
  dispose(): void
}

/** Exécution dans le fil courant (navigateur sans Worker ou sans OffscreenCanvas). */
export class InlineMbRunner implements MbRunner {
  readonly capacity = 1
  private renderer = new MbtilesRenderer((w, h) => {
    const c = document.createElement('canvas')
    c.width = w
    c.height = h
    return c
  }, browserDecode)
  reset(): void {
    this.renderer.reset()
  }
  run(job: MbJob): Promise<MbResult> {
    return this.renderer.render(job)
  }
  dispose(): void {}
}

interface MbReply extends PoolReply {
  pixels?: ArrayBuffer | null
  size?: number
  best?: number | null
  used?: string[]
}

/** Pool de Workers : une tuile à la fois par Worker. */
export class WorkerMbRunner implements MbRunner {
  private readonly pool: WorkerPool<MbReply>

  constructor(size: number) {
    this.pool = new WorkerPool<MbReply>(
      size,
      () => new Worker(new URL('./mbtilesWorker.ts', import.meta.url), { type: 'module' }),
      'Erreur du Worker MBTiles',
    )
  }

  get capacity(): number {
    return this.pool.capacity
  }

  reset(): void {
    this.pool.broadcast({ type: 'reset' })
  }

  async run(job: MbJob): Promise<MbResult> {
    const r = await this.pool.run({ type: 'job', job })
    return {
      pixels: r.pixels ? new Uint32Array(r.pixels) : null,
      size: r.size ?? 256,
      ...(typeof r.best === 'number' ? { best: r.best } : {}),
      used: r.used ?? [],
    }
  }

  dispose(): void {
    this.pool.dispose()
  }
}

/** Pool de Workers si possible (taille : cœurs − 1, entre 1 et 4), sinon exécution dans le fil courant. */
export function createMbRunner(): MbRunner {
  if (typeof Worker !== 'undefined' && typeof OffscreenCanvas !== 'undefined' && typeof createImageBitmap !== 'undefined') {
    try {
      const cores = typeof navigator !== 'undefined' ? (navigator.hardwareConcurrency ?? 2) : 2
      return new WorkerMbRunner(Math.max(1, Math.min(4, cores - 1)))
    } catch {
      /* Worker de module non supporté : repli ci-dessous */
    }
  }
  return new InlineMbRunner()
}

export class MbtilesEngine {
  private entries: MbEntry[] = []
  private refs = new Map<string, ChartFileRef>()
  private readonly queue: TileQueue<MbResult>

  /** `pixelRatio` : pixels de canevas par pixel CSS (2 sur écran Retina) */
  constructor(
    private readonly runner: MbRunner,
    private readonly pixelRatio: () => number = () => 1,
  ) {
    this.queue = new TileQueue(
      () => this.runner.capacity,
      (z, x, y) => this.execute(z, x, y),
    )
  }

  /** Remplace le catalogue (nouveau dossier). Les tuiles en attente sont annulées. */
  setCatalog(refs: readonly ChartFileRef[], entries: readonly MbEntry[]): void {
    this.queue.clear('Catalogue remplacé')
    this.refs = new Map(refs.map((r) => [r.id, r]))
    this.entries = [...entries]
    this.runner.reset()
  }

  get fileCount(): number {
    return this.entries.length
  }

  /** Tuile z/x/y (x déjà ramené dans [0, 2^z[), servie dernier arrivé, premier servi (voir `TileQueue`). */
  renderTile(z: number, x: number, y: number, signal?: AbortSignal): Promise<MbResult> {
    return this.queue.request(z, x, y, signal)
  }

  private async execute(z: number, x: number, y: number): Promise<MbResult> {
    const k = Math.max(1, Math.min(2, Math.round(this.pixelRatio())))
    const sources = planMbtiles(this.entries, z, x, y).flatMap((p) => {
      const ref = this.refs.get(p.id)
      return ref ? [{ id: p.id, dz: p.dz, ...fileSource(ref) }] : []
    })
    if (!sources.length) return { pixels: null, size: 256 * k, used: [] }
    return this.runner.run({ z, x, y, k, sources })
  }

  dispose(): void {
    this.setCatalog([], [])
    this.runner.dispose()
  }
}
