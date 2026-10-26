// Jeux de caractères acceptés par les champs de texte du GP-39 (noms et commentaires de waypoints et de routes).
// Un nom ou un commentaire qui en sort ne pourrait pas être saisi sur l'appareil : l'éditeur de routes les filtre de la même façon.

export const CHARSET_NAME = ' ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789&()+-/=?>_'
export const CHARSET_COMMENT = '_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789&()+-/=?> '

/**
 * Filtre à la frappe : majuscules (le GP-39 n'a pas de minuscules), caractères de `charset` seulement, `maxLen` au plus.
 * Les espaces sont gardés : « AB » doit pouvoir devenir « AB C ».
 */
export function filterText(raw: string, charset: string, maxLen: number): string {
  return Array.from(raw.toUpperCase())
    .filter((c) => charset.includes(c))
    .slice(0, maxLen)
    .join('')
}

/** Valeur définitive d'un champ : filtrée, sans espaces de début ni de fin. */
export function cleanText(raw: string, charset: string, maxLen: number): string {
  return filterText(raw.trim(), charset, maxLen).trim()
}

/** Vrai si tous les caractères de `text` sont saisissables sur l'appareil (les minuscules ne le sont pas). */
export function isDeviceText(text: string, charset: string): boolean {
  return Array.from(text).every((c) => charset.includes(c))
}
