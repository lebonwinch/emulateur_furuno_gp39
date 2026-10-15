<template>
  <div class="gpx-merge" @dragover.prevent @drop.prevent.stop="onDrop">
    <div class="text-caption text-grey-7">
      Chargez jusqu’à {{ MAX_GPX_SETS }} fichiers GPX, chacun à part (bouton ou glisser-déposer ici) : ils ne modifient pas l’appareil.
      Exportez-les ensuite dans un seul fichier.
    </div>

    <q-btn
      dense
      no-caps
      outline
      icon="upload_file"
      class="full-width q-mt-sm"
      :disable="gpx.full"
      :label="`Ajouter des fichiers GPX… (${gpx.count}/${MAX_GPX_SETS})`"
      @click="fileInput?.click()"
    />
    <input
      ref="fileInput"
      type="file"
      multiple
      accept=".gpx,application/gpx+xml,text/xml,application/xml"
      class="hidden"
      @change="onPick"
    />

    <q-list v-if="gpx.count" dense bordered separator class="rounded-borders q-mt-sm">
      <q-item v-for="s in gpx.sets" :key="s.id" dense>
        <q-item-section>
          <q-item-label class="ellipsis" :title="s.fileName">{{ s.fileName }}</q-item-label>
          <q-item-label caption>{{ s.waypoints.length }} waypoints · {{ s.routes.length }} routes</q-item-label>
        </q-item-section>
        <q-item-section side>
          <div class="row no-wrap items-center">
            <q-icon
              v-if="s.warnings.length"
              name="warning"
              color="warning"
              size="xs"
              class="q-mr-xs"
              aria-label="Avertissements de lecture"
            >
              <q-tooltip class="gpx-warn">
                <div v-for="w in s.warnings" :key="w">{{ w }}</div>
              </q-tooltip>
            </q-icon>
            <q-btn flat round dense size="sm" icon="close" :aria-label="`Retirer ${s.fileName}`" @click="gpx.remove(s.id)" />
          </div>
        </q-item-section>
      </q-item>
    </q-list>

    <template v-if="gpx.count">
      <q-checkbox v-model="gpx.dedupe" dense class="q-mt-sm" label="Supprimer les doublons entre fichiers" />
      <div class="text-caption text-grey-7">
        Un waypoint déjà présent dans un fichier précédent (même nom, même position à 1 m près, même symbole, même couleur) ou une route
        identique n’est pas répété. Les répétitions à l’intérieur d’un même fichier sont conservées.
      </div>

      <div class="text-body2 q-mt-sm">
        Fichier fusionné : <b>{{ gpx.merged.waypoints.length }}</b> waypoints · <b>{{ gpx.merged.routes.length }}</b> routes
      </div>
      <div v-for="w in gpx.merged.warnings" :key="w" class="text-caption text-warning">{{ w }}</div>

      <q-input
        v-model="gpx.exportName"
        dense
        outlined
        class="q-mt-sm"
        label="Nom du fichier exporté"
        suffix=".gpx"
        maxlength="96"
        :hint="
          isDeviceName ? 'Nom reconnu par le GP-39.' : `Enregistré sous « ${fileName} ». Le GP-39 ne relit que ${DEFAULT_EXPORT_NAME}.gpx.`
        "
        @keyup.enter="exportMerged"
      />
      <div class="row q-gutter-sm q-mt-xs">
        <q-btn color="primary" unelevated no-caps dense icon="download" :disable="empty" label="Exporter" @click="exportMerged" />
        <q-btn flat dense no-caps icon="delete_sweep" label="Tout retirer" @click="gpx.clear()" />
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { useQuasar } from 'quasar'
import { downloadTextFile } from '@/gp39/download'
import { DEFAULT_EXPORT_NAME, MAX_GPX_BYTES, MAX_GPX_SETS, gpxFileName, mergedGpxText } from '@/gp39/gpxSets'
import { useGpxSets } from '@/stores/gpxSets'

const $q = useQuasar()
const gpx = useGpxSets()
const fileInput = ref<HTMLInputElement | null>(null)

const fileName = computed(() => gpxFileName(gpx.exportName))
const isDeviceName = computed(() => fileName.value === `${DEFAULT_EXPORT_NAME}.gpx`)
const empty = computed(() => !gpx.merged.waypoints.length && !gpx.merged.routes.length)

/** Ajoute les fichiers dans l'ordre jusqu'à la limite ; signale ceux qui sont refusés. */
async function addFiles(files: File[]): Promise<void> {
  if (!files.length) return
  const problems: string[] = []
  let added = 0
  for (const f of files) {
    if (gpx.full) {
      problems.push(`${f.name} : ${MAX_GPX_SETS} fichiers GPX au maximum`)
      continue
    }
    if (f.size > MAX_GPX_BYTES) {
      problems.push(`${f.name} : fichier trop gros (${Math.round(MAX_GPX_BYTES / 1024 / 1024)} Mo au maximum)`)
      continue
    }
    const r = gpx.add(f.name, await f.text())
    if (r.ok) added++
    else problems.push(r.error)
  }
  if (problems.length) {
    $q.notify({
      type: 'warning',
      message: `${problems.length} fichier(s) non chargé(s)`,
      caption: problems.join(' · '),
      timeout: 6000,
    })
  }
  if (added) $q.notify({ type: 'positive', message: `${added} fichier(s) GPX chargé(s)`, timeout: 2000 })
}

async function onPick(ev: Event): Promise<void> {
  const input = ev.target as HTMLInputElement
  const files = Array.from(input.files ?? [])
  input.value = ''
  await addFiles(files)
}

/** Dépôt de fichiers sur ce panneau (`.stop` : le dépôt n'ouvre pas aussi la fenêtre « Charger » de l'appareil). */
async function onDrop(e: DragEvent): Promise<void> {
  const files = Array.from(e.dataTransfer?.files ?? []).filter((f) => f.name.toLowerCase().endsWith('.gpx') || f.type.includes('xml'))
  await addFiles(files)
}

function exportMerged(): void {
  if (empty.value) return
  const m = gpx.merged
  downloadTextFile(fileName.value, mergedGpxText(m))
  $q.notify({
    type: m.warnings.length ? 'warning' : 'positive',
    message: `${fileName.value} exporté (${m.stats.waypoints} waypoints, ${m.stats.routes} routes)`,
    ...(m.warnings.length ? { caption: m.warnings.join(' · ') } : {}),
    timeout: 4500,
  })
}
</script>

<style scoped lang="scss">
.hidden {
  display: none;
}
</style>

<style lang="scss">
/* l'infobulle est téléportée hors du composant : style non « scoped » */
.gpx-warn {
  max-width: 320px;
}
</style>
