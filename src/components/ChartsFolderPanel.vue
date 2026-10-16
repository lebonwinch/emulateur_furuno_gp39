<template>
  <div class="charts-panel q-mt-xs q-pa-sm rounded-borders bordered">
    <!-- aucun dossier -->
    <template v-if="charts.phase === 'empty'">
      <div class="text-caption">
        Choisissez le dossier qui contient vos cartes marines (sous-dossiers compris). Le format est reconnu automatiquement :
        <b>BSB/KAP</b> (cartes raster : SHOM, NOAA…) ou <b>CM93</b> (cartes vectorielles C-MAP, avec leurs dictionnaires
        <code>CM93OBJ.DIC</code> et <code>CM93ATTR.DIC</code>). Les cartes ne sont ni copiées ni envoyées : elles sont lues sur place, au
        fur et à mesure de l’affichage.
      </div>
      <q-btn dense no-caps outline icon="folder_open" class="q-mt-sm" label="Choisir le dossier…" @click="choose" />
    </template>

    <!-- dossier mémorisé, accès à confirmer -->
    <template v-else-if="charts.phase === 'needs-permission'">
      <div class="text-caption"> Dossier « {{ charts.dirName }} » mémorisé : le navigateur demande de confirmer l’accès en lecture. </div>
      <div class="row q-gutter-sm q-mt-sm">
        <q-btn dense no-caps color="primary" unelevated icon="lock_open" label="Autoriser l’accès" @click="grantAccess" />
        <q-btn dense no-caps outline icon="folder_open" label="Autre dossier…" @click="choose" />
      </div>
    </template>

    <!-- analyse du dossier -->
    <template v-else-if="charts.phase === 'scanning'">
      <div v-if="charts.step === 'listing'" class="text-caption">
        Parcours du dossier « {{ charts.dirName }} »… {{ charts.files.toLocaleString('fr-FR') }} fichiers
      </div>
      <div v-else-if="charts.step === 'bsb'" class="text-caption">Lecture des cartes BSB… {{ charts.scanned }} / {{ charts.total }}</div>
      <div v-else class="text-caption">Lecture des dictionnaires CM93…</div>
      <q-linear-progress :indeterminate="charts.step !== 'bsb'" :value="charts.total ? charts.scanned / charts.total : 0" class="q-mt-xs" />
    </template>

    <!-- prêt -->
    <template v-else-if="charts.phase === 'ready'">
      <div v-if="charts.formats.includes('bsb')" class="text-body2">
        <b>BSB</b> (raster) : <b>{{ charts.bsb.count }}</b> cartes · du {{ scaleText(charts.bsb.scaleMin) }} au
        {{ scaleText(charts.bsb.scaleMax) }}
      </div>
      <div v-if="charts.formats.includes('cm93')" class="text-body2">
        <b>CM93</b> (vectoriel) : <b>{{ charts.cm93.cells.toLocaleString('fr-FR') }}</b> cellules · {{ cm93Range }}
        <q-tooltip class="charts-tip">
          <div v-for="s in scaleRows" :key="s.ch"
            >{{ s.ch }} (1:{{ s.denom.toLocaleString('fr-FR') }}) : {{ s.n.toLocaleString('fr-FR') }} cellules</div
          >
        </q-tooltip>
      </div>
      <div class="text-caption text-grey-7">
        Dossier « {{ charts.dirName }} ». À chaque zoom et à chaque endroit, la carte la plus détaillée encore lisible s’affiche, les moins
        détaillées complétant ce qu’elle ne couvre pas.
        <span v-if="charts.bsb.skipped.length" class="text-warning"
          >{{ charts.bsb.skipped.length }} fichier(s) BSB ignoré(s)
          <q-tooltip class="charts-tip">
            <div v-for="s in charts.bsb.skipped.slice(0, 12)" :key="s.id">{{ s.id }} : {{ s.reason }}</div>
            <div v-if="charts.bsb.skipped.length > 12">…</div>
          </q-tooltip></span
        >
      </div>
      <div class="row q-gutter-sm q-mt-xs">
        <q-btn dense no-caps outline icon="folder_open" label="Changer de dossier…" @click="choose" />
        <q-btn dense no-caps flat icon="delete_outline" label="Oublier" @click="forgetDirectory" />
      </div>
    </template>

    <!-- erreur -->
    <template v-else>
      <div class="text-caption text-negative">{{ charts.error }}</div>
      <q-btn dense no-caps outline icon="folder_open" class="q-mt-sm" label="Choisir un autre dossier…" @click="choose" />
    </template>

    <div v-if="!canPick" class="text-caption text-grey-7 q-mt-sm">
      Ce navigateur ne sait pas mémoriser le dossier : il faudra le choisir de nouveau à chaque session (Chrome et Edge le mémorisent).
    </div>
    <!-- repli : sélection d'un dossier par un champ de fichier (Firefox, Safari) -->
    <input ref="fileInput" type="file" webkitdirectory multiple class="hidden" @change="onFolder" />
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { SCALES } from '@/gp39/cm93/scales'
import {
  canPickDirectory,
  charts,
  cm93ScaleRange,
  forgetDirectory,
  grantAccess,
  pickDirectory,
  pickFromFileList,
  scaleText,
} from './useCharts'

const fileInput = ref<HTMLInputElement | null>(null)
const canPick = canPickDirectory()

const cm93Range = computed(() => cm93ScaleRange(charts.cm93.perScale))
const scaleRows = computed(() =>
  SCALES.map((s, i) => ({ ch: s.ch, denom: s.denom, n: charts.cm93.perScale[i] ?? 0 })).filter((s) => s.n > 0),
)

function choose(): void {
  if (canPick) void pickDirectory()
  else fileInput.value?.click()
}

async function onFolder(e: Event): Promise<void> {
  const input = e.target as HTMLInputElement
  const files = input.files
  await pickFromFileList(files)
  input.value = ''
}
</script>

<style scoped lang="scss">
.bordered {
  border: 1px solid rgba(128, 128, 128, 0.35);
}
.hidden {
  display: none;
}
</style>

<style lang="scss">
.charts-tip {
  max-width: 360px;
}
</style>
