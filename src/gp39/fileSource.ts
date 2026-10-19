// Comment un Worker relira un fichier du dossier de l'utilisateur : le File lui-même, ou la poignée de fichier du navigateur
// (clonable ; la lecture se fait alors dans le Worker, seulement si besoin).

import type { ChartFileRef } from './bsb/catalog'

export interface FileSource {
  file?: Blob
  handle?: { getFile(): Promise<File> }
}

export function fileSource(ref: ChartFileRef): FileSource {
  const s = ref.source
  if (!s) return { handle: { getFile: () => ref.getFile() } }
  return s instanceof Blob ? { file: s } : { handle: s }
}
