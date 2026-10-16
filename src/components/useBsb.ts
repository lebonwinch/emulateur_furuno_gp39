// Cartes BSB : dossier choisi par l'utilisateur, catalogue, moteur de tuiles. État partagé par les fenêtres à carte.
//
// Le navigateur ne laisse lire un dossier qu'avec l'accord de l'utilisateur : « Choisir le dossier » ouvre le sélecteur du
// système (File System Access API : Chrome, Edge…) et mémorise le dossier pour les sessions suivantes (le navigateur redemande
// alors une simple confirmation) ; Firefox et Safari passent par un <input webkitdirectory> et doivent le redemander à chaque fois.

import { reactive } from 'vue'
import { listDirectory, refsFromFileList, scanCharts, type CatalogEntry, type ChartFileRef, type DirHandleLike } from '@/gp39/bsb/catalog'
import { BsbEngine, createRunner } from '@/gp39/bsb/engine'
import type { ChartInfo } from '@/gp39/bsb/tiles'
import { kvGet, kvSet } from '@/gp39/persist'

const KEY_DIR = 'bsb.dir'
const KEY_CATALOG = 'bsb.catalog'

export type BsbPhase = 'empty' | 'needs-permission' | 'scanning' | 'ready' | 'error'

export const bsb = reactive({
  phase: 'empty' as BsbPhase,
  dirName: '',
  /** nombre de cartes utilisables */
  count: 0,
  scanned: 0,
  total: 0,
  /** fichiers .kap ignorés (illisibles ou non calés) */
  skipped: [] as { id: string; reason: string }[],
  scaleMin: 0,
  scaleMax: 0,
  error: '',
  /** incrémenté à chaque nouveau catalogue : les couches s'en servent pour se recréer */
  version: 0,
})

/** Le sélecteur de dossier du système existe-t-il (sinon : <input webkitdirectory>) ? */
export const canPickDirectory = (): boolean => typeof window !== 'undefined' && 'showDirectoryPicker' in window

let engine: BsbEngine | null = null
/** Moteur de tuiles (créé au premier usage : les Workers ne démarrent que si l'on affiche des cartes BSB). */
export function getBsbEngine(): BsbEngine {
  return (engine ??= new BsbEngine(createRunner()))
}

let pendingHandle: DirHandleLike | null = null
let restored = false

async function load(dirName: string, refs: ChartFileRef[]): Promise<void> {
  bsb.phase = 'scanning'
  bsb.dirName = dirName
  bsb.error = ''
  bsb.scanned = 0
  bsb.total = refs.length
  try {
    const stored = await kvGet<{ dirName: string; entries: CatalogEntry[] }>(KEY_CATALOG)
    const cache = new Map((stored?.dirName === dirName ? stored.entries : []).map((e) => [e.id, e]))
    const res = await scanCharts(refs, {
      cache,
      onProgress: (done, total) => {
        bsb.scanned = done
        bsb.total = total
      },
    })
    if (!res.charts.length) {
      bsb.phase = 'error'
      bsb.error = 'Aucune carte .kap exploitable dans ce dossier.'
      return
    }
    getBsbEngine().setCatalog(refs, res.charts)
    bsb.count = res.charts.length
    bsb.skipped = res.skipped
    const scales = res.charts.map((c: ChartInfo) => c.header.scale).filter((s) => s > 0)
    bsb.scaleMin = scales.length ? Math.min(...scales) : 0
    bsb.scaleMax = scales.length ? Math.max(...scales) : 0
    bsb.phase = 'ready'
    bsb.version++
    void kvSet(KEY_CATALOG, { dirName, entries: res.entries })
  } catch (e) {
    bsb.phase = 'error'
    bsb.error = e instanceof Error ? e.message : String(e)
  }
}

/** Ouvre le sélecteur de dossier du système (à appeler depuis un clic). */
export async function pickDirectory(): Promise<void> {
  const picker = (window as unknown as { showDirectoryPicker?: (o: object) => Promise<DirHandleLike> }).showDirectoryPicker
  if (!picker) return
  let handle: DirHandleLike
  try {
    handle = await picker.call(window, { id: 'bsb-charts', mode: 'read' })
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') return // l'utilisateur a refermé le sélecteur
    bsb.phase = 'error'
    bsb.error = e instanceof Error ? e.message : String(e)
    return
  }
  void kvSet(KEY_DIR, handle)
  pendingHandle = handle
  await load(handle.name, await listDirectory(handle))
}

/** Dossier choisi avec un <input webkitdirectory> (navigateurs sans sélecteur de dossier). */
export async function pickFromFileList(files: FileList | null): Promise<void> {
  const list = Array.from(files ?? [])
  if (!list.length) return
  const first = (list[0] as File & { webkitRelativePath?: string }).webkitRelativePath ?? ''
  // ce dossier-ci remplace le dossier mémorisé (qui ne servirait plus qu'à prêter à confusion)
  pendingHandle = null
  void kvSet(KEY_DIR, null)
  await load(first.split('/')[0] || 'dossier', refsFromFileList(list))
}

/** Au premier besoin : retrouve le dossier mémorisé ; sans autorisation en cours, demande à l'utilisateur de la confirmer. */
export async function restoreDirectory(): Promise<void> {
  if (restored || bsb.phase !== 'empty') return
  restored = true
  const handle = await kvGet<DirHandleLike>(KEY_DIR)
  if (!handle || typeof handle.values !== 'function') return
  pendingHandle = handle
  bsb.dirName = handle.name
  const perm = (await handle.queryPermission?.({ mode: 'read' })) ?? 'prompt'
  if (perm === 'granted') await load(handle.name, await listDirectory(handle))
  else bsb.phase = 'needs-permission'
}

/** Confirme l'accès au dossier mémorisé (à appeler depuis un clic). */
export async function grantAccess(): Promise<void> {
  const handle = pendingHandle
  if (!handle) return
  const perm = (await handle.requestPermission?.({ mode: 'read' })) ?? 'denied'
  if (perm === 'granted') await load(handle.name, await listDirectory(handle))
}

/** Oublie le dossier : plus aucune carte n'est lue, le dossier mémorisé est effacé. */
export async function forgetDirectory(): Promise<void> {
  pendingHandle = null
  getBsbEngine().setCatalog([], [])
  await kvSet(KEY_DIR, null)
  await kvSet(KEY_CATALOG, null)
  Object.assign(bsb, { phase: 'empty', dirName: '', count: 0, scanned: 0, total: 0, skipped: [], scaleMin: 0, scaleMax: 0, error: '' })
  bsb.version++
}
