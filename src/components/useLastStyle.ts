// Dernier symbole et dernière couleur utilisés dans l'éditeur de waypoints : un nouveau waypoint les reprend, pour saisir
// une série de points du même type sans rechoisir à chaque fois. Mémorisés dans le navigateur.

import { ref, watch } from 'vue'
import { parseIndex } from '@/gp39/layers'
import { COLORS, DEFAULT_COLOR, DEFAULT_SYMBOL, SYMBOL_COUNT } from '@/gp39/symbols'
import { readPref, writePref } from './useBaseMap'

/** Dernier symbole (GP39Symbol 0-9) choisi ; rond au départ. */
export const lastSymbol = ref(parseIndex(readPref('gp39.lastsymbol', ''), SYMBOL_COUNT - 1, DEFAULT_SYMBOL))
/** Dernière couleur (FECColor 0-6) choisie ; vert au départ. */
export const lastColor = ref(parseIndex(readPref('gp39.lastcolor', ''), COLORS.length - 1, DEFAULT_COLOR))

watch(lastSymbol, (v) => writePref('gp39.lastsymbol', String(v)))
watch(lastColor, (v) => writePref('gp39.lastcolor', String(v)))
