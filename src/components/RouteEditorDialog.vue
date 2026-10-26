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
    <q-card class="rte-card column no-wrap" data-testid="route-editor">
      <q-card-section class="row items-center q-py-sm bg-grey-10 text-grey-2">
        <q-icon name="route" size="sm" class="q-mr-sm" />
        <div class="text-subtitle1">Éditeur de routes</div>
        <q-space />
        <q-btn flat round dense icon="close" aria-label="Fermer" @click="requestClose" />
      </q-card-section>

      <div class="toolbar row items-center q-px-sm q-py-xs q-gutter-x-sm q-gutter-y-xs">
        <template v-if="draft">
          <q-icon name="edit_road" color="deep-orange" />
          <span class="text-subtitle2 ellipsis">{{
            draft.no === null ? 'Nouvelle route' : `Modification de « ${draft.name || '…'} »`
          }}</span>
          <q-space />
          <q-btn
            color="primary"
            unelevated
            dense
            no-caps
            icon="save"
            label="Enregistrer"
            data-testid="save-route"
            :disable="!!issues?.errors.length"
            @click="save"
          >
            <q-tooltip v-if="issues?.errors.length">{{ issues.errors[0] }}</q-tooltip>
          </q-btn>
          <q-btn outline dense no-caps icon="close" label="Annuler" data-testid="cancel-route" @click="cancelEdit()" />
        </template>
        <template v-else>
          <q-btn
            color="primary"
            unelevated
            dense
            no-caps
            icon="add_road"
            label="Créer une nouvelle route"
            data-testid="new-route"
            :disable="routesFull"
            @click="startNew()"
          >
            <q-tooltip v-if="routesFull">Le GP-39 garde {{ LIMITS.routes }} routes au plus</q-tooltip>
          </q-btn>
          <q-space />
          <span class="text-caption"
            >{{ dev.routes.length }} route(s) · {{ visibleWaypoints.length }} waypoints affichés sur {{ totalWaypoints }}</span
          >
          <q-btn dense no-caps outline icon="fit_screen" label="Tout voir" @click="fitVisible" />
        </template>
      </div>

      <div class="body col row no-wrap">
        <div class="map-col col">
          <div ref="mapEl" class="map" />
          <div class="map-hint">{{ hint }}</div>
        </div>

        <q-scroll-area class="side">
          <div class="q-pa-md q-gutter-y-md">
            <!-- ===================================================== route en cours d'édition ===== -->
            <template v-if="draft">
              <div>
                <div class="text-overline">Route</div>
                <div class="row q-col-gutter-sm">
                  <div class="col-5">
                    <q-input
                      :model-value="draft.name"
                      dense
                      outlined
                      label="Nom"
                      maxlength="6"
                      autofocus
                      data-testid="route-name"
                      :hint="`${draft.name.length}/6`"
                      @update:model-value="(v) => (draft!.name = typeRouteName(String(v ?? '')))"
                    />
                  </div>
                  <div class="col-7">
                    <q-input
                      :model-value="draft.comment"
                      dense
                      outlined
                      label="Commentaire"
                      maxlength="18"
                      data-testid="route-comment"
                      :hint="`${draft.comment.length}/18`"
                      @update:model-value="(v) => (draft!.comment = typeRouteComment(String(v ?? '')))"
                    />
                  </div>
                </div>
                <div class="text-caption text-grey-7"
                  >Nom : majuscules A-Z, chiffres et &amp; ( ) + - / = ? &gt; _ (comme sur l’appareil).</div
                >
              </div>

              <div v-if="issues && (issues.errors.length || issues.warnings.length)" class="issues">
                <div v-for="t in issues.errors" :key="t" class="text-caption text-negative"
                  ><q-icon name="error_outline" size="xs" /> {{ t }}</div
                >
                <div v-for="t in issues.warnings" :key="t" class="text-caption text-orange-9"><q-icon name="info" size="xs" /> {{ t }}</div>
              </div>

              <div v-if="selectedWaypoint" data-testid="wpt-card">
                <q-separator class="q-mb-sm" />
                <div class="text-overline">Waypoint sélectionné</div>
                <WaypointForm :ids="[selectedWaypoint.id]" compact />
                <div v-if="sameSpot.length" class="text-caption text-grey-8 q-mt-xs" data-testid="same-spot">
                  Aussi à cet endroit :
                  <q-chip v-for="w in sameSpot" :key="w.id" dense clickable size="sm" @click="selectWaypoint(w.id)">
                    {{ w.name || '(sans nom)' }}<span v-if="w.comment" class="text-grey-7">&nbsp;· {{ w.comment }}</span>
                  </q-chip>
                </div>
                <div v-if="usedAt.length" class="text-caption text-grey-8 q-mt-xs"
                  >Déjà dans la route : point(s) {{ usedAt.map((i) => i + 1).join(', ') }}</div
                >
                <div class="row q-gutter-sm q-mt-xs">
                  <q-btn
                    color="primary"
                    unelevated
                    dense
                    no-caps
                    icon="playlist_add"
                    label="Ajouter à la route"
                    data-testid="add-to-route"
                    :disable="!!addBlock.append"
                    @click="addSelected()"
                  />
                  <q-btn
                    v-if="selectedPoint !== null && selectedPoint < draft.points.length"
                    outline
                    dense
                    no-caps
                    icon="low_priority"
                    :label="`Insérer après le point ${selectedPoint + 1}`"
                    data-testid="insert-after"
                    :disable="!!addBlock.insert"
                    @click="addSelected(selectedPoint + 1)"
                  />
                </div>
                <div v-if="addBlock.append" class="text-caption text-negative q-mt-xs">{{ addBlock.append }}</div>
              </div>
              <div v-else class="text-caption text-grey-7"
                >Cliquez un waypoint sur la carte (ou cherchez-le ci-dessous) : le bouton « Ajouter à la route » apparaît ici.</div
              >

              <q-separator />

              <div>
                <div class="row items-center">
                  <div class="text-overline col">Points de la route ({{ draft.points.length }}/{{ LIMITS.routeWaypoints }})</div>
                  <div class="text-caption" data-testid="route-length">{{ stats.totalNm.toFixed(2) }} NM</div>
                </div>
                <q-list v-if="draft.points.length" dense bordered separator class="rounded-borders" data-testid="points">
                  <q-item
                    v-for="(p, i) in draft.points"
                    :key="`${i}:${p.wptId}`"
                    dense
                    clickable
                    :active="selectedPoint === i"
                    active-class="bg-orange-1"
                    @click="pickPoint(i)"
                  >
                    <q-item-section side class="rte-idx">{{ i + 1 }}</q-item-section>
                    <q-item-section>
                      <q-item-label :class="{ 'text-strike text-grey-6': p.skip, 'text-negative': !wptById.get(p.wptId) }">
                        <span v-if="wptById.get(p.wptId)" class="rte-mark" v-html="markOf(p.wptId)" />
                        {{ labelOf(p.wptId) }}
                        <span v-if="p.skip" class="text-caption">(ignoré)</span>
                      </q-item-label>
                      <q-item-label caption>{{ legText(i) }}</q-item-label>
                    </q-item-section>
                    <q-item-section side>
                      <div class="row no-wrap items-center">
                        <q-btn
                          flat
                          round
                          dense
                          size="sm"
                          icon="arrow_upward"
                          :disable="i === 0"
                          aria-label="Monter"
                          @click.stop="move(i, i - 1)"
                        />
                        <q-btn
                          flat
                          round
                          dense
                          size="sm"
                          icon="arrow_downward"
                          :disable="i === draft.points.length - 1"
                          aria-label="Descendre"
                          @click.stop="move(i, i + 1)"
                        />
                        <q-btn
                          flat
                          round
                          dense
                          size="sm"
                          :icon="p.skip ? 'visibility_off' : 'visibility'"
                          :aria-label="p.skip ? 'Reprendre ce point' : 'Ignorer ce point (skip)'"
                          @click.stop="skip(i)"
                        >
                          <q-tooltip>{{
                            p.skip
                              ? 'Ignoré par la navigation de l’émulateur et absent du fichier exporté : cliquer pour le reprendre'
                              : 'Ignorer ce point (skip) : la navigation le saute, il n’est pas exporté vers le GP-39'
                          }}</q-tooltip>
                        </q-btn>
                        <q-btn flat round dense size="sm" icon="delete" aria-label="Retirer de la route" @click.stop="removeAt(i)" />
                      </div>
                    </q-item-section>
                  </q-item>
                </q-list>
                <div v-else class="text-caption text-grey-7">Aucun waypoint : cliquez-en un sur la carte puis « Ajouter à la route ».</div>
                <div class="row q-gutter-sm q-mt-xs">
                  <q-btn dense no-caps outline icon="swap_vert" label="Inverser" :disable="draft.points.length < 2" @click="reverse" />
                  <q-btn dense no-caps outline icon="clear_all" label="Vider" :disable="!draft.points.length" @click="clearPoints" />
                </div>
              </div>

              <q-separator />

              <div>
                <div class="text-overline">Chercher un waypoint</div>
                <q-input v-model="search" dense outlined clearable label="Nom ou commentaire" data-testid="search" />
                <q-list v-if="searchResults.length" dense bordered separator class="rounded-borders q-mt-xs search-list">
                  <q-item
                    v-for="w in searchResults"
                    :key="w.id"
                    dense
                    clickable
                    :active="selectedWptId === w.id"
                    @click="selectWaypoint(w.id, true)"
                  >
                    <q-item-section side><span class="rte-mark" v-html="markSvg(w.symbol, w.color, 14)" /></q-item-section>
                    <q-item-section>
                      <q-item-label>{{ w.name || '(sans nom)' }}</q-item-label>
                      <q-item-label v-if="w.comment" caption>{{ w.comment }}</q-item-label>
                    </q-item-section>
                  </q-item>
                </q-list>
                <div v-else-if="search" class="text-caption text-grey-7 q-mt-xs">Aucun waypoint affiché ne correspond.</div>
              </div>
            </template>

            <!-- ===================================================== liste des routes ===== -->
            <template v-else>
              <div>
                <div class="row items-center">
                  <div class="text-overline col">Routes ({{ dev.routes.length }}/{{ LIMITS.routes }})</div>
                </div>
                <q-list v-if="rows.length" dense bordered separator class="rounded-borders" data-testid="routes">
                  <q-item
                    v-for="row in rows"
                    :key="row.route.no"
                    clickable
                    :active="selectedRouteNo === row.route.no"
                    active-class="bg-blue-1"
                    :data-testid="`route-${row.route.name}`"
                    @click="selectRoute(row.route.no)"
                  >
                    <q-item-section>
                      <q-item-label class="text-weight-bold">
                        {{ row.route.name || '(sans nom)' }}
                        <q-icon v-if="row.issues.errors.length" name="error" color="negative" size="xs">
                          <q-tooltip>{{ row.issues.errors.join(' · ') }}</q-tooltip>
                        </q-icon>
                        <q-icon v-else-if="row.issues.warnings.length" name="warning" color="orange" size="xs">
                          <q-tooltip>{{ row.issues.warnings.join(' · ') }}</q-tooltip>
                        </q-icon>
                      </q-item-label>
                      <q-item-label v-if="row.route.comment" caption class="ellipsis">{{ row.route.comment }}</q-item-label>
                      <q-item-label caption>{{ row.route.points.length }} point(s) · {{ row.nm.toFixed(1) }} NM</q-item-label>
                    </q-item-section>
                    <q-item-section side>
                      <div class="row no-wrap items-center">
                        <q-btn
                          flat
                          round
                          dense
                          size="sm"
                          icon="edit"
                          :aria-label="`Modifier ${row.route.name}`"
                          @click.stop="startEdit(row.route.no)"
                        >
                          <q-tooltip>Modifier</q-tooltip>
                        </q-btn>
                        <q-btn
                          flat
                          round
                          dense
                          size="sm"
                          icon="delete"
                          :aria-label="`Supprimer ${row.route.name}`"
                          @click.stop="removeRoute(row.route.no)"
                        >
                          <q-tooltip>Supprimer</q-tooltip>
                        </q-btn>
                      </div>
                    </q-item-section>
                  </q-item>
                </q-list>
                <div v-else data-testid="no-route">
                  <div class="text-caption text-grey-7">
                    Aucune route. « Créer une nouvelle route », ou importez un fichier GPX qui en contient : elles sont reconstituées à
                    partir des noms de waypoints.
                  </div>
                  <q-btn
                    class="q-mt-sm"
                    color="primary"
                    unelevated
                    dense
                    no-caps
                    icon="add_road"
                    label="Créer une nouvelle route"
                    data-testid="new-route-empty"
                    @click="startNew()"
                  />
                </div>
              </div>

              <div v-if="selectedWaypoint" data-testid="wpt-card">
                <q-separator class="q-mb-sm" />
                <div class="text-overline">Waypoint sélectionné</div>
                <div class="text-body2"
                  >{{ selectedWaypoint.name || '(sans nom)' }} <span class="text-grey-7">{{ selectedWaypoint.comment }}</span></div
                >
                <div class="text-caption text-grey-7 mono"
                  >{{ selectedWaypoint.lat.toFixed(5) }}, {{ selectedWaypoint.lon.toFixed(5) }}</div
                >
                <div v-if="routesOfSelected.length" class="text-caption q-mt-xs">
                  Dans les routes :
                  <q-chip v-for="r in routesOfSelected" :key="r.no" dense clickable size="sm" @click="selectRoute(r.no)">{{
                    r.name
                  }}</q-chip>
                </div>
                <div v-else class="text-caption text-grey-7 q-mt-xs">Ce waypoint n’est dans aucune route.</div>
                <q-btn
                  class="q-mt-xs"
                  outline
                  dense
                  no-caps
                  icon="add_road"
                  label="Nouvelle route à partir d’ici"
                  :disable="routesFull"
                  @click="startNew(selectedWaypoint.id)"
                />
              </div>

              <q-separator />

              <div @dragover.prevent @drop.prevent.stop="onDrop">
                <div class="text-overline">Importer</div>
                <q-btn dense no-caps outline icon="upload_file" label="Importer des GPX…" @click="fileInput?.click()" />
                <input
                  ref="fileInput"
                  type="file"
                  multiple
                  accept=".gpx,application/gpx+xml,text/xml,application/xml"
                  class="hidden"
                  @change="onPick"
                />
                <q-checkbox v-model="skipDuplicates" dense class="q-mt-xs" label="Ignorer les doublons déjà présents" />
                <div class="text-caption text-grey-7">
                  Les waypoints du fichier forment un calque ; ses routes sont ajoutées à la liste, rattachées aux waypoints par leur nom.
                  Glisser-déposer des fichiers ici fonctionne aussi.
                </div>
              </div>

              <q-separator />

              <div>
                <div class="text-overline">Calques affichés</div>
                <q-list v-if="dev.layers.length" dense bordered separator class="rounded-borders">
                  <q-item v-for="l in dev.layers" :key="l.id" dense>
                    <q-item-section side>
                      <q-btn
                        flat
                        round
                        dense
                        size="sm"
                        :icon="l.visible ? 'visibility' : 'visibility_off'"
                        :aria-label="l.visible ? `Masquer ${l.name}` : `Afficher ${l.name}`"
                        @click="dev.setLayerVisible(l.id, !l.visible)"
                      />
                    </q-item-section>
                    <q-item-section>
                      <q-item-label class="ellipsis" :class="{ 'text-grey-6': !l.visible }">{{ l.name }}</q-item-label>
                      <q-item-label caption>{{ dev.layerCounts.get(l.id) ?? 0 }} waypoints</q-item-label>
                    </q-item-section>
                  </q-item>
                </q-list>
                <div v-else class="text-caption text-grey-7">Aucun waypoint : importez un fichier GPX.</div>
              </div>

              <q-separator />

              <GpxExportPanel />
            </template>

            <q-separator />

            <BaseMapPicker />
          </div>
        </q-scroll-area>
      </div>
    </q-card>
  </q-dialog>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { useQuasar } from 'quasar'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { useDevice } from '@/stores/device'
import type { WaypointCanvasLayer } from '@/gp39/leafletMarks'
import {
  draftFromRoute,
  emptyDraft,
  insertPoint,
  movePoint,
  removePoint,
  reversePoints,
  routeBounds,
  routeIssues,
  routeStats,
  toggleSkip,
  typeRouteComment,
  typeRouteName,
  validateDraft,
  type RouteDraft,
} from '@/gp39/routes'
import { pickTolerance } from '@/gp39/selection'
import { markSvg } from '@/gp39/symbols'
import { LIMITS, type Route, type RoutePoint, type Waypoint } from '@/gp39/types'
import BaseMapPicker from './BaseMapPicker.vue'
import GpxExportPanel from './GpxExportPanel.vue'
import WaypointForm from './WaypointForm.vue'
import { useEditorMap, useVisibleWaypoints } from './useEditorMap'
import { gpxFilesOf, useGpxImport } from './useGpxImport'

const open = defineModel<boolean>({ default: false })
const $q = useQuasar()
const dev = useDevice()

const mapEl = ref<HTMLElement | null>(null)
const fileInput = ref<HTMLInputElement | null>(null)
let map: L.Map | null = null
let wptLayer: WaypointCanvasLayer | null = null
let routeLayer: L.LayerGroup | null = null

// ---------------------------------------------------------------- état
/** Route en cours d'édition (une copie : elle n'atteint l'appareil qu'à « Enregistrer »), ou null. */
const draft = ref<RouteDraft | null>(null)
let baseline = ''
const dirty = computed(() => draft.value !== null && JSON.stringify(draft.value) !== baseline)

const selectedRouteNo = ref<number | null>(null)
const selectedWptId = ref<number | null>(null)
/** point de la route en cours d'édition mis en évidence (position d'une insertion) */
const selectedPoint = ref<number | null>(null)
/** waypoints sous le dernier clic de la carte (le premier est sélectionné) : pour choisir entre plusieurs waypoints au même endroit */
const cluster = ref<number[]>([])
const search = ref('')
const skipDuplicates = ref(true)
const pointerKind = ref('mouse')

const wptById = computed(() => {
  void dev.wptVersion
  return dev.wptById
})
const routesFull = computed(() => dev.routes.length >= LIMITS.routes)
const { visibleWaypoints, totalWaypoints } = useVisibleWaypoints()

// copie : les waypoints sont des objets simples modifiés sur place (renommage) ; une copie neuve à chaque version fait suivre les calculs et l'affichage
const selectedWaypoint = computed<Waypoint | null>(() => {
  const w = selectedWptId.value === null ? undefined : wptById.value.get(selectedWptId.value)
  return w ? { ...w } : null
})

// ---------------------------------------------------------------- contrôles et longueurs
const issues = computed(() => (draft.value ? validateDraft(draft.value, dev.routeContext()) : null))
const stats = computed(() => routeStats(draft.value?.points ?? [], wptById.value, dev.settings.navigation))
const legAt = computed(() => new Map(stats.value.legs.map((l) => [l.index, l])))

/** Routes enregistrées avec leur longueur et leurs problèmes (marqués d'une icône dans la liste). */
const rows = computed(() => {
  const ctx = dev.routeContext()
  return dev.routes.map((route) => ({
    route,
    nm: routeStats(route.points, wptById.value, dev.settings.navigation).totalNm,
    issues: routeIssues(route, ctx),
  }))
})

const routesOfSelected = computed<Route[]>(() =>
  selectedWptId.value === null ? [] : dev.routes.filter((r) => r.points.some((p) => p.wptId === selectedWptId.value)),
)
/** positions du waypoint sélectionné dans la route éditée */
const usedAt = computed(() => (draft.value?.points ?? []).flatMap((p, i) => (p.wptId === selectedWptId.value ? [i] : [])))

/** Pourquoi le waypoint sélectionné ne peut pas être ajouté (à la fin / après le point choisi), ou '' s'il le peut. */
const addBlock = computed(() => {
  const d = draft.value
  const w = selectedWaypoint.value
  if (!d || !w) return { append: 'Aucun waypoint sélectionné', insert: 'Aucun waypoint sélectionné' }
  if (!w.name)
    return {
      append: 'Ce waypoint n’a pas de nom : donnez-lui un nom ci-dessus (le GP-39 relie les routes aux waypoints par leur nom).',
      insert: 'Sans nom',
    }
  const append = insertPoint(d.points, w.id)
  const after = selectedPoint.value === null ? null : insertPoint(d.points, w.id, selectedPoint.value + 1)
  return { append: append.ok ? '' : append.error, insert: after && !after.ok ? after.error : '' }
})

/** Les autres waypoints au même endroit que le waypoint sélectionné. */
const sameSpot = computed<Waypoint[]>(() =>
  cluster.value.length > 1 && cluster.value.includes(selectedWptId.value ?? -1)
    ? cluster.value.flatMap((id) => {
        const w = wptById.value.get(id)
        return w && id !== selectedWptId.value ? [w] : []
      })
    : [],
)

const labelOf = (id: number): string => {
  const w = wptById.value.get(id)
  return w ? w.name || '(sans nom)' : 'waypoint disparu'
}
const markOf = (id: number): string => {
  const w = wptById.value.get(id)
  return w ? markSvg(w.symbol, w.color, 14) : ''
}
function legText(i: number): string {
  const l = legAt.value.get(i)
  if (!l) return draft.value?.points[i]?.skip ? '' : i === 0 ? 'départ' : ''
  return `${l.nm.toFixed(2)} NM · ${Math.round(dev.toDisplayAngle(l.brg))}° ${dev.settings.cogRef === 'Mag' ? 'M' : 'V'}`
}

const searchResults = computed<Waypoint[]>(() => {
  const q = (search.value ?? '').trim().toUpperCase()
  if (!q) return []
  return visibleWaypoints.value.filter((w) => w.name.toUpperCase().includes(q) || w.comment.toUpperCase().includes(q)).slice(0, 30)
})

const hint = computed(() => {
  const touch = pointerKind.value === 'touch' || $q.platform.has.touch
  if (draft.value) return `${touch ? 'Toucher' : 'Cliquer'} un waypoint pour le sélectionner, puis « Ajouter à la route »`
  return `${touch ? 'Toucher' : 'Cliquer'} une route pour la sélectionner · un waypoint pour voir ses routes`
})

// ---------------------------------------------------------------- carte
const editorMap = useEditorMap({
  waypoints: () => visibleWaypoints.value,
  layer: { selected: () => (selectedWptId.value === null ? new Set<number>() : new Set([selectedWptId.value])), showHidden: true },
})

function fitPoints(points: readonly RoutePoint[]): void {
  const b = map && routeBounds(points, wptById.value)
  if (!map || !b) return
  map.fitBounds(L.latLngBounds([b[0].lat, b[0].lon], [b[1].lat, b[1].lon]).pad(0.25), { maxZoom: 15 })
}
const fitVisible = (): void => editorMap.fit(visibleWaypoints.value)

const COLOR_EDIT = '#ff6d00'
const COLOR_ROUTE = '#2540c8'

/** Trace une route : ligne entre ses points actifs ; pour une route choisie ou en édition, flèches de sens et numéros des points. */
function drawRoute(
  layer: L.LayerGroup,
  points: readonly RoutePoint[],
  kind: 'faint' | 'selected' | 'edit',
  highlight: number | null,
): void {
  const byId = wptById.value
  const color = kind === 'edit' ? COLOR_EDIT : COLOR_ROUTE
  const active = points.flatMap((p) => {
    const w = byId.get(p.wptId)
    return w && !p.skip ? [L.latLng(w.lat, w.lon)] : []
  })
  if (active.length > 1) {
    L.polyline(active, { color, weight: kind === 'faint' ? 2 : 4, opacity: kind === 'faint' ? 0.5 : 0.95, interactive: false }).addTo(layer)
  }
  if (kind === 'faint') return
  const stat = routeStats(points, byId, dev.settings.navigation)
  for (const l of stat.legs) {
    // la loxodromie est une droite en projection Mercator : le relèvement est aussi l'angle de la flèche à l'écran
    const mid = L.latLng((l.from.lat + l.to.lat) / 2, (l.from.lon + l.to.lon) / 2)
    L.marker(mid, {
      interactive: false,
      keyboard: false,
      icon: L.divIcon({
        className: 'rte-arrow-wrap',
        iconSize: [14, 14],
        iconAnchor: [7, 7],
        html: `<div class="rte-arrow" style="transform:rotate(${l.brg.toFixed(0)}deg);color:${color}">▲</div>`,
      }),
    }).addTo(layer)
  }
  points.forEach((p, i) => {
    const w = byId.get(p.wptId)
    if (!w) return
    const cls = [
      'rte-badge',
      kind === 'edit' ? 'rte-badge--edit' : '',
      p.skip ? 'rte-badge--skip' : '',
      highlight === i ? 'rte-badge--on' : '',
    ]
    L.marker([w.lat, w.lon], {
      interactive: false,
      keyboard: false,
      zIndexOffset: 900,
      icon: L.divIcon({
        className: 'rte-badge-wrap',
        iconSize: [18, 18],
        iconAnchor: [-5, 24],
        html: `<div class="${cls.join(' ')}">${i + 1}</div>`,
      }),
    }).addTo(layer)
  })
}

/** Redessine toutes les routes : les routes enregistrées en trait fin, la route choisie ou en édition en trait épais. */
function drawRoutes(): void {
  if (!map) return
  routeLayer ??= L.layerGroup().addTo(map)
  routeLayer.clearLayers()
  const d = draft.value
  for (const r of dev.routes) {
    if (d && r.no === d.no) continue // remplacée par sa copie en cours d'édition
    if (!d && r.no === selectedRouteNo.value) drawRoute(routeLayer, r.points, 'selected', null)
    else drawRoute(routeLayer, r.points, 'faint', null)
  }
  if (d) drawRoute(routeLayer, d.points, 'edit', selectedPoint.value)
}
watch([draft, selectedRouteNo, selectedPoint, () => dev.wptVersion], drawRoutes, { deep: true, flush: 'post' })
watch(() => dev.routes, drawRoutes, { deep: true, flush: 'post' })
watch(selectedWptId, () => wptLayer?.redraw())
watch(visibleWaypoints, () => wptLayer?.redraw())

/** Route la plus proche d'un point de la carte (px du conteneur), à `tolerance` px au plus ; null s'il n'y en a pas. */
function routeAt(point: L.Point, tolerance: number): number | null {
  if (!map) return null
  let best: { no: number; d: number } | null = null
  for (const r of dev.routes) {
    const pts = r.points.flatMap((p) => {
      const w = wptById.value.get(p.wptId)
      return w && !p.skip ? [map!.latLngToContainerPoint([w.lat, w.lon])] : []
    })
    for (let i = 1; i < pts.length; i++) {
      const d = L.LineUtil.pointToSegmentDistance(point, pts[i - 1]!, pts[i]!)
      if (d <= tolerance && (!best || d < best.d)) best = { no: r.no, d }
    }
  }
  return best?.no ?? null
}

function onMapClick(e: L.LeafletMouseEvent): void {
  const hits = wptLayer?.pickAll(e.containerPoint, pickTolerance(pointerKind.value)) ?? []
  const first = hits[0]
  if (first) {
    selectWaypoint(first.id)
    cluster.value = hits.slice(0, 8).map((w) => w.id) // plusieurs waypoints au même endroit : on peut choisir
    return
  }
  selectedWptId.value = null
  cluster.value = []
  if (!draft.value) selectedRouteNo.value = routeAt(e.containerPoint, pointerKind.value === 'touch' ? 16 : 8)
}

function onPointerDown(ev: PointerEvent): void {
  pointerKind.value = ev.pointerType
}

function selectWaypoint(id: number, fly = false): void {
  selectedWptId.value = id
  if (fly) cluster.value = [] // choisi dans la liste de recherche, pas sur la carte
  const w = wptById.value.get(id)
  if (fly && w && map) map.setView([w.lat, w.lon], Math.max(map.getZoom(), 14))
}

// ---------------------------------------------------------------- liste des routes
function selectRoute(no: number): void {
  selectedRouteNo.value = no
  const r = dev.routeByNo(no)
  if (r) fitPoints(r.points)
}

function startNew(seedWptId?: number): void {
  if (routesFull.value) return
  const d = emptyDraft()
  if (seedWptId !== undefined && wptById.value.get(seedWptId)?.name) d.points = [{ wptId: seedWptId, skip: false }]
  begin(d)
}

function startEdit(no: number): void {
  const r = dev.routeByNo(no)
  if (!r) return
  const go = (): void => begin(draftFromRoute(r))
  if (dev.dest?.kind === 'route' && dev.dest.routeNo === no) {
    $q.dialog({
      title: 'Route en cours de navigation',
      message: 'Cette route est la destination en cours. La modifier peut changer le point visé. Continuer ?',
      cancel: { label: 'Annuler', flat: true },
      ok: { label: 'Modifier', color: 'primary' },
      persistent: true,
    }).onOk(go)
  } else go()
}

function begin(d: RouteDraft): void {
  draft.value = d
  baseline = JSON.stringify(d)
  selectedRouteNo.value = d.no
  selectedWptId.value = null
  cluster.value = []
  selectedPoint.value = null
  search.value = ''
  if (d.points.length) fitPoints(d.points)
}

function removeRoute(no: number): void {
  const r = dev.routeByNo(no)
  if (!r) return
  $q.dialog({
    title: 'Supprimer la route',
    message: `Supprimer la route « ${r.name} » (${r.points.length} points) ? Les waypoints sont conservés.`,
    cancel: { label: 'Annuler', flat: true },
    ok: { label: 'Supprimer', color: 'negative' },
    persistent: true,
  }).onOk(() => {
    if (!dev.deleteRoute(no)) {
      $q.notify({
        type: 'warning',
        message: 'Route conservée',
        caption: 'C’est la destination en cours : annulez-la d’abord depuis l’appareil (menu Routes).',
        timeout: 5000,
      })
      return
    }
    if (selectedRouteNo.value === no) selectedRouteNo.value = null
    $q.notify({ type: 'positive', message: `Route « ${r.name} » supprimée`, timeout: 2000 })
  })
}

// ---------------------------------------------------------------- édition
function addSelected(at?: number): void {
  const d = draft.value
  const w = selectedWaypoint.value
  if (!d || !w) return
  const res = insertPoint(d.points, w.id, at)
  if (!res.ok) {
    $q.notify({ type: 'warning', message: res.error, timeout: 3000 })
    return
  }
  d.points = res.points
  selectedPoint.value = res.index
}

/** Choisit un point de la liste : il est montré sur la carte et son waypoint est sélectionné (pour le renommer, par exemple). */
function pickPoint(i: number): void {
  selectedPoint.value = selectedPoint.value === i ? null : i
  const w = wptById.value.get(draft.value?.points[i]?.wptId ?? -1)
  if (!w) return
  selectedWptId.value = w.id
  cluster.value = []
  if (map) map.panTo([w.lat, w.lon])
}

function move(from: number, to: number): void {
  const d = draft.value
  if (!d) return
  d.points = movePoint(d.points, from, to)
  if (selectedPoint.value === from) selectedPoint.value = to
}
function skip(i: number): void {
  if (draft.value) draft.value.points = toggleSkip(draft.value.points, i)
}
function removeAt(i: number): void {
  const d = draft.value
  if (!d) return
  d.points = removePoint(d.points, i)
  selectedPoint.value = null
}
function reverse(): void {
  if (!draft.value) return
  draft.value.points = reversePoints(draft.value.points)
  selectedPoint.value = null
}
function clearPoints(): void {
  if (!draft.value) return
  draft.value.points = []
  selectedPoint.value = null
}

function save(): void {
  const d = draft.value
  if (!d) return
  const res = dev.saveRoute(d)
  if (!res.ok) {
    $q.notify({
      type: 'negative',
      message: res.errors[0] ?? 'Route non enregistrée',
      caption: res.errors.slice(1).join(' · '),
      timeout: 5000,
    })
    return
  }
  const n = res.route.points.length
  $q.notify({
    type: 'positive',
    message: `Route « ${res.route.name} » enregistrée (${n} waypoint${n > 1 ? 's' : ''})`,
    timeout: 2500,
  })
  draft.value = null // on quitte le mode édition
  selectedWptId.value = null
  selectedPoint.value = null
  selectedRouteNo.value = res.route.no
  fitPoints(res.route.points)
}

/** Annule l'édition ; demande confirmation s'il y a des modifications non enregistrées. */
function cancelEdit(after?: () => void): void {
  const leave = (): void => {
    draft.value = null
    selectedWptId.value = null
    selectedPoint.value = null
    after?.()
  }
  if (!dirty.value) return leave()
  $q.dialog({
    title: 'Abandonner les modifications ?',
    message: 'La route n’a pas été enregistrée : ses modifications seront perdues.',
    cancel: { label: 'Continuer l’édition', flat: true },
    ok: { label: 'Abandonner', color: 'negative' },
    persistent: true,
  }).onOk(leave)
}

function requestClose(): void {
  if (draft.value) cancelEdit(() => (open.value = false))
  else open.value = false
}

// ---------------------------------------------------------------- import
const { addFiles } = useGpxImport(() => skipDuplicates.value)

async function importFiles(files: File[]): Promise<void> {
  const r = await addFiles(files)
  if (r.lastLayer !== null) {
    const w = dev.waypoints.filter((x) => x.layer === r.lastLayer && !x.qp)
    editorMap.fit(w)
  }
}
async function onPick(ev: Event): Promise<void> {
  const input = ev.target as HTMLInputElement
  const files = Array.from(input.files ?? [])
  input.value = ''
  await importFiles(files)
}
/** `.stop` : le dépôt n'ouvre pas aussi la fenêtre « Charger » du panneau de commande. */
async function onDrop(e: DragEvent): Promise<void> {
  await importFiles(gpxFilesOf(e))
}

// ---------------------------------------------------------------- fenêtre
function onShow(): void {
  void nextTick(() => {
    if (!mapEl.value || map) return
    const m = editorMap.mount(mapEl.value)
    map = m.map
    wptLayer = m.layer
    map.on('click', onMapClick)
    map.getContainer().addEventListener('pointerdown', onPointerDown)
    window.addEventListener('keydown', onKey, true)
    drawRoutes()
    if (visibleWaypoints.value.length) fitVisible()
  })
}

function onHide(): void {
  window.removeEventListener('keydown', onKey, true)
  map?.getContainer().removeEventListener('pointerdown', onPointerDown)
  routeLayer = null
  wptLayer = null
  map = null
  editorMap.unmount()
  draft.value = null
  selectedWptId.value = null
  selectedPoint.value = null
  selectedRouteNo.value = null
  search.value = ''
}
onBeforeUnmount(onHide)

/** Échap : désélectionne le waypoint. C'est aussi la touche MENU de l'appareil : l'éditeur la garde (écoute en phase de capture). */
function onKey(e: KeyboardEvent): void {
  if (!open.value || document.querySelectorAll('.q-dialog').length > 1) return // une confirmation est ouverte
  if (e.target instanceof Element && e.target.closest('input, textarea, select, [contenteditable="true"]')) return
  if (e.key === 'Escape') {
    e.stopPropagation()
    e.preventDefault()
    selectedWptId.value = null
  }
}
</script>

<style lang="scss">
.rte-card {
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
    width: 360px;
    max-width: 44%;
    border-left: 1px solid rgba(128, 128, 128, 0.35);
  }
  .hidden {
    display: none;
  }
  .mono {
    font-family: 'Roboto Mono', ui-monospace, monospace;
  }
  .rte-idx {
    min-width: 22px;
    font-weight: 700;
    color: #555;
  }
  .rte-mark {
    display: inline-block;
    vertical-align: middle;
    line-height: 0;
    margin-right: 4px;
  }
  .search-list {
    max-height: 200px;
    overflow: auto;
  }
}
/* numéros et flèches posés sur la carte (hors de la carte, car ajoutés par Leaflet dans ses propres panneaux) */
.rte-badge-wrap,
.rte-arrow-wrap {
  background: transparent;
  border: 0;
}
.rte-badge {
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: #2540c8;
  color: #fff;
  border: 1.5px solid #fff;
  font:
    700 10px/15px Arial,
    sans-serif;
  text-align: center;
  box-shadow: 0 0 2px rgba(0, 0, 0, 0.6);
  &.rte-badge--edit {
    background: #ff6d00;
  }
  &.rte-badge--skip {
    background: #9e9e9e;
  }
  &.rte-badge--on {
    outline: 2px solid #000;
    transform: scale(1.2);
  }
}
.rte-arrow {
  width: 14px;
  height: 14px;
  font-size: 12px;
  line-height: 14px;
  text-align: center;
  text-shadow:
    0 0 2px #fff,
    0 0 2px #fff;
}
@media (max-width: 1023px) {
  .rte-card {
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
