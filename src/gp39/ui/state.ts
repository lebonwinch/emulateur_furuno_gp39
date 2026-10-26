// État de l'interface du GP-39 : pile de vues, curseur du plotter, et fabriques de fenêtres génériques.

import { reactive } from 'vue'
import type { LatLon } from '@/gp39/geo'
import { CHARSET_COMMENT, CHARSET_NAME } from '@/gp39/charset'
import type { ConfirmView, EditSlot, EditView, KeyName, ListRow, ListView, MessageView, SelectView, View } from './types'

export const ui = reactive({
  /** pile des vues ouvertes par-dessus l'affichage de base (menus, fenêtres) */
  stack: [] as View[],
  /** centre de la carte du plotter (écran) */
  center: { lat: 47.7208, lon: -3.3517 } as LatLon,
  /** curseur du plotter (position géographique) ; null = masqué */
  cursor: null as LatLon | null,
  cursorUntil: 0,
  /** waypoint en cours de déplacement (Move) */
  moving: null as null | { id: number },
  /** page de l'écran Satellite monitor (>13 satellites) */
  satPage: 0,
  /** sélection de cellule sur les User displays */
  userCell: null as null | { which: 5 | 6; cell: number; until: number },
  /** message éphémère en bas d'écran */
  toast: '',
  toastUntil: 0,
})

export const topView = (): View | undefined => ui.stack[ui.stack.length - 1]

export function pushView<T extends View>(v: T): T {
  ui.stack.push(v)
  return ui.stack[ui.stack.length - 1] as T
}

export function popView(): void {
  ui.stack.pop()
}

export function closeAllViews(): void {
  ui.stack.splice(0, ui.stack.length)
}

let housekeeping: ReturnType<typeof setInterval> | undefined

/** Expiration du curseur (7 s), des messages éphémères et de la sélection de cellule, quel que soit l'écran affiché. */
export function startUiHousekeeping(): () => void {
  if (!housekeeping) {
    housekeeping = setInterval(() => {
      const now = Date.now()
      if (ui.cursor && now >= ui.cursorUntil && !ui.moving) ui.cursor = null
      if (ui.toast && now >= ui.toastUntil) ui.toast = ''
      if (ui.userCell && now >= ui.userCell.until) ui.userCell = null
    }, 400)
  }
  return () => {
    if (housekeeping) clearInterval(housekeeping)
    housekeeping = undefined
  }
}

export function showToast(text: string, ms = 2200): void {
  ui.toast = text
  ui.toastUntil = Date.now() + ms
}

// -------------------------------------------------------------------- liste

export interface ListOptions {
  title: string
  mode?: ListView['mode']
  cols?: number[]
  header?: string[]
  count: () => number
  row: (i: number) => ListRow
  idx?: number
  footer?: string
  /** surcharge de touche (retourne true si traitée) */
  onKey?: (k: KeyName, long: boolean, v: ListView) => boolean
}

function selectable(r: ListRow): boolean {
  return !r.disabled && !r.info
}

export function makeList(o: ListOptions): ListView {
  const v: ListView = reactive({
    kind: 'list',
    title: o.title,
    ...(o.header ? { header: o.header } : {}),
    cols: o.cols ?? [],
    mode: o.mode ?? 'menu',
    count: o.count,
    row: o.row,
    idx: o.idx ?? 0,
    cell: 0,
    top: 0,
    ...(o.footer !== undefined ? { footer: o.footer } : {}),
    handle(key: KeyName, long: boolean): boolean {
      if (o.onKey?.(key, long, v)) return true
      const n = v.count()
      const visible = v.visible ?? 7
      const step = (d: 1 | -1): void => {
        if (!n) return
        let i = v.idx
        for (let k = 0; k < n; k++) {
          i = (i + d + n) % n
          if (selectable(v.row(i))) break
        }
        v.idx = i
        v.cell = Math.min(v.cell, Math.max(0, (v.row(i).editable?.length ?? 1) - 1))
        if (v.idx < v.top) v.top = v.idx
        if (v.idx >= v.top + visible) v.top = v.idx - visible + 1
        if (v.top < 0) v.top = 0
      }
      if (key === 'up') step(-1)
      else if (key === 'down') step(1)
      else if (key === 'left' || key === 'right') {
        const r = n ? v.row(v.idx) : undefined
        const ed = r?.editable
        if (ed && ed.length > 1) v.cell = Math.max(0, Math.min(ed.length - 1, v.cell + (key === 'right' ? 1 : -1)))
        else if (key === 'right' && r?.enter && !r.disabled) r.enter(ed?.[0] ?? 0)
        else if (key === 'left') popView()
      } else if (key === 'ent') {
        const r = n ? v.row(v.idx) : undefined
        if (r && selectable(r)) r.enter?.(r.editable ? (r.editable[v.cell] ?? r.editable[0] ?? 0) : 0)
      } else if (key === 'menu') popView()
      else return false
      return true
    },
  })
  // positionne le curseur sur une ligne sélectionnable
  const n = v.count()
  if (n && !selectable(v.row(v.idx))) {
    for (let i = 0; i < n; i++)
      if (selectable(v.row(i))) {
        v.idx = i
        break
      }
  }
  return v
}

// -------------------------------------------------------------------- sélection (fenêtre d'options)

export interface SelectOptions {
  title?: string
  options: string[]
  idx?: number
  at?: { x: number; y: number }
  icons?: string[]
  max?: number
  width?: number
  onPick: (i: number) => void
}

export function openSelect(o: SelectOptions): SelectView {
  const v: SelectView = reactive({
    kind: 'select',
    options: o.options,
    idx: Math.max(0, Math.min(o.options.length - 1, o.idx ?? 0)),
    top: 0,
    max: o.max ?? 6,
    ...(o.title !== undefined ? { title: o.title } : {}),
    ...(o.at ? { at: o.at } : {}),
    ...(o.icons ? { icons: o.icons } : {}),
    ...(o.width !== undefined ? { width: o.width } : {}),
    handle(key: KeyName): boolean {
      const n = v.options.length
      if (key === 'up' || key === 'down') {
        v.idx = (v.idx + (key === 'down' ? 1 : -1) + n) % n
        if (v.idx < v.top) v.top = v.idx
        if (v.idx >= v.top + v.max) v.top = v.idx - v.max + 1
      } else if (key === 'ent' || key === 'right') {
        const i = v.idx
        popView()
        o.onPick(i)
      } else if (key === 'menu' || key === 'left') popView()
      else return false
      return true
    },
  })
  if (v.idx >= v.max) v.top = v.idx - v.max + 1
  return pushView(v)
}

// -------------------------------------------------------------------- éditeur de champ

export { CHARSET_COMMENT, CHARSET_NAME }
export const DIGITS = '0123456789'

/** `pattern` : 9 = chiffre, N = N/S, E = E/W, + = signe, _ = caractère de texte, autre = littéral. */
export function slotsFromPattern(pattern: string): EditSlot[] {
  return pattern.split('').map((c): EditSlot => {
    if (c === '9') return { set: DIGITS }
    if (c === 'N') return { set: 'NS' }
    if (c === 'E') return { set: 'EW' }
    if (c === '+') return { set: '+-' }
    if (c === '_') return { set: CHARSET_NAME }
    return { lit: c }
  })
}

export interface EditOptions {
  prefix?: string
  slots: EditSlot[]
  /** valeur initiale (même longueur que slots, ou plus courte : complétée par des espaces) */
  init: string
  suffix?: string
  at?: { x: number; y: number }
  onDone: (text: string) => void
}

export function openEdit(o: EditOptions): EditView {
  const buf = o.slots.map((s, i) => (s.lit !== undefined ? s.lit : (o.init[i] ?? (s.set?.includes(' ') ? ' ' : (s.set?.[0] ?? ' ')))))
  const first = Math.max(
    0,
    o.slots.findIndex((s) => s.lit === undefined),
  )
  const v: EditView = reactive({
    kind: 'edit',
    slots: o.slots,
    buf,
    pos: first,
    ...(o.prefix !== undefined ? { prefix: o.prefix } : {}),
    ...(o.suffix !== undefined ? { suffix: o.suffix } : {}),
    ...(o.at ? { at: o.at } : {}),
    handle(key: KeyName): boolean {
      const slot = v.slots[v.pos]
      const move = (d: 1 | -1): void => {
        let p = v.pos + d
        while (p >= 0 && p < v.slots.length && v.slots[p]!.lit !== undefined) p += d
        if (p >= 0 && p < v.slots.length) v.pos = p
      }
      if (key === 'up' || key === 'down') {
        const set = slot?.set
        if (set) {
          const i = set.indexOf(v.buf[v.pos] ?? '')
          const n = set.length
          v.buf[v.pos] = set[(i + (key === 'up' ? 1 : -1) + n * 2) % n] ?? ' '
        }
      } else if (key === 'right') move(1)
      else if (key === 'left') move(-1)
      else if (key === 'ent') {
        popView()
        o.onDone(v.buf.join(''))
      } else if (key === 'menu') popView()
      else return false
      return true
    },
    typed(ch: string): boolean {
      const slot = v.slots[v.pos]
      if (!slot?.set) return false
      const c = slot.set.includes(ch) ? ch : slot.set.includes(ch.toUpperCase()) ? ch.toUpperCase() : ''
      if (!c) return false
      v.buf[v.pos] = c
      // avance au champ suivant
      let p = v.pos + 1
      while (p < v.slots.length && v.slots[p]!.lit !== undefined) p++
      if (p < v.slots.length) v.pos = p
      return true
    },
  })
  return pushView(v)
}

// -------------------------------------------------------------------- confirmation / message

export interface ConfirmOptions {
  title: string
  lines: string[]
  options?: string[]
  /** option sélectionnée au départ */
  idx?: number
  onPick: (i: number) => void
}

export function openConfirm(o: ConfirmOptions): ConfirmView {
  const v: ConfirmView = reactive({
    kind: 'confirm',
    title: o.title,
    lines: o.lines,
    options: o.options ?? ['Yes', 'No'],
    idx: o.idx ?? 1,
    handle(key: KeyName): boolean {
      const n = v.options.length
      if (key === 'left' || key === 'up') v.idx = (v.idx + n - 1) % n
      else if (key === 'right' || key === 'down') v.idx = (v.idx + 1) % n
      else if (key === 'ent') {
        const i = v.idx
        popView()
        o.onPick(i)
      } else if (key === 'menu') popView()
      else return false
      return true
    },
  })
  return pushView(v)
}

export function openMessage(title: string, lines: string[], onClose?: () => void): MessageView {
  const v: MessageView = reactive({
    kind: 'message',
    title,
    lines,
    handle(): boolean {
      popView()
      onClose?.()
      return true
    },
  })
  return pushView(v)
}
