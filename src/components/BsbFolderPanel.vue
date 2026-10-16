<template>
  <div class="bsb-panel q-mt-xs q-pa-sm rounded-borders bordered">
    <!-- aucun dossier -->
    <template v-if="bsb.phase === 'empty'">
      <div class="text-caption">
        Choisissez le dossier qui contient vos cartes <code>.kap</code> (sous-dossiers compris). Les cartes ne sont ni copiées ni envoyées :
        elles sont lues sur place, au fur et à mesure de l’affichage.
      </div>
      <q-btn dense no-caps outline icon="folder_open" class="q-mt-sm" label="Choisir le dossier…" @click="choose" />
    </template>

    <!-- dossier mémorisé, accès à confirmer -->
    <template v-else-if="bsb.phase === 'needs-permission'">
      <div class="text-caption"> Dossier « {{ bsb.dirName }} » mémorisé : le navigateur demande de confirmer l’accès en lecture. </div>
      <div class="row q-gutter-sm q-mt-sm">
        <q-btn dense no-caps color="primary" unelevated icon="lock_open" label="Autoriser l’accès" @click="grantAccess" />
        <q-btn dense no-caps outline icon="folder_open" label="Autre dossier…" @click="choose" />
      </div>
    </template>

    <!-- analyse des en-têtes -->
    <template v-else-if="bsb.phase === 'scanning'">
      <div class="text-caption">Analyse des cartes de « {{ bsb.dirName }} »… {{ bsb.scanned }} / {{ bsb.total }}</div>
      <q-linear-progress :value="bsb.total ? bsb.scanned / bsb.total : 0" class="q-mt-xs" />
    </template>

    <!-- prêt -->
    <template v-else-if="bsb.phase === 'ready'">
      <div class="text-body2">
        <b>{{ bsb.count }}</b> cartes · du 1:{{ fmt(bsb.scaleMin) }} au 1:{{ fmt(bsb.scaleMax) }}
      </div>
      <div class="text-caption text-grey-7">
        Dossier « {{ bsb.dirName }} ». La carte la plus détaillée encore lisible s’affiche selon le zoom et la zone, les moins détaillées
        complétant ce qu’elle ne couvre pas.
        <span v-if="bsb.skipped.length" class="text-warning"
          >{{ bsb.skipped.length }} fichier(s) ignoré(s)
          <q-tooltip class="bsb-skipped">
            <div v-for="s in bsb.skipped.slice(0, 12)" :key="s.id">{{ s.id }} : {{ s.reason }}</div>
            <div v-if="bsb.skipped.length > 12">…</div>
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
      <div class="text-caption text-negative">{{ bsb.error }}</div>
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
import { ref } from 'vue'
import { bsb, canPickDirectory, forgetDirectory, grantAccess, pickDirectory, pickFromFileList } from './useBsb'

const fileInput = ref<HTMLInputElement | null>(null)
const canPick = canPickDirectory()

const fmt = (n: number): string => n.toLocaleString('fr-FR')

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
.bsb-skipped {
  max-width: 360px;
}
</style>
