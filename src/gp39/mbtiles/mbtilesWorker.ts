// Worker des cartes MBTiles : lecture des tuiles, décodage des images et assemblage hors du fil de l'interface.

import type { Canvas2D } from '../canvas'
import { MbtilesRenderer, browserDecode, type MbJob } from './render'

type Message = { type: 'reset' } | { type: 'job'; id: number; job: MbJob }

const renderer = new MbtilesRenderer((w, h) => new OffscreenCanvas(w, h) as unknown as Canvas2D, browserDecode)
const scope = self as unknown as {
  onmessage: ((e: MessageEvent<Message>) => void) | null
  postMessage(message: unknown, transfer?: Transferable[]): void
}

scope.onmessage = (e) => {
  const m = e.data
  if (m.type === 'reset') {
    renderer.reset()
    return
  }
  renderer.render(m.job).then(
    (r) => {
      // le tampon est transféré (pas copié) au fil principal
      const buffer = r.pixels ? (r.pixels.buffer as ArrayBuffer) : null
      scope.postMessage({ id: m.id, pixels: buffer, size: r.size, best: r.best ?? null, used: r.used }, buffer ? [buffer] : [])
    },
    (err: unknown) => scope.postMessage({ id: m.id, error: err instanceof Error ? err.message : String(err) }),
  )
}
