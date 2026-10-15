// Fond de carte partagé par les fenêtres à carte (« Position du bateau », « Éditeur de waypoints ») : le choix de l'utilisateur
// (fond + couches Shom) est le même partout et mémorisé dans le navigateur.

import { ref, watch } from 'vue'
import L from 'leaflet'
import {
  DEFAULT_BASE,
  SHOM_OVERLAYS,
  baseLayers,
  baseMinZoom,
  isBaseId,
  parseShomSelection,
  shomOverlaySpec,
  type BaseId,
} from '@/gp39/basemaps'

export function readPref(k: string, d: string): string {
  try {
    return localStorage.getItem(k) ?? d
  } catch {
    return d
  }
}

export function writePref(k: string, v: string): void {
  try {
    localStorage.setItem(k, v)
  } catch {
    /* stockage indisponible */
  }
}

const stored = readPref('gp39.basemap', DEFAULT_BASE)
/** Fond choisi (partagé par toutes les fenêtres à carte). */
export const baseMap = ref<BaseId>(isBaseId(stored) ? stored : DEFAULT_BASE)
/** Couches Shom libres cochées (partagé). */
export const shomLayers = ref<string[]>(parseShomSelection(readPref('gp39.shomlayers', '[]')))

watch(baseMap, (v) => writePref('gp39.basemap', v))
watch(shomLayers, (v) => writePref('gp39.shomlayers', JSON.stringify(v)), { deep: true })

/**
 * Empile sur la carte le fond choisi puis les couches Shom cochées (dessous : tuiles ; dessus : waypoints et bateau) et
 * redessine quand le choix change. `getMap` renvoie la carte de la fenêtre (ou null si elle est fermée).
 */
export function useBaseMap(getMap: () => L.Map | null): { applyBaseMap: () => void; releaseBaseMap: () => void } {
  let tileLayers: L.TileLayer[] = []

  function applyBaseMap(): void {
    const map = getMap()
    if (!map) return
    for (const l of tileLayers) map.removeLayer(l)
    tileLayers = []
    const specs = [...baseLayers(baseMap.value), ...SHOM_OVERLAYS.filter((o) => shomLayers.value.includes(o.id)).map(shomOverlaySpec)]
    specs.forEach((sp, i) => {
      const options = {
        attribution: sp.attribution,
        maxZoom: sp.maxZoom,
        ...(sp.minZoom !== undefined ? { minZoom: sp.minZoom } : {}),
        ...(sp.maxNativeZoom !== undefined ? { maxNativeZoom: sp.maxNativeZoom } : {}),
        crossOrigin: true,
        zIndex: i + 1,
      }
      const layer = sp.wms
        ? L.tileLayer.wms(sp.url, { ...options, layers: sp.wms.layers, format: 'image/png', transparent: true, version: '1.3.0' })
        : L.tileLayer(sp.url, options)
      layer.addTo(map)
      tileLayers.push(layer)
    })
    // la carte Shom n'existe pas sous le zoom 6 : Leaflet remonte alors le zoom courant
    map.setMinZoom(baseMinZoom(baseMap.value))
  }

  /** À appeler quand la carte est détruite : les couches disparaissent avec elle. */
  function releaseBaseMap(): void {
    tileLayers = []
  }

  watch(baseMap, applyBaseMap)
  watch(shomLayers, applyBaseMap, { deep: true })
  return { applyBaseMap, releaseBaseMap }
}
