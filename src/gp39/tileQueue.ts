// File d'attente des tuiles : la dernière demande est servie la première (en déplaçant la carte, les tuiles visibles maintenant
// passent avant celles qu'on a déjà quittées), un nombre borné de tuiles se fabrique en même temps, et une tuile annulée avant
// son départ est retirée de la file aussitôt.

interface Task<R> {
  z: number
  x: number
  y: number
  signal: AbortSignal | undefined
  resolve: (r: R) => void
  reject: (e: unknown) => void
}

const aborted = (): DOMException => new DOMException('Tuile annulée', 'AbortError')

export class TileQueue<R> {
  private pending: Task<R>[] = []
  private running = 0

  /** `capacity` : tuiles fabriquées simultanément ; `execute` : fabrique une tuile (appelée au départ de la tâche) */
  constructor(
    private readonly capacity: () => number,
    private readonly execute: (z: number, x: number, y: number, signal: AbortSignal | undefined) => Promise<R>,
  ) {}

  request(z: number, x: number, y: number, signal?: AbortSignal): Promise<R> {
    return new Promise((resolve, reject) => {
      if (signal?.aborted) return reject(aborted())
      const task: Task<R> = { z, x, y, signal, resolve, reject }
      signal?.addEventListener(
        'abort',
        () => {
          const i = this.pending.indexOf(task)
          if (i < 0) return
          this.pending.splice(i, 1)
          reject(aborted())
        },
        { once: true },
      )
      this.pending.push(task)
      this.pump()
    })
  }

  /** Annule les tuiles en attente (celles déjà parties vont au bout). */
  clear(reason = 'File vidée'): void {
    for (const t of this.pending) t.reject(new DOMException(reason, 'AbortError'))
    this.pending = []
  }

  private pump(): void {
    while (this.running < this.capacity() && this.pending.length) {
      const task = this.pending.pop()!
      if (task.signal?.aborted) {
        task.reject(aborted())
        continue
      }
      this.running++
      this.execute(task.z, task.x, task.y, task.signal)
        .then(task.resolve, task.reject)
        .finally(() => {
          this.running--
          this.pump()
        })
    }
  }
}
