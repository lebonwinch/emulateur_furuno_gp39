<template>
  <div class="wpt-form">
    <!-- un seul waypoint : édition -->
    <template v-if="single">
      <div class="text-overline">Waypoint sélectionné</div>
      <div class="row q-col-gutter-sm">
        <div class="col-6">
          <q-input
            v-model="draft.name"
            dense
            outlined
            label="Nom"
            maxlength="8"
            :hint="`${draft.name.length}/8`"
            @blur="commit({ name: draft.name })"
            @keyup.enter="commit({ name: draft.name })"
          />
        </div>
        <div class="col-6">
          <q-input
            v-model="draft.comment"
            dense
            outlined
            label="Commentaire"
            maxlength="13"
            :hint="`${draft.comment.length}/13`"
            @blur="commit({ comment: draft.comment })"
            @keyup.enter="commit({ comment: draft.comment })"
          />
        </div>
        <div class="col-6">
          <q-select
            v-model="draft.symbol"
            dense
            outlined
            emit-value
            map-options
            label="Symbole"
            :options="symbolOptions"
            @update:model-value="(v: number) => commit({ symbol: v })"
          >
            <template #selected-item="{ opt }">
              <span class="row items-center no-wrap"
                ><i class="mark" v-html="markSvg(opt.value, draft.color, 16)" /><span class="q-ml-xs">{{ opt.label }}</span></span
              >
            </template>
            <template #option="{ opt, itemProps }">
              <q-item v-bind="itemProps" dense>
                <q-item-section avatar><i class="mark" v-html="markSvg(opt.value, draft.color, 18)" /></q-item-section>
                <q-item-section>{{ opt.label }}</q-item-section>
              </q-item>
            </template>
          </q-select>
        </div>
        <div class="col-6">
          <q-select
            v-model="draft.color"
            dense
            outlined
            emit-value
            map-options
            label="Couleur"
            :options="colorOptions"
            @update:model-value="(v: number) => commit({ color: v })"
          >
            <template #selected-item="{ opt }">
              <span class="row items-center no-wrap"
                ><span class="swatch" :style="{ background: COLORS[opt.value] }" /><span class="q-ml-xs">{{ opt.label }}</span></span
              >
            </template>
            <template #option="{ opt, itemProps }">
              <q-item v-bind="itemProps" dense>
                <q-item-section avatar><span class="swatch" :style="{ background: COLORS[opt.value] }" /></q-item-section>
                <q-item-section>{{ opt.label }}</q-item-section>
              </q-item>
            </template>
          </q-select>
        </div>
        <div class="col-6">
          <q-input
            v-model.number="draft.lat"
            dense
            outlined
            type="number"
            step="0.0001"
            label="Latitude (°)"
            :error="latBad"
            error-message="−90 à 90"
            @blur="applyPos"
            @keyup.enter="applyPos"
          />
        </div>
        <div class="col-6">
          <q-input
            v-model.number="draft.lon"
            dense
            outlined
            type="number"
            step="0.0001"
            label="Longitude (°)"
            :error="lonBad"
            error-message="−180 à 180"
            @blur="applyPos"
            @keyup.enter="applyPos"
          />
        </div>
        <div class="col-12">
          <q-select
            v-model="draft.layer"
            dense
            outlined
            emit-value
            map-options
            label="Calque"
            :options="layerOptions"
            @update:model-value="(v: number) => commit({ layer: v })"
          />
        </div>
      </div>
      <q-toggle
        v-model="draft.display"
        dense
        class="q-mt-sm"
        label="Affiché sur le plotter (GP39Flag)"
        @update:model-value="(v: boolean) => commit({ display: v })"
      />
      <div class="text-caption text-grey-7 mono"
        >{{ single.lat.toFixed(5) }}, {{ single.lon.toFixed(5) }} — glisser le repère orange pour déplacer</div
      >
      <div class="row q-gutter-sm q-mt-sm">
        <q-btn color="negative" outline dense no-caps icon="delete" label="Supprimer" @click="emit('delete')" />
      </div>
    </template>

    <!-- plusieurs waypoints : actions groupées -->
    <template v-else-if="ids.length > 1">
      <div class="text-overline">{{ ids.length }} waypoints sélectionnés</div>
      <div class="text-caption text-grey-7 q-mb-sm">{{ preview }}</div>
      <div class="row q-col-gutter-sm items-center">
        <div class="col">
          <q-select v-model="targetLayer" dense outlined emit-value map-options label="Déplacer vers le calque" :options="layerOptions" />
        </div>
        <div class="col-auto">
          <q-btn dense no-caps outline icon="drive_file_move" label="Déplacer" :disable="targetLayer === null" @click="moveToLayer" />
        </div>
      </div>
      <div class="row q-gutter-sm q-mt-sm">
        <q-btn color="negative" outline dense no-caps icon="delete" :label="`Supprimer ${ids.length} waypoints`" @click="emit('delete')" />
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { useQuasar } from 'quasar'
import { useDevice } from '@/stores/device'
import { COLORS, COLOR_NAMES_FR, SYMBOL_COUNT, SYMBOL_NAMES_FR, markSvg } from '@/gp39/symbols'
import type { Waypoint } from '@/gp39/types'

const props = defineProps<{ ids: readonly number[] }>()
const emit = defineEmits<{ (e: 'delete'): void }>()

const $q = useQuasar()
const dev = useDevice()

const symbolOptions = Array.from({ length: SYMBOL_COUNT }, (_, i) => ({ value: i, label: `${i} — ${SYMBOL_NAMES_FR[i] ?? '?'}` }))
const colorOptions = COLOR_NAMES_FR.map((label, i) => ({ value: i, label: `${i} — ${label}` }))
const layerOptions = computed(() => dev.layers.map((l) => ({ value: l.id, label: l.name })))

const single = computed<Waypoint | null>(() => {
  void dev.wptVersion
  return props.ids.length === 1 ? (dev.wptById.get(props.ids[0]!) ?? null) : null
})

interface Draft {
  name: string
  comment: string
  symbol: number
  color: number
  display: boolean
  lat: number | null
  lon: number | null
  layer: number
}
const draft = reactive<Draft>({ name: '', comment: '', symbol: 0, color: 2, display: true, lat: null, lon: null, layer: 0 })

function load(w: Waypoint): void {
  Object.assign(draft, {
    name: w.name,
    comment: w.comment,
    symbol: w.symbol,
    color: w.color,
    display: w.display,
    lat: Number(w.lat.toFixed(7)),
    lon: Number(w.lon.toFixed(7)),
    layer: w.layer ?? 0,
  })
}
// recharge à chaque changement de sélection ou de données (déplacement à la souris, autre onglet de la liste…)
watch(
  () => [single.value?.id, dev.wptVersion],
  () => single.value && load(single.value),
  { immediate: true },
)

const latBad = computed(() => draft.lat === null || !Number.isFinite(draft.lat) || Math.abs(draft.lat) > 90)
const lonBad = computed(() => draft.lon === null || !Number.isFinite(draft.lon) || Math.abs(draft.lon) > 180)

function commit(patch: Partial<Omit<Waypoint, 'id'>>): void {
  if (single.value) dev.updateWaypoint(single.value.id, patch)
}

function applyPos(): void {
  const w = single.value
  if (!w) return
  if (latBad.value || lonBad.value) {
    // valeur invalide : on revient à la position enregistrée
    load(w)
    return
  }
  if (Math.abs(draft.lat! - w.lat) > 1e-9 || Math.abs(draft.lon! - w.lon) > 1e-9) commit({ lat: draft.lat!, lon: draft.lon! })
}

const preview = computed(() => {
  const names = props.ids
    .slice(0, 6)
    .map((id) => dev.wptById.get(id)?.name || '(sans nom)')
    .join(', ')
  return props.ids.length > 6 ? `${names}…` : names
})

const targetLayer = ref<number | null>(null)
function moveToLayer(): void {
  if (targetLayer.value === null) return
  const n = dev.moveWaypointsToLayer(props.ids, targetLayer.value)
  const name = dev.layers.find((l) => l.id === targetLayer.value)?.name ?? ''
  $q.notify({ type: 'positive', message: `${n} waypoint(s) déplacé(s) vers « ${name} »`, timeout: 2500 })
}
</script>

<style scoped lang="scss">
.mono {
  font-family: 'Roboto Mono', ui-monospace, monospace;
}
.mark {
  display: inline-flex;
  width: 18px;
  height: 18px;
  align-items: center;
  justify-content: center;
}
.swatch {
  display: inline-block;
  width: 14px;
  height: 14px;
  border-radius: 3px;
  border: 1px solid rgba(0, 0, 0, 0.35);
}
</style>
