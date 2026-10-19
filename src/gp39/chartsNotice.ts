// Ce qu'on dit sur la carte quand le fond « Cartes marines » est choisi mais que le dossier n'est pas (encore) lisible : sans message la
// carte reste vide et rien n'explique pourquoi. Pur (sans Vue ni Leaflet) : testable sous Node.

export interface NoticeState {
  phase: 'empty' | 'needs-permission' | 'scanning' | 'ready' | 'error'
  step: string
  dirName: string
  /** fichiers vus pendant le parcours du dossier */
  files: number
  /** en-têtes lus / à lire */
  scanned: number
  total: number
  error: string
}

export interface NoticeAction {
  label: string
  run: () => void
}

export interface Notice {
  text: string
  /** bouton d'action, s'il y en a un */
  action?: NoticeAction
  /** deuxième bouton, discret */
  other?: NoticeAction
}

export interface NoticeActions {
  /** ouvrir le sélecteur de dossier ; absent si le navigateur n'en a pas (Firefox, Safari : il faut passer par le panneau) */
  choose?: () => void
  /** confirmer l'accès au dossier mémorisé */
  grant: () => void
}

/** Le message pour l'état courant ; null quand les cartes sont prêtes. */
export function noticeFor(s: NoticeState, act: NoticeActions): Notice | null {
  const choose = act.choose ? { label: 'Choisir le dossier…', run: act.choose } : undefined
  switch (s.phase) {
    case 'ready':
      return null
    case 'needs-permission':
      return {
        text: `Cartes marines : le navigateur demande de confirmer l’accès en lecture au dossier « ${s.dirName} ».`,
        action: { label: 'Autoriser l’accès', run: act.grant },
        ...(act.choose ? { other: { label: 'Autre dossier…', run: act.choose } } : {}),
      }
    case 'scanning':
      return {
        text:
          s.step === 'listing'
            ? `Cartes marines : parcours du dossier « ${s.dirName} »… ${s.files.toLocaleString('fr-FR')} fichiers`
            : `Cartes marines : lecture du dossier « ${s.dirName} »… ${s.scanned} / ${s.total}`,
      }
    case 'error':
      return { text: `Cartes marines : ${s.error}`, ...(choose ? { action: choose } : {}) }
    default:
      return choose
        ? { text: 'Cartes marines : aucun dossier choisi.', action: choose }
        : { text: 'Cartes marines : aucun dossier choisi. Utilisez « Choisir le dossier… » dans le panneau « Carte ».' }
  }
}
