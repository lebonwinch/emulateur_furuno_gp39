// Worker des cartes CM93 : fabrique des tuiles hors du fil de l'interface (lecture des cellules, décodage, dessin sur OffscreenCanvas).

import type { Cm93Dict } from './dict'
import { Cm93Renderer, type Canvas2D, type Cm93Job } from './tile'

type Message = { type: 'dict'; dict: Cm93Dict | null } | { type: 'job'; id: number; job: Cm93Job }

const renderer = new Cm93Renderer((w, h) => new OffscreenCanvas(w, h) as unknown as Canvas2D)
const scope = self as unknown as {
  onmessage: ((e: MessageEvent<Message>) => void) | null
  postMessage(message: unknown, transfer?: Transferable[]): void
}

scope.onmessage = (e) => {
  const m = e.data
  if (m.type === 'dict') {
    renderer.setDictionary(m.dict)
    return
  }
  renderer.render(m.job).then(
    (r) => {
      // le tampon est transféré (pas copié) au fil principal
      const buffer = r.pixels ? (r.pixels.buffer as ArrayBuffer) : null
      scope.postMessage({ id: m.id, pixels: buffer, scales: r.scales, size: r.size }, buffer ? [buffer] : [])
    },
    (err: unknown) => scope.postMessage({ id: m.id, error: err instanceof Error ? err.message : String(err) }),
  )
}
