// Fichiers GPX chargés à part dans le bloc « Données » (5 au plus) : ils ne touchent pas à l'appareil, ils servent à être
// exportés ensemble dans un seul fichier. État en mémoire seulement (à recharger après un rafraîchissement de la page).

import { defineStore } from 'pinia'
import { computed, ref, shallowRef } from 'vue'
import { DEFAULT_EXPORT_NAME, MAX_GPX_SETS, mergeGpxSets, readGpxSet, type GpxSet, type ReadResult } from '@/gp39/gpxSets'

export const useGpxSets = defineStore('gpxSets', () => {
  // tableau remplacé à chaque changement (jamais modifié en place) : pas de réactivité profonde sur des milliers de waypoints
  const sets = shallowRef<GpxSet[]>([])
  const exportName = ref(DEFAULT_EXPORT_NAME)
  const dedupe = ref(true)
  let nextId = 1

  const count = computed(() => sets.value.length)
  const full = computed(() => sets.value.length >= MAX_GPX_SETS)
  /** Fusion recalculée seulement quand les fichiers ou l'option « doublons » changent. */
  const merged = computed(() => mergeGpxSets(sets.value, { dedupe: dedupe.value }))

  function add(fileName: string, xml: string): ReadResult {
    if (full.value) return { ok: false, error: `${fileName} : ${MAX_GPX_SETS} fichiers GPX au maximum` }
    const r = readGpxSet(nextId, fileName, xml)
    if (!r.ok) return r
    nextId++
    sets.value = [...sets.value, r.set]
    return r
  }

  function remove(id: number): void {
    sets.value = sets.value.filter((s) => s.id !== id)
  }

  function clear(): void {
    sets.value = []
  }

  return { sets, exportName, dedupe, count, full, merged, add, remove, clear }
})
