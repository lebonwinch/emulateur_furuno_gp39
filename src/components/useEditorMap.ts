// Carte commune aux éditeurs (« Éditeur de waypoints », « Éditeur de routes ») : même création de la carte Leaflet, même fond de carte
// (choix mémorisé, cartes marines du dossier de l'utilisateur…), même couche de waypoints avec leurs pictogrammes GP-39, même cadrage.
// Chaque éditeur n'ajoute que ses propres interactions.

import { computed, type ComputedRef } from 'vue'
import L from 'leaflet'
import { useDevice } from '@/stores/device'
import { WaypointCanvasLayer, type WaypointLayerOptions } from '@/gp39/leafletMarks'
import type { Waypoint } from '@/gp39/types'
import { useBaseMap } from './useBaseMap'

export interface EditorMapOptions {
  /** waypoints à dessiner */
  waypoints: () => readonly Waypoint[]
  /** anneau de sélection, waypoints masqués, infobulle… (voir WaypointCanvasLayer) */
  layer?: WaypointLayerOptions
}

export interface EditorMap {
  map: L.Map
  layer: WaypointCanvasLayer
}

/** Waypoints des calques affichés (sans le Quick Point) : ce que montrent les éditeurs. */
export function useVisibleWaypoints(): { visibleWaypoints: ComputedRef<Waypoint[]>; totalWaypoints: ComputedRef<number> } {
  const dev = useDevice()
  const visibleWaypoints = computed<Waypoint[]>(() => {
    void dev.wptVersion
    const shown = new Set(dev.layers.filter((l) => l.visible).map((l) => l.id))
    return dev.waypoints.filter((w) => !w.qp && w.layer !== undefined && shown.has(w.layer))
  })
  const totalWaypoints = computed(() => {
    void dev.wptVersion
    return [...dev.layerCounts.values()].reduce((a, b) => a + b, 0)
  })
  return { visibleWaypoints, totalWaypoints }
}

/** À appeler dans le `setup` du composant : les `watch` du fond de carte lui sont rattachés. */
export function useEditorMap(opts: EditorMapOptions): {
  mount: (el: HTMLElement) => EditorMap
  unmount: () => void
  fit: (list: readonly Waypoint[]) => void
} {
  const dev = useDevice()
  let map: L.Map | null = null
  const { applyBaseMap, releaseBaseMap } = useBaseMap(() => map)

  function mount(el: HTMLElement): EditorMap {
    // boxZoom désactivé : le rectangle de sélection (Maj + glisser) est tracé par l'éditeur
    const m = L.map(el, { zoomControl: true, preferCanvas: true, worldCopyJump: true, minZoom: 2, maxZoom: 19, boxZoom: false })
    m.setView([dev.ship.lat, dev.ship.lon], 11)
    map = m
    applyBaseMap()
    // les waypoints gardent leur pictogramme (GP39Symbol) et leur couleur (FECColor)
    const l = new WaypointCanvasLayer(opts.waypoints, opts.layer ?? {})
    l.addTo(m)
    setTimeout(() => map?.invalidateSize(), 150)
    return { map: m, layer: l }
  }

  function unmount(): void {
    map?.remove()
    map = null
    releaseBaseMap()
  }

  /** Cadre la carte sur ces waypoints (sans zoomer au-delà du niveau 15). */
  function fit(list: readonly Waypoint[]): void {
    if (!map || !list.length) return
    map.fitBounds(L.latLngBounds(list.map((w) => [w.lat, w.lon] as [number, number])).pad(0.05), { maxZoom: 15 })
  }

  return { mount, unmount, fit }
}
