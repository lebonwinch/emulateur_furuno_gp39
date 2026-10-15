// Téléchargement d'un texte comme fichier : lien temporaire cliqué par programme.

export function downloadTextFile(name: string, content: string, type = 'application/gpx+xml'): void {
  const url = URL.createObjectURL(new Blob([content], { type }))
  const a = document.createElement('a')
  a.href = url
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 2000)
}
