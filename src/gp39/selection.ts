// Règles de la sélection de waypoints de l'éditeur (sans Vue ni Leaflet : testées sous Node).
//
// « Additive » = ajouter à la sélection au lieu de la remplacer : Ctrl/Cmd/Maj à la souris, ou le bouton « Multi » (un téléphone n'a pas de touche
// de modification).

/** Après un clic ou un toucher : `hit` est le waypoint touché, ou null s'il n'y en a pas. */
export function afterTap(current: ReadonlySet<number>, hit: number | null, additive: boolean): Set<number> {
  if (hit === null) return additive ? new Set(current) : new Set()
  if (!additive) return new Set([hit])
  const next = new Set(current)
  if (!next.delete(hit)) next.add(hit)
  return next
}

/** Après un rectangle de sélection contenant `inside`. */
export function afterBox(current: ReadonlySet<number>, inside: readonly number[], additive: boolean): Set<number> {
  return additive ? new Set([...current, ...inside]) : new Set(inside)
}

/** `PointerEvent.pointerType` : « mouse », « touch » ou « pen » (une chaîne vide est possible sur un navigateur ancien) */
export type PointerKind = string

/** Distance (px) en deçà de laquelle un toucher désigne un waypoint : un doigt est moins précis qu'un pointeur de souris. */
export function pickTolerance(kind: PointerKind): number {
  return kind === 'touch' ? 24 : kind === 'pen' ? 14 : 10
}

/**
 * Un appui qui commence un rectangle de sélection ?
 * - mode « Sélection » : tout glisser, à la souris comme au doigt ;
 * - mode « Déplacer » : seulement Maj + glisser à la souris (au doigt, le glisser déplace la carte) ;
 * - mode « Ajouter » : jamais (un appui crée un waypoint).
 */
export function startsBox(mode: 'pan' | 'select' | 'add', kind: PointerKind, shift: boolean): boolean {
  if (mode === 'add') return false
  if (mode === 'select') return true
  return kind === 'mouse' && shift
}

/** Distance (px) à partir de laquelle un appui devient un glisser (et non un simple toucher). */
export const DRAG_THRESHOLD_PX = 6
