<template>
  <q-dialog v-model="open">
    <q-card class="legend-card">
      <q-card-section class="row items-center q-py-sm bg-grey-10 text-grey-2">
        <q-icon name="category" size="sm" class="q-mr-sm" />
        <div class="text-subtitle1">Légende des symboles et couleurs GP-39</div>
        <q-space />
        <q-btn flat round dense icon="close" aria-label="Fermer" @click="open = false" />
      </q-card-section>

      <q-card-section class="text-body2">
        Règle appliquée : <code>GP39Symbol</code> et <code>FECColor</code> du GPX sont le <b>rang</b> dans les listes <i>Symbol</i> et
        <i>Color</i> du GP-39 (menu Waypoint Info). Les nombres sont ceux du fichier actuellement chargé ({{ dev.waypoints.length }}
        waypoints).
      </q-card-section>

      <q-card-section class="q-pt-none">
        <div class="text-overline">GP39Symbol</div>
        <table class="legend">
          <thead>
            <tr>
              <th>Code</th>
              <th>Pictogramme</th>
              <th>Forme</th>
              <th class="num">Waypoints</th>
              <th>Couleurs utilisées dans le fichier</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="s in symbolRows" :key="s.code" :class="{ unused: !s.total }">
              <td class="code">{{ s.code }}</td>
              <td class="icon" v-html="s.icon" />
              <td>
                {{ s.name }}
                <q-badge v-if="s.provisional" color="orange" text-color="black" class="q-ml-xs" label="provisoire" />
              </td>
              <td class="num">{{ s.total }}</td>
              <td>
                <span v-for="c in s.colors" :key="c.code" class="chip"><i v-html="c.icon" />{{ c.name }} {{ c.count }}</span>
                <span v-if="!s.colors.length" class="text-grey-6">—</span>
              </td>
            </tr>
          </tbody>
        </table>

        <div class="text-overline q-mt-md">FECColor</div>
        <table class="legend">
          <thead>
            <tr>
              <th>Code</th>
              <th>Couleur</th>
              <th>Nom GP-39</th>
              <th>RVB (symbols.pdf)</th>
              <th class="num">Waypoints</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="c in colorRows" :key="c.code">
              <td class="code">{{ c.code }}</td>
              <td><span class="swatch" :style="{ background: c.hex }" /></td>
              <td
                >{{ c.nameFr }} <span class="text-grey-6">({{ c.name }})</span></td
              >
              <td class="mono">{{ c.hex }}</td>
              <td class="num">{{ c.total }}</td>
            </tr>
          </tbody>
        </table>

        <div class="text-caption text-grey-7 q-mt-md">
          Codes confirmés par votre <code>symbols.pdf</code> et par l'export : 0 rond, 2 losange, 8 tête de mort, 9 drapeau. Le manuel du
          GP-39 ne montre que les 6 premiers symboles de la liste (rond, carré, losange, trois poissons) : 6 (ancre) et 7 (croix) sont des
          hypothèses.
        </div>
      </q-card-section>
    </q-card>
  </q-dialog>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useDevice } from '@/stores/device'
import { COLORS, COLOR_NAMES, COLOR_NAMES_FR, SYMBOL_COUNT, SYMBOL_NAMES_FR, markSvg } from '@/gp39/symbols'

const open = defineModel<boolean>({ default: false })
const dev = useDevice()

/** Décompte (symbole, couleur) dans les waypoints chargés. */
const counts = computed(() => {
  const m = new Map<number, Map<number, number>>()
  for (const w of dev.waypoints) {
    const byColor = m.get(w.symbol) ?? new Map<number, number>()
    byColor.set(w.color, (byColor.get(w.color) ?? 0) + 1)
    m.set(w.symbol, byColor)
  }
  return m
})

const symbolRows = computed(() =>
  Array.from({ length: SYMBOL_COUNT }, (_, code) => {
    const byColor = counts.value.get(code)
    const colors = [...(byColor?.entries() ?? [])]
      .sort((a, b) => a[0] - b[0])
      .map(([c, count]) => ({ code: c, name: COLOR_NAMES_FR[c] ?? '?', count, icon: markSvg(code, c, 16) }))
    return {
      code,
      name: SYMBOL_NAMES_FR[code] ?? '?',
      icon: markSvg(code, 5, 30),
      provisional: code === 6 || code === 7,
      total: colors.reduce((n, c) => n + c.count, 0),
      colors,
    }
  }),
)

const colorRows = computed(() =>
  COLORS.map((hex, code) => {
    let total = 0
    for (const byColor of counts.value.values()) total += byColor.get(code) ?? 0
    return { code, hex, name: COLOR_NAMES[code], nameFr: COLOR_NAMES_FR[code], total }
  }),
)
</script>

<style lang="scss" scoped>
.legend-card {
  width: min(900px, 96vw);
  max-width: 100vw !important;
}
.legend {
  border-collapse: collapse;
  width: 100%;
  font-size: 13px;
  th,
  td {
    border-bottom: 1px solid rgba(128, 128, 128, 0.3);
    padding: 3px 8px;
    text-align: left;
    vertical-align: middle;
  }
  .num {
    text-align: right;
  }
  .code {
    font-weight: 700;
    width: 2.5em;
  }
  .icon {
    width: 44px;
    text-align: center;
  }
  tr.unused {
    opacity: 0.55;
  }
}
.chip {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  margin-right: 10px;
  white-space: nowrap;
}
.swatch {
  display: inline-block;
  width: 36px;
  height: 16px;
  border: 1px solid rgba(0, 0, 0, 0.4);
}
.mono {
  font-family: 'Roboto Mono', ui-monospace, monospace;
}
</style>
