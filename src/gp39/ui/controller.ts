// Routage des touches de la façade : affichage de base (Plotter, Highway…) puis vues empilées (menus, fenêtres).

import { reactive } from 'vue'
import { unlockAudio, beep } from '@/gp39/audio'
import { HIGHWAY_RANGES, PLOTTER_RANGES } from '@/gp39/types'
import { useDevice } from '@/stores/device'
import type { KeyName, ZoomView } from './types'
import { closeAllViews, popView, pushView, showToast, topView, ui } from './state'
import { centerOnShip, moveCursor, pickAtCursor, showCursor } from './plotter'
import {
  openBrillWindow,
  openGotoMenu,
  openLegPopup,
  openMainMenu,
  openMobDialog,
  openShipPopup,
  openUserCellSelect,
  openUserDisplayMenu,
  openWaypointPopup,
} from './menus'

const MODE_PLOTTER = 0
const MODE_HIGHWAY = 1
const MODE_SAT = 4
const MODE_USER1 = 5
const MODE_USER2 = 6

// ---------------------------------------------------------------- affichages

function changeDisplay(dir: 1 | -1): void {
  const dev = useDevice()
  let m = dev.settings.display
  for (let i = 0; i < 8; i++) {
    m = (m + dir + 7) % 7
    if (m === MODE_USER2 && dev.settings.user2.kind === 'Off') continue
    break
  }
  dev.settings.display = m
  ui.userCell = null
  if (ui.moving) {
    // déplacement de waypoint abandonné : le curseur retrouve sa durée normale de 7 s
    ui.moving = null
    ui.cursorUntil = Date.now() + 7000
  }
}

export function setDisplay(m: number): void {
  const dev = useDevice()
  dev.settings.display = m
  ui.userCell = null
}

function zoomView(): ZoomView {
  const dev = useDevice()
  const v: ZoomView = reactive({
    kind: 'zoom' as const,
    handle(key: KeyName): boolean {
      const highway = dev.settings.display === MODE_HIGHWAY
      const n = highway ? HIGHWAY_RANGES.length : PLOTTER_RANGES.length
      const cur = highway ? dev.settings.highwayRange : dev.settings.plotterRange
      const set = (i: number): void => {
        if (highway) dev.settings.highwayRange = i
        else dev.settings.plotterRange = i
      }
      if (key === 'up') set(Math.max(0, cur - 1)) // ▲ : plus de détail
      else if (key === 'down') set(Math.min(n - 1, cur + 1))
      else if (key === 'ent') popView()
      else if (key === 'menu') {
        popView()
        openMainMenu()
      } else return false
      return true
    },
  })
  return v
}

export function openZoom(): void {
  pushView(zoomView())
}

// ---------------------------------------------------------------- touches « affichage de base »

function gotoKey(): void {
  const dev = useDevice()
  if (dev.settings.display === MODE_PLOTTER && ui.cursor && Date.now() < ui.cursorUntil && !ui.moving) {
    // curseur sur un waypoint : son menu contextuel (Goto / Move / Edit / Delete), comme avec ENT/CNTR ; ailleurs : Quick Point (manuel §5.1)
    const picked = pickAtCursor()
    if (picked?.type === 'wpt') {
      showCursor()
      openWaypointPopup(picked.id)
      return
    }
    dev.setQuickPoint(ui.cursor.lat, ui.cursor.lon)
    ui.cursor = null
    return
  }
  openGotoMenu()
}

function markKey(long: boolean): void {
  const dev = useDevice()
  if (long) {
    dev.markMob()
    openMobDialog()
    return
  }
  if (dev.fix === '---') {
    showToast('NO POSITION FIX')
    return
  }
  if (!dev.addWaypointAtShip()) showToast('WAYPOINT MEMORY FULL')
}

function plotterKey(key: KeyName, long: boolean, repeat: number): void {
  const dev = useDevice()
  switch (key) {
    case 'up':
    case 'down':
    case 'left':
    case 'right':
    case 'upleft':
    case 'upright':
    case 'downleft':
    case 'downright':
      moveCursor(key, repeat)
      return
    case 'ent': {
      if (long) {
        centerOnShip()
        return
      }
      const visible = ui.cursor && Date.now() < ui.cursorUntil
      if (!visible) return
      showCursor()
      const cur = ui.cursor!
      if (ui.moving) {
        dev.updateWaypoint(ui.moving.id, { lat: cur.lat, lon: cur.lon })
        ui.moving = null
        ui.cursorUntil = Date.now() + 7000
        return
      }
      const p = pickAtCursor()
      if (!p) {
        if (!dev.addWaypoint({ lat: cur.lat, lon: cur.lon, comment: '' })) showToast('WAYPOINT MEMORY FULL')
      } else if (p.type === 'wpt') openWaypointPopup(p.id)
      else if (p.type === 'ship') openShipPopup()
      else if (p.type === 'leg') openLegPopup()
      return
    }
    default:
  }
}

const USER_CELL_COUNT: Record<number, number> = { 1: 1, 2: 2, 3: 3, 4: 4 }

function userDisplayKey(which: 5 | 6, key: KeyName, long: boolean): void {
  const dev = useDevice()
  const cfg = which === MODE_USER1 ? dev.settings.user1 : dev.settings.user2
  if (key === 'ent' && long) {
    openUserDisplayMenu()
    return
  }
  if (cfg.kind !== 'Digital') return
  const n = USER_CELL_COUNT[cfg.layout] ?? 4
  const sel = ui.userCell && ui.userCell.which === which && Date.now() < ui.userCell.until ? ui.userCell : null
  if (key === 'ent') {
    if (!sel) ui.userCell = { which, cell: 0, until: Date.now() + 7000 }
    else openUserCellSelect(which, sel.cell)
    return
  }
  if (!['up', 'down', 'left', 'right'].includes(key)) return
  const cur = sel?.cell ?? 0
  let c = cur
  // grille : 4 cellules = 2×2, 3 cellules = A / B C, 2 cellules = A / B
  const col = (i: number): number => (n === 4 ? i % 2 : n === 3 ? (i === 0 ? 0 : i - 1) : 0)
  if (key === 'left' || key === 'right') {
    if (n === 4) c = key === 'right' ? (cur % 2 === 0 ? cur + 1 : cur) : cur % 2 === 1 ? cur - 1 : cur
    else if (n === 3 && cur > 0) c = key === 'right' ? 2 : 1
  } else {
    if (n === 4) c = key === 'down' ? Math.min(3, cur + 2) : Math.max(0, cur - 2)
    else if (n === 3) c = key === 'down' ? (cur === 0 ? 1 : cur) : cur > 0 ? 0 : cur
    else if (n === 2) c = key === 'down' ? 1 : 0
  }
  void col
  ui.userCell = { which, cell: Math.max(0, Math.min(n - 1, c)), until: Date.now() + 7000 }
}

function baseKey(key: KeyName, long: boolean, repeat: number): void {
  const dev = useDevice()
  const mode = dev.settings.display
  switch (key) {
    case 'disp':
      changeDisplay(long ? -1 : 1)
      return
    case 'menu':
      if (mode === MODE_PLOTTER || mode === MODE_HIGHWAY) openZoom()
      else openMainMenu()
      return
    case 'goto':
      gotoKey()
      return
    case 'mark':
      markKey(long)
      return
    case 'brill':
      openBrillWindow(0)
      return
    default:
  }
  if (mode === MODE_PLOTTER) plotterKey(key, long, repeat)
  else if (mode === MODE_SAT) {
    if (key === 'up') ui.satPage = Math.max(0, ui.satPage - 1)
    else if (key === 'down') ui.satPage = Math.min(1, ui.satPage + 1)
  } else if (mode === MODE_USER1 || mode === MODE_USER2) userDisplayKey(mode as 5 | 6, key, long)
}

// ---------------------------------------------------------------- point d'entrée des touches

/**
 * Touche de la façade.
 * @param long  appui long (maintenu)
 * @param repeat  numéro de répétition automatique (maintien d'une flèche)
 */
export function press(key: KeyName, long = false, repeat = 0): void {
  const dev = useDevice()
  unlockAudio()
  if (dev.power === 'off') {
    if (key === 'brill' && !long) dev.powerOn()
    return
  }
  if (dev.power === 'booting') return
  if (dev.settings.keyBeep && repeat === 0) beep()
  // un appui sur n'importe quelle touche coupe l'alarme sonore (manuel §6.1)
  if (dev.acknowledgeAlarms()) return

  const top = topView()
  if (top) {
    if (top.handle(key, long)) return
    if (key === 'menu') popView()
    else if (key === 'disp') closeAllViews()
    return
  }
  // Déplacement d'un waypoint : MENU annule
  if (ui.moving && key === 'menu') {
    ui.moving = null
    ui.cursorUntil = Date.now() + 7000
    return
  }
  baseKey(key, long, repeat)
}

/** Caractère saisi au clavier physique, transmis aux éditeurs. */
export function typeChar(ch: string): boolean {
  const top = topView()
  return top?.typed?.(ch) ?? false
}

// ---------------------------------------------------------------- BRILL / alimentation

/** Appui sur BRILL : mise sous tension, ou fenêtre de luminosité. L'appui long (3 s) éteint. */
export function brillDown(): void {
  const dev = useDevice()
  unlockAudio()
  if (dev.power === 'off') {
    dev.powerOn()
    return
  }
  if (dev.power !== 'on') return
  dev.beginPowerOffAfter(900)
}

export function brillUp(): void {
  const dev = useDevice()
  if (dev.power !== 'on') return
  const wasCounting = dev.cancelPowerOffAttempt()
  if (wasCounting) return
  if (dev.settings.keyBeep) beep()
  if (dev.acknowledgeAlarms()) return
  const top = topView()
  if (top && top.kind === 'brill') {
    dev.settings.brillLcd = (dev.settings.brillLcd % 7) + 1
    return
  }
  if (top) {
    closeAllViews()
    openBrillWindow(0)
    return
  }
  openBrillWindow(0)
}
