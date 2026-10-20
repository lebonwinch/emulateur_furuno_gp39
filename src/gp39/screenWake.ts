// Maintient l'écran allumé tant que le GPS de l'appareil sert à naviguer : un navigateur qui met la page en veille gèle la géolocalisation.
// API Screen Wake Lock (Chrome, Edge, Safari 16.4+) ; ailleurs, ou sous Node, ne fait rien. Le verrou est perdu quand la page passe en
// arrière-plan : on le reprend au retour.

interface WakeLockSentinelLike {
  release(): Promise<void>
}
interface WakeLockLike {
  request(type: 'screen'): Promise<WakeLockSentinelLike>
}

export interface ScreenWake {
  on(): void
  off(): void
}

export function createScreenWake(): ScreenWake {
  let wanted = false
  let sentinel: WakeLockSentinelLike | null = null
  const lock = (): WakeLockLike | undefined => (globalThis as { navigator?: { wakeLock?: WakeLockLike } }).navigator?.wakeLock

  const acquire = async (): Promise<void> => {
    if (!wanted || sentinel || !lock()) return
    try {
      sentinel = await lock()!.request('screen')
      // le navigateur a pu retirer le verrou (batterie faible, onglet masqué) : on le sait au prochain retour au premier plan
      ;(sentinel as unknown as EventTarget).addEventListener?.('release', () => (sentinel = null))
    } catch {
      sentinel = null // refusé (page masquée, économie d'énergie) : sans conséquence
    }
  }
  const onVisible = (): void => {
    if (typeof document !== 'undefined' && document.visibilityState === 'visible') void acquire()
  }

  return {
    on(): void {
      if (wanted) return
      wanted = true
      if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVisible)
      void acquire()
    },
    off(): void {
      wanted = false
      if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVisible)
      const s = sentinel
      sentinel = null
      void s?.release().catch(() => undefined)
    },
  }
}
