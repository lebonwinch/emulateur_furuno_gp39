<template>
  <q-dialog v-model="open" :maximized="$q.screen.lt.sm" transition-show="fade" transition-hide="fade">
    <q-card class="help-card column no-wrap" data-testid="help-dialog">
      <q-card-section class="row items-center q-py-sm bg-grey-10 text-grey-2">
        <q-icon name="help_outline" size="sm" class="q-mr-sm" />
        <div class="text-subtitle1">Aide</div>
        <q-space />
        <q-btn flat round dense icon="close" aria-label="Fermer" @click="open = false" />
      </q-card-section>

      <q-tabs v-model="tab" dense align="left" class="text-grey-8" active-color="primary" indicator-color="primary" narrow-indicator>
        <q-tab name="symbols" icon="category" label="Légende des symboles" no-caps data-testid="tab-symbols" />
        <q-tab name="keys" icon="keyboard" label="Raccourcis clavier" no-caps data-testid="tab-keys" />
      </q-tabs>
      <q-separator />

      <q-tab-panels v-model="tab" animated class="panels col">
        <q-tab-panel name="symbols">
          <SymbolLegendPanel />
        </q-tab-panel>
        <q-tab-panel name="keys">
          <KeyboardShortcuts />
        </q-tab-panel>
      </q-tab-panels>
    </q-card>
  </q-dialog>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import KeyboardShortcuts from './KeyboardShortcuts.vue'
import SymbolLegendPanel from './SymbolLegendPanel.vue'

const open = defineModel<boolean>({ default: false })
/** Onglet affiché : le dernier consulté est conservé tant que la page reste ouverte. */
const tab = ref<'symbols' | 'keys'>('symbols')
</script>

<style lang="scss">
.help-card {
  width: min(900px, 96vw);
  max-width: 100vw !important;
  max-height: min(760px, 92vh);
  .panels {
    min-height: 0;
    overflow: auto;
  }
}
</style>
