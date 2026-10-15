<template>
  <div class="layers-panel" @dragover.prevent @drop.prevent.stop="onDrop">
    <div class="text-overline">Calques</div>
    <div class="text-caption text-grey-7">
      Un calque par fichier GPX importé. L’œil l’affiche ou le masque sur la carte ; le bouton rond désigne le calque qui reçoit les
      nouveaux waypoints.
    </div>

    <q-list v-if="dev.layers.length" dense bordered separator class="rounded-borders q-mt-sm">
      <q-item v-for="l in dev.layers" :key="l.id" dense :active="active === l.id" active-class="bg-blue-1">
        <q-item-section side>
          <q-radio
            v-model="active"
            :val="l.id"
            dense
            :title="`Nouveaux waypoints dans « ${l.name} »`"
            :aria-label="`Calque actif : ${l.name}`"
          />
        </q-item-section>
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
          <q-item-label class="ellipsis cursor-pointer" :class="{ 'text-grey-6': !l.visible }" :title="`${l.name} (cliquer pour renommer)`">
            {{ l.name }}
            <q-popup-edit v-slot="scope" :model-value="l.name" auto-save @save="(v: string) => dev.renameLayer(l.id, v)">
              <q-input v-model="scope.value" dense autofocus maxlength="40" label="Nom du calque" @keyup.enter="scope.set" />
            </q-popup-edit>
          </q-item-label>
          <q-item-label caption>{{ dev.layerCounts.get(l.id) ?? 0 }} waypoints</q-item-label>
        </q-item-section>
        <q-item-section side>
          <div class="row no-wrap items-center">
            <q-btn
              flat
              round
              dense
              size="sm"
              icon="zoom_in_map"
              :disable="!dev.layerCounts.get(l.id)"
              :aria-label="`Voir ${l.name} sur la carte`"
              @click="emit('fit', l.id)"
            />
            <q-btn flat round dense size="sm" icon="delete" :aria-label="`Supprimer le calque ${l.name}`" @click="removeLayer(l.id)" />
          </div>
        </q-item-section>
      </q-item>
    </q-list>
    <div v-else class="text-caption text-grey-7 q-mt-sm">Aucun calque : importez un fichier GPX ou créez un calque vide.</div>

    <div class="row q-gutter-sm q-mt-sm">
      <q-btn dense no-caps outline icon="upload_file" label="Importer des GPX…" @click="fileInput?.click()" />
      <q-btn dense no-caps outline icon="add" label="Nouveau calque" @click="newLayer" />
    </div>
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
      Même nom, même position (à 1 m près), même symbole et même couleur qu’un waypoint déjà chargé. Glisser-déposer des fichiers ici
      fonctionne aussi. Les traces <code>&lt;trk&gt;</code> ne sont pas lues.
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { useQuasar } from 'quasar'
import { useDevice } from '@/stores/device'
import { MAX_GPX_BYTES } from '@/gp39/gpxFile'

/** Calque actif : reçoit les waypoints créés dans l'éditeur. */
const active = defineModel<number | null>({ default: null })
/** `fit` : cadrer la carte sur les waypoints d'un calque. */
const emit = defineEmits<{ (e: 'fit', layerId: number): void }>()

const $q = useQuasar()
const dev = useDevice()
const fileInput = ref<HTMLInputElement | null>(null)
const skipDuplicates = ref(true)

/** Importe les fichiers un par un : chacun devient un calque (sauf s'il n'apporte aucun waypoint). */
async function addFiles(files: File[]): Promise<void> {
  if (!files.length) return
  const problems: string[] = []
  const warnings: string[] = []
  let waypoints = 0
  let layers = 0
  let lastLayer: number | null = null
  for (const f of files) {
    if (f.size > MAX_GPX_BYTES) {
      problems.push(`${f.name} : fichier trop gros (${Math.round(MAX_GPX_BYTES / 1024 / 1024)} Mo au maximum)`)
      continue
    }
    const r = dev.importGpx(await f.text(), 'merge', f.name, { skipDuplicates: skipDuplicates.value })
    if (r.layerId === null) {
      problems.push(`${f.name} : aucun waypoint importé${r.warnings.length ? ` (${r.warnings[0]})` : ''}`)
      continue
    }
    waypoints += r.waypoints
    layers++
    lastLayer = r.layerId
    warnings.push(...r.warnings.filter((w) => !w.includes('sans <name>')).map((w) => `${f.name} : ${w}`))
  }
  if (problems.length) {
    $q.notify({ type: 'warning', message: `${problems.length} fichier(s) non importé(s)`, caption: problems.join(' · '), timeout: 6000 })
  }
  if (layers) {
    $q.notify({
      type: warnings.length ? 'warning' : 'positive',
      message: `${waypoints} waypoints importés dans ${layers} calque(s)`,
      ...(warnings.length ? { caption: warnings.join(' · ') } : {}),
      timeout: 4500,
    })
    if (lastLayer !== null) {
      active.value = lastLayer
      emit('fit', lastLayer)
    }
  }
}

async function onPick(ev: Event): Promise<void> {
  const input = ev.target as HTMLInputElement
  const files = Array.from(input.files ?? [])
  input.value = ''
  await addFiles(files)
}

/** `.stop` : le dépôt n'ouvre pas aussi la fenêtre « Charger » du panneau de commande. */
async function onDrop(e: DragEvent): Promise<void> {
  await addFiles(Array.from(e.dataTransfer?.files ?? []).filter((f) => f.name.toLowerCase().endsWith('.gpx') || f.type.includes('xml')))
}

function newLayer(): void {
  $q.dialog({
    title: 'Nouveau calque',
    message: 'Nom du calque (il recevra les nouveaux waypoints) :',
    prompt: { model: 'Nouveaux waypoints', type: 'text', isValid: (v: string) => v.trim().length > 0 },
    cancel: true,
    persistent: true,
  }).onOk((name: string) => {
    active.value = dev.addLayer(name).id
  })
}

function removeLayer(id: number): void {
  const layer = dev.layers.find((l) => l.id === id)
  if (!layer) return
  const n = dev.layerCounts.get(id) ?? 0
  $q.dialog({
    title: 'Supprimer le calque',
    message: n
      ? `Supprimer le calque « ${layer.name} » et ses ${n} waypoints ? Cette action est définitive.`
      : `Supprimer le calque vide « ${layer.name} » ?`,
    cancel: { label: 'Annuler', flat: true },
    ok: { label: 'Supprimer', color: 'negative' },
    persistent: true,
  }).onOk(() => {
    const r = dev.deleteLayer(id)
    if (r?.blocked) {
      $q.notify({
        type: 'warning',
        message: `${r.deleted} waypoint(s) effacé(s), ${r.blocked} conservé(s)`,
        caption: 'Un waypoint est la destination en cours : le calque est gardé avec lui.',
        timeout: 5000,
      })
    }
  })
}
</script>

<style scoped lang="scss">
.hidden {
  display: none;
}
</style>
