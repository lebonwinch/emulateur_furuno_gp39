// Catalogue des cartes d'un dossier : on ne lit que l'en-tête (quelques Ko) de chaque .kap, jamais le raster.

import { blobSource, readKapHeader } from './kap'
import { makeChartInfo, type ChartInfo } from './tiles'

/** Un fichier du dossier choisi, quelle que soit la façon dont il a été obtenu (FileSystem API ou liste d'un <input>). */
export interface ChartFileRef {
  /** identifiant stable : chemin relatif dans le dossier */
  id: string
  size: number
  lastModified: number
  getFile(): Promise<File>
  /** de quoi relire le fichier depuis un Worker : le File lui-même, ou la poignée de fichier du navigateur (clonable) */
  source?: Blob | { getFile(): Promise<File> }
}

/** Ce qu'on garde d'une carte entre deux sessions pour éviter de relire son en-tête. */
export interface CatalogEntry {
  id: string
  size: number
  lastModified: number
  info: ChartInfo
}

export interface ScanResult {
  charts: ChartInfo[]
  entries: CatalogEntry[]
  /** fichiers .kap illisibles ou non géoréférencés, avec la raison */
  skipped: { id: string; reason: string }[]
}

export const isKapFile = (id: string): boolean => /\.kap$/i.test(id)

/**
 * Analyse les fichiers .kap (les .bsb, simples fiches d'en-tête, sont ignorés). `cache` évite de relire les fichiers dont la
 * taille et la date n'ont pas changé. Lectures en parallèle, par lots.
 */
export async function scanCharts(
  refs: readonly ChartFileRef[],
  opts: { cache?: ReadonlyMap<string, CatalogEntry>; onProgress?: (done: number, total: number) => void; concurrency?: number } = {},
): Promise<ScanResult> {
  const kap = refs.filter((r) => isKapFile(r.id))
  const entries: CatalogEntry[] = []
  const skipped: ScanResult['skipped'] = []
  let done = 0
  let next = 0
  const worker = async (): Promise<void> => {
    while (next < kap.length) {
      const ref = kap[next++]!
      const hit = opts.cache?.get(ref.id)
      if (hit && hit.size === ref.size && hit.lastModified === ref.lastModified) {
        entries.push(hit)
      } else {
        try {
          const header = await readKapHeader(blobSource(await ref.getFile()))
          const info = header ? makeChartInfo(ref.id, ref.size, header) : null
          if (info) entries.push({ id: ref.id, size: ref.size, lastModified: ref.lastModified, info })
          else skipped.push({ id: ref.id, reason: header ? 'calage impossible (points REF inutilisables)' : 'en-tête BSB illisible' })
        } catch (e) {
          skipped.push({ id: ref.id, reason: e instanceof Error ? e.message : String(e) })
        }
      }
      opts.onProgress?.(++done, kap.length)
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, Math.min(opts.concurrency ?? 8, kap.length)) }, worker))
  entries.sort((a, b) => a.id.localeCompare(b.id))
  return { charts: entries.map((e) => e.info), entries, skipped }
}

// --- accès aux dossiers du navigateur -------------------------------------------------------------------------------

/** Partie de l'API File System Access dont on se sert (non présente dans les types DOM de la version de TypeScript utilisée). */
export interface DirHandleLike {
  readonly kind: 'directory'
  readonly name: string
  values(): AsyncIterable<DirHandleLike | FileHandleLike>
  queryPermission?(d: { mode: 'read' }): Promise<PermissionState>
  requestPermission?(d: { mode: 'read' }): Promise<PermissionState>
}
export interface FileHandleLike {
  readonly kind: 'file'
  readonly name: string
  getFile(): Promise<File>
}

/** Parcourt un dossier (sous-dossiers compris, 4 niveaux au plus) et liste ses fichiers .kap. */
export async function listDirectory(dir: DirHandleLike, prefix = '', depth = 0): Promise<ChartFileRef[]> {
  const out: ChartFileRef[] = []
  for await (const entry of dir.values()) {
    const id = `${prefix}${entry.name}`
    if (entry.kind === 'directory') {
      if (depth < 4) out.push(...(await listDirectory(entry, `${id}/`, depth + 1)))
    } else if (isKapFile(entry.name)) {
      // getFile() donne la taille et la date (clé du cache) ; le File obtenu sert ensuite pour les lectures
      const file = await entry.getFile()
      out.push({ id, size: file.size, lastModified: file.lastModified, getFile: async () => file })
    }
  }
  return out
}

/** Liste de fichiers venue d'un `<input type="file" webkitdirectory>` (Firefox, Safari). */
export function refsFromFileList(files: Iterable<File>): ChartFileRef[] {
  const out: ChartFileRef[] = []
  for (const f of files) {
    const id = (f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name
    if (isKapFile(id)) out.push({ id, size: f.size, lastModified: f.lastModified, getFile: async () => f })
  }
  return out
}
