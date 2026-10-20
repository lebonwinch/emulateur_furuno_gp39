<template>
  <div class="possrc">
    <q-btn-toggle
      :model-value="dev.sim.source"
      class="full-width"
      spread
      no-caps
      dense
      unelevated
      toggle-color="primary"
      color="grey-3"
      text-color="grey-9"
      :options="OPTIONS"
      @update:model-value="(v: PositionSource) => dev.setPositionSource(v)"
    />

    <div v-if="!dev.isSim" class="q-mt-sm" data-testid="gps-status">
      <div class="row items-center no-wrap">
        <q-icon :name="look.icon" :color="look.color" size="sm" class="q-mr-sm" />
        <span class="text-body2">{{ GPS_STATUS_TEXT[dev.gps.status] }}</span>
      </div>

      <div v-if="detail && dev.gps.status === 'tracking'" class="text-caption text-grey-8 q-mt-xs">
        Précision ±{{ accuracyText }} · altitude {{ altitudeText }}<br />
        SOG {{ dev.ship.sog.toFixed(1) }} kn · COG {{ cogText }} · il y a {{ ageText }}
      </div>

      <div v-if="hint" class="text-caption text-grey-7 q-mt-xs">{{ hint }}</div>

      <q-btn
        v-if="dev.gps.status === 'prompt'"
        class="q-mt-sm"
        color="primary"
        unelevated
        dense
        no-caps
        icon="my_location"
        label="Activer la localisation"
        @click="dev.enableDeviceGps()"
      />
      <q-btn
        v-else-if="RETRY.includes(dev.gps.status)"
        class="q-mt-sm"
        outline
        dense
        no-caps
        icon="refresh"
        label="Réessayer"
        @click="dev.enableDeviceGps()"
      />
    </div>
    <div v-else-if="detail" class="text-caption text-grey-7 q-mt-xs">Le bateau est placé et déplacé par vos soins (voir ci-dessous).</div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useDevice } from '@/stores/device'
import { GPS_STATUS_TEXT, type GpsStatus } from '@/gp39/deviceGps'
import type { PositionSource } from '@/gp39/defaults'

withDefaults(defineProps<{ detail?: boolean }>(), { detail: false })

const dev = useDevice()

const OPTIONS = [
  { label: 'Simulée', value: 'sim', icon: 'smart_toy' },
  { label: 'GPS de l’appareil', value: 'device', icon: 'my_location' },
]
/** états après lesquels un nouvel essai a un sens */
const RETRY: GpsStatus[] = ['denied', 'unavailable', 'timeout', 'lost', 'imprecise']

const look = computed(() => {
  switch (dev.gps.status) {
    case 'tracking':
      return { icon: 'gps_fixed', color: 'positive' }
    case 'starting':
    case 'prompt':
      return { icon: 'gps_not_fixed', color: 'warning' }
    default:
      return { icon: 'gps_off', color: 'negative' }
  }
})

const HINTS: Partial<Record<GpsStatus, string>> = {
  prompt: 'Le navigateur va vous demander l’autorisation de lire la position de l’appareil.',
  denied: 'Autorisez la localisation pour ce site dans les réglages du navigateur (icône à gauche de l’adresse), puis réessayez.',
  insecure: 'Le navigateur ne donne la position qu’aux pages en HTTPS (ou sur localhost).',
  unsupported: 'Utilisez un navigateur récent (Chrome, Edge, Firefox, Safari).',
  imprecise: 'Sans puce GPS (ordinateur fixe), le navigateur ne connaît que la ville : utilisez un téléphone ou une tablette.',
  unavailable: 'Vérifiez que la localisation est activée sur l’appareil.',
  timeout: 'Sortez à l’air libre : le GPS n’a pas encore de satellites.',
  lost: 'Le GPS ne donne plus de position : le bateau est tenu pour arrêté, sans fix.',
}
const hint = computed(() => HINTS[dev.gps.status] ?? '')

const accuracyText = computed(() => (dev.gps.accuracy === null ? '?' : `${Math.round(dev.gps.accuracy)} m`))
const altitudeText = computed(() => (dev.altitude === null ? '--' : `${Math.round(dev.altitude)} m`))
const cogText = computed(() => (dev.ship.hasCog ? `${Math.round(dev.ship.cog)}°` : '--'))
const ageText = computed(() => (dev.gps.lastFixAt ? `${Math.max(0, Math.round((dev.nowMs - dev.gps.lastFixAt) / 1000))} s` : '—'))
</script>
