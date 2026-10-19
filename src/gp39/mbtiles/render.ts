// Fabrication d'une tuile MBTiles : lecture des tuiles dans les fichiers choisis, décodage de l'image, superposition (la plus
// prioritaire d'abord, les suivantes seulement là où elle est transparente) et agrandissement d'une partie de tuile au-delà du dernier
// zoom d'un fichier. Même code dans un Worker et en direct ; le décodage d'image est injecté (createImageBitmap dans le navigateur).

import { blobSource } from '../bsb/kap'
import type { MakeCanvas } from '../canvas'
import { MIME, Mbtiles, sniffFormat, type TileFormat } from './mbtiles'
import { MAX_OVERZOOM } from './plan'

export const TILE = 256

/** Où lire un fichier : un `File`, ou une poignée de fichier du navigateur (relue dans le Worker). */
export interface MbSource {
  id: string
  file?: Blob
  handle?: { getFile(): Promise<File> }
  /** niveaux de zoom d'agrandissement (0 = tuile native) */
  dz: number
}

export interface MbJob {
  z: number
  x: number
  y: number
  /** pixels de canevas par pixel CSS (1, ou 2 sur écran Retina) */
  k: number
  sources: MbSource[]
}

export interface MbResult {
  /** pixels RGBA de la tuile (côté `size`), ou null si aucun fichier n'a de tuile ici */
  pixels: Uint32Array | null
  size: number
  /** agrandissement de la première tuile dessinée (voir `mbtilesRank`) ; undefined sans pixels */
  best?: number
  /** fichiers qui ont dessiné */
  used: string[]
}

export interface Bitmap {
  width: number
  height: number
  image: CanvasImageSource
  close?(): void
}
export type Decode = (bytes: Uint8Array, format: TileFormat) => Promise<Bitmap>

/** Décodage par le navigateur */
export const browserDecode: Decode = async (bytes, format) => {
  const bmp = await createImageBitmap(new Blob([bytes as BlobPart], { type: MIME[format] }))
  return { width: bmp.width, height: bmp.height, image: bmp, close: () => bmp.close() }
}

/** Bases ouvertes gardées en mémoire (cache de pages de 8 Mo au plus chacune) ; les plus anciennes sont oubliées. */
const OPEN_MAX = 12

export class MbtilesRenderer {
  private open = new Map<string, Promise<Mbtiles>>()

  constructor(
    private readonly makeCanvas: MakeCanvas,
    private readonly decode: Decode,
  ) {}

  private db(src: MbSource): Promise<Mbtiles> {
    let p = this.open.get(src.id)
    if (p) {
      this.open.delete(src.id) // ré-insertion : ordre d'usage
    } else {
      p = (async () => {
        const file = src.file ?? (await src.handle?.getFile())
        if (!file) throw new Error(`Fichier illisible : ${src.id}`)
        return Mbtiles.open(blobSource(file))
      })()
      p.catch(() => this.open.delete(src.id)) // une ouverture ratée sera retentée
      while (this.open.size >= OPEN_MAX) this.open.delete(this.open.keys().next().value as string)
    }
    this.open.set(src.id, p)
    return p
  }

  /** Oublie les bases ouvertes (nouveau dossier). */
  reset(): void {
    this.open.clear()
  }

  async render(job: MbJob): Promise<MbResult> {
    const size = TILE * job.k
    const canvas = this.makeCanvas(size, size)
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Canevas 2D indisponible')
    ctx.globalCompositeOperation = 'destination-over' // la tuile déjà dessinée reste au-dessus de la suivante
    const used: string[] = []
    let best: number | undefined
    let failure: unknown
    for (const [i, s] of job.sources.entries()) {
      // La tuile du niveau voulu, sinon — les fichiers n'ont de tuiles que là où il y a des données, et leur `maxzoom` n'est pas toujours
      // atteint partout — celle du niveau juste au-dessus (agrandie), puis du suivant… jusqu'à `MAX_OVERZOOM` ou au zoom minimal du fichier.
      let found: { bytes: Uint8Array; d: number } | null = null
      try {
        const db = await this.db(s)
        for (let d = s.dz; d <= MAX_OVERZOOM && job.z - d >= db.info.minzoom && !found; d++) {
          const n = 2 ** d
          const bytes = await db.getXyz(job.z - d, Math.floor(job.x / n), Math.floor(job.y / n))
          if (bytes) found = { bytes, d }
        }
      } catch (e) {
        failure ??= e // un fichier illisible ne prive pas la tuile des autres
        continue
      }
      if (!found) continue
      const format = sniffFormat(found.bytes)
      if (format === 'unknown' || format === 'pbf') continue // tuile vectorielle ou inconnue : rien à dessiner
      const bmp = await this.decode(found.bytes, format)
      try {
        if (found.d === 0) ctx.drawImage(bmp.image, 0, 0, size, size)
        else {
          // une partie de la tuile du niveau supérieur, agrandie
          const n = 2 ** found.d
          const sw = bmp.width / n
          const sh = bmp.height / n
          ctx.imageSmoothingQuality = 'high'
          ctx.drawImage(bmp.image, (job.x % n) * sw, (job.y % n) * sh, sw, sh, 0, 0, size, size)
        }
      } finally {
        bmp.close?.()
      }
      used.push(s.id)
      best ??= found.d
      if (i < job.sources.length - 1 && opaque(ctx.getImageData(0, 0, size, size).data)) break
    }
    if (!used.length) {
      if (failure) throw failure
      return { pixels: null, size, used }
    }
    return { pixels: new Uint32Array(ctx.getImageData(0, 0, size, size).data.buffer), size, ...(best !== undefined ? { best } : {}), used }
  }
}

/** Tous les pixels sont-ils opaques ? (octet alpha = 255 ; la lecture s'arrête au premier pixel transparent) */
function opaque(data: Uint8ClampedArray): boolean {
  for (let i = 3; i < data.length; i += 4) if (data[i] !== 255) return false
  return true
}
