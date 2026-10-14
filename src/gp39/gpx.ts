// Import / export GPX au format « GP39_WptRte.gpx » (extensions GP39Symbol / FECColor / GP39Comment / GP39Flag).
// Parseur volontairement léger (regex) : il fonctionne dans le navigateur comme sous Node (tests).

import { DEFAULT_COLOR, DEFAULT_SYMBOL } from './symbols'
import { LIMITS } from './types'
import type { Route, Waypoint } from './types'

export interface ImportedRoute {
  name: string
  comment: string
  points: { name: string; lat: number; lon: number; skip: boolean }[]
}

export interface GpxImport {
  waypoints: Omit<Waypoint, 'id'>[]
  routes: ImportedRoute[]
  warnings: string[]
}

const ENTITIES: Record<string, string> = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&apos;': "'" }

function unescapeXml(s: string): string {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&(?:amp|lt|gt|quot|apos);/g, (m) => ENTITIES[m] ?? m)
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCharCode(Number(n)))
}

export function escapeXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function tag(block: string, name: string): string | undefined {
  const m = new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`).exec(block)
  return m ? unescapeXml(m[1]!).trim() : undefined
}

function attr(attrs: string, name: string): number {
  // guillemets doubles ou simples (les deux sont du XML valide)
  const m = new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`).exec(attrs)
  return m ? Number(m[1] ?? m[2]) : NaN
}

function clampInt(v: string | undefined, min: number, max: number, dflt: number): number {
  if (v === undefined || v === '') return dflt
  const n = Math.trunc(Number(v))
  return Number.isFinite(n) && n >= min && n <= max ? n : dflt
}

export function parseGpx(source: string): GpxImport {
  // préfixes d'espace de noms (<gpx:wpt>, <ogr:…>) : ignorés pour simplifier la lecture
  const xml = source.replace(/<(\/?)[A-Za-z][\w.-]*:(?=[A-Za-z_])/g, '<$1')
  const warnings: string[] = []
  const waypoints: GpxImport['waypoints'] = []
  const routes: ImportedRoute[] = []
  let longNames = 0
  let longComments = 0
  let badCoord = 0

  // les routes contiennent des <rtept> : on les retire avant de lire les <wpt>
  const rteBlocks: string[] = []
  const withoutRte = xml.replace(/<rte\b[^>]*>([\s\S]*?)<\/rte>/g, (_m, body: string) => {
    rteBlocks.push(body)
    return ''
  })

  const wptRe = /<wpt\b([^>]*?)(?:\/>|>([\s\S]*?)<\/wpt>)/g
  for (let m = wptRe.exec(withoutRte); m; m = wptRe.exec(withoutRte)) {
    const lat = attr(m[1]!, 'lat')
    const lon = attr(m[1]!, 'lon')
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
      badCoord++
      continue
    }
    const body = m[2] ?? ''
    let name = tag(body, 'name') ?? ''
    if (name.length > LIMITS.nameLen) {
      name = name.slice(0, LIMITS.nameLen)
      longNames++
    }
    let comment = tag(body, 'GP39Comment') ?? tag(body, 'cmt') ?? ''
    if (comment.length > LIMITS.commentLen) {
      comment = comment.slice(0, LIMITS.commentLen)
      longComments++
    }
    waypoints.push({
      name,
      lat,
      lon,
      symbol: clampInt(tag(body, 'GP39Symbol'), 0, 9, DEFAULT_SYMBOL),
      color: clampInt(tag(body, 'FECColor'), 0, 6, DEFAULT_COLOR),
      comment,
      display: tag(body, 'GP39Flag') !== '0',
    })
  }

  for (const body of rteBlocks) {
    const pts: ImportedRoute['points'] = []
    const ptRe = /<rtept\b([^>]*?)(?:\/>|>([\s\S]*?)<\/rtept>)/g
    for (let m = ptRe.exec(body); m; m = ptRe.exec(body)) {
      const lat = attr(m[1]!, 'lat')
      const lon = attr(m[1]!, 'lon')
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue
      pts.push({
        name: (tag(m[2] ?? '', 'name') ?? '').slice(0, LIMITS.nameLen),
        lat,
        lon,
        skip: tag(m[2] ?? '', 'GP39Skip') === '1',
      })
    }
    const head = body.replace(/<rtept\b[\s\S]*?<\/rtept>/g, '')
    routes.push({
      name: (tag(head, 'name') ?? '').slice(0, LIMITS.routeNameLen),
      comment: (tag(head, 'cmt') ?? '').slice(0, LIMITS.routeCommentLen),
      points: pts.slice(0, LIMITS.routeWaypoints),
    })
  }

  if (badCoord) warnings.push(`${badCoord} waypoint(s) avec coordonnées invalides ignoré(s)`)
  if (longNames) warnings.push(`${longNames} nom(s) tronqué(s) à ${LIMITS.nameLen} caractères`)
  if (longComments) warnings.push(`${longComments} commentaire(s) tronqué(s) à ${LIMITS.commentLen} caractères`)
  const unnamed = waypoints.filter((w) => !w.name).length
  if (unnamed) warnings.push(`${unnamed} waypoint(s) sans <name>`)
  if (waypoints.length > LIMITS.waypoints) warnings.push(`${waypoints.length} waypoints (le GP-39 en accepte ${LIMITS.waypoints})`)
  return { waypoints, routes, warnings }
}

const f7 = (n: number): string => n.toFixed(7)

/** Construit le fichier GP39_WptRte.gpx (waypoints puis routes). */
export function buildGpx(waypoints: Waypoint[], routes: Route[]): string {
  const byId = new Map(waypoints.map((w) => [w.id, w]))
  const out: string[] = ['<?xml version="1.0"?>', '<gpx version="1.1" creator="gp39-emulator" xmlns="http://www.topografix.com/GPX/1/1">']
  for (const w of waypoints) {
    out.push(`<wpt lat="${f7(w.lat)}" lon="${f7(w.lon)}">`)
    if (w.name) out.push(`  <name>${escapeXml(w.name)}</name>`)
    out.push('  <extensions>')
    out.push(`    <GP39Symbol>${w.symbol}</GP39Symbol>`)
    out.push(`    <FECColor>${w.color}</FECColor>`)
    if (w.comment) out.push(`    <GP39Comment>${escapeXml(w.comment)}</GP39Comment>`)
    out.push(`    <GP39Flag>${w.display ? 1 : 0}</GP39Flag>`)
    out.push('  </extensions>')
    out.push('</wpt>')
  }
  for (const r of routes) {
    out.push('<rte>')
    out.push(`  <name>${escapeXml(r.name)}</name>`)
    if (r.comment) out.push(`  <cmt>${escapeXml(r.comment)}</cmt>`)
    out.push(`  <number>${r.no}</number>`)
    for (const p of r.points) {
      const w = byId.get(p.wptId)
      if (!w) continue
      out.push(`  <rtept lat="${f7(w.lat)}" lon="${f7(w.lon)}">`)
      if (w.name) out.push(`    <name>${escapeXml(w.name)}</name>`)
      if (p.skip) out.push('    <extensions><GP39Skip>1</GP39Skip></extensions>')
      out.push('  </rtept>')
    }
    out.push('</rte>')
  }
  out.push('</gpx>')
  return out.join('\n') + '\n'
}
