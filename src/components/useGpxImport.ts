// Import de fichiers GPX dans l'appareil, commun aux éditeurs : chaque fichier apporte un calque de waypoints (s'il en a) et ses routes,
// reconstituées à partir des noms de waypoints.

import { useQuasar } from 'quasar'
import { useDevice } from '@/stores/device'
import { MAX_GPX_BYTES } from '@/gp39/gpxFile'

export interface ImportSummary {
  waypoints: number
  routes: number
  layers: number
  /** calque du dernier fichier qui en a créé un */
  lastLayer: number | null
}

/** `skipDuplicates` : ignorer les waypoints déjà présents (même nom, position, symbole, couleur). */
export function useGpxImport(skipDuplicates: () => boolean): { addFiles: (files: File[]) => Promise<ImportSummary> } {
  const $q = useQuasar()
  const dev = useDevice()

  /** Importe les fichiers un par un ; un fichier sans waypoint ni route n'est pas importé. */
  async function addFiles(files: File[]): Promise<ImportSummary> {
    const sum: ImportSummary = { waypoints: 0, routes: 0, layers: 0, lastLayer: null }
    if (!files.length) return sum
    const problems: string[] = []
    const warnings: string[] = []
    for (const f of files) {
      if (f.size > MAX_GPX_BYTES) {
        problems.push(`${f.name} : fichier trop gros (${Math.round(MAX_GPX_BYTES / 1024 / 1024)} Mo au maximum)`)
        continue
      }
      const r = dev.importGpx(await f.text(), 'merge', f.name, { skipDuplicates: skipDuplicates() })
      if (r.layerId === null && !r.routes) {
        problems.push(`${f.name} : ni waypoint ni route importé${r.warnings.length ? ` (${r.warnings[0]})` : ''}`)
        continue
      }
      sum.waypoints += r.waypoints
      sum.routes += r.routes
      if (r.layerId !== null) {
        sum.layers++
        sum.lastLayer = r.layerId
      }
      warnings.push(...r.warnings.filter((w) => !w.includes('sans <name>')).map((w) => `${f.name} : ${w}`))
    }
    if (problems.length) {
      $q.notify({ type: 'warning', message: `${problems.length} fichier(s) non importé(s)`, caption: problems.join(' · '), timeout: 6000 })
    }
    if (sum.layers || sum.routes) {
      const parts = [`${sum.waypoints} waypoints importés dans ${sum.layers} calque(s)`]
      if (sum.routes) parts.push(`${sum.routes} route(s)`)
      $q.notify({
        type: warnings.length ? 'warning' : 'positive',
        message: parts.join(' · '),
        ...(warnings.length ? { caption: warnings.join(' · ') } : {}),
        timeout: 4500,
      })
    }
    return sum
  }

  return { addFiles }
}

/** Fichiers GPX d'un glisser-déposer. */
export const gpxFilesOf = (e: DragEvent): File[] =>
  Array.from(e.dataTransfer?.files ?? []).filter((f) => f.name.toLowerCase().endsWith('.gpx') || f.type.includes('xml'))
