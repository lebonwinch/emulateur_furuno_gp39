// Choix des fichiers MBTiles pour une tuile : ceux dont l'emprise et les niveaux de zoom conviennent, le plus adapté d'abord.

import { tileBox } from '../bsb/tiles'
import type { MbtilesInfo } from './mbtiles'

/** Au-delà de ce nombre de niveaux de zoom au-dessus du dernier niveau d'un fichier, la tuile agrandie ne serait plus qu'une bouillie. */
export const MAX_OVERZOOM = 5
/** Nombre maximal de fichiers superposés pour une tuile (elle s'arrête dès qu'elle est entièrement couverte). */
export const MAX_FILES_PER_TILE = 6

export interface MbEntry {
  id: string
  info: MbtilesInfo
}

export interface MbPick {
  id: string
  /** niveaux de zoom d'agrandissement : 0 = tuile native du fichier */
  dz: number
}

/**
 * Fichiers à consulter pour la tuile z/x/y, du plus prioritaire au moins prioritaire :
 *  1. fichiers dont les zooms contiennent z (tuiles natives), le plus détaillé (dernier zoom le plus grand) d'abord ;
 *  2. puis fichiers qu'il faut agrandir (z au-dessus de leur dernier zoom), le moins agrandi d'abord.
 * Les fichiers qui commencent plus bas que z ne sont pas utilisés (pas de réduction de tuiles).
 */
export function planMbtiles(entries: readonly MbEntry[], z: number, x: number, y: number): MbPick[] {
  const box = tileBox(z, x, y)
  const picks: (MbPick & { maxzoom: number })[] = []
  for (const e of entries) {
    const [w, s, ea, n] = e.info.bounds
    if (w > box.east || ea < box.west || s > box.north || n < box.south) continue
    if (z < e.info.minzoom) continue
    const dz = Math.max(0, z - e.info.maxzoom)
    if (dz > MAX_OVERZOOM) continue
    picks.push({ id: e.id, dz, maxzoom: e.info.maxzoom })
  }
  picks.sort((a, b) => a.dz - b.dz || b.maxzoom - a.maxzoom || a.id.localeCompare(b.id))
  return picks.slice(0, MAX_FILES_PER_TILE).map(({ id, dz }) => ({ id, dz }))
}

/**
 * Rang de qualité d'une tuile MBTiles pour départager avec les autres sources du dossier (plus petit = plus lisible, passe devant) :
 * native 0,5 ; agrandie une fois 1,25 ; davantage 2.
 */
export const mbtilesRank = (dz: number): number => (dz === 0 ? 0.5 : dz === 1 ? 1.25 : 2)
