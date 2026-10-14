<template>
  <div class="lcdscreen nav">
    <div class="top">
      <span class="fix">{{ v.fixText.value }}</span>
      <span class="datum">{{ v.datum.value }}</span>
      <span class="when">{{ v.date.value }}</span>
      <span class="when">{{ v.time.value }}</span>
    </div>
    <div class="sep" style="top: 28px" />
    <div class="pos lat">
      <span class="m">{{ lat.main }}</span
      ><span class="h">{{ lat.hemi }}</span>
    </div>
    <div class="pos lon">
      <span class="m">{{ lon.main }}</span
      ><span class="h">{{ lon.hemi }}</span>
    </div>
    <div class="sep" style="top: 190px" />
    <div class="bottom">
      <div class="half">
        <span class="lbl">SOG</span>
        <span class="big">{{ v.sog.value }}</span>
        <span class="unit">{{ v.sUnit.value }}</span>
      </div>
      <div class="half">
        <span class="lbl">COG {{ v.refLetter.value }}</span>
        <span class="big">{{ v.cog.value }}</span
        ><span class="deg">°</span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { splitCoord, useDisplayValues } from '@/gp39/ui/display'

const v = useDisplayValues()
const lat = computed(() => splitCoord(v.lat.value))
const lon = computed(() => splitCoord(v.lon.value))
</script>

<style scoped lang="scss">
.top {
  position: absolute;
  top: 3px;
  left: 6px;
  right: 6px;
  height: 24px;
  display: flex;
  align-items: baseline;
  font-size: 22px;
  gap: 18px;
  .when {
    font-size: 19px;
    margin-left: auto;
    & + .when {
      margin-left: 14px;
    }
  }
}
.pos {
  position: absolute;
  left: 0;
  right: 0;
  text-align: center;
  font-size: 76px;
  line-height: 80px;
  white-space: nowrap;
  letter-spacing: -1px;
  .h {
    font-size: 40px;
    margin-left: 4px;
  }
  &.lat {
    top: 32px;
  }
  &.lon {
    top: 108px;
  }
}
.bottom {
  position: absolute;
  top: 196px;
  left: 0;
  right: 0;
  height: 74px;
  display: flex;
  .half {
    flex: 1;
    position: relative;
    display: flex;
    align-items: flex-end;
    justify-content: flex-end;
    padding: 0 14px 4px 8px;
    &:first-child {
      border-right: 1px solid #c9ccd1;
    }
  }
  .lbl {
    position: absolute;
    left: 8px;
    top: 0;
  }
  .big {
    font-size: 70px;
    line-height: 66px;
    letter-spacing: -1px;
  }
  .unit {
    font-size: 20px;
    margin-bottom: 6px;
    margin-left: 3px;
  }
  .deg {
    font-size: 40px;
    align-self: flex-start;
    margin-top: 8px;
  }
}
</style>
