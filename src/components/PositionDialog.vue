<template>
  <q-dialog
    v-model="open"
    :maximized="$q.screen.lt.md"
    persistent
    transition-show="fade"
    transition-hide="fade"
    @show="onShow"
    @hide="onHide"
  >
    <q-card class="pos-card column no-wrap">
      <q-card-section class="row items-center q-py-sm bg-grey-10 text-grey-2">
        <q-icon name="my_location" size="sm" class="q-mr-sm" />
        <div class="text-subtitle1">Position du bateau et simulation</div>
        <q-space />
        <q-btn flat round dense icon="close" aria-label="Fermer" @click="open = false" />
      </q-card-section>

      <div class="body col row no-wrap">
        <div class="map-col col">
          <div ref="mapEl" class="map" />
          <div class="map-hint">
            <template v-if="dev.isSim">
              Faites glisser le bateau ⛵ pour changer la position courante · molette ou +/− pour zoomer
            </template>
            <template v-else> Position donnée par le GPS de l’appareil · molette ou +/− pour zoomer </template>
          </div>
        </div>

        <q-scroll-area class="side">
          <div class="q-pa-md q-gutter-y-md">
            <div>
              <div class="text-overline">Source de la position</div>
              <PositionSource detail />
            </div>

            <q-separator />

            <div>
              <div class="text-overline">Position</div>
              <div class="row q-col-gutter-sm">
                <div class="col-6">
                  <q-input
                    v-model.number="latInput"
                    dense
                    outlined
                    type="number"
                    step="0.0001"
                    label="Latitude (°)"
                    :readonly="!dev.isSim"
                    @keyup.enter="applyInputs"
                    @blur="applyInputs"
                  />
                </div>
                <div class="col-6">
                  <q-input
                    v-model.number="lonInput"
                    dense
                    outlined
                    type="number"
                    step="0.0001"
                    label="Longitude (°)"
                    :readonly="!dev.isSim"
                    @keyup.enter="applyInputs"
                    @blur="applyInputs"
                  />
                </div>
              </div>
              <div class="text-caption text-grey-7 q-mt-xs mono">{{ dmText }}</div>
              <div v-if="dev.isSim" class="row q-gutter-xs q-mt-sm">
                <q-btn v-for="p in PRESETS" :key="p.name" dense no-caps size="sm" outline :label="p.name" @click="goTo(p.lat, p.lon)" />
              </div>
            </div>

            <q-separator v-if="dev.isSim" />

            <div v-if="dev.isSim">
              <div class="text-overline">Déplacement simulé</div>
              <q-toggle v-model="dev.sim.moving" label="Le bateau avance" />
              <div class="text-caption q-mt-sm">Vitesse (SOG) : {{ dev.sim.speed.toFixed(1) }} kn</div>
              <q-slider v-model="dev.sim.speed" :min="0" :max="40" :step="0.5" label dense />
              <div class="text-caption">Cap (COG vrai) : {{ Math.round(dev.sim.course) }}°</div>
              <q-slider v-model="dev.sim.course" :min="0" :max="359" :step="1" label dense :disable="dev.sim.courseMode === 'Auto'" />
              <q-toggle
                :model-value="dev.sim.courseMode === 'Auto'"
                label="Route circulaire (mode Auto)"
                @update:model-value="(v: boolean) => (dev.sim.courseMode = v ? 'Auto' : 'Manual')"
              />
            </div>

            <q-separator v-if="dev.isSim" />

            <div v-if="dev.isSim">
              <div class="text-overline">Récepteur GPS</div>
              <q-select v-model="dev.sim.forcedFix" dense outlined emit-value map-options :options="FIX_OPTIONS" label="État du fix" />
              <q-toggle v-model="dev.sim.demo" label="Mode Demo (SIM)" class="q-mt-sm" />
              <div class="row q-col-gutter-sm q-mt-xs">
                <div class="col-6"
                  ><q-input v-model.number="dev.sim.volts" dense outlined type="number" step="0.1" label="Tension (V)"
                /></div>
                <div class="col-6"
                  ><q-input v-model.number="dev.sim.altitude" dense outlined type="number" step="0.5" label="Altitude (m)"
                /></div>
              </div>
            </div>

            <q-separator />

            <BaseMapPicker />

            <div>
              <q-toggle v-model="showWpts" label="Afficher les waypoints" />
              <q-toggle v-model="follow" label="La carte suit le bateau" />
              <div class="row q-gutter-sm q-mt-sm">
                <q-btn dense no-caps outline icon="center_focus_strong" label="Centrer" @click="centerMap" />
                <q-btn dense no-caps outline icon="fit_screen" label="Tous les waypoints" @click="fitWaypoints" />
              </div>
            </div>
          </div>
        </q-scroll-area>
      </div>
    </q-card>
  </q-dialog>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { useDevice } from '@/stores/device'
import { WaypointCanvasLayer } from '@/gp39/leafletMarks'
import { formatLat, formatLon } from '@/gp39/format'
import { centerOnShip } from '@/gp39/ui/plotter'
import BaseMapPicker from './BaseMapPicker.vue'
import PositionSource from './PositionSource.vue'
import { readPref, useBaseMap, writePref } from './useBaseMap'

const open = defineModel<boolean>({ default: false })
const dev = useDevice()

const PRESETS = [
  { name: 'Brest', lat: 48.3824, lon: -4.4952 },
  { name: 'Roscoff', lat: 48.7258, lon: -3.9791 },
  { name: 'Lorient', lat: 47.7208, lon: -3.3517 },
  { name: 'Quiberon', lat: 47.4786, lon: -3.1217 },
  { name: 'Saint-Nazaire', lat: 47.2641, lon: -2.2125 },
]
const FIX_OPTIONS = [
  { label: 'Automatique (satellites)', value: 'auto' },
  { label: '--- (pas de fix)', value: '---' },
  { label: '2D', value: '2D' },
  { label: '3D', value: '3D' },
  { label: 'S2D (SBAS)', value: 'S2D' },
  { label: 'S3D (SBAS)', value: 'S3D' },
  { label: 'DOP', value: 'DOP' },
]

const mapEl = ref<HTMLElement | null>(null)
let map: L.Map | null = null
let boat: L.Marker | null = null
/** disque d'incertitude de la position du GPS de l'appareil */
let accuracyCircle: L.Circle | null = null
let wptLayer: WaypointCanvasLayer | null = null
let dragging = false

const latInput = ref<number>(dev.ship.lat)
const lonInput = ref<number>(dev.ship.lon)
const dmText = computed(() => `${formatLat(dev.ship.lat)}  ${formatLon(dev.ship.lon)}`)

// fond de carte : choix partagé avec l'éditeur de waypoints
const { applyBaseMap, releaseBaseMap } = useBaseMap(() => map)
const showWpts = ref(readPref('gp39.showwpts', '1') === '1')
const follow = ref(readPref('gp39.follow', '1') === '1')
watch(showWpts, (v) => {
  writePref('gp39.showwpts', v ? '1' : '0')
  refreshWaypoints()
})
watch(follow, (v) => writePref('gp39.follow', v ? '1' : '0'))

function boatIcon(cog: number): L.DivIcon {
  return L.divIcon({
    className: 'boat-icon',
    iconSize: [44, 44],
    iconAnchor: [22, 22],
    html: `<svg viewBox="-22 -22 44 44" width="44" height="44"><circle r="20" fill="rgba(255,255,255,.55)" stroke="#111" stroke-width="1.5"/><g transform="rotate(${cog})"><polygon points="0,-15 9,12 0,6 -9,12" fill="#111" stroke="#fff" stroke-width="1.5"/></g></svg>`,
  })
}

function onShow(): void {
  void nextTick(() => {
    if (!mapEl.value || map) return
    map = L.map(mapEl.value, { zoomControl: true, preferCanvas: true, worldCopyJump: true, minZoom: 2, maxZoom: 19 })
    map.setView([dev.ship.lat, dev.ship.lon], 11)
    applyBaseMap()
    // les waypoints gardent leur pictogramme GP-39 (GP39Symbol) et leur couleur (FECColor)
    wptLayer = new WaypointCanvasLayer(() => dev.waypoints)
    boat = L.marker([dev.ship.lat, dev.ship.lon], {
      draggable: true,
      icon: boatIcon(dev.ship.cog),
      zIndexOffset: 1000,
      title: 'Position courante : glisser pour déplacer',
    }).addTo(map)
    applySource()
    boat.on('dragstart', () => (dragging = true))
    boat.on('drag', () => {
      const p = boat!.getLatLng()
      setPos(p.lat, p.lng)
    })
    boat.on('dragend', () => {
      dragging = false
      const p = boat!.getLatLng()
      setPos(p.lat, p.lng)
    })
    map.on('dblclick', (e: L.LeafletMouseEvent) => {
      if (dev.isSim) goTo(e.latlng.lat, e.latlng.lng)
    })
    map.doubleClickZoom.disable()
    refreshWaypoints()
    setTimeout(() => map?.invalidateSize(), 150)
  })
}

function refreshWaypoints(): void {
  if (!map || !wptLayer) return
  if (showWpts.value) {
    if (map.hasLayer(wptLayer)) wptLayer.redraw()
    else wptLayer.addTo(map)
  } else if (map.hasLayer(wptLayer)) map.removeLayer(wptLayer)
}

/** Selon la source : bateau déplaçable à la main (simulée) ou imposé par le GPS de l'appareil, avec son disque d'incertitude. */
function applySource(): void {
  if (!map || !boat) return
  if (dev.isSim) boat.dragging?.enable()
  else boat.dragging?.disable()
  const acc = dev.gps.accuracy
  if (!dev.isSim && dev.fix !== '---' && acc !== null) {
    if (!accuracyCircle)
      accuracyCircle = L.circle([dev.ship.lat, dev.ship.lon], {
        radius: acc,
        weight: 1,
        color: '#1976d2',
        fillOpacity: 0.12,
        interactive: false,
      }).addTo(map)
    else accuracyCircle.setLatLng([dev.ship.lat, dev.ship.lon]).setRadius(acc)
  } else if (accuracyCircle) {
    accuracyCircle.remove()
    accuracyCircle = null
  }
}

/** Déplace le bateau : mise à jour immédiate de l'appareil, de la carte et des champs. */
function setPos(lat: number, lon: number): void {
  if (!dev.setShipPosition(lat, lon, { jump: true })) {
    // la position vient du GPS de l'appareil : le bateau revient où il est
    boat?.setLatLng([dev.ship.lat, dev.ship.lon])
    return
  }
  centerOnShip()
  latInput.value = Number(dev.ship.lat.toFixed(6))
  lonInput.value = Number(dev.ship.lon.toFixed(6))
  if (boat && !dragging) boat.setLatLng([dev.ship.lat, dev.ship.lon])
}

function goTo(lat: number, lon: number): void {
  setPos(lat, lon)
  map?.setView([lat, lon], Math.max(map.getZoom(), 11), { animate: true })
}

function applyInputs(): void {
  if (!dev.isSim) return
  if (
    Number.isFinite(latInput.value) &&
    Number.isFinite(lonInput.value) &&
    Math.abs(latInput.value) <= 90 &&
    Math.abs(lonInput.value) <= 180
  ) {
    if (Math.abs(latInput.value - dev.ship.lat) > 1e-7 || Math.abs(lonInput.value - dev.ship.lon) > 1e-7)
      goTo(latInput.value, lonInput.value)
  }
}

function centerMap(): void {
  map?.setView([dev.ship.lat, dev.ship.lon], map.getZoom())
}

function fitWaypoints(): void {
  if (!map || !dev.waypoints.length) return
  const pts = dev.waypoints.map((w) => [w.lat, w.lon] as [number, number])
  map.fitBounds(L.latLngBounds(pts).pad(0.05))
}

// le bateau avance : on suit sur la carte
watch(
  () => [dev.ship.lat, dev.ship.lon, dev.ship.cog] as const,
  ([lat, lon, cog]) => {
    if (!map || !boat || dragging) return
    boat.setLatLng([lat, lon])
    boat.setIcon(boatIcon(cog))
    latInput.value = Number(lat.toFixed(6))
    lonInput.value = Number(lon.toFixed(6))
    if (follow.value && !map.getBounds().pad(-0.2).contains([lat, lon])) map.panTo([lat, lon], { animate: true })
    applySource()
  },
)
watch(() => [dev.isSim, dev.fix, dev.gps.accuracy] as const, applySource)
watch(() => dev.wptVersion, refreshWaypoints)

function onHide(): void {
  map?.remove()
  map = null
  boat = null
  accuracyCircle = null
  wptLayer = null
  releaseBaseMap()
}
onBeforeUnmount(onHide)
</script>

<style lang="scss">
.pos-card {
  width: min(1100px, 96vw);
  height: min(720px, 92vh);
  max-width: 100vw !important;
  .body {
    min-height: 0;
  }
  .map-col {
    position: relative;
    min-width: 0;
  }
  .map {
    position: absolute;
    inset: 0;
    background: #d7e5ee;
  }
  .map-hint {
    position: absolute;
    left: 50%;
    bottom: 8px;
    transform: translateX(-50%);
    z-index: 500;
    background: rgba(20, 20, 20, 0.78);
    color: #fff;
    font-size: 12px;
    padding: 3px 10px;
    border-radius: 4px;
    pointer-events: none;
    white-space: nowrap;
  }
  .side {
    width: 330px;
    max-width: 44%;
    border-left: 1px solid rgba(128, 128, 128, 0.35);
  }
  .mono {
    font-family: 'Roboto Mono', monospace;
  }
}
.boat-icon {
  background: transparent;
  border: 0;
}
@media (max-width: 1023px) {
  .pos-card {
    .body {
      flex-direction: column;
    }
    .side {
      width: 100%;
      max-width: 100%;
      height: 42%;
      border-left: 0;
      border-top: 1px solid rgba(128, 128, 128, 0.35);
    }
    .map-col {
      min-height: 40%;
    }
  }
}
</style>
