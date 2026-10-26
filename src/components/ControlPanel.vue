<template>
  <div class="panel column q-gutter-y-md">
    <q-card flat bordered>
      <q-card-section>
        <div class="text-overline">Position</div>
        <PositionSource class="q-mb-sm" />
        <q-btn
          color="primary"
          unelevated
          no-caps
          class="full-width"
          icon="my_location"
          label="Position du bateau…"
          @click="$emit('position')"
        />
        <div class="text-caption q-mt-sm mono">
          {{ lat }}<br />
          {{ lon }}
        </div>
        <div class="text-caption text-grey-7"
          >SOG {{ dev.ship.sog.toFixed(1) }} kn · COG {{ Math.round(dev.ship.cog) }}° · {{ dev.fix }}</div
        >
      </q-card-section>
    </q-card>

    <q-card flat bordered>
      <q-card-section>
        <div class="text-overline">Données</div>
        <div class="text-body2">
          <b>{{ dev.waypoints.length }}</b> waypoints · <b>{{ dev.routes.length }}</b> routes · trace {{ dev.trackMemoryPct }} %
        </div>
        <div class="q-mt-sm column q-gutter-y-xs">
          <q-btn color="primary" unelevated dense no-caps icon="edit_location_alt" label="Éditeur de waypoints…" @click="$emit('editor')" />
          <q-btn color="primary" unelevated dense no-caps icon="route" label="Éditeur de routes…" @click="$emit('routes')" />
          <q-btn outline dense no-caps icon="upload_file" label="Charger un fichier GPX…" @click="loadFile" />
          <q-btn outline dense no-caps icon="download" label="Exporter GP39_WptRte.gpx" @click="exportFile" />
          <q-btn outline dense no-caps icon="restart_alt" label="Recharger waypoints_GP39.gpx" @click="reloadDefault" />
          <q-btn outline dense no-caps icon="category" label="Légende des symboles…" @click="showLegend = true" />
        </div>
      </q-card-section>
    </q-card>

    <q-expansion-item dense dense-toggle label="Raccourcis clavier" icon="keyboard" class="rounded-borders bordered-card">
      <q-card flat>
        <q-card-section class="text-caption keys">
          <div><kbd>↑ ↓ ← →</kbd> CursorPad <kbd>Home PgUp End PgDn</kbd> diagonales</div>
          <div><kbd>Entrée</kbd> ENT/CNTR (maintenu : centrer le bateau)</div>
          <div><kbd>M</kbd> / <kbd>Échap</kbd> MENU</div>
          <div><kbd>D</kbd> DISP (maintenu : sens inverse)</div>
          <div><kbd>G</kbd> GO TO</div>
          <div><kbd>Espace</kbd> MARK (maintenu : MOB)</div>
          <div><kbd>B</kbd> BRILL (maintenu 3 s : arrêt)</div>
          <div><kbd>+</kbd> <kbd>−</kbd> zoom du plotter · molette sur l’écran</div>
          <div>Dans un champ de saisie : taper directement les caractères.</div>
        </q-card-section>
      </q-card>
    </q-expansion-item>

    <q-expansion-item dense dense-toggle label="À propos et licences" icon="info" class="rounded-borders bordered-card">
      <q-card flat>
        <q-card-section>
          <AboutPanel />
        </q-card-section>
      </q-card>
    </q-expansion-item>

    <SymbolLegend v-model="showLegend" />
    <input ref="fileInput" type="file" accept=".gpx,application/gpx+xml,text/xml,application/xml" class="hidden" @change="onFile" />
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useQuasar } from 'quasar'
import { useDevice } from '@/stores/device'
import { downloadTextFile } from '@/gp39/download'
import { formatLat, formatLon } from '@/gp39/format'
import { centerOnShip } from '@/gp39/ui/plotter'
import { fileHooks } from '@/gp39/ui/menus'
import AboutPanel from './AboutPanel.vue'
import PositionSource from './PositionSource.vue'
import SymbolLegend from './SymbolLegend.vue'

defineEmits<{ (e: 'position'): void; (e: 'editor'): void; (e: 'routes'): void }>()

const showLegend = ref(false)

const $q = useQuasar()
const dev = useDevice()
const fileInput = ref<HTMLInputElement | null>(null)
let pending: ((text: string, name: string) => void) | null = null

const lat = computed(() => formatLat(dev.ship.lat, dev.settings.posFormat))
const lon = computed(() => formatLon(dev.ship.lon, dev.settings.posFormat))

function exportFile(): void {
  downloadTextFile('GP39_WptRte.gpx', dev.exportGpx())
  $q.notify({
    type: 'positive',
    message: `GP39_WptRte.gpx exporté (${dev.waypoints.length} waypoints, ${dev.routes.length} routes)`,
    timeout: 2500,
  })
}

/** Demande comment charger le contenu d'un fichier GPX (remplacer / ajouter) puis l'importe. */
function promptImport(text: string, name: string): void {
  $q.dialog({
    title: `Charger ${name}`,
    message: 'Remplacer tous les waypoints et routes de l’appareil, ou ajouter ceux du fichier ?',
    options: {
      type: 'radio',
      model: 'replace',
      items: [
        { label: 'Remplacer (comme Load WPT/RTE ← USB)', value: 'replace' },
        { label: 'Ajouter aux waypoints existants', value: 'merge' },
      ],
    },
    cancel: true,
    persistent: true,
  }).onOk((mode: 'replace' | 'merge') => {
    const r = dev.importGpx(text, mode, name)
    $q.notify({
      type: r.warnings.length ? 'warning' : 'positive',
      message: `${r.waypoints} waypoints, ${r.routes} routes importés`,
      ...(r.warnings.length ? { caption: r.warnings.join(' · ') } : {}),
      timeout: 4500,
    })
    centerOnShip()
  })
}

function loadFile(): void {
  pending = promptImport
  fileInput.value?.click()
}

async function onFile(ev: Event): Promise<void> {
  const input = ev.target as HTMLInputElement
  const f = input.files?.[0]
  input.value = ''
  if (!f) return
  const cb = pending ?? promptImport
  pending = null
  cb(await f.text(), f.name)
}

/** Glisser-déposer d'un fichier .gpx n'importe où dans la page. */
function onDragOver(e: DragEvent): void {
  if (e.dataTransfer?.types.includes('Files')) e.preventDefault()
}
async function onDrop(e: DragEvent): Promise<void> {
  const f = Array.from(e.dataTransfer?.files ?? []).find((x) => x.name.toLowerCase().endsWith('.gpx') || x.type.includes('xml'))
  if (!f) return
  e.preventDefault()
  promptImport(await f.text(), f.name)
}

function reloadDefault(): void {
  $q.dialog({
    title: 'Recharger le jeu de données',
    message: 'Remplacer les waypoints et routes par waypoints_GP39.gpx (2252 points) ?',
    cancel: true,
    persistent: true,
  }).onOk(() => {
    void dev
      .loadDefaultDataset()
      .then(() => $q.notify({ type: 'positive', message: `${dev.waypoints.length} waypoints chargés`, timeout: 2000 }))
  })
}

onMounted(() => {
  window.addEventListener('dragover', onDragOver)
  window.addEventListener('drop', onDrop)
  fileHooks.download = downloadTextFile
  // « Load WPT/RTE <- USB » depuis le menu de l'appareil : ouvre directement le sélecteur de fichier
  fileHooks.pickFile = (cb) => {
    pending = cb
    fileInput.value?.click()
  }
})
onBeforeUnmount(() => {
  window.removeEventListener('dragover', onDragOver)
  window.removeEventListener('drop', onDrop)
  fileHooks.download = () => {}
  fileHooks.pickFile = () => {}
})
</script>

<style scoped lang="scss">
.panel {
  width: 100%;
}
.mono {
  font-family: 'Roboto Mono', ui-monospace, monospace;
}
.hidden {
  display: none;
}
.bordered-card {
  border: 1px solid rgba(128, 128, 128, 0.35);
}
kbd {
  display: inline-block;
  padding: 0 5px;
  margin: 0 1px;
  border: 1px solid rgba(128, 128, 128, 0.6);
  border-radius: 3px;
  font-size: 11px;
  background: rgba(128, 128, 128, 0.12);
}
.keys > div {
  margin-bottom: 4px;
}
</style>
