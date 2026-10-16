<template>
  <div>
    <div class="text-overline">Carte</div>
    <q-option-group v-model="baseMap" type="radio" dense :options="baseOptions" />
    <div class="text-caption text-grey-7 q-mt-xs">{{ baseHint }}</div>
    <!-- fond « cartes marines » : choix du dossier, formats reconnus, état de l'analyse -->
    <ChartsFolderPanel v-if="baseMap === 'charts'" />

    <div class="text-overline q-mt-sm">Couches Shom (données libres)</div>
    <q-option-group v-model="shomLayers" type="checkbox" dense :options="shomOptions" />
    <div class="text-caption text-grey-7 q-mt-sm">
      Les fonds viennent de services en ligne (connexion nécessaire) ; leurs sources s’affichent en bas à droite de la carte. Les cartes
      marines Shom ne sont pas destinées à la navigation.
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { BASE_OPTIONS, SHOM_OVERLAYS } from '@/gp39/basemaps'
import ChartsFolderPanel from './ChartsFolderPanel.vue'
import { baseMap, shomLayers } from './useBaseMap'

const baseOptions = BASE_OPTIONS.map((o) => ({ label: o.label, value: o.id }))
const shomOptions = SHOM_OVERLAYS.map((o) => ({ label: o.label, value: o.id }))
const baseHint = computed(() => BASE_OPTIONS.find((o) => o.id === baseMap.value)?.hint ?? '')
</script>
