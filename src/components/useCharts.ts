// Cartes marines de l'utilisateur : dossier choisi, formats reconnus (BSB/KAP, CM93), catalogues, moteurs de tuiles. État partagé
// par les fenêtres à carte. L'utilisateur ne fournit que le dossier ; ce qu'il contient est reconnu d'après le nom des fichiers.
//
// Le navigateur ne laisse lire un dossier qu'avec l'accord de l'utilisateur : « Choisir le dossier » ouvre le sélecteur du
// système (File System Access API : Chrome, Edge…) et mémorise le dossier pour les sessions suivantes (le navigateur redemande
// alors une simple confirmation) ; Firefox et Safari passent par un <input webkitdirectory> et doivent le redemander à chaque fois.

import { reactive } from 'vue'
import { scanCharts, type CatalogEntry, type ChartFileRef, type DirHandleLike } from '@/gp39/bsb/catalog'
import { BsbEngine, createRunner } from '@/gp39/bsb/engine'
import type { ChartInfo } from '@/gp39/bsb/tiles'
import { chartsPixelRatio } from '@/gp39/chartsLayer'
import { parseDictionaries, type Cm93Dict } from '@/gp39/cm93/dict'
import { Cm93Engine, createCm93Runner } from '@/gp39/cm93/engine'
import { SCALES } from '@/gp39/cm93/scales'
import { CHARTS_MIN_ZOOM_RASTER, CHARTS_MIN_ZOOM_VECTOR } from '@/gp39/basemaps'
import { formatsOf, listFolder, listFromFileList, type FolderFormat, type FolderListing } from '@/gp39/library'
import { kvGet, kvSet } from '@/gp39/persist'

const KEY_DIR = 'charts.dir'
/** ancienne clé (époque où seules les cartes BSB existaient) : lue si la nouvelle est vide */
const KEY_DIR_LEGACY = 'bsb.dir'
const KEY_BSB_CATALOG = 'bsb.catalog'

export type ChartsPhase = 'empty' | 'needs-permission' | 'scanning' | 'ready' | 'error'
export type ChartsStep = '' | 'listing' | 'bsb' | 'cm93'

export const charts = reactive({
  phase: 'empty' as ChartsPhase,
  step: '' as ChartsStep,
  dirName: '',
  /** fichiers vus pendant le parcours du dossier */
  files: 0,
  /** en-têtes BSB lus / à lire */
  scanned: 0,
  total: 0,
  /** formats reconnus dans le dossier */
  formats: [] as FolderFormat[],
  bsb: {
    count: 0,
    /** fichiers .kap ignorés (illisibles ou non calés) */
    skipped: [] as { id: string; reason: string }[],
    scaleMin: 0,
    scaleMax: 0,
  },
  cm93: {
    cells: 0,
    /** cellules par échelle (indice 0 = Z … 7 = G) */
    perScale: [] as number[],
  },
  error: '',
  /** incrémenté à chaque nouveau catalogue : les couches s'en servent pour se recréer */
  version: 0,
})

/** Le sélecteur de dossier du système existe-t-il (sinon : <input webkitdirectory>) ? */
export const canPickDirectory = (): boolean => typeof window !== 'undefined' && 'showDirectoryPicker' in window

let bsbEngine: BsbEngine | null = null
let cm93Engine: Cm93Engine | null = null
/** Moteurs de tuiles (créés au premier usage : les Workers ne démarrent que si l'on affiche des cartes de ce format). */
export const getBsbEngine = (): BsbEngine => (bsbEngine ??= new BsbEngine(createRunner()))
export const getCm93Engine = (): Cm93Engine => (cm93Engine ??= new Cm93Engine(createCm93Runner(), chartsPixelRatio))

/** Zoom minimal de la carte quand un dossier est affiché : les cartes vectorielles descendent plus bas que les cartes raster. */
export const chartsMinZoom = (): number => (charts.formats.includes('cm93') ? CHARTS_MIN_ZOOM_VECTOR : CHARTS_MIN_ZOOM_RASTER)

let pendingHandle: DirHandleLike | null = null
let restored = false

const latin1 = new TextDecoder('windows-1252')

function fail(message: string): void {
  charts.phase = 'error'
  charts.step = ''
  charts.error = message
}

async function load(dirName: string, listing: () => Promise<FolderListing>): Promise<void> {
  charts.phase = 'scanning'
  charts.step = 'listing'
  charts.dirName = dirName
  charts.error = ''
  charts.files = 0
  charts.scanned = 0
  charts.total = 0
  try {
    const l = await listing()
    const formats = formatsOf(l)
    if (!formats.length) {
      fail(
        l.cm93.count && !(l.cm93.obj && l.cm93.attr)
          ? 'Cartes CM93 trouvées, mais pas leurs dictionnaires (CM93OBJ.DIC et CM93ATTR.DIC) : ils doivent se trouver dans le dossier choisi.'
          : 'Aucune carte reconnue dans ce dossier (formats pris en charge : BSB/KAP et CM93).',
      )
      return
    }

    // BSB : un en-tête à lire par carte (quelques Ko chacun, résultat mémorisé)
    let bsbCharts: ChartInfo[] = []
    let skipped: { id: string; reason: string }[] = []
    if (formats.includes('bsb')) {
      charts.step = 'bsb'
      charts.total = l.kap.length
      const stored = await kvGet<{ dirName: string; entries: CatalogEntry[] }>(KEY_BSB_CATALOG)
      const cache = new Map((stored?.dirName === dirName ? stored.entries : []).map((e) => [e.id, e]))
      const res = await scanCharts(l.kap, {
        cache,
        onProgress: (done, total) => {
          charts.scanned = done
          charts.total = total
        },
      })
      bsbCharts = res.charts
      skipped = res.skipped
      void kvSet(KEY_BSB_CATALOG, { dirName, entries: res.entries })
    }

    // CM93 : seuls les dictionnaires (quelques dizaines de Ko) sont lus ; les cellules le seront à l'affichage
    let dict: Cm93Dict | null = null
    if (formats.includes('cm93')) {
      charts.step = 'cm93'
      const text = async (ref: ChartFileRef): Promise<string> => latin1.decode(await (await ref.getFile()).arrayBuffer())
      dict = parseDictionaries(await text(l.cm93.obj!), await text(l.cm93.attr!))
      if (dict.classes.filter(Boolean).length < 20 || dict.attrs.filter(Boolean).length < 20) {
        fail('Les dictionnaires CM93 (CM93OBJ.DIC, CM93ATTR.DIC) sont illisibles ou incomplets.')
        return
      }
    }

    const bsbOk = formats.includes('bsb') && bsbCharts.length > 0
    if (formats.includes('bsb') && !bsbOk && formats.length === 1) {
      fail('Aucune carte .kap exploitable dans ce dossier.')
      return
    }
    getBsbEngine().setCatalog(bsbOk ? l.kap : [], bsbCharts)
    if (dict) getCm93Engine().setCatalog(l.cm93, dict)
    else if (cm93Engine) cm93Engine.setCatalog(null, null)

    const scales = bsbCharts.map((c) => c.header.scale).filter((s) => s > 0)
    charts.formats = [...(bsbOk ? (['bsb'] as const) : []), ...(dict ? (['cm93'] as const) : [])]
    charts.bsb = {
      count: bsbCharts.length,
      skipped,
      scaleMin: scales.length ? Math.min(...scales) : 0,
      scaleMax: scales.length ? Math.max(...scales) : 0,
    }
    charts.cm93 = { cells: dict ? l.cm93.count : 0, perScale: dict ? [...l.cm93.perScale] : [] }
    charts.phase = 'ready'
    charts.step = ''
    charts.version++
  } catch (e) {
    fail(e instanceof Error ? e.message : String(e))
  }
}

/** Ouvre le sélecteur de dossier du système (à appeler depuis un clic). */
export async function pickDirectory(): Promise<void> {
  const picker = (window as unknown as { showDirectoryPicker?: (o: object) => Promise<DirHandleLike> }).showDirectoryPicker
  if (!picker) return
  let handle: DirHandleLike
  try {
    handle = await picker.call(window, { id: 'marine-charts', mode: 'read' })
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') return // l'utilisateur a refermé le sélecteur
    fail(e instanceof Error ? e.message : String(e))
    return
  }
  void kvSet(KEY_DIR, handle)
  pendingHandle = handle
  await load(handle.name, () => listFolder(handle, (n) => (charts.files = n)))
}

/** Dossier choisi avec un <input webkitdirectory> (navigateurs sans sélecteur de dossier). */
export async function pickFromFileList(files: FileList | null): Promise<void> {
  const list = Array.from(files ?? [])
  if (!list.length) return
  const first = (list[0] as File & { webkitRelativePath?: string }).webkitRelativePath ?? ''
  // ce dossier-ci remplace le dossier mémorisé (qui ne servirait plus qu'à prêter à confusion)
  pendingHandle = null
  void kvSet(KEY_DIR, null)
  await load(first.split('/')[0] || 'dossier', async () => listFromFileList(list))
}

/** Au premier besoin : retrouve le dossier mémorisé ; sans autorisation en cours, demande à l'utilisateur de la confirmer. */
export async function restoreDirectory(): Promise<void> {
  if (restored || charts.phase !== 'empty') return
  restored = true
  const handle = (await kvGet<DirHandleLike>(KEY_DIR)) ?? (await kvGet<DirHandleLike>(KEY_DIR_LEGACY))
  if (!handle || typeof handle.values !== 'function') return
  pendingHandle = handle
  charts.dirName = handle.name
  const perm = (await handle.queryPermission?.({ mode: 'read' })) ?? 'prompt'
  if (perm === 'granted') await load(handle.name, () => listFolder(handle, (n) => (charts.files = n)))
  else charts.phase = 'needs-permission'
}

/** Confirme l'accès au dossier mémorisé (à appeler depuis un clic). */
export async function grantAccess(): Promise<void> {
  const handle = pendingHandle
  if (!handle) return
  const perm = (await handle.requestPermission?.({ mode: 'read' })) ?? 'denied'
  if (perm === 'granted') await load(handle.name, () => listFolder(handle, (n) => (charts.files = n)))
}

/** Oublie le dossier : plus aucune carte n'est lue, le dossier mémorisé est effacé. */
export async function forgetDirectory(): Promise<void> {
  pendingHandle = null
  bsbEngine?.setCatalog([], [])
  cm93Engine?.setCatalog(null, null)
  await Promise.all([kvSet(KEY_DIR, null), kvSet(KEY_DIR_LEGACY, null), kvSet(KEY_BSB_CATALOG, null)])
  Object.assign(charts, {
    phase: 'empty',
    step: '',
    dirName: '',
    files: 0,
    scanned: 0,
    total: 0,
    formats: [],
    bsb: { count: 0, skipped: [], scaleMin: 0, scaleMax: 0 },
    cm93: { cells: 0, perScale: [] },
    error: '',
  })
  charts.version++
}

/** « 1:50 000 » */
export const scaleText = (denom: number): string => `1:${denom.toLocaleString('fr-FR')}`

/** Échelles CM93 présentes, de la plus petite à la plus grande : « 1:20 000 000 → 1:7 500 » ; chaîne vide s'il n'y en a pas. */
export function cm93ScaleRange(perScale: readonly number[]): string {
  const have = SCALES.filter((_, i) => (perScale[i] ?? 0) > 0)
  if (!have.length) return ''
  return `${scaleText(have[0]!.denom)} → ${scaleText(have[have.length - 1]!.denom)}`
}
