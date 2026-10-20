<template>
  <div class="about text-caption">
    <div class="text-subtitle2">{{ APP_NAME }}</div>
    <div>{{ COPYRIGHT }}</div>

    <p class="q-mt-sm">
      Licence : <b>{{ LICENSE_NAME }}</b> (<code>{{ LICENSE_ID }}</code
      >). {{ WARRANTY_NOTICE }}
    </p>
    <p>
      Code source :
      <a :href="REPO_URL" target="_blank" rel="noopener">{{ REPO_URL }}</a>
      <br />
      <a :href="legal('LICENSE')" target="_blank" rel="noopener">Texte de la licence</a> ·
      <a :href="legal('THIRD_PARTY_NOTICES.md')" target="_blank" rel="noopener">Avis et licences des composants tiers</a>
    </p>
    <p>{{ TRADEMARK_NOTICE }}</p>
    <p class="text-weight-medium">{{ NAVIGATION_NOTICE }}</p>

    <div class="text-overline">Données et services en ligne</div>
    <ul class="credits">
      <li v-for="c in DATA_CREDITS" :key="c.name">
        <b>{{ c.name }}</b> — {{ c.what }}
        <i>{{ c.licence }}</i>
        <div v-if="c.citation" class="citation">Citation : {{ c.citation }}</div>
      </li>
    </ul>

    <div class="text-overline">Travaux de référence</div>
    <ul class="credits">
      <li v-for="c in REFERENCE_CREDITS" :key="c.name">
        <b>{{ c.name }}</b> — {{ c.what }}
        <i>{{ c.licence }}</i>
      </li>
    </ul>

    <div class="text-overline">Composants embarqués</div>
    <div>
      <span v-for="(c, i) in LIBRARIES" :key="c.name"
        >{{ c.name }} <span class="text-grey-7">({{ c.licence }})</span>{{ i < LIBRARIES.length - 1 ? ' · ' : '' }}</span
      >
    </div>
  </div>
</template>

<script setup lang="ts">
import {
  APP_NAME,
  COPYRIGHT,
  DATA_CREDITS,
  LIBRARIES,
  LICENSE_ID,
  LICENSE_NAME,
  NAVIGATION_NOTICE,
  REFERENCE_CREDITS,
  REPO_URL,
  TRADEMARK_NOTICE,
  WARRANTY_NOTICE,
} from '@/gp39/about'

/** Fichiers déposés dans public/legal/ par `npm run notices`, servis avec l'application */
const legal = (name: string): string => `${import.meta.env.BASE_URL}legal/${name}`
</script>

<style scoped lang="scss">
.about p {
  margin: 6px 0;
}
.credits {
  margin: 0;
  padding-left: 18px;
  li {
    margin-bottom: 4px;
  }
}
.citation {
  font-family: 'Roboto Mono', ui-monospace, monospace;
  font-size: 11px;
  word-break: break-all;
}
</style>
