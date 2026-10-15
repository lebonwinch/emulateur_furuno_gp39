// Fichiers GPX : nom du fichier exporté et taille maximale d'un fichier importé.

/** Taille maximale d'un fichier GPX lu (le parseur travaille en mémoire sur le texte entier). */
export const MAX_GPX_BYTES = 25 * 1024 * 1024
/** Nom (sans extension) que le GP-39 sait relire. */
export const DEFAULT_EXPORT_NAME = 'GP39_WptRte'

// noms de périphériques Windows, interdits même suivis d'une extension (CON, NUL.txt, COM1…)
const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i
const TRAILING = /[. ]+$/

/**
 * Nom de fichier d'export valide sous Windows, macOS et Linux, extension `.gpx` comprise : l'utilisateur tape le nom
 * (avec ou sans `.gpx`), les caractères interdits deviennent « _ », un nom vide redonne le nom reconnu par le GP-39.
 */
export function gpxFileName(raw: string): string {
  let base = raw
    .trim()
    .replace(TRAILING, '')
    .replace(/\.gpx$/i, '')
  base = Array.from(base)
    .map((c) => (c.charCodeAt(0) < 32 || '\\/:*?"<>|'.includes(c) ? '_' : c))
    .join('')
  base = base.trim().replace(TRAILING, '')
  if (WINDOWS_RESERVED.test(base)) base = `_${base}`
  const name = Array.from(base).slice(0, 96).join('').replace(TRAILING, '')
  return `${name || DEFAULT_EXPORT_NAME}.gpx`
}
