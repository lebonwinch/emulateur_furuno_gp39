// Catalogue des fichiers MBTiles d'un dossier : on ne lit que l'en-tête de chaque base (schéma + métadonnées : quelques pages),
// jamais les tuiles.

import type { ChartFileRef } from '../bsb/catalog'
import { blobSource } from '../bsb/kap'
import { Mbtiles, type MbtilesInfo } from './mbtiles'

export const isMbtilesFile = (name: string): boolean => /\.mbtiles$/i.test(name)

/** Ce qu'on garde d'un fichier entre deux sessions pour éviter de le rouvrir. */
export interface MbCatalogEntry {
  id: string
  size: number
  lastModified: number
  info: MbtilesInfo
}

export interface MbScanResult {
  entries: MbCatalogEntry[]
  /** fichiers inutilisables, avec la raison */
  skipped: { id: string; reason: string }[]
}

/** Raison pour laquelle un fichier ne peut pas être affiché, ou null s'il le peut. */
export function unusable(info: MbtilesInfo): string | null {
  if (info.format === 'pbf') return 'tuiles vectorielles (pbf) : non prises en charge'
  if (info.minzoom > info.maxzoom) return 'niveaux de zoom incohérents'
  return null
}

/**
 * Sources des fichiers pour l'attribution de Leaflet (qui insère du HTML) : les métadonnées d'un fichier de l'utilisateur ne sont pas
 * dignes de confiance, on n'en garde que le texte (balises retirées, `<` et `>` isolés neutralisés ; les entités comme `&copy;` restent).
 */
export function attributionHtml(infos: readonly MbtilesInfo[]): string {
  const texts = new Set<string>()
  for (const info of infos) {
    const t = (info.attribution || info.name)
      .replace(/<[^>]*>/g, ' ')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/\s+/g, ' ')
      .trim()
    if (t) texts.add(t.slice(0, 160))
  }
  const list = [...texts].slice(0, 4)
  return list.length ? `Tuiles MBTiles : ${list.join(' · ')}` : 'Tuiles MBTiles (dossier local de l’utilisateur)'
}

/**
 * Analyse les fichiers .mbtiles. `cache` évite de rouvrir ceux dont la taille et la date n'ont pas changé. Lectures en parallèle,
 * par lots.
 */
export async function scanMbtiles(
  refs: readonly ChartFileRef[],
  opts: { cache?: ReadonlyMap<string, MbCatalogEntry>; onProgress?: (done: number, total: number) => void; concurrency?: number } = {},
): Promise<MbScanResult> {
  const entries: MbCatalogEntry[] = []
  const skipped: MbScanResult['skipped'] = []
  let done = 0
  let next = 0
  const worker = async (): Promise<void> => {
    while (next < refs.length) {
      const ref = refs[next++]!
      const hit = opts.cache?.get(ref.id)
      let info: MbtilesInfo | null = null
      if (hit && hit.size === ref.size && hit.lastModified === ref.lastModified) info = hit.info
      else {
        try {
          info = (await Mbtiles.open(blobSource(await ref.getFile()))).info
        } catch (e) {
          skipped.push({ id: ref.id, reason: e instanceof Error ? e.message : String(e) })
        }
      }
      if (info) {
        const why = unusable(info)
        if (why) skipped.push({ id: ref.id, reason: why })
        else entries.push({ id: ref.id, size: ref.size, lastModified: ref.lastModified, info })
      }
      opts.onProgress?.(++done, refs.length)
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, Math.min(opts.concurrency ?? 4, refs.length)) }, worker))
  entries.sort((a, b) => a.id.localeCompare(b.id))
  return { entries, skipped }
}
