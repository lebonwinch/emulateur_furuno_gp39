<template>
  <div class="row q-col-gutter-sm no-wrap">
    <div class="col">
      <q-select
        :model-value="symbol"
        dense
        outlined
        emit-value
        map-options
        label="Symbole"
        :options="symbolOptions"
        @update:model-value="(v: number) => emit('update:symbol', v)"
      >
        <template #selected-item="{ opt }">
          <span class="row items-center no-wrap"
            ><i class="mark" v-html="markSvg(opt.value, color, 16)" /><span class="q-ml-xs">{{ opt.label }}</span></span
          >
        </template>
        <template #option="{ opt, itemProps }">
          <q-item v-bind="itemProps" dense>
            <q-item-section avatar><i class="mark" v-html="markSvg(opt.value, color, 18)" /></q-item-section>
            <q-item-section>{{ opt.label }}</q-item-section>
          </q-item>
        </template>
      </q-select>
    </div>
    <div class="col">
      <q-select
        :model-value="color"
        dense
        outlined
        emit-value
        map-options
        label="Couleur"
        :options="colorOptions"
        @update:model-value="(v: number) => emit('update:color', v)"
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
  </div>
</template>

<script setup lang="ts">
import { COLORS, COLOR_NAMES_FR, SYMBOL_COUNT, SYMBOL_NAMES_FR, markSvg } from '@/gp39/symbols'

// symbole (GP39Symbol) et couleur (FECColor) avec leurs pictogrammes ; le parent garde la valeur (pas d'état ici)
defineProps<{ symbol: number; color: number }>()
const emit = defineEmits<{ (e: 'update:symbol', v: number): void; (e: 'update:color', v: number): void }>()

const symbolOptions = Array.from({ length: SYMBOL_COUNT }, (_, i) => ({ value: i, label: `${i} — ${SYMBOL_NAMES_FR[i] ?? '?'}` }))
const colorOptions = COLOR_NAMES_FR.map((label, i) => ({ value: i, label: `${i} — ${label}` }))
</script>

<style scoped lang="scss">
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
