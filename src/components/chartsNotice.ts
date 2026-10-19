// Message affiché SUR la carte quand le fond « Cartes marines » est choisi mais que le dossier n'est pas (encore) lisible : sans lui la
// carte reste vide et rien n'explique pourquoi (le panneau qui le dit est ailleurs, souvent hors de l'écran). Le texte vient de
// `noticeFor` (testé) ; ici, seulement le contrôle Leaflet.

import L from 'leaflet'
import { noticeFor, type Notice } from '@/gp39/chartsNotice'
import { canPickDirectory, charts, grantAccess, pickDirectory } from './useCharts'

/** Ce qu'il faut dire (et proposer) dans l'état courant ; null quand les cartes sont prêtes. */
export const chartsNotice = (): Notice | null =>
  noticeFor(charts, {
    grant: () => void grantAccess(),
    ...(canPickDirectory() ? { choose: () => void pickDirectory() } : {}),
  })

/** Contrôle Leaflet affichant le message (reconstruit à chaque changement d'état par l'appelant). */
export function createChartsNotice(n: Notice): L.Control {
  const control = new L.Control({ position: 'topright' })
  control.onAdd = () => {
    const box = L.DomUtil.create('div', 'charts-notice')
    box.style.cssText =
      'background:rgba(255,255,255,0.95);color:#222;border-radius:4px;box-shadow:0 1px 5px rgba(0,0,0,0.4);padding:8px 10px;max-width:260px;font:12px/1.35 sans-serif'
    const text = L.DomUtil.create('div', '', box)
    text.textContent = n.text
    const button = (b: { label: string; run: () => void }, primary: boolean): void => {
      const el = L.DomUtil.create('button', '', box)
      el.type = 'button'
      el.textContent = b.label
      el.style.cssText = `margin:6px 6px 0 0;padding:3px 8px;border-radius:3px;cursor:pointer;font:12px sans-serif;border:1px solid #1976d2;${
        primary ? 'background:#1976d2;color:#fff' : 'background:#fff;color:#1976d2'
      }`
      el.addEventListener('click', b.run)
    }
    if (n.action) button(n.action, true)
    if (n.other) button(n.other, false)
    L.DomEvent.disableClickPropagation(box)
    L.DomEvent.disableScrollPropagation(box)
    return box
  }
  return control
}
