// Pool de Web Workers pour la fabrication de tuiles : une demande à la fois par Worker, réponse retrouvée par son numéro.
// Commun aux moteurs de tuiles (BSB, CM93, MBTiles) ; chacun garde son propre Worker et son propre format de message.

/** Toute réponse d'un Worker porte le numéro de la demande, et `error` si elle a échoué. */
export interface PoolReply {
  id: number
  error?: string
}

interface Slot {
  w: Worker
  busy: boolean
}

export class WorkerPool<R extends PoolReply> {
  readonly capacity: number
  private readonly slots: Slot[]
  private readonly waiting = new Map<number, { resolve: (r: R) => void; reject: (e: Error) => void; slot: Slot }>()
  private nextId = 1

  /** `create` fabrique un Worker (`new Worker(new URL('./x.ts', import.meta.url), { type: 'module' })` dans le module du moteur) */
  constructor(size: number, create: () => Worker, failure = 'Erreur du Worker') {
    this.capacity = size
    this.slots = Array.from({ length: size }, () => {
      const w = create()
      const slot: Slot = { w, busy: false }
      w.onmessage = (e: MessageEvent<R>) => {
        const p = this.waiting.get(e.data.id)
        if (!p) return
        this.waiting.delete(e.data.id)
        p.slot.busy = false
        if (e.data.error !== undefined) p.reject(new Error(e.data.error))
        else p.resolve(e.data)
      }
      w.onerror = (e) => {
        for (const [id, p] of this.waiting) {
          if (p.slot === slot) {
            this.waiting.delete(id)
            slot.busy = false
            p.reject(new Error(e.message || failure))
          }
        }
      }
      return slot
    })
  }

  /** Message à tous les Workers (nouveaux dictionnaires, par exemple) */
  broadcast(message: unknown): void {
    for (const s of this.slots) s.w.postMessage(message)
  }

  /** Envoie une demande (le numéro `id` est ajouté au message) à un Worker libre. */
  run(message: Record<string, unknown>): Promise<R> {
    const slot = this.slots.find((s) => !s.busy)
    if (!slot) return Promise.reject(new Error('Aucun Worker libre'))
    slot.busy = true
    const id = this.nextId++
    return new Promise((resolve, reject) => {
      this.waiting.set(id, { resolve, reject, slot })
      slot.w.postMessage({ ...message, id })
    })
  }

  dispose(): void {
    for (const s of this.slots) s.w.terminate()
    this.waiting.clear()
  }
}
