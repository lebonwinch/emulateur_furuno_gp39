<template>
  <div>
    <div class="text-overline">Export</div>
    <q-checkbox v-model="onlyVisible" dense label="Seulement les calques affichés" />
    <div class="text-caption text-grey-7">
      Sinon tous les waypoints de tous les calques. Avec cette case, une route n’est exportée que si tous ses points sont dans les calques
      affichés.
    </div>
    <q-checkbox v-model="withRoutes" dense class="q-mt-xs" label="Inclure les routes" />
    <div class="text-body2 q-mt-sm">
      Fichier exporté : <b>{{ exportCount.waypoints }}</b> waypoints · <b>{{ withRoutes ? exportCount.routes : 0 }}</b> routes
    </div>

    <q-banner
      v-if="withRoutes && findings.length"
      dense
      rounded
      class="q-mt-sm"
      :class="errors ? 'bg-red-1 text-red-10' : 'bg-orange-1 text-orange-10'"
    >
      <template #avatar><q-icon :name="errors ? 'error' : 'warning'" /></template>
      <div class="text-body2"> Routes et GP-39 : {{ errors }} problème(s) bloquant(s), {{ findings.length - errors }} remarque(s) </div>
      <div v-for="(f, i) in shown" :key="i" class="text-caption">
        <q-icon :name="f.severity === 'error' ? 'error_outline' : 'info'" size="xs" /> <b v-if="f.route">{{ f.route }}</b> {{ f.text }}
      </div>
      <div v-if="findings.length > shown.length" class="text-caption">… et {{ findings.length - shown.length }} autre(s)</div>
    </q-banner>

    <q-input
      v-model="exportName"
      dense
      outlined
      class="q-mt-sm"
      label="Nom du fichier exporté"
      suffix=".gpx"
      maxlength="96"
      :hint="
        isDeviceName ? 'Nom reconnu par le GP-39.' : `Enregistré sous « ${exportFile} ». Le GP-39 ne relit que ${DEFAULT_EXPORT_NAME}.gpx.`
      "
      @keyup.enter="exportAll"
    />
    <q-btn
      color="primary"
      unelevated
      no-caps
      dense
      class="q-mt-sm"
      icon="download"
      label="Exporter"
      :disable="!exportCount.waypoints && !(withRoutes && exportCount.routes)"
      @click="exportAll"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { useQuasar } from 'quasar'
import { useDevice } from '@/stores/device'
import { downloadTextFile } from '@/gp39/download'
import { DEFAULT_EXPORT_NAME, gpxFileName } from '@/gp39/gpxFile'
import { selectForExport } from '@/gp39/layers'
import { deviceExportReport } from '@/gp39/routes'

// Export du fichier GP39_WptRte.gpx : commun à l'éditeur de waypoints et à l'éditeur de routes.
const $q = useQuasar()
const dev = useDevice()

const exportName = ref(DEFAULT_EXPORT_NAME)
const onlyVisible = ref(false)
const withRoutes = ref(true)
const exportFile = computed(() => gpxFileName(exportName.value))
const isDeviceName = computed(() => exportFile.value === `${DEFAULT_EXPORT_NAME}.gpx`)
const exportLayers = computed<ReadonlySet<number> | null>(() =>
  onlyVisible.value ? new Set(dev.layers.filter((l) => l.visible).map((l) => l.id)) : null,
)
const selection = computed(() => {
  void dev.wptVersion
  return selectForExport(dev.waypoints, dev.routes, exportLayers.value)
})
const exportCount = computed(() => ({ waypoints: selection.value.waypoints.length, routes: selection.value.routes.length }))

/** Ce qui, dans les routes à exporter, empêcherait le GP-39 de les relire correctement. */
const findings = computed(() => (withRoutes.value ? deviceExportReport(selection.value.waypoints, selection.value.routes) : []))
const errors = computed(() => findings.value.filter((f) => f.severity === 'error').length)
// les erreurs d'abord, une quinzaine de lignes au plus
const shown = computed(() =>
  [...findings.value].sort((a, b) => Number(b.severity === 'error') - Number(a.severity === 'error')).slice(0, 15),
)

function doExport(): void {
  downloadTextFile(exportFile.value, dev.exportGpx(exportLayers.value, withRoutes.value))
  $q.notify({
    type: 'positive',
    message: `${exportFile.value} exporté (${exportCount.value.waypoints} waypoints, ${withRoutes.value ? exportCount.value.routes : 0} routes)`,
    timeout: 3500,
  })
}

function exportAll(): void {
  if (!exportCount.value.waypoints && !(withRoutes.value && exportCount.value.routes)) return
  if (!errors.value) return doExport()
  $q.dialog({
    title: 'Routes à corriger',
    message: `${errors.value} problème(s) peuvent empêcher le GP-39 de relire certaines routes (par exemple un waypoint sans nom). Exporter quand même ?`,
    cancel: { label: 'Annuler', flat: true },
    ok: { label: 'Exporter quand même', color: 'primary' },
    persistent: true,
  }).onOk(doExport)
}
</script>
