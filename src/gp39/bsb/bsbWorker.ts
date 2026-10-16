// Worker : fabrique les tuiles hors du fil de l'interface (décodage RLE et rééchantillonnage ne gèlent jamais la carte).

import { TileRenderer, type TileJob } from './runner'

interface Request {
  id: number
  job: TileJob
}

const renderer = new TileRenderer()
const scope = self as unknown as {
  onmessage: ((e: MessageEvent<Request>) => void) | null
  postMessage(message: unknown, transfer?: Transferable[]): void
}

scope.onmessage = (e) => {
  const { id, job } = e.data
  renderer.render(job).then(
    (r) => {
      // le tampon est transféré (pas copié) au fil principal
      scope.postMessage({ id, used: r.used, pixels: r.pixels?.buffer ?? null }, r.pixels ? [r.pixels.buffer] : [])
    },
    (err: unknown) => scope.postMessage({ id, error: err instanceof Error ? err.message : String(err) }),
  )
}
