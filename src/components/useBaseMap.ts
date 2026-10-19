// Fond de carte partagé par les fenêtres à carte (« Position du bateau », « Éditeur de waypoints ») : le choix de l'utilisateur
// (fond + couches Shom) est le même partout et mémorisé dans le navigateur.

import { ref, watch } from 'vue'
import L from 'leaflet'
import {
  DEFAULT_BASE,
  SHOM_OVERLAYS,
  baseLayers,
  baseMinZoom,
  normaliseBase,
  parseShomSelection,
  shomOverlaySpec,
  type BaseId,
} from '@/gp39/basemaps'
import { createChartsLayer } from '@/gp39/chartsLayer'
import { chartsNotice, createChartsNotice } from './chartsNotice'
import { charts, chartsMinZoom, getBsbEngine, getCm93Engine, getMbtilesEngine, restoreDirectory } from './useCharts'

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
export const baseMap = ref<BaseId>(normaliseBase(stored))
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
  let notice: L.Control | null = null

  /** Message sur la carte tant que le fond « Cartes marines » est choisi sans que le dossier soit prêt (sinon la carte reste vide, sans explication). */
  function updateNotice(): void {
    notice?.remove()
    notice = null
    const map = getMap()
    const n = baseMap.value === 'charts' ? chartsNotice() : null
    if (map && n) notice = createChartsNotice(n).addTo(map)
  }

  function applyBaseMap(): void {
    const map = getMap()
    if (!map) return
    for (const l of tileLayers) map.removeLayer(l)
    tileLayers = []
    // cartes du dossier de l'utilisateur : un moteur de tuiles par format présent (lecture à la demande), au-dessous de tout le reste
    const chartsOn = baseMap.value === 'charts' && charts.phase === 'ready'
    if (chartsOn) {
      const layer = createChartsLayer(
        {
          bsb: charts.formats.includes('bsb') ? getBsbEngine() : null,
          cm93: charts.formats.includes('cm93') ? getCm93Engine() : null,
          mbtiles: charts.formats.includes('mbtiles') ? getMbtilesEngine() : null,
        },
        { zIndex: 1, minZoom: chartsMinZoom(), mbtilesAttribution: charts.mbtiles.attribution },
      )
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
        zIndex: i + 1 + (chartsOn ? 1 : 0),
      }
      const layer = sp.wms
        ? L.tileLayer.wms(sp.url, { ...options, layers: sp.wms.layers, format: 'image/png', transparent: true, version: '1.3.0' })
        : L.tileLayer(sp.url, options)
      layer.addTo(map)
      tileLayers.push(layer)
    })
    // la carte Shom n'existe pas sous le zoom 6 : Leaflet remonte alors le zoom courant (cartes du dossier : seulement une fois chargées)
    map.setMinZoom(baseMap.value === 'charts' ? (chartsOn ? chartsMinZoom() : 2) : baseMinZoom(baseMap.value))
    updateNotice()
  }

  /** À appeler quand la carte est détruite : les couches disparaissent avec elle. */
  function releaseBaseMap(): void {
    tileLayers = []
    notice = null
  }

  watch(baseMap, applyBaseMap)
  watch(shomLayers, applyBaseMap, { deep: true })
  // nouveau dossier de cartes (ou dossier oublié) : la couche est recréée avec le nouveau catalogue
  watch(() => charts.version, applyBaseMap)
  // avancement de l'analyse, accès à confirmer, erreur : le message de la carte suit
  watch(() => [charts.phase, charts.step, charts.files, charts.scanned, charts.error], updateNotice)
  // fond « cartes marines » choisi : retrouve le dossier mémorisé (une seule fois, quelle que soit la fenêtre)
  watch(
    baseMap,
    (v) => {
      if (v === 'charts') void restoreDirectory()
    },
    { immediate: true },
  )
  return { applyBaseMap, releaseBaseMap }
}
