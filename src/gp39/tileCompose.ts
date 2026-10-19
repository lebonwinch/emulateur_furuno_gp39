// Superposition des tuiles que fabriquent les différents moteurs (BSB, MBTiles, CM93) pour un même emplacement : la plus lisible au
// dessus. Chaque source donne un « rang » (plus petit = plus lisible) ; pur, donc testable sans navigateur.

export interface TilePart {
  /** pixels RGBA de la tuile */
  pixels: Uint32Array
  /** côté des pixels */
  size: number
  /** plus petit = passe devant */
  rank: number
}

/** Le CM93 choisit toujours son échelle d'après le zoom : rang moyen, derrière une carte lisible, devant une carte mal adaptée. */
export const CM93_RANK = 1.5

/**
 * Rang d'une tuile de carte BSB : rang de sa carte la plus prioritaire (0 lisible, 1 un peu trop détaillée, 2 agrandie, 3 beaucoup
 * trop détaillée). Les rangs 0 et 1 passent devant le CM93, les autres derrière.
 */
export const bsbRank = (best: number | undefined): number => best ?? 0

/**
 * Parties à dessiner du dessous au dessus. `parts` est donné dans l'ordre de préférence à rang égal (BSB, MBTiles, CM93) : à rang
 * égal, la première passe devant.
 */
export function stackOrder(parts: readonly TilePart[]): TilePart[] {
  return parts
    .map((p, i) => ({ p, i }))
    .sort((a, b) => b.p.rank - a.p.rank || b.i - a.i)
    .map((x) => x.p)
}
