// Moteur de tuiles BSB : catalogue, choix des cartes selon le zoom, file d'attente (la dernière demande d'abord, annulable) et
// exécuteurs (pool de Workers, ou en direct si les Workers sont indisponibles).

import type { ChartFileRef } from './catalog'
import { TileRenderer, type TileJob, type TileResult } from './runner'
import { TileQueue } from '../tileQueue'
import { WorkerPool, type PoolReply } from '../workerPool'
import { bestTier, selectCharts, tileBox, type ChartInfo } from './tiles'

/** Exécute une tuile ; `capacity` = nombre de tuiles pouvant être fabriquées en même temps. */
export interface TileRunner {
  readonly capacity: number
  run(job: TileJob): Promise<TileResult>
  dispose(): void
}

/** Exécution dans le fil courant (tests, ou navigateur sans Worker). */
export class InlineRunner implements TileRunner {
  readonly capacity = 1
  private renderer = new TileRenderer()
  run(job: TileJob): Promise<TileResult> {
    return this.renderer.render(job)
  }
  dispose(): void {}
}

interface BsbReply extends PoolReply {
  used?: string[]
  pixels?: ArrayBuffer | null
}

/** Pool de Workers : une tuile à la fois par Worker. */
export class WorkerRunner implements TileRunner {
  private readonly pool: WorkerPool<BsbReply>

  constructor(size: number) {
    this.pool = new WorkerPool<BsbReply>(
      size,
      () => new Worker(new URL('./bsbWorker.ts', import.meta.url), { type: 'module' }),
      'Erreur du Worker BSB',
    )
  }

  get capacity(): number {
    return this.pool.capacity
  }

  async run(job: TileJob): Promise<TileResult> {
    const r = await this.pool.run({ job })
    return { used: r.used ?? [], pixels: r.pixels ? new Uint32Array(r.pixels) : null }
  }

  dispose(): void {
    this.pool.dispose()
  }
}

/** Pool de Workers si possible (taille : cœurs − 1, entre 1 et 4), sinon exécution dans le fil courant. */
export function createRunner(): TileRunner {
  if (typeof Worker !== 'undefined') {
    try {
      const cores = typeof navigator !== 'undefined' ? (navigator.hardwareConcurrency ?? 2) : 2
      return new WorkerRunner(Math.max(1, Math.min(4, cores - 1)))
    } catch {
      /* Worker de module non supporté : repli ci-dessous */
    }
  }
  return new InlineRunner()
}

export class BsbEngine {
  private charts: ChartInfo[] = []
  private refs = new Map<string, ChartFileRef>()
  private files = new Map<string, Promise<File>>()
  private readonly queue: TileQueue<TileResult>

  constructor(private readonly runner: TileRunner) {
    this.queue = new TileQueue(
      () => this.runner.capacity,
      (z, x, y, signal) => this.execute(z, x, y, signal),
    )
  }

  /** Remplace le catalogue (nouveau dossier). Les tuiles en attente sont annulées. */
  setCatalog(refs: readonly ChartFileRef[], charts: readonly ChartInfo[]): void {
    this.queue.clear('Catalogue remplacé')
    this.refs = new Map(refs.map((r) => [r.id, r]))
    this.files.clear()
    this.charts = [...charts]
  }

  get chartCount(): number {
    return this.charts.length
  }

  /**
   * Tuile z/x/y (x déjà ramené dans [0, 2^z[). La file est servie dernier arrivé, premier servi : en déplaçant la carte, les
   * tuiles visibles maintenant passent avant celles qu'on a déjà quittées. Une tuile annulée (`signal`) avant son départ est
   * retirée de la file aussitôt et n'est jamais fabriquée ; une tuile déjà partie va au bout (son résultat est ignoré).
   */
  renderTile(z: number, x: number, y: number, signal?: AbortSignal): Promise<TileResult> {
    return this.queue.request(z, x, y, signal)
  }

  private fileOf(id: string): Promise<File> {
    let p = this.files.get(id)
    if (!p) {
      const ref = this.refs.get(id)
      p = ref ? ref.getFile() : Promise.reject(new Error(`Carte inconnue : ${id}`))
      p.catch(() => this.files.delete(id)) // une lecture ratée sera retentée
      this.files.set(id, p)
    }
    return p
  }

  private async execute(z: number, x: number, y: number, signal: AbortSignal | undefined): Promise<TileResult> {
    const box = tileBox(z, x, y)
    const chosen = selectCharts(this.charts, z, box)
    if (!chosen.length) return { pixels: null, used: [] }
    const charts = await Promise.all(chosen.map(async (info) => ({ info, file: await this.fileOf(info.id) })))
    if (signal?.aborted) throw new DOMException('Tuile annulée', 'AbortError')
    const r = await this.runner.run({ z, x, y, charts })
    const best = bestTier(chosen, z, box)
    return best === undefined ? r : { ...r, best }
  }

  dispose(): void {
    this.setCatalog([], [])
    this.runner.dispose()
  }
}
