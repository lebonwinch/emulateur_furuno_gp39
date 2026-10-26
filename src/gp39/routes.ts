// Routes : édition, longueurs, validité et contrôle avant export vers le GP-39 (domaine pur, testé sans navigateur).
//
// Une route est une suite de références à des waypoints (au plus 30), avec un nom de 6 caractères et un commentaire de 18 au plus ;
// l'appareil en garde 100 au plus. Les « skip » sont des points désélectionnés temporairement (manuel §4.2.4) : la navigation les saute.

import { CHARSET_COMMENT, CHARSET_NAME, cleanText, filterText, isDeviceText } from './charset'
import { bearing, distance, type LatLon, type NavMethod } from './geo'
import { LIMITS, type Route, type RoutePoint, type Waypoint } from './types'

export const cleanRouteName = (raw: string): string => cleanText(raw, CHARSET_NAME, LIMITS.routeNameLen)
export const cleanRouteComment = (raw: string): string => cleanText(raw, CHARSET_COMMENT, LIMITS.routeCommentLen)
/** Filtres à la frappe (sans retirer les espaces) */
export const typeRouteName = (raw: string): string => filterText(raw, CHARSET_NAME, LIMITS.routeNameLen)
export const typeRouteComment = (raw: string): string => filterText(raw, CHARSET_COMMENT, LIMITS.routeCommentLen)

/** Route en cours d'édition : une copie, qui n'atteint l'appareil qu'à l'enregistrement. `no` est null pour une route nouvelle. */
export interface RouteDraft {
  no: number | null
  name: string
  comment: string
  points: RoutePoint[]
}

export const emptyDraft = (): RouteDraft => ({ no: null, name: '', comment: '', points: [] })

export const draftFromRoute = (r: Route): RouteDraft => ({
  no: r.no,
  name: r.name,
  comment: r.comment,
  points: r.points.map((p) => ({ wptId: p.wptId, skip: p.skip })),
})

// ---------------------------------------------------------------- liste de points

export type PointResult = { ok: true; points: RoutePoint[]; index: number } | { ok: false; error: string }

/**
 * Ajoute un waypoint à la route, à la fin ou à `at` (0 = en tête). Refus : route pleine (30), ou même waypoint que son voisin
 * (un tronçon de longueur nulle n'a pas de sens).
 */
export function insertPoint(points: readonly RoutePoint[], wptId: number, at: number = points.length): PointResult {
  if (points.length >= LIMITS.routeWaypoints) return { ok: false, error: `Route pleine : ${LIMITS.routeWaypoints} waypoints au plus` }
  const i = Math.max(0, Math.min(points.length, at))
  if (points[i - 1]?.wptId === wptId || points[i]?.wptId === wptId) {
    return { ok: false, error: 'Ce waypoint est déjà voisin de cette position dans la route' }
  }
  const next = points.map((p) => ({ ...p }))
  next.splice(i, 0, { wptId, skip: false })
  return { ok: true, points: next, index: i }
}

export function removePoint(points: readonly RoutePoint[], index: number): RoutePoint[] {
  return points.filter((_, i) => i !== index).map((p) => ({ ...p }))
}

/** Déplace le point `from` à la place `to` (les autres glissent). Un indice hors limites ne change rien. */
export function movePoint(points: readonly RoutePoint[], from: number, to: number): RoutePoint[] {
  const next = points.map((p) => ({ ...p }))
  if (from < 0 || from >= next.length || to < 0 || to >= next.length || from === to) return next
  const [p] = next.splice(from, 1)
  next.splice(to, 0, p!)
  return next
}

export function toggleSkip(points: readonly RoutePoint[], index: number): RoutePoint[] {
  return points.map((p, i) => (i === index ? { ...p, skip: !p.skip } : { ...p }))
}

export const reversePoints = (points: readonly RoutePoint[]): RoutePoint[] => points.map((p) => ({ ...p })).reverse()

// ---------------------------------------------------------------- longueurs

export interface Leg {
  /** indice (dans la route) du point d'arrivée du tronçon */
  index: number
  from: Waypoint
  to: Waypoint
  nm: number
  /** relèvement vrai du début vers la fin (°) */
  brg: number
}

export interface RouteStats {
  legs: Leg[]
  totalNm: number
  /** points qui comptent : présents dans la liste des waypoints et non « skip » */
  activePoints: number
}

/** Tronçons entre points consécutifs retenus (les points « skip » et ceux qui n'existent plus sont sautés), et longueur totale en NM. */
export function routeStats(
  points: readonly RoutePoint[],
  byId: ReadonlyMap<number, Waypoint>,
  method: NavMethod = 'Rhumb Line',
): RouteStats {
  const legs: Leg[] = []
  let prev: Waypoint | undefined
  let active = 0
  let total = 0
  points.forEach((p, index) => {
    const w = byId.get(p.wptId)
    if (!w || p.skip) return
    active++
    if (prev) {
      const nm = distance(prev, w, method)
      legs.push({ index, from: prev, to: w, nm, brg: bearing(prev, w, method) })
      total += nm
    }
    prev = w
  })
  return { legs, totalNm: total, activePoints: active }
}

/** Rectangle englobant la route (pour cadrer la carte), ou null s'il n'y a aucun point. */
export function routeBounds(points: readonly RoutePoint[], byId: ReadonlyMap<number, Waypoint>): [LatLon, LatLon] | null {
  let s = Infinity
  let n = -Infinity
  let w = Infinity
  let e = -Infinity
  for (const p of points) {
    const wp = byId.get(p.wptId)
    if (!wp) continue
    s = Math.min(s, wp.lat)
    n = Math.max(n, wp.lat)
    w = Math.min(w, wp.lon)
    e = Math.max(e, wp.lon)
  }
  return Number.isFinite(s)
    ? [
        { lat: s, lon: w },
        { lat: n, lon: e },
      ]
    : null
}

// ---------------------------------------------------------------- validité

export interface Issues {
  /** empêchent l'enregistrement ou l'export correct */
  errors: string[]
  /** à connaître, sans bloquer */
  warnings: string[]
}

export interface RouteContext {
  routes: readonly Route[]
  byId: ReadonlyMap<number, Waypoint>
  /** nombre de waypoints de chaque nom (pour repérer les ambiguïtés) */
  nameCount: ReadonlyMap<string, number>
}

export function nameCounts(waypoints: Iterable<Waypoint>): Map<string, number> {
  const m = new Map<string, number>()
  for (const w of waypoints) if (w.name && !w.qp) m.set(w.name, (m.get(w.name) ?? 0) + 1)
  return m
}

/** Problèmes des points d'une route (waypoints disparus, sans nom, de nom ambigu ou impossible à saisir sur l'appareil). */
function pointIssues(points: readonly RoutePoint[], ctx: RouteContext, out: Issues): void {
  if (points.length > LIMITS.routeWaypoints)
    out.errors.push(`${points.length} waypoints : une route en accepte ${LIMITS.routeWaypoints} au plus`)
  const missing = points.filter((p) => !ctx.byId.has(p.wptId)).length
  if (missing) out.errors.push(`${missing} waypoint(s) de la route n'existent plus`)
  const unnamed = new Set<number>()
  const ambiguous = new Set<string>()
  const foreign = new Set<string>()
  for (const p of points) {
    const w = ctx.byId.get(p.wptId)
    if (!w) continue
    if (!w.name) unnamed.add(w.id)
    else {
      if ((ctx.nameCount.get(w.name) ?? 0) > 1) ambiguous.add(w.name)
      if (!isDeviceText(w.name, CHARSET_NAME)) foreign.add(w.name)
    }
  }
  const skipped = points.filter((p) => p.skip && ctx.byId.has(p.wptId)).length
  if (skipped) out.warnings.push(`${skipped} point(s) ignoré(s) (skip) : absents du fichier exporté, le format du GP-39 n'a pas de skip`)
  if (unnamed.size) out.errors.push(`${unnamed.size} waypoint(s) sans nom : le GP-39 relie les routes aux waypoints par leur nom`)
  if (ambiguous.size)
    out.warnings.push(`Nom porté par plusieurs waypoints : ${[...ambiguous].slice(0, 4).join(', ')}${ambiguous.size > 4 ? '…' : ''}`)
  if (foreign.size)
    out.warnings.push(
      `Nom avec des caractères que le GP-39 ne saisit pas : ${[...foreign].slice(0, 4).join(', ')}${foreign.size > 4 ? '…' : ''}`,
    )
}

/** Contrôle d'une route en cours d'édition, avant enregistrement. */
export function validateDraft(d: RouteDraft, ctx: RouteContext): Issues {
  const out: Issues = { errors: [], warnings: [] }
  const name = cleanRouteName(d.name)
  if (!name) out.errors.push('Donnez un nom à la route (6 caractères au plus : A-Z, 0-9 et & ( ) + - / = ? > _)')
  else if (ctx.routes.some((r) => r.no !== d.no && r.name.toUpperCase() === name))
    out.errors.push(`Une autre route s'appelle déjà « ${name} »`)
  if (cleanRouteComment(d.comment) !== d.comment.trim().toUpperCase())
    out.warnings.push('Le commentaire sera corrigé : majuscules et caractères du GP-39 seulement')
  pointIssues(d.points, ctx, out)
  const active = d.points.filter((p) => !p.skip && ctx.byId.has(p.wptId)).length
  if (d.points.length < 2) out.warnings.push('Route incomplète : il faut au moins 2 waypoints pour naviguer')
  else if (active < 2) out.warnings.push('Moins de 2 waypoints actifs (les autres sont ignorés)')
  return out
}

/** Contrôle d'une route enregistrée (liste des routes, rapport d'export). */
export function routeIssues(r: Route, ctx: RouteContext): Issues {
  const out: Issues = { errors: [], warnings: [] }
  if (!cleanRouteName(r.name)) out.errors.push('Route sans nom')
  else if (cleanRouteName(r.name) !== r.name) out.warnings.push(`Nom corrigé à l'export : « ${cleanRouteName(r.name)} »`)
  if (ctx.routes.some((o) => o !== r && o.name.toUpperCase() === r.name.toUpperCase()))
    out.warnings.push('Nom déjà utilisé par une autre route')
  if (cleanRouteComment(r.comment) !== r.comment) out.warnings.push("Commentaire corrigé à l'export")
  pointIssues(r.points, ctx, out)
  const active = r.points.filter((p) => !p.skip && ctx.byId.has(p.wptId)).length
  if (r.points.length < 2) out.warnings.push('Route incomplète (moins de 2 waypoints)')
  else if (active < 2) out.warnings.push('Moins de 2 waypoints exportés : la route sera incomplète sur le GP-39')
  return out
}

export interface ExportFinding {
  route: string
  severity: 'error' | 'warning'
  text: string
}

/** Tout ce qui, dans les routes à exporter, empêcherait le GP-39 de les relire correctement. */
export function deviceExportReport(waypoints: readonly Waypoint[], routes: readonly Route[]): ExportFinding[] {
  const byId = new Map(waypoints.map((w) => [w.id, w]))
  const ctx: RouteContext = { routes, byId, nameCount: nameCounts(waypoints) }
  const out: ExportFinding[] = []
  if (routes.length > LIMITS.routes) {
    out.push({ route: '', severity: 'error', text: `${routes.length} routes : le GP-39 en accepte ${LIMITS.routes} au plus` })
  }
  for (const r of routes) {
    const i = routeIssues(r, ctx)
    const label = r.name || `n°${r.no}`
    for (const t of i.errors) out.push({ route: label, severity: 'error', text: t })
    for (const t of i.warnings) out.push({ route: label, severity: 'warning', text: t })
  }
  return out
}
