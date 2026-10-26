<template>
  <q-page class="gp-page">
    <div class="device-col">
      <GP39Device />
    </div>
    <div class="side-col">
      <ControlPanel @position="showPosition = true" @editor="showEditor = true" @routes="showRoutes = true" />
    </div>
    <PositionDialog v-model="showPosition" />
    <WaypointEditorDialog v-model="showEditor" />
    <RouteEditorDialog v-model="showRoutes" />
  </q-page>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import GP39Device from '@/components/GP39Device.vue'
import ControlPanel from '@/components/ControlPanel.vue'
import PositionDialog from '@/components/PositionDialog.vue'
import RouteEditorDialog from '@/components/RouteEditorDialog.vue'
import WaypointEditorDialog from '@/components/WaypointEditorDialog.vue'

const showPosition = ref(false)
const showEditor = ref(false)
const showRoutes = ref(false)
</script>

<style scoped lang="scss">
.gp-page {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  align-items: flex-start;
  gap: 20px;
  padding: 16px;
}
.device-col {
  flex: 1 1 560px;
  max-width: 940px;
  min-width: 300px;
}
.side-col {
  flex: 0 1 300px;
  min-width: 260px;
}
@media (max-width: 700px) {
  .gp-page {
    padding: 8px;
  }
  .side-col {
    flex: 1 1 100%;
  }
}
</style>
