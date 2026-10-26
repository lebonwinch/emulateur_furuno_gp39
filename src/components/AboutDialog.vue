<template>
  <q-dialog v-model="open" :maximized="$q.screen.lt.sm" transition-show="fade" transition-hide="fade">
    <q-card class="about-card column no-wrap" data-testid="about-dialog">
      <q-card-section class="row items-center q-py-sm bg-grey-10 text-grey-2">
        <q-icon name="info" size="sm" class="q-mr-sm" />
        <div class="text-subtitle1">À propos et licences</div>
        <q-space />
        <q-btn flat round dense icon="close" aria-label="Fermer" @click="open = false" />
      </q-card-section>

      <q-card-section class="body col">
        <AboutPanel />
      </q-card-section>
    </q-card>
  </q-dialog>
</template>

<script setup lang="ts">
import AboutPanel from './AboutPanel.vue'

const open = defineModel<boolean>({ default: false })
</script>

<style lang="scss">
.about-card {
  width: min(760px, 96vw);
  max-width: 100vw !important;
  max-height: min(760px, 92vh);
  .body {
    min-height: 0;
    overflow: auto;
  }
}
</style>
