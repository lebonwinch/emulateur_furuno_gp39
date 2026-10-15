// Fichiers GPX chargés séparément (bloc « Données ») puis fusionnés dans un seul fichier GP39_WptRte.gpx.
// Domaine pur (sans Vue ni Leaflet) pour pouvoir le tester : lecture d'un fichier, fusion, nom du fichier exporté.

import { buildGpx, parseGpx, type ImportedRoute } from './gpx'
import { DEFAULT_COLOR, DEFAULT_SYMBOL } from './symbols'
import { LIMITS, type Route, type Waypoint } from './types'

/** Nombre maximal de fichiers GPX chargés en même temps. */
export const MAX_GPX_SETS = 5
/** Taille maximale d'un fichier GPX lu (le parseur travaille en mémoire sur le texte entier). */
export const MAX_GPX_BYTES = 25 * 1024 * 1024
/** Nom (sans extension) que le GP-39 sait relire. */
export const DEFAULT_EXPORT_NAME = 'GP39_WptRte'

export interface GpxSet {
  id: number
  fileName: string
  /** waypoints du fichier (ids propres au fichier) */
  waypoints: Waypoint[]
  routes: ImportedRoute[]
  /** avertissements de lecture (noms tronqués, points sans nom…) */
  warnings: string[]
}

export type ReadResult = { ok: true; set: GpxSet } | { ok: false; error: string }

/** Lit un fichier GPX ; refuse ceux qui ne contiennent ni `<wpt>` ni `<rte>` (le GP-39 ne lit pas les traces `<trk>`). */
export function readGpxSet(id: number, fileName: string, xml: string): ReadResult {
  const p = parseGpx(xml)
  if (!p.waypoints.length && !p.routes.length) {
    return { ok: false, error: `${fileName} : aucun waypoint ni route (les traces <trk> ne sont pas lues)` }
  }
  return {
    ok: true,
    set: {
      id,
      fileName,
      waypoints: p.waypoints.map((w, i) => ({ ...w, id: i + 1 })),
      routes: p.routes,
      warnings: p.warnings,
    },
  }
}

export interface MergeOptions {
  /** ne répète pas un waypoint (même nom, position, symbole et couleur) ni une route déjà présents dans un fichier précédent */
  dedupe: boolean
}

export interface MergeStats {
  /** waypoints et routes retenus dans le fichier fusionné */
  waypoints: number
  routes: number
  duplicates: number
  droppedWaypoints: number
  droppedRoutes: number
  /** points de route absents des `<wpt>` : un waypoint a été créé pour chacun */
  createdFromRoutes: number
  droppedRoutePoints: number
}

export interface MergeResult {
  waypoints: Waypoint[]
  routes: Route[]
  warnings: string[]
  stats: MergeStats
}

// position arrondie à 1e-5° (≈ 1 m), comme la recherche des points de route à l'import dans l'appareil
const q5 = (v: number): number => Math.round(v * 1e5)
const posKey = (lat: number, lon: number): string => `${q5(lat)},${q5(lon)}`
const namePosKey = (name: string, lat: number, lon: number): string => `${name}|${posKey(lat, lon)}`
const wptKey = (w: Omit<Waypoint, 'id'>): string => `${namePosKey(w.name, w.lat, w.lon)}|${w.symbol}|${w.color}`

/**
 * Fusionne les fichiers dans l'ordre : waypoints de tous les fichiers, puis routes de tous les fichiers (renumérotées de 1 à n).
 * Respecte les limites du GP-39 (10 000 waypoints, 100 routes) et le signale.
 */
export function mergeGpxSets(sets: readonly GpxSet[], opts: MergeOptions): MergeResult {
  const stats: MergeStats = {
    waypoints: 0,
    routes: 0,
    duplicates: 0,
    droppedWaypoints: 0,
    droppedRoutes: 0,
    createdFromRoutes: 0,
    droppedRoutePoints: 0,
  }
  const waypoints: Waypoint[] = []
  const seen = new Set<string>()
  const byNamePos = new Map<string, Waypoint>()
  const byPos = new Map<string, Waypoint>()

  const register = (w: Waypoint): void => {
    if (!byNamePos.has(namePosKey(w.name, w.lat, w.lon))) byNamePos.set(namePosKey(w.name, w.lat, w.lon), w)
    if (!byPos.has(posKey(w.lat, w.lon))) byPos.set(posKey(w.lat, w.lon), w)
  }

  // « doublon » = déjà présent dans un fichier PRÉCÉDENT : les répétitions à l'intérieur d'un même fichier restent
  // (fichier seul exporté tel quel ; ex. les feux à secteurs de waypoints_GP39.gpx partagent une même position)
  for (const s of sets) {
    const inThisFile = new Set<string>()
    for (const w of s.waypoints) {
      if (opts.dedupe) {
        const k = wptKey(w)
        if (seen.has(k)) {
          stats.duplicates++
          continue
        }
        inThisFile.add(k)
      }
      if (waypoints.length >= LIMITS.waypoints) {
        stats.droppedWaypoints++
        continue
      }
      const merged: Waypoint = { ...w, id: waypoints.length + 1 }
      waypoints.push(merged)
      register(merged)
    }
    for (const k of inThisFile) seen.add(k)
  }

  const routes: Route[] = []
  const routeSeen = new Set<string>()
  for (const s of sets) {
    const routesInThisFile = new Set<string>()
    for (const ir of s.routes) {
      const points: Route['points'] = []
      for (const p of ir.points) {
        // même nom ET même position ; à défaut, simple coïncidence de position (comme l'import dans l'appareil)
        let w = byNamePos.get(namePosKey(p.name, p.lat, p.lon)) ?? byPos.get(posKey(p.lat, p.lon))
        if (!w) {
          // route issue d'un autre logiciel : ses points ne sont pas des <wpt> ; sur le GP-39 un point de route est un waypoint
          if (waypoints.length >= LIMITS.waypoints) {
            stats.droppedRoutePoints++
            continue
          }
          w = {
            id: waypoints.length + 1,
            name: p.name,
            lat: p.lat,
            lon: p.lon,
            symbol: DEFAULT_SYMBOL,
            color: DEFAULT_COLOR,
            comment: '',
            display: true,
          }
          waypoints.push(w)
          register(w)
          stats.createdFromRoutes++
        }
        points.push({ wptId: w.id, skip: p.skip })
      }
      if (opts.dedupe) {
        // les ids fusionnés sont les rangs + 1 : waypoints[id - 1]
        const key = `${ir.name}|${points
          .map((p) => {
            const w = waypoints[p.wptId - 1]!
            return `${posKey(w.lat, w.lon)}${p.skip ? 's' : ''}`
          })
          .join(';')}`
        if (routeSeen.has(key)) {
          stats.duplicates++
          continue
        }
        routesInThisFile.add(key)
      }
      if (routes.length >= LIMITS.routes) {
        stats.droppedRoutes++
        continue
      }
      const no = routes.length + 1
      routes.push({ no, name: ir.name || `RT${String(no).padStart(2, '0')}`, comment: ir.comment, points })
    }
    for (const k of routesInThisFile) routeSeen.add(k)
  }

  stats.waypoints = waypoints.length
  stats.routes = routes.length
  const warnings: string[] = []
  if (stats.duplicates) warnings.push(`${stats.duplicates} doublon(s) supprimé(s)`)
  if (stats.droppedWaypoints) warnings.push(`${stats.droppedWaypoints} waypoint(s) ignoré(s) (limite du GP-39 : ${LIMITS.waypoints})`)
  if (stats.droppedRoutes) warnings.push(`${stats.droppedRoutes} route(s) ignorée(s) (limite du GP-39 : ${LIMITS.routes})`)
  if (stats.createdFromRoutes) warnings.push(`${stats.createdFromRoutes} point(s) de route sans waypoint : waypoint créé`)
  if (stats.droppedRoutePoints) warnings.push(`${stats.droppedRoutePoints} point(s) de route ignoré(s) (limite de waypoints atteinte)`)
  return { waypoints, routes, warnings, stats }
}

/** Texte du fichier GP39_WptRte.gpx correspondant à une fusion. */
export function mergedGpxText(m: Pick<MergeResult, 'waypoints' | 'routes'>): string {
  return buildGpx(m.waypoints, m.routes)
}

// noms de périphériques Windows, interdits même suivis d'une extension (CON, NUL.txt, COM1…)
const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i
const TRAILING = /[. ]+$/

/**
 * Nom de fichier d'export valide sous Windows, macOS et Linux, extension `.gpx` comprise : l'utilisateur tape le nom
 * (avec ou sans `.gpx`), les caractères interdits deviennent « _ », un nom vide redonne le nom reconnu par le GP-39.
 */
export function gpxFileName(raw: string): string {
  let base = raw
    .trim()
    .replace(TRAILING, '')
    .replace(/\.gpx$/i, '')
  base = Array.from(base)
    .map((c) => (c.charCodeAt(0) < 32 || '\\/:*?"<>|'.includes(c) ? '_' : c))
    .join('')
  base = base.trim().replace(TRAILING, '')
  if (WINDOWS_RESERVED.test(base)) base = `_${base}`
  const name = Array.from(base).slice(0, 96).join('').replace(TRAILING, '')
  return `${name || DEFAULT_EXPORT_NAME}.gpx`
}
