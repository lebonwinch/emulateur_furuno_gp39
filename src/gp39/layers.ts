// Calques de l'éditeur de waypoints (un par fichier GPX importé) et outils d'édition : domaine pur, testé sans navigateur.

import type { Layer, Route, Waypoint } from './types'

/** Calque qui reçoit les waypoints créés sur l'appareil (MARK, MOB…) et les anciennes données sans calque. */
export const DEVICE_LAYER_NAME = 'Appareil'
export const MAX_LAYER_NAME = 40

/** Nom de calque valide : sans caractères de contrôle, 40 caractères au plus, `fallback` si vide. */
export function cleanLayerName(raw: string, fallback = 'Calque'): string {
  const s = Array.from(raw)
    .filter((c) => c.charCodeAt(0) >= 32)
    .join('')
    .trim()
  return Array.from(s).slice(0, MAX_LAYER_NAME).join('') || fallback
}

/**
 * Rattache à un calque tout waypoint qui n'en a pas (anciennes données) ou dont le calque n'existe plus.
 * Ces waypoints vont dans le calque « Appareil », créé au besoin. MODIFIE les waypoints reçus (appel après chargement).
 */
export function normaliseLayers(waypoints: readonly Waypoint[], layers: readonly Layer[]): { layers: Layer[]; assigned: number } {
  const out: Layer[] = []
  const ids = new Set<number>()
  for (const l of layers) {
    if (ids.has(l.id)) continue
    ids.add(l.id)
    out.push({ id: l.id, name: cleanLayerName(l.name), visible: l.visible !== false })
  }
  let deviceId: number | undefined
  let assigned = 0
  for (const w of waypoints) {
    if (w.layer !== undefined && ids.has(w.layer)) continue
    if (deviceId === undefined) {
      const existing = out.find((l) => l.name === DEVICE_LAYER_NAME)
      if (existing) deviceId = existing.id
      else {
        deviceId = Math.max(0, ...out.map((l) => l.id)) + 1
        out.push({ id: deviceId, name: DEVICE_LAYER_NAME, visible: true })
        ids.add(deviceId)
      }
    }
    w.layer = deviceId
    assigned++
  }
  return { layers: out, assigned }
}

/** Nombre de waypoints par calque (le Quick Point n'est pas un waypoint de l'utilisateur). */
export function layerCounts(waypoints: readonly Waypoint[]): Map<number, number> {
  const m = new Map<number, number>()
  for (const w of waypoints) {
    if (w.qp || w.layer === undefined) continue
    m.set(w.layer, (m.get(w.layer) ?? 0) + 1)
  }
  return m
}

export interface GeoBox {
  south: number
  west: number
  north: number
  east: number
}

/** Waypoints dont la position est dans le rectangle (bornes comprises) et que `include` accepte. */
export function waypointsInBox(waypoints: readonly Waypoint[], box: GeoBox, include: (w: Waypoint) => boolean = () => true): Waypoint[] {
  return waypoints.filter((w) => w.lat >= box.south && w.lat <= box.north && w.lon >= box.west && w.lon <= box.east && include(w))
}

// position arrondie à 1e-5° (≈ 1 m)
const q5 = (v: number): number => Math.round(v * 1e5)

/** Clé de doublon : même nom, même position à 1 m près, même symbole, même couleur. */
export function duplicateKey(w: Pick<Waypoint, 'name' | 'lat' | 'lon' | 'symbol' | 'color'>): string {
  return `${w.name}|${q5(w.lat)},${q5(w.lon)}|${w.symbol}|${w.color}`
}

/**
 * Contenu d'un export : sans Quick Point ; si `layerIds` est fourni, seulement les waypoints de ces calques et les routes
 * dont tous les points y sont (une route amputée de certains points n'aurait plus de sens).
 */
export function selectForExport(
  waypoints: readonly Waypoint[],
  routes: readonly Route[],
  layerIds: ReadonlySet<number> | null,
): { waypoints: Waypoint[]; routes: Route[] } {
  const wpts = waypoints.filter((w) => !w.qp && (!layerIds || (w.layer !== undefined && layerIds.has(w.layer))))
  if (!layerIds) return { waypoints: wpts, routes: [...routes] }
  const ids = new Set(wpts.map((w) => w.id))
  return { waypoints: wpts, routes: routes.filter((r) => r.points.every((p) => ids.has(p.wptId))) }
}
