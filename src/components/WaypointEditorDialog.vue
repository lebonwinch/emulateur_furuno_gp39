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
    <q-card class="wpe-card column no-wrap">
      <q-card-section class="row items-center q-py-sm bg-grey-10 text-grey-2">
        <q-icon name="edit_location_alt" size="sm" class="q-mr-sm" />
        <div class="text-subtitle1">Éditeur de waypoints</div>
        <q-space />
        <q-btn flat round dense icon="close" aria-label="Fermer" @click="open = false" />
      </q-card-section>

      <div class="toolbar row items-center q-px-sm q-py-xs q-gutter-x-sm q-gutter-y-xs">
        <q-btn-toggle v-model="mode" dense no-caps unelevated toggle-color="primary" :options="modeOptions" />
        <q-btn
          dense
          no-caps
          :outline="!multi"
          :unelevated="multi"
          :color="multi ? 'primary' : 'grey-8'"
          icon="library_add_check"
          label="Multi"
          :aria-pressed="multi"
          @click="multi = !multi"
        >
          <q-tooltip>Ajouter à la sélection au lieu de la remplacer (équivaut à Ctrl, qui manque sur un téléphone)</q-tooltip>
        </q-btn>
        <q-space />
        <span class="text-caption"
          >{{ selected.size }} sélectionné(s) · {{ visibleWaypoints.length }} affiché(s) sur {{ totalWaypoints }}</span
        >
        <q-btn dense no-caps outline icon="fit_screen" label="Tout voir" @click="fitVisible" />
        <q-btn dense no-caps outline icon="deselect" label="Désélectionner" :disable="!selected.size" @click="clearSelection" />
        <q-btn
          dense
          no-caps
          color="negative"
          icon="delete"
          :label="`Supprimer (${selected.size})`"
          :disable="!selected.size"
          @click="requestDelete"
        />
      </div>

      <div class="body col row no-wrap">
        <div class="map-col col">
          <div ref="mapEl" class="map" />
          <div class="map-hint">{{ hint }}</div>
        </div>

        <q-scroll-area class="side">
          <div class="q-pa-md q-gutter-y-md">
            <template v-if="selected.size">
              <WaypointForm :ids="selectedIds" @delete="requestDelete" />
              <q-separator />
            </template>

            <EditorLayersPanel v-model="activeLayerId" @fit="fitLayer" />

            <q-separator />

            <GpxExportPanel />

            <q-separator />

            <BaseMapPicker />
          </div>
        </q-scroll-area>
      </div>
    </q-card>
  </q-dialog>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, shallowRef, watch } from 'vue'
import { useQuasar } from 'quasar'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { useDevice } from '@/stores/device'
import { waypointsInBox } from '@/gp39/layers'
import type { WaypointCanvasLayer } from '@/gp39/leafletMarks'
import { afterBox, afterTap, DRAG_THRESHOLD_PX, pickTolerance, startsBox } from '@/gp39/selection'
import { LIMITS, type Waypoint } from '@/gp39/types'
import BaseMapPicker from './BaseMapPicker.vue'
import EditorLayersPanel from './EditorLayersPanel.vue'
import GpxExportPanel from './GpxExportPanel.vue'
import WaypointForm from './WaypointForm.vue'
import { useEditorMap, useVisibleWaypoints } from './useEditorMap'
import { lastColor, lastSymbol } from './useLastStyle'

const open = defineModel<boolean>({ default: false })
const $q = useQuasar()
const dev = useDevice()

type Mode = 'pan' | 'select' | 'add'
const mode = ref<Mode>('pan')
/** « Multi » : les toucher et rectangles s'ajoutent à la sélection (un téléphone n'a ni Ctrl ni Maj) */
const multi = ref(false)
/** type du dernier pointeur (souris, doigt, stylet) : tolérance de visée et textes d'aide */
const pointerKind = ref('mouse')
const modeOptions = [
  { label: 'Déplacer', value: 'pan', icon: 'pan_tool' },
  { label: 'Sélection', value: 'select', icon: 'highlight_alt' },
  { label: 'Ajouter', value: 'add', icon: 'add_location_alt' },
]

const mapEl = ref<HTMLElement | null>(null)
let map: L.Map | null = null
let wptLayer: WaypointCanvasLayer | null = null
let marker: L.Marker | null = null
let markerWptId = 0
let suppressClickUntil = 0

// ---------------------------------------------------------------- données affichées
const { visibleWaypoints, totalWaypoints } = useVisibleWaypoints()

// ---------------------------------------------------------------- sélection
const NONE: ReadonlySet<number> = new Set()
const selected = shallowRef<ReadonlySet<number>>(NONE)
const selectedIds = computed(() => [...selected.value])
const activeLayerId = ref<number | null>(null)

function setSelection(ids: Iterable<number>): void {
  selected.value = new Set(ids)
}
function clearSelection(): void {
  if (selected.value.size) selected.value = NONE
}
/** Remplace la sélection, sauf si elle ne change pas (évite de redessiner pour rien). */
function applySelection(next: ReadonlySet<number>): void {
  const cur = selected.value
  if (next.size === cur.size && [...next].every((id) => cur.has(id))) return
  selected.value = next
}

watch(visibleWaypoints, (list) => {
  // un waypoint masqué (calque caché) ou supprimé quitte la sélection
  const ids = new Set(list.map((w) => w.id))
  const kept = [...selected.value].filter((id) => ids.has(id))
  if (kept.length !== selected.value.size) setSelection(kept)
  wptLayer?.redraw()
  syncMarker()
})
watch(selected, () => {
  wptLayer?.redraw()
  syncMarker()
})

// ---------------------------------------------------------------- carte
const esc = (t: string): string => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const layerInfo = (w: Waypoint): string => {
  const name = dev.layers.find((l) => l.id === w.layer)?.name
  return name ? `<br><i>Calque : ${esc(name)}</i>` : ''
}

const round7 = (v: number): number => Number(v.toFixed(7))
const wrapLon = (v: number): number => ((((v + 180) % 360) + 360) % 360) - 180

// carte, fond de carte, couche de waypoints et cadrage : communs aux éditeurs (voir useEditorMap)
const editorMap = useEditorMap({
  waypoints: () => visibleWaypoints.value,
  // anneau de sélection dessiné par la couche, sauf pour un seul waypoint : le repère glissable en tient lieu
  layer: { selected: () => (selected.value.size === 1 ? NONE : selected.value), showHidden: true, extra: layerInfo },
})

function onShow(): void {
  void nextTick(() => {
    if (!mapEl.value || map) return
    const m = editorMap.mount(mapEl.value)
    map = m.map
    wptLayer = m.layer
    map.on('click', onMapClick)
    map.getContainer().addEventListener('pointerdown', onPointerDown)
    window.addEventListener('keydown', onKey, true)
    applyMode()
    if (visibleWaypoints.value.length) fitVisible()
    syncMarker()
  })
}

function onHide(): void {
  window.removeEventListener('keydown', onKey, true)
  map?.getContainer().removeEventListener('pointerdown', onPointerDown)
  marker = null
  wptLayer = null
  map = null
  editorMap.unmount()
  mode.value = 'pan'
  multi.value = false
}
onBeforeUnmount(onHide)

const fitWaypoints = (list: readonly Waypoint[]): void => editorMap.fit(list)
const fitVisible = (): void => fitWaypoints(visibleWaypoints.value)
function fitLayer(id: number): void {
  if (dev.layers.find((l) => l.id === id)?.visible === false) dev.setLayerVisible(id, true)
  fitWaypoints(dev.waypoints.filter((w) => w.layer === id && !w.qp))
}

// ---------------------------------------------------------------- modes
/**
 * Curseur selon le mode, puis, en mode « Sélection », le glisser trace un rectangle : la carte ne se déplace plus.
 * La classe du mode est posée à la main : un `:class` Vue réécrirait tout l'attribut `class` de la carte et effacerait les classes
 * de Leaflet (leaflet-container…), donc son découpage : les tuiles déborderaient sur la barre d'outils.
 */
function applyMode(): void {
  const el = mapEl.value
  if (el) {
    el.classList.remove('map--pan', 'map--select', 'map--add')
    el.classList.add(`map--${mode.value}`)
  }
  if (!map) return
  if (mode.value === 'select') map.dragging.disable()
  else map.dragging.enable()
}
watch(mode, applyMode)

const hint = computed(() => {
  if (mode.value === 'add') {
    const name = dev.layers.find((l) => l.id === activeLayerId.value)?.name ?? dev.layers[0]?.name ?? 'Nouveaux waypoints'
    return `Cliquer sur la carte pour créer un waypoint dans « ${name} » · Échap : annuler`
  }
  const touch = pointerKind.value === 'touch' || $q.platform.has.touch
  if (mode.value === 'select') {
    return touch
      ? 'Glisser un doigt pour tracer un rectangle · Multi : ajouter à la sélection · deux doigts : déplacer / zoomer la carte'
      : 'Glisser pour tracer un rectangle de sélection · Ctrl ou Multi : ajouter à la sélection · Suppr : supprimer'
  }
  return touch
    ? 'Toucher un waypoint pour le sélectionner · Multi : en ajouter · mode Sélection : rectangle'
    : 'Cliquer un waypoint pour le sélectionner (Ctrl ou Multi : ajouter) · Maj + glisser : rectangle de sélection · molette : zoom'
})

// ---------------------------------------------------------------- clic et rectangle de sélection
function onMapClick(e: L.LeafletMouseEvent): void {
  if (performance.now() < suppressClickUntil) return // fin d'un rectangle : le clic qui suit ne doit pas vider la sélection
  if (mode.value === 'add') return createAt(e.latlng)
  const hit = wptLayer?.pick(e.containerPoint, pickTolerance(pointerKind.value))
  const o = e.originalEvent
  applySelection(afterTap(selected.value, hit?.id ?? null, o.ctrlKey || o.metaKey || o.shiftKey || multi.value))
}

/**
 * Rectangle de sélection, aux événements « pointeur » : souris, doigt et stylet (les événements souris n'existent pas pour un glissement au
 * doigt). Un second doigt (pincement) abandonne le rectangle et laisse Leaflet zoomer ; l'appui qui ne bouge presque pas reste un toucher.
 */
function onPointerDown(ev: PointerEvent): void {
  pointerKind.value = ev.pointerType
  const m = map
  if (!m || !ev.isPrimary || ev.button !== 0 || !startsBox(mode.value, ev.pointerType, ev.shiftKey)) return
  if ((ev.target as HTMLElement).closest('.leaflet-control, .leaflet-marker-icon')) return
  ev.preventDefault()
  const el = m.getContainer()
  try {
    el.setPointerCapture(ev.pointerId) // le doigt peut sortir de la carte sans que le rectangle se perde
  } catch {
    /* pointeur déjà relâché */
  }
  const start = m.mouseEventToContainerPoint(ev)
  const rect = L.DomUtil.create('div', 'wpe-sel-rect', el)
  let moved = false
  const place = (p: L.Point): void => {
    rect.style.left = `${Math.min(start.x, p.x)}px`
    rect.style.top = `${Math.min(start.y, p.y)}px`
    rect.style.width = `${Math.abs(p.x - start.x)}px`
    rect.style.height = `${Math.abs(p.y - start.y)}px`
  }
  const onMove = (e: PointerEvent): void => {
    if (e.pointerId !== ev.pointerId) return
    const p = m.mouseEventToContainerPoint(e)
    if (Math.abs(p.x - start.x) > DRAG_THRESHOLD_PX || Math.abs(p.y - start.y) > DRAG_THRESHOLD_PX) moved = true
    if (moved) place(p)
  }
  const stop = (): void => {
    window.removeEventListener('pointermove', onMove)
    window.removeEventListener('pointerup', onUp)
    window.removeEventListener('pointercancel', onCancel)
    window.removeEventListener('pointerdown', onOther, true)
    try {
      el.releasePointerCapture(ev.pointerId)
    } catch {
      /* déjà relâché */
    }
    rect.remove()
  }
  const onUp = (e: PointerEvent): void => {
    if (e.pointerId !== ev.pointerId) return
    stop()
    if (!moved || map !== m) return
    suppressClickUntil = performance.now() + 80
    const b = L.latLngBounds(m.containerPointToLatLng(start), m.containerPointToLatLng(m.mouseEventToContainerPoint(e)))
    const hits = waypointsInBox(visibleWaypoints.value, { south: b.getSouth(), west: b.getWest(), north: b.getNorth(), east: b.getEast() })
    applySelection(
      afterBox(
        selected.value,
        hits.map((w) => w.id),
        e.ctrlKey || e.metaKey || multi.value,
      ),
    )
  }
  const onCancel = (e: PointerEvent): void => {
    if (e.pointerId === ev.pointerId) stop()
  }
  const onOther = (e: PointerEvent): void => {
    if (e.pointerId !== ev.pointerId) stop() // deuxième doigt : pincement, pas un rectangle
  }
  window.addEventListener('pointermove', onMove)
  window.addEventListener('pointerup', onUp)
  window.addEventListener('pointercancel', onCancel)
  window.addEventListener('pointerdown', onOther, true)
}

// ---------------------------------------------------------------- repère glissable (un seul waypoint sélectionné)
function syncMarker(): void {
  if (!map) return
  const w = selected.value.size === 1 ? dev.wptById.get([...selected.value][0]!) : undefined
  if (!w) {
    marker?.remove()
    marker = null
    return
  }
  markerWptId = w.id
  if (marker) marker.setLatLng([w.lat, w.lon])
  else {
    marker = L.marker([w.lat, w.lon], {
      draggable: true,
      keyboard: false,
      zIndexOffset: 800,
      title: 'Glisser pour déplacer le waypoint',
      icon: L.divIcon({ className: 'wpe-ring', iconSize: [30, 30], iconAnchor: [15, 15], html: '<div></div>' }),
    }).addTo(map)
    marker.on('dragend', () => {
      const p = marker!.getLatLng()
      dev.updateWaypoint(markerWptId, { lat: round7(Math.max(-90, Math.min(90, p.lat))), lon: round7(wrapLon(p.lng)) })
    })
  }
}

// ---------------------------------------------------------------- création et suppression
/** Calque actif (premier calque à défaut ; créé s'il n'y en a aucun) ; il est affiché pour que le nouveau point soit visible. */
function ensureActiveLayer(): number {
  let layer = dev.layers.find((l) => l.id === activeLayerId.value) ?? dev.layers[0]
  if (!layer) layer = dev.addLayer('Nouveaux waypoints')
  activeLayerId.value = layer.id
  if (!layer.visible) dev.setLayerVisible(layer.id, true)
  return layer.id
}

function createAt(ll: L.LatLng): void {
  const w = dev.addWaypoint({
    lat: round7(ll.lat),
    lon: round7(wrapLon(ll.lng)),
    // le dernier symbole et la dernière couleur choisis (par défaut : rond vert)
    symbol: lastSymbol.value,
    color: lastColor.value,
    layer: ensureActiveLayer(),
  })
  if (!w) {
    $q.notify({ type: 'negative', message: `Limite de ${LIMITS.waypoints} waypoints atteinte`, timeout: 3500 })
    return
  }
  setSelection([w.id])
  mode.value = 'pan'
}

function requestDelete(): void {
  const ids = selectedIds.value
  if (!ids.length) return
  const first = dev.wptById.get(ids[0]!)?.name || '(sans nom)'
  $q.dialog({
    title: ids.length === 1 ? 'Supprimer le waypoint' : 'Supprimer les waypoints',
    message:
      ids.length === 1 ? `Supprimer « ${first} » ?` : `Supprimer les ${ids.length} waypoints sélectionnés ? Cette action est définitive.`,
    cancel: { label: 'Annuler', flat: true },
    ok: { label: 'Supprimer', color: 'negative' },
    persistent: true,
  }).onOk(() => {
    const r = dev.deleteWaypoints(ids)
    if (r.blocked) {
      $q.notify({
        type: 'warning',
        message: `${r.deleted} waypoint(s) supprimé(s), ${r.blocked} conservé(s)`,
        caption: 'Un waypoint est la destination en cours : il ne peut pas être effacé.',
        timeout: 5000,
      })
    } else $q.notify({ type: 'positive', message: `${r.deleted} waypoint(s) supprimé(s)`, timeout: 2000 })
  })
}

/** Échap : quitte le mode Ajouter/Sélection, puis vide la sélection ; Suppr : supprime la sélection (avec confirmation). */
function onKey(e: KeyboardEvent): void {
  if (!open.value || document.querySelectorAll('.q-dialog').length > 1) return // une confirmation est ouverte
  if (e.target instanceof Element && e.target.closest('input, textarea, select, [contenteditable="true"]')) return
  if (e.key === 'Escape') {
    // Échap est aussi la touche MENU de l'appareil : on la garde pour l'éditeur (écoute en phase de capture)
    e.stopPropagation()
    e.preventDefault()
    if (mode.value !== 'pan') mode.value = 'pan'
    else clearSelection()
  } else if ((e.key === 'Delete' || e.key === 'Backspace') && selected.value.size) {
    e.stopPropagation()
    e.preventDefault()
    requestDelete()
  }
}
</script>

<style lang="scss">
.wpe-card {
  width: min(1180px, 96vw);
  height: min(780px, 94vh);
  max-width: 100vw !important;
  .toolbar {
    border-bottom: 1px solid rgba(128, 128, 128, 0.35);
    flex-wrap: wrap;
  }
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
  .map.map--add,
  .map.map--add .leaflet-interactive,
  .map.map--select,
  .map.map--select .leaflet-interactive {
    cursor: crosshair !important;
  }
  /* mode Sélection : le glisser au doigt trace le rectangle, il ne doit être ni défilement de page ni pincement du navigateur
     (sans cela le navigateur envoie pointercancel dès le début du geste) ; Leaflet garde le pincement à deux doigts */
  .map.map--select {
    touch-action: none !important;
  }
  .map-hint {
    position: absolute;
    left: 50%;
    bottom: 8px;
    transform: translateX(-50%);
    z-index: 500;
    max-width: 94%;
    background: rgba(20, 20, 20, 0.78);
    color: #fff;
    font-size: 12px;
    padding: 3px 10px;
    border-radius: 4px;
    pointer-events: none;
    text-align: center;
  }
  .side {
    width: 350px;
    max-width: 46%;
    border-left: 1px solid rgba(128, 128, 128, 0.35);
  }
}
.wpe-sel-rect {
  position: absolute;
  z-index: 650;
  border: 2px dashed #ff6d00;
  background: rgba(255, 109, 0, 0.12);
  pointer-events: none;
}
.wpe-ring {
  background: transparent;
  border: 0;
  div {
    width: 30px;
    height: 30px;
    box-sizing: border-box;
    border-radius: 50%;
    border: 3px solid #ff6d00;
    box-shadow:
      0 0 0 2px rgba(255, 255, 255, 0.95),
      inset 0 0 0 2px rgba(255, 255, 255, 0.6);
    cursor: grab;
  }
}
@media (max-width: 1023px) {
  .wpe-card {
    .body {
      flex-direction: column;
    }
    .side {
      width: 100%;
      max-width: 100%;
      height: 46%;
      border-left: 0;
      border-top: 1px solid rgba(128, 128, 128, 0.35);
    }
    .map-col {
      min-height: 40%;
    }
  }
}
</style>
