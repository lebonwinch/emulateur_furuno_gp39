// Dossier de cartes de l'utilisateur : on le parcourt une seule fois et on reconnaît seul le format de ce qu'il contient
// (BSB/KAP ou CM93, éventuellement les deux), d'après le nom des fichiers. Rien n'est lu ici, sauf la taille et la date des .kap
// (clé du cache de leur catalogue) : les cellules CM93 (des dizaines de milliers de fichiers) ne sont ouvertes qu'à l'affichage.

import { isKapFile, type ChartFileRef, type DirHandleLike } from './bsb/catalog'
import { isDictionaryName } from './cm93/dict'
import { isMbtilesFile } from './mbtiles/catalog'
import { cellKeyId, parseCellName } from './cm93/scales'

/** Une cellule CM93 du dossier : la principale (« 0 ») puis ses compléments (A, B…). */
export interface Cm93CellRef {
  sub: string
  ref: ChartFileRef
}

export interface Cm93Listing {
  /** CM93OBJ.DIC et CM93ATTR.DIC (au texte clair, fournis avec les cartes) */
  obj?: ChartFileRef
  attr?: ChartFileRef
  /** cellules par « échelle/latitude/longitude » (voir `cellKeyId`) */
  cells: Map<string, Cm93CellRef[]>
  /** nombre de cellules */
  count: number
  /** nombre de cellules par échelle (indice 0 = Z … 7 = G) */
  perScale: number[]
}

export interface FolderListing {
  kap: ChartFileRef[]
  /** fichiers MBTiles (tuiles raster dans une base SQLite) */
  mbtiles: ChartFileRef[]
  cm93: Cm93Listing
  /** fichiers vus au total */
  files: number
}

export type FolderFormat = 'bsb' | 'cm93' | 'mbtiles'

/** Formats trouvés dans le dossier (CM93 : il faut au moins une cellule et les deux dictionnaires). */
export function formatsOf(l: FolderListing): FolderFormat[] {
  const out: FolderFormat[] = []
  if (l.kap.length) out.push('bsb')
  if (l.cm93.count && l.cm93.obj && l.cm93.attr) out.push('cm93')
  if (l.mbtiles.length) out.push('mbtiles')
  return out
}

const emptyCm93 = (): Cm93Listing => ({ cells: new Map(), count: 0, perScale: Array.from({ length: 8 }, () => 0) })
export const emptyListing = (): FolderListing => ({ kap: [], mbtiles: [], cm93: emptyCm93(), files: 0 })

/** Un fichier vu dans le dossier : `eager` lit sa taille et sa date (.kap, .mbtiles), `lazy` ne touche pas au disque (cellules, dictionnaires). */
interface Seen {
  id: string
  name: string
  eager(): Promise<ChartFileRef> | ChartFileRef
  lazy(): ChartFileRef
}

const then = <T>(v: Promise<T> | T, f: (t: T) => void): Promise<void> | void => (v instanceof Promise ? v.then(f) : f(v))

/** Range un fichier dans le bon format d'après son nom. Renvoie une promesse seulement s'il a fallu attendre une lecture. */
function sort(l: FolderListing, f: Seen): Promise<void> | void {
  l.files++
  if (isKapFile(f.name)) return then(f.eager(), (r) => void l.kap.push(r))
  if (isMbtilesFile(f.name)) return then(f.eager(), (r) => void l.mbtiles.push(r))
  const dict = isDictionaryName(f.name)
  if (dict) {
    // plusieurs jeux de dictionnaires : le moins profond (le plus proche de la racine) fait foi
    const r = f.lazy()
    const cur = l.cm93[dict]
    if (!cur || r.id.split('/').length < cur.id.split('/').length) l.cm93[dict] = r
    return
  }
  const cell = parseCellName(f.name)
  if (!cell) return
  const key = cellKeyId(cell)
  const entry: Cm93CellRef = { sub: cell.sub, ref: f.lazy() }
  const list = l.cm93.cells.get(key)
  if (list) list.push(entry)
  else l.cm93.cells.set(key, [entry])
  l.cm93.count++
  l.cm93.perScale[cell.scale]!++
}

const finish = (l: FolderListing): FolderListing => {
  for (const list of l.cm93.cells.values()) list.sort((a, b) => (a.sub < b.sub ? -1 : a.sub > b.sub ? 1 : 0))
  l.kap.sort((a, b) => a.id.localeCompare(b.id))
  l.mbtiles.sort((a, b) => a.id.localeCompare(b.id))
  return l
}

const MAX_DEPTH = 6
const PARALLEL = 8

/**
 * Parcourt un dossier du navigateur (sous-dossiers compris). Les dossiers frères sont lus en parallèle : sur des dizaines de
 * milliers de fichiers, c'est la latence de chaque liste de dossier qui coûte, pas le nombre de fichiers.
 */
export async function listFolder(root: DirHandleLike, onProgress?: (files: number) => void): Promise<FolderListing> {
  const out = emptyListing()
  let running = 0
  const waiting: (() => void)[] = []
  const walk = async (dir: DirHandleLike, prefix: string, depth: number): Promise<void> => {
    if (running >= PARALLEL) await new Promise<void>((r) => waiting.push(r))
    running++
    const jobs: Promise<void>[] = []
    try {
      for await (const entry of dir.values()) {
        const id = `${prefix}${entry.name}`
        if (entry.kind === 'directory') {
          if (depth < MAX_DEPTH) jobs.push(walk(entry, `${id}/`, depth + 1))
          continue
        }
        const p = sort(out, {
          id,
          name: entry.name,
          // .kap et .mbtiles : taille et date lues tout de suite (clé du cache de leur catalogue) ; le File sert aussi aux Workers
          eager: async () => {
            const file = await entry.getFile()
            return { id, size: file.size, lastModified: file.lastModified, getFile: async () => file, source: file }
          },
          lazy: () => ({ id, size: 0, lastModified: 0, getFile: () => entry.getFile(), source: entry }),
        })
        if (p) jobs.push(p)
      }
      onProgress?.(out.files)
    } finally {
      running--
      waiting.shift()?.()
    }
    await Promise.all(jobs)
  }
  await walk(root, '', 0)
  onProgress?.(out.files)
  return finish(out)
}

/** Liste de fichiers venue d'un `<input type="file" webkitdirectory>` (Firefox, Safari). */
export function listFromFileList(files: Iterable<File>): FolderListing {
  const out = emptyListing()
  for (const f of files) {
    const id = (f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name
    const ref = (): ChartFileRef => ({ id, size: f.size, lastModified: f.lastModified, getFile: async () => f, source: f })
    void sort(out, { id, name: f.name, eager: ref, lazy: ref })
  }
  return finish(out)
}
