// Fond de carte partagé par les fenêtres à carte (« Position du bateau », « Éditeur de waypoints ») : le choix de l'utilisateur
// (fond + couches Shom) est le même partout et mémorisé dans le navigateur.

import { ref, watch } from 'vue'
import L from 'leaflet'
import {
  BSB_MIN_ZOOM,
  DEFAULT_BASE,
  SHOM_OVERLAYS,
  baseLayers,
  baseMinZoom,
  isBaseId,
  parseShomSelection,
  shomOverlaySpec,
  type BaseId,
} from '@/gp39/basemaps'
import { createBsbLayer } from '@/gp39/bsb/layer'
import { bsb, getBsbEngine, restoreDirectory } from './useBsb'

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
  let tileLayers: L.GridLayer[] = []

  function applyBaseMap(): void {
    const map = getMap()
    if (!map) return
    for (const l of tileLayers) map.removeLayer(l)
    tileLayers = []
    // cartes BSB : un moteur de tuiles propre (lecture à la demande du dossier choisi), au-dessous de tout le reste
    const bsbOn = baseMap.value === 'bsb' && bsb.phase === 'ready'
    if (bsbOn) {
      const layer = createBsbLayer(getBsbEngine(), { zIndex: 1, minZoom: BSB_MIN_ZOOM })
      layer.addTo(map)
      tileLayers.push(layer)
    }
    const specs = [...baseLayers(baseMap.value), ...SHOM_OVERLAYS.filter((o) => shomLayers.value.includes(o.id)).map(shomOverlaySpec)]
    specs.forEach((sp, i) => {
      const options = {
        attribution: sp.attribution,
        maxZoom: sp.maxZoom,
        ...(sp.minZoom !== undefined ? { minZoom: sp.minZoom } : {}),
        ...(sp.maxNativeZoom !== undefined ? { maxNativeZoom: sp.maxNativeZoom } : {}),
        crossOrigin: true,
        zIndex: i + 1 + (bsbOn ? 1 : 0),
      }
      const layer = sp.wms
        ? L.tileLayer.wms(sp.url, { ...options, layers: sp.wms.layers, format: 'image/png', transparent: true, version: '1.3.0' })
        : L.tileLayer(sp.url, options)
      layer.addTo(map)
      tileLayers.push(layer)
    })
    // la carte Shom n'existe pas sous le zoom 6 : Leaflet remonte alors le zoom courant (BSB : seulement une fois les cartes chargées)
    map.setMinZoom(baseMap.value === 'bsb' && !bsbOn ? 2 : baseMinZoom(baseMap.value))
  }

  /** À appeler quand la carte est détruite : les couches disparaissent avec elle. */
  function releaseBaseMap(): void {
    tileLayers = []
  }

  watch(baseMap, applyBaseMap)
  watch(shomLayers, applyBaseMap, { deep: true })
  // nouveau dossier de cartes BSB (ou dossier oublié) : la couche est recréée avec le nouveau catalogue
  watch(() => bsb.version, applyBaseMap)
  // fond BSB choisi : retrouve le dossier mémorisé (une seule fois, quelle que soit la fenêtre)
  watch(
    baseMap,
    (v) => {
      if (v === 'bsb') void restoreDirectory()
    },
    { immediate: true },
  )
  return { applyBaseMap, releaseBaseMap }
}
