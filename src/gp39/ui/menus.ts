// Menus du GP-39 (arborescence du manuel, annexe 1) construits au-dessus des vues génériques.

import { reactive } from 'vue'
import { bearing, destinationPoint, distance, norm360 } from '@/gp39/geo'
import { defaultSettings } from '@/gp39/defaults'
import { formatCoord, formatOffset, type PosFormat } from '@/gp39/format'
import { COLORS, COLOR_NAMES, markSvg } from '@/gp39/symbols'
import { LIMITS, type Route, type Waypoint } from '@/gp39/types'
import { useDevice } from '@/stores/device'
import {
  CHARSET_COMMENT,
  CHARSET_NAME,
  closeAllViews,
  makeList,
  openConfirm,
  openEdit,
  openMessage,
  openSelect,
  popView,
  pushView,
  showToast,
  slotsFromPattern,
  topView,
  ui,
} from './state'
import type { BrillView, Cell, EditSlot, KeyName, ListRow, ListView } from './types'

const ROW_H = 26

// ---------------------------------------------------------------- utilitaires

/** Position (px LCD) d'une fenêtre d'édition/de choix, à droite de la ligne sélectionnée. */
function popupAt(dx = 196): { x: number; y: number } {
  const t = topView()
  if (t?.kind === 'list') return { x: dx, y: ROW_H + (t.idx - t.top) * ROW_H }
  return { x: dx, y: 60 }
}

interface Spec {
  v: Cell
  edit?: () => void
}

/** Ligne « libellé : valeur(s) » des écrans de réglage. */
function srow(label: string, specs: Spec[]): ListRow {
  const cells: Cell[] = [label, ':', ...specs.map((s) => s.v)]
  const editable: number[] = []
  const edits = new Map<number, () => void>()
  specs.forEach((s, i) => {
    if (s.edit) {
      editable.push(i + 2)
      edits.set(i + 2, s.edit)
    }
  })
  if (!editable.length) return { cells, info: true }
  return { cells, editable, enter: (c) => edits.get(c)?.() }
}

function choice(
  options: readonly string[],
  get: () => string,
  set: (v: string, i: number) => void,
  extra?: { icons?: string[]; width?: number },
): Spec {
  return {
    v: get(),
    edit: () =>
      openSelect({
        options: [...options],
        idx: Math.max(0, options.indexOf(get())),
        at: popupAt(),
        ...(extra?.icons ? { icons: extra.icons } : {}),
        ...(extra?.width ? { width: extra.width } : {}),
        onPick: (i) => set(options[i]!, i),
      }),
  }
}

/** Texte numérique à largeur fixe correspondant à `pattern` (ex. '99.99'). */
export function numText(value: number, pattern: string): string {
  const dot = pattern.indexOf('.')
  const dec = dot < 0 ? 0 : pattern.length - dot - 1
  const intDigits = dot < 0 ? pattern.length : dot
  // une valeur qui ne tient pas dans le champ est ramenée au maximum représentable (sinon les chiffres seraient tronqués)
  const max = 10 ** intDigits - 10 ** -dec
  return Math.min(max, Math.max(0, value)).toFixed(dec).padStart(pattern.length, '0')
}

function num(pattern: string, value: number, set: (v: number) => void, suffix = '', shown?: string): Spec {
  const text = numText(value, pattern)
  return {
    // l'affichage supprime les zéros de tête des entiers (« 60 ° »), l'éditeur garde la largeur fixe
    v: shown ?? `${pattern.includes('.') ? text : String(Number(text))}${suffix ? ' ' + suffix : ''}`,
    edit: () =>
      openEdit({
        slots: slotsFromPattern(pattern),
        init: text,
        ...(suffix ? { suffix } : {}),
        at: popupAt(),
        onDone: (t) => {
          // valeur inchangée : on ne touche à rien (l'affichage est arrondi, la valeur réelle ne l'est pas)
          if (t === text) return
          const n = Number.parseFloat(t)
          if (Number.isFinite(n)) set(n)
        },
      }),
  }
}

function settingsList(title: string, cols: number[], rows: () => ListRow[]): ListView {
  return pushView(
    makeList({
      title,
      mode: 'settings',
      cols,
      count: () => rows().length,
      row: (i) => rows()[i]!,
      footer: '[MENU]:Cancel [ENT]:Enter ▲/▼:Sel.',
    }),
  )
}

const onOff = ['Off', 'On'] as const
const bool = (b: boolean): string => (b ? 'On' : 'Off')

/** Après un « Goto » : retour au plotter, menus fermés. */
function backToPlotter(): void {
  closeAllViews()
  useDevice().settings.display = 0
}

// ---------------------------------------------------------------- menu principal

export function openMainMenu(): void {
  const dev = useDevice()
  const onPlotter = dev.settings.display === 0
  const items: { label: string; open: () => void }[] = [
    ...(onPlotter
      ? [
          {
            label: 'Ship To Center *',
            open: () => {
              closeAllViews()
              ui.center = { lat: dev.ship.lat, lon: dev.ship.lon }
            },
          },
        ]
      : []),
    { label: 'Tracks', open: openTracksMenu },
    { label: 'Waypoints', open: () => chooseSort((s) => openWaypointList(s)) },
    { label: 'Routes', open: () => chooseSort((s) => openRouteList(s)) },
    { label: 'Plotter Setup', open: openPlotterSetup },
    { label: 'Alarms', open: openAlarmsMenu },
    { label: 'Messages', open: openMessages },
    { label: 'Delete', open: openDeleteMenu },
    { label: 'GPS Setup', open: openGpsSetup },
    { label: 'SBAS', open: openSbasMenu },
    { label: 'I/O Setup', open: openIoSetup },
    { label: 'User Display', open: openUserDisplayMenu },
    { label: 'Pos/TD Setup', open: openPosTdSetup },
    { label: 'System', open: openSystemMenu },
  ]
  pushView(
    makeList({
      title: 'Menu',
      mode: 'menu',
      count: () => items.length,
      row: (i) => ({ cells: [items[i]!.label], enter: () => items[i]!.open() }),
      footer: '[MENU]:Cancel [ENT]:Enter ▲/▼:Sel.',
    }),
  )
}

export function openGotoMenu(): void {
  const items = ['QP', 'WPT-Alphabet', 'WPT-Distance', 'Route-Alphabet', 'Route-Distance']
  openSelect({
    title: 'Goto',
    options: items,
    onPick: (i) => {
      if (i === 0) {
        closeAllViews()
        const dev = useDevice()
        dev.settings.display = 0
        ui.cursor = { lat: dev.ship.lat, lon: dev.ship.lon }
        ui.cursorUntil = Date.now() + 7000
      } else if (i <= 2) openWaypointList(i === 1 ? 'Alphabet' : 'Distance')
      else openRouteList(i === 3 ? 'Alphabet' : 'Distance')
    },
  })
}

function chooseSort(next: (s: 'Alphabet' | 'Distance') => void): void {
  openSelect({
    options: ['Alphabet', 'Distance'],
    at: { x: 150, y: 60 },
    onPick: (i) => next(i === 0 ? 'Alphabet' : 'Distance'),
  })
}

// ---------------------------------------------------------------- Tracks

function openTracksMenu(): void {
  const dev = useDevice()
  const colorIcons = COLORS.map(
    (c) =>
      `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 14 14"><rect x="1" y="3" width="12" height="8" fill="${c}"/></svg>`,
  )
  settingsList('Menu >Tracks', [12, 2, 10, 9], () => {
    const s = dev.settings
    return [
      srow('Record', [
        choice(
          ['Off', 'Distance', 'Auto'],
          () => s.trackRecord,
          (v) => (s.trackRecord = v as typeof s.trackRecord),
        ),
        ...(s.trackRecord === 'Distance' ? [num('9.99', s.trackInterval, (v) => (s.trackInterval = Math.min(9.99, v)), 'NM')] : []),
      ]),
      srow('Color', [
        choice(
          COLOR_NAMES,
          () => COLOR_NAMES[s.trackColor]!,
          (_v, i) => (s.trackColor = i),
          { icons: colorIcons },
        ),
      ]),
      srow('Delete', [
        {
          v: 'All',
          edit: () =>
            openSelect({
              options: ['By Color', 'All'],
              idx: 1,
              at: popupAt(),
              onPick: (i) => {
                if (i === 1) confirmErase('Erase All Tracks?', () => dev.clearTrack())
                else
                  openSelect({
                    options: [...COLOR_NAMES],
                    icons: colorIcons,
                    at: popupAt(),
                    onPick: (c) => confirmErase(`Erase ${COLOR_NAMES[c]} Tracks?`, () => dev.clearTrack(c)),
                  })
              },
            }),
        },
      ]),
      { cells: [{ dim: `Memory Used ${String(dev.trackMemoryPct).padStart(3, ' ')}%` }], info: true },
    ]
  })
}

function confirmErase(msg: string, run: () => void): void {
  openConfirm({ title: 'Delete', lines: [msg, 'Are you sure?'], idx: 1, onPick: (i) => i === 0 && run() })
}

// ---------------------------------------------------------------- Waypoints : liste, popup, formulaire

const rngText = (nm: number): string => nm.toFixed(2)

function sortedWaypoints(sort: 'Alphabet' | 'Distance'): () => Waypoint[] {
  const dev = useDevice()
  let version = -1
  let cache: Waypoint[] = []
  return () => {
    if (version !== dev.wptVersion) {
      version = dev.wptVersion
      const list = dev.waypoints.slice()
      if (sort === 'Alphabet') list.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : a.id - b.id))
      else {
        const p = { lat: dev.ship.lat, lon: dev.ship.lon }
        const d = new Map(list.map((w) => [w.id, distance(p, w, dev.settings.navigation)]))
        list.sort((a, b) => d.get(a.id)! - d.get(b.id)!)
      }
      cache = list
    }
    return cache
  }
}

/** Liste des waypoints. `pick` : mode sélection (ajout à une route) au lieu du menu Goto/Edit/Delete. */
export function openWaypointList(sort: 'Alphabet' | 'Distance', pick?: (w: Waypoint) => void): void {
  const dev = useDevice()
  const list = sortedWaypoints(sort)
  const offset = pick ? 0 : 1 // ligne [New]
  pushView(
    makeList({
      title: `Menu >Waypoints >Waypoint List`,
      mode: 'table',
      header: ['Name', 'Mark', 'RNG(NM)', 'BRG(°)'],
      cols: [10, 9, 10, 6],
      count: () => list().length + offset,
      row: (i): ListRow => {
        if (!pick && i === 0) return { cells: ['[New]'], enter: () => openWaypointForm(null) }
        const w = list()[i - offset]
        if (!w) return { cells: [''], info: true }
        const p = { lat: dev.ship.lat, lon: dev.ship.lon }
        const m = dev.settings.navigation
        const rng = distance(p, w, m)
        const brg = dev.toDisplayAngle(bearing(p, w, m))
        return {
          cells: [w.name || { dim: '--------' }, { mark: [w.symbol, w.color] }, rngText(rng), String(Math.round(brg))],
          enter: () => (pick ? (popView(), pick(w)) : openWaypointPopup(w.id, true)),
        }
      },
      footer: '[MENU]:Cancel [ENT]:Enter ▲/▼:Sel.',
    }),
  )
}

/** Fenêtre contextuelle d'un waypoint (Goto / Move / Edit / Delete). */
export function openWaypointPopup(id: number, fromList = false): void {
  const dev = useDevice()
  const w = dev.wptById.get(id)
  if (!w) return
  const d = dev.dest
  const isDest = !!d && (((d.kind === 'waypoint' || d.kind === 'qp') && d.wptId === id) || (d.kind === 'route' && d.wptId === id))
  const isRoute = d?.kind === 'route'
  const opts: string[] = []
  if (isDest || (isRoute && dev.isWaypointInUse(id))) opts.push(isRoute ? 'Cancel Route' : 'Cancel Goto')
  else opts.push('Goto')
  if (d?.kind !== 'qp' || d.wptId !== id) opts.push('Move', 'Edit')
  if (!dev.isWaypointInUse(id)) opts.push('Delete')
  const t = topView()
  const at = fromList ? popupAt(230) : { x: 130, y: 90 }
  void t
  openSelect({
    options: opts,
    at,
    onPick: (i) => {
      const o = opts[i]
      if (o === 'Goto') {
        dev.setDestWaypoint(id)
        backToPlotter()
      } else if (o === 'Cancel Goto' || o === 'Cancel Route')
        openConfirm({ title: o, lines: ['Cancel destination?'], idx: 1, onPick: (k) => k === 0 && dev.cancelDest() })
      else if (o === 'Move') {
        closeAllViews()
        dev.settings.display = 0
        ui.moving = { id }
        ui.center = { lat: w.lat, lon: w.lon }
        ui.cursor = { lat: w.lat, lon: w.lon }
        ui.cursorUntil = Date.now() + 600000
        showToast('MOVE: CURSOR, THEN ENT', 4000)
      } else if (o === 'Edit') openWaypointForm(id)
      else if (o === 'Delete') dev.deleteWaypoint(id)
    },
  })
}

function parseCoord(text: string, isLat: boolean, fmt: PosFormat): number | null {
  // DMS : 99°99'99.9"N / DM : 99°99.999'N
  const m = fmt === `xx'xx.x"` ? /^(\d+)°(\d+)'(\d+(?:\.\d+)?)"([NSEW])$/.exec(text) : /^(\d+)°(\d+(?:\.\d+)?)'([NSEW])$/.exec(text)
  if (!m) return null
  const deg = Number(m[1])
  const min = Number(m[2])
  const sec = fmt === `xx'xx.x"` ? Number(m[3]) : 0
  const hemi = (fmt === `xx'xx.x"` ? m[4] : m[3])!
  if (min >= 60 || sec >= 60) return null
  const v = deg + min / 60 + sec / 3600
  if (isLat && v > 90) return null
  if (!isLat && v > 180) return null
  return hemi === 'S' || hemi === 'W' ? -v : v
}

/** Formulaire « Waypoint Info ». `id` null = nouveau waypoint (créé en quittant le formulaire avec MENU). */
export function openWaypointForm(id: number | null, preset?: { lat: number; lon: number }): void {
  const dev = useDevice()
  const existing = id != null ? dev.wptById.get(id) : undefined
  const draft: Omit<Waypoint, 'id'> = existing
    ? { ...existing }
    : {
        name: dev.nextWaypointName(),
        lat: preset?.lat ?? dev.ship.lat,
        lon: preset?.lon ?? dev.ship.lon,
        symbol: 0,
        color: 2,
        comment: '',
        display: true,
      }
  const fmt = dev.settings.posFormat
  const apply = (patch: Partial<Omit<Waypoint, 'id'>>): void => {
    Object.assign(draft, patch)
    if (existing) dev.updateWaypoint(existing.id, patch)
  }
  const symbolIcons = Array.from({ length: 10 }, (_, i) => markSvg(i, draft.color, 18))
  const colorIcons = COLORS.map(
    (c) =>
      `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 14 14"><rect x="1" y="3" width="12" height="8" fill="${c}"/></svg>`,
  )
  const latPattern = fmt === `xx'xx.x"` ? `99°99'99.9"N` : `99°99.999'N`
  const lonPattern = fmt === `xx'xx.x"` ? `999°99'99.9"E` : `999°99.999'E`
  const coordSpec = (isLat: boolean): Spec => {
    const text = formatCoord(isLat ? draft.lat : draft.lon, isLat, fmt)
    const pat = isLat ? latPattern : lonPattern
    const padded = text.padStart(pat.length, '0')
    return {
      v: text,
      edit: () =>
        openEdit({
          slots: slotsFromPattern(pat),
          init: padded,
          at: popupAt(150),
          onDone: (t) => {
            const v = parseCoord(t, isLat, fmt)
            if (v == null) return showToast('INVALID VALUE')
            apply(isLat ? { lat: v } : { lon: v })
          },
        }),
    }
  }
  const brgOf = (): number => dev.toDisplayAngle(bearing(dev.shipPos, draft, dev.settings.navigation))
  const rngOf = (): number => distance(dev.shipPos, draft, dev.settings.navigation)
  const reposition = (rng: number, brgDisp: number): void => {
    const brgTrue = dev.settings.cogRef === 'Mag' ? norm360(brgDisp + dev.magVar) : brgDisp
    const p = destinationPoint(dev.shipPos, brgTrue, rng, dev.settings.navigation)
    apply({ lat: p.lat, lon: p.lon })
  }

  const v = settingsList('Menu >Waypoints >Waypoint Info', [12, 2, 16], () => [
    srow('Name', [
      {
        v: draft.name,
        edit: () =>
          openEdit({
            slots: Array.from({ length: LIMITS.nameLen }, (): EditSlot => ({ set: CHARSET_NAME })),
            init: draft.name.padEnd(LIMITS.nameLen, ' '),
            at: popupAt(150),
            onDone: (t) => {
              const name = t.trimEnd()
              if (name && dev.waypoints.some((w) => w.name === name && w.id !== existing?.id)) return showToast('SAME NAME EXISTS')
              apply({ name })
            },
          }),
      },
    ]),
    srow('Symbol', [
      {
        v: { icon: [draft.symbol, draft.color] },
        edit: () =>
          openSelect({
            options: symbolIcons.map(() => ''),
            icons: symbolIcons.map((_, i) => markSvg(i, draft.color, 18)),
            idx: draft.symbol,
            at: popupAt(150),
            max: 6,
            width: 3,
            onPick: (i) => apply({ symbol: i }),
          }),
      },
    ]),
    srow('Color', [
      choice(
        COLOR_NAMES,
        () => COLOR_NAMES[draft.color]!,
        (_v, i) => apply({ color: i }),
        { icons: colorIcons },
      ),
    ]),
    srow('Latitude', [coordSpec(true)]),
    srow('Longitude', [coordSpec(false)]),
    srow('RNG (NM)', [num('9999.99', rngOf(), (n) => reposition(n, brgOf()), '', rngOf().toFixed(2))]),
    srow('BRG (°)', [num('999', brgOf(), (n) => reposition(rngOf(), n % 360), '', String(Math.round(brgOf())))]),
    srow('Comment', [
      {
        v: draft.comment,
        edit: () =>
          openEdit({
            slots: Array.from({ length: LIMITS.commentLen }, (): EditSlot => ({ set: CHARSET_COMMENT })),
            init: draft.comment.padEnd(LIMITS.commentLen, ' '),
            at: popupAt(100),
            onDone: (t) => apply({ comment: t.trimEnd() }),
          }),
      },
    ]),
  ])
  if (!existing) {
    // MENU : enregistre le nouveau waypoint (manuel §3.1.3, étape 14)
    const base = v.handle.bind(v)
    v.handle = (key: KeyName, long: boolean): boolean => {
      if (key === 'menu') {
        const created = dev.addWaypoint({ ...draft })
        popView()
        if (!created) showToast('WAYPOINT MEMORY FULL')
        return true
      }
      return base(key, long)
    }
  }
}

// ---------------------------------------------------------------- Routes

function routeLength(r: Route): number {
  const dev = useDevice()
  let total = 0
  let prev: Waypoint | undefined
  for (const p of r.points) {
    const w = dev.wptById.get(p.wptId)
    if (!w) continue
    if (prev) total += distance(prev, w, dev.settings.navigation)
    prev = w
  }
  return total
}

export function openRouteList(sort: 'Alphabet' | 'Distance'): void {
  const dev = useDevice()
  let showStats = false
  const order = (): Route[] => {
    const l = dev.routes.slice()
    if (sort === 'Alphabet') l.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : a.no - b.no))
    else {
      const first = (r: Route): number => {
        const w = r.points.length ? dev.wptById.get(r.points[0]!.wptId) : undefined
        return w ? distance(dev.shipPos, w) : Infinity
      }
      l.sort((a, b) => first(a) - first(b))
    }
    return l
  }
  const v = pushView(
    makeList({
      title: 'Menu >Routes >Route List',
      mode: 'table',
      header: ['Name', 'Comment'],
      cols: [10, 20],
      count: () => order().length + 1,
      row: (i): ListRow => {
        if (i === 0) return { cells: ['[New]'], enter: () => createRoute() }
        const r = order()[i - 1]
        if (!r) return { cells: [''], info: true }
        const second: Cell = showStats ? `${routeLength(r).toFixed(1)}NM ${r.points.length}pts` : r.comment
        return { cells: [r.name, second], enter: () => openRoutePopup(r.no) }
      },
      footer: '[MENU]:Cancel [ENT]:Enter ▲/▼:Sel. [GOTO]:Info',
      onKey: (k) => {
        if (k === 'goto') {
          showStats = !showStats
          return true
        }
        return false
      },
    }),
  )
  void v
}

function createRoute(): void {
  const dev = useDevice()
  const r = dev.addRoute()
  if (!r) return showToast('ROUTE MEMORY FULL')
  openRouteInfo(r.no)
}

function openRoutePopup(no: number): void {
  const dev = useDevice()
  const r = dev.routeByNo(no)
  if (!r) return
  const active = dev.dest?.kind === 'route' && dev.dest.routeNo === no
  const opts = active ? ['Cancel Route', 'Edit'] : ['Goto', 'Edit', 'Delete']
  openSelect({
    options: opts,
    at: popupAt(220),
    onPick: (i) => {
      const o = opts[i]
      if (o === 'Goto')
        openSelect({
          options: ['Forward', 'Reverse'],
          at: popupAt(220),
          onPick: (k) => {
            if (!dev.setDestRoute(no, k === 0 ? 'Forward' : 'Reverse')) return showToast('ROUTE HAS NO WAYPOINT')
            backToPlotter()
          },
        })
      else if (o === 'Cancel Route')
        openConfirm({ title: 'Cancel Route', lines: ['Cancel route?'], idx: 1, onPick: (k) => k === 0 && dev.cancelDest() })
      else if (o === 'Edit') openRouteInfo(no)
      else if (o === 'Delete') dev.deleteRoute(no)
    },
  })
}

function openRouteInfo(no: number): void {
  const dev = useDevice()
  const r = dev.routeByNo(no)
  if (!r) return
  const insertAt = (index: number, w: Waypoint): void => {
    if (r.points.length >= LIMITS.routeWaypoints) return showToast('ROUTE FULL (30)')
    r.points.splice(index, 0, { wptId: w.id, skip: false })
  }
  const pickInto = (index: number, replace: boolean): void =>
    chooseSort((s) =>
      openWaypointList(s, (w) => {
        if (replace) r.points[index] = { wptId: w.id, skip: r.points[index]?.skip ?? false }
        else insertAt(index, w)
      }),
    )
  settingsList('Menu >Routes >Route Info', [8, 2, 20, 10], () => {
    const rows: ListRow[] = [
      srow('Name', [
        {
          v: r.name,
          edit: () =>
            openEdit({
              slots: Array.from({ length: LIMITS.routeNameLen }, (): EditSlot => ({ set: CHARSET_NAME })),
              init: r.name.padEnd(LIMITS.routeNameLen, ' '),
              at: popupAt(150),
              onDone: (t) => (r.name = t.trimEnd()),
            }),
        },
      ]),
      srow('Comment', [
        {
          v: r.comment,
          edit: () =>
            openEdit({
              slots: Array.from({ length: LIMITS.routeCommentLen }, (): EditSlot => ({ set: CHARSET_COMMENT })),
              init: r.comment.padEnd(LIMITS.routeCommentLen, ' '),
              at: popupAt(60),
              onDone: (t) => (r.comment = t.trimEnd()),
            }),
        },
      ]),
    ]
    r.points.forEach((p, i) => {
      const w = dev.wptById.get(p.wptId)
      const label = `${String(i + 1).padStart(2, ' ')}${p.skip ? 'X' : ' '}`
      rows.push({
        cells: [label, ':', w ? w.name : '?', w ? { mark: [w.symbol, w.color] } : ''],
        editable: [2],
        enter: () => {
          const opts = ['Add', 'Change', 'Delete', p.skip ? 'Skip Off' : 'Skip']
          openSelect({
            options: opts,
            at: popupAt(180),
            onPick: (k) => {
              const o = opts[k]
              if (o === 'Add') pickInto(i, false)
              else if (o === 'Change') pickInto(i, true)
              else if (o === 'Delete') r.points.splice(i, 1)
              else p.skip = !p.skip
            },
          })
        },
      })
    })
    if (r.points.length < LIMITS.routeWaypoints)
      rows.push({
        cells: [String(r.points.length + 1).padStart(2, ' ') + ' ', ':', '--------'],
        editable: [2],
        enter: () => pickInto(r.points.length, false),
      })
    return rows
  })
}

// ---------------------------------------------------------------- Plotter Setup

function openPlotterSetup(): void {
  const dev = useDevice()
  settingsList('Menu >Plotter Setup', [14, 2, 11, 6, 6], () => {
    const s = dev.settings
    const mv = dev.magVar
    return [
      srow('Auto WPT Ent', [
        choice(
          onOff,
          () => bool(s.autoWpt.on),
          (v) => (s.autoWpt.on = v === 'On'),
        ),
        num('999', s.autoWpt.deg, (n) => (s.autoWpt.deg = Math.max(15, Math.min(150, n))), '°'),
        num('99', s.autoWpt.sec, (n) => (s.autoWpt.sec = Math.max(1, Math.min(60, n))), 's'),
      ]),
      srow('COG Line', [
        choice(
          onOff,
          () => bool(s.cogLine),
          (v) => (s.cogLine = v === 'On'),
        ),
      ]),
      srow('COG/BRG Ref.', [
        choice(
          ['True', 'Mag'],
          () => s.cogRef,
          (v) => (s.cogRef = v as 'True' | 'Mag'),
        ),
      ]),
      srow('Magnetic Var.', [
        choice(
          ['Auto', 'Manual'],
          () => s.magVar.mode,
          (v) => (s.magVar.mode = v as 'Auto' | 'Manual'),
        ),
        s.magVar.mode === 'Auto'
          ? { v: `${mv >= 0 ? 'E' : 'W'} ${Math.abs(Math.round(mv))} °` }
          : {
              v: `${s.magVar.value >= 0 ? 'E' : 'W'} ${Math.abs(Math.round(s.magVar.value))} °`,
              edit: () =>
                openEdit({
                  slots: slotsFromPattern('E99'),
                  init: `${s.magVar.value >= 0 ? 'E' : 'W'}${String(Math.abs(Math.round(s.magVar.value))).padStart(2, '0')}`,
                  suffix: '°',
                  at: popupAt(),
                  onDone: (t) => (s.magVar.value = (t[0] === 'W' ? -1 : 1) * Number(t.slice(1))),
                }),
            },
      ]),
      srow('Waypoint Name', [
        choice(
          ['Disp Goto', 'Disp All', 'Disp Route'],
          () => s.wptName,
          (v) => (s.wptName = v as typeof s.wptName),
        ),
      ]),
      srow('TTG/ETA Speed', [
        choice(
          ['Auto', 'Manual'],
          () => s.ttgEtaSpd.mode,
          (v) => (s.ttgEtaSpd.mode = v as 'Auto' | 'Manual'),
        ),
        s.ttgEtaSpd.mode === 'Auto'
          ? num('999', s.ttgEtaSpd.avgSec, (n) => (s.ttgEtaSpd.avgSec = Math.max(1, n)), 's')
          : num('999', s.ttgEtaSpd.manualKn, (n) => (s.ttgEtaSpd.manualKn = Math.max(1, n)), 'kn'),
      ]),
    ]
  })
}

// ---------------------------------------------------------------- Alarms

function openAlarmsMenu(): void {
  const dev = useDevice()
  settingsList('Menu >Alarms', [14, 2, 11, 12], () => {
    const s = dev.settings
    const hh = Math.floor(s.alarmTime.hhmm / 100)
    const mm = s.alarmTime.hhmm % 100
    const timeText = `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`
    return [
      srow('Buzzer', [
        choice(
          ['Short', 'Long', 'Cont.'],
          () => s.buzzer,
          (v) => (s.buzzer = v as typeof s.buzzer),
        ),
      ]),
      srow('Arrival/Anchor', [
        choice(
          ['Off', 'Arrival', 'Anchor'],
          () => s.alarmArrival.mode,
          (v) => (s.alarmArrival.mode = v as typeof s.alarmArrival.mode),
        ),
        num('99.99', s.alarmArrival.nm, (n) => (s.alarmArrival.nm = n), 'NM'),
      ]),
      srow('XTE', [
        choice(
          onOff,
          () => bool(s.alarmXte.on),
          (v) => (s.alarmXte.on = v === 'On'),
        ),
        num('99.999', s.alarmXte.nm, (n) => (s.alarmXte.nm = n), 'NM'),
      ]),
      srow('Speed', [
        choice(
          onOff,
          () => bool(s.alarmSpeed.on),
          (v) => (s.alarmSpeed.on = v === 'On'),
        ),
        num('999.9', s.alarmSpeed.kn, (n) => (s.alarmSpeed.kn = n), 'kn'),
      ]),
      srow('SBAS', [
        choice(
          onOff,
          () => bool(s.alarmSbas),
          (v) => (s.alarmSbas = v === 'On'),
        ),
      ]),
      srow('Time', [
        choice(
          onOff,
          () => bool(s.alarmTime.on),
          (v) => (s.alarmTime.on = v === 'On'),
        ),
        {
          v: timeText,
          edit: () =>
            openEdit({
              slots: slotsFromPattern('99:99'),
              init: timeText,
              at: popupAt(),
              onDone: (t) => {
                const h = Number(t.slice(0, 2))
                const m = Number(t.slice(3, 5))
                if (h > 23 || m > 59) return showToast('INVALID VALUE')
                s.alarmTime.hhmm = h * 100 + m
              },
            }),
        },
      ]),
      srow('Trip', [
        choice(
          onOff,
          () => bool(s.alarmTrip.on),
          (v) => (s.alarmTrip.on = v === 'On'),
        ),
        num('99999', s.alarmTrip.nm, (n) => (s.alarmTrip.nm = n), 'NM'),
      ]),
      srow('Odometer', [
        choice(
          onOff,
          () => bool(s.alarmOdo.on),
          (v) => (s.alarmOdo.on = v === 'On'),
        ),
        num('99999', s.alarmOdo.nm, (n) => (s.alarmOdo.nm = n), 'NM'),
      ]),
    ]
  })
}

function openMessages(): void {
  const dev = useDevice()
  pushView(
    makeList({
      title: 'Menu >Messages',
      mode: 'menu',
      count: () => Math.max(1, dev.alarms.active.length),
      row: (i) => (dev.alarms.active.length ? { cells: [dev.alarms.active[i]!], info: true } : { cells: ['No Message!'], info: true }),
      footer: '[MENU]:Cancel',
    }),
  )
}

// ---------------------------------------------------------------- Delete

function openDeleteMenu(): void {
  const dev = useDevice()
  const askDelete = (kind: 'wpt' | 'rte'): void => {
    const what = kind === 'wpt' ? 'All Waypoints' : 'All Routes'
    const busy = !!dev.dest
    openConfirm({
      title: 'Delete',
      lines: [busy ? `${what} will be erased` : `${what}`, busy ? 'and destination is cancelled.' : '', 'Are you sure?'].filter(Boolean),
      idx: 1,
      onPick: (i) => {
        if (i !== 0) return
        if (kind === 'wpt') dev.deleteAllWaypoints()
        else dev.deleteAllRoutes()
      },
    })
  }
  settingsList('Menu >Delete', [16, 2, 8], () => [
    srow('All Waypoints', [
      { v: 'Off', edit: () => openSelect({ options: ['Off', 'Delete'], at: popupAt(), onPick: (i) => i === 1 && askDelete('wpt') }) },
    ]),
    srow('All Routes', [
      { v: 'Off', edit: () => openSelect({ options: ['Off', 'Delete'], at: popupAt(), onPick: (i) => i === 1 && askDelete('rte') }) },
    ]),
  ])
}

// ---------------------------------------------------------------- GPS Setup / SBAS

function openGpsSetup(): void {
  const dev = useDevice()
  settingsList('Menu >GPS Setup', [14, 2, 12, 10], () => {
    const s = dev.settings
    const off = (v: number, p: string, hemi: string[]): string => `${numText(Math.abs(v), p)}'${v >= 0 ? hemi[0] : hemi[1]}`
    return [
      srow('Datum', [
        choice(
          ['WGS84', 'WGS72', 'Other'],
          () => s.datum,
          (v) => (s.datum = v as typeof s.datum),
        ),
        ...(s.datum === 'Other' ? [num('999', s.datumOther, (n) => (s.datumOther = Math.max(3, Math.min(173, n))))] : []),
      ]),
      srow('Navigation', [
        choice(
          ['Rhumb Line', 'Great Circle'],
          () => s.navigation,
          (v) => (s.navigation = v as typeof s.navigation),
        ),
      ]),
      srow('Smooth Position', [num('999', s.smoothPos, (n) => (s.smoothPos = n), 's')]),
      srow('Smooth S/C', [num('9999', s.smoothSC, (n) => (s.smoothSC = n), 's')]),
      srow('Lat Offset', [
        {
          v: off(s.latOffset, '9.999', ['N', 'S']),
          edit: () =>
            openEdit({
              slots: slotsFromPattern('9.999N'),
              init: numText(Math.abs(s.latOffset), '9.999') + (s.latOffset >= 0 ? 'N' : 'S'),
              at: popupAt(),
              onDone: (t) => (s.latOffset = Number(t.slice(0, 5)) * (t[5] === 'S' ? -1 : 1)),
            }),
        },
      ]),
      srow('Lon Offset', [
        {
          v: off(s.lonOffset, '9.999', ['E', 'W']),
          edit: () =>
            openEdit({
              slots: slotsFromPattern('9.999E'),
              init: numText(Math.abs(s.lonOffset), '9.999') + (s.lonOffset >= 0 ? 'E' : 'W'),
              at: popupAt(),
              onDone: (t) => (s.lonOffset = Number(t.slice(0, 5)) * (t[5] === 'W' ? -1 : 1)),
            }),
        },
      ]),
      srow('Disable SV', [
        {
          v: [0, 1, 2].map((i) => String(s.disableSv[i] ?? 0).padStart(2, '0')).join(' '),
          edit: () =>
            openEdit({
              slots: slotsFromPattern('99 99 99'),
              init: [0, 1, 2].map((i) => String(s.disableSv[i] ?? 0).padStart(2, '0')).join(' '),
              at: popupAt(),
              onDone: (t) =>
                (s.disableSv = t
                  .split(' ')
                  .map(Number)
                  .filter((n) => n > 0)),
            }),
        },
      ]),
      srow('SV ELV', [num('99', s.svElev, (n) => (s.svElev = Math.max(5, Math.min(90, n))), '°')]),
      srow('Roll Over', [num('9999', s.rollOver, (n) => (s.rollOver = Math.max(2000, Math.min(2099, n))))]),
    ]
  })
}

function openSbasMenu(): void {
  const dev = useDevice()
  settingsList('Menu >SBAS', [18, 2, 8, 6], () => {
    const s = dev.settings
    return [
      srow('Mode', [
        choice(
          ['SBAS', 'GPS'],
          () => s.sbasMode,
          (v) => (s.sbasMode = v as 'SBAS' | 'GPS'),
        ),
      ]),
      srow('SBAS Search', [
        choice(
          ['Auto', 'Manual'],
          () => s.sbasSearch,
          (v) => (s.sbasSearch = v as 'Auto' | 'Manual'),
        ),
        ...(s.sbasSearch === 'Manual' ? [num('999', s.sbasSat, (n) => (s.sbasSat = Math.max(120, Math.min(138, n))))] : []),
      ]),
      srow('QZSS Positioning', [
        choice(
          onOff,
          () => bool(s.qzssPositioning),
          (v) => (s.qzssPositioning = v === 'On'),
        ),
      ]),
      srow('QZSS Correction', [
        choice(
          onOff,
          () => bool(s.qzssCorrection),
          (v) => (s.qzssCorrection = v === 'On'),
        ),
      ]),
    ]
  })
}

// ---------------------------------------------------------------- I/O Setup

/** Sélecteur de fichier GPX caché (équivalent de la clé USB), alimenté par le composant racine. */
export const fileHooks = {
  /** déclenche le téléchargement du fichier */
  download: (_name: string, _content: string): void => {},
  /** ouvre le sélecteur de fichier ; rappelle `onText` avec le contenu */
  pickFile: (_onText: (text: string, name: string) => void): void => {},
}

function openIoSetup(): void {
  const dev = useDevice()
  settingsList('Menu >I/O Setup', [26, 2, 8], () => {
    const s = dev.settings
    return [
      srow('Data 1', [
        choice(
          ['REM1', 'REM2', 'AP', 'GPS'],
          () => s.data1,
          (v) => (s.data1 = v as typeof s.data1),
        ),
      ]),
      srow('NMEA0183 Version', [
        choice(
          ['1.5', '2.0', '3.0'],
          () => s.nmeaVersion,
          (v) => (s.nmeaVersion = v as typeof s.nmeaVersion),
        ),
      ]),
      {
        cells: ['Save WPT/RTE -> USB'],
        enter: () =>
          openConfirm({
            title: 'Save WPT/RTE -> USB',
            lines: ['Save waypoints and routes', 'to GP39_WptRte.gpx?'],
            idx: 1,
            onPick: (i) => {
              if (i !== 0) return
              fileHooks.download('GP39_WptRte.gpx', dev.exportGpx())
              openMessage('Save WPT/RTE', ['Saving completed.', 'Push any key.'])
            },
          }),
      },
      {
        cells: ['Load WPT/RTE <- USB'],
        enter: () =>
          openConfirm({
            title: 'Load WPT/RTE <- USB',
            lines: ['All waypoints and routes', 'will be replaced. Sure?'],
            idx: 1,
            onPick: (i) => {
              if (i !== 0) return
              fileHooks.pickFile((text) => {
                const r = dev.importGpx(text, 'replace')
                const lines = [`Loading completed.`, `${r.waypoints} waypoints, ${r.routes} routes.`, 'Push any key.']
                openMessage('Load WPT/RTE', lines)
              })
            },
          }),
      },
      { cells: ['Load WPT/RTE <- GP-32'], enter: () => openMessage('GP-32', ['Not available in the emulator.', '', 'Push any key.']) },
      { cells: ['Wiring Info. NMEA 0183'], enter: () => openWiringInfo() },
    ]
  })
}

function openWiringInfo(): void {
  const lines = [
    'TD-A  WHITE    RD-H  External',
    'TD-B  BLUE     RD-C  Equipment',
    'RD-H  YELLOW   TD-H',
    'RD-C  GREEN    TD-C',
    '12-24VDC  RED(+) BLACK(-)',
  ]
  pushView(
    makeList({
      title: 'Menu >I/O Setup >Wiring Info.',
      mode: 'menu',
      count: () => lines.length,
      row: (i) => ({ cells: [lines[i]!], info: true }),
      footer: '[MENU]:Cancel',
    }),
  )
}

// ---------------------------------------------------------------- User Display

const USER_DATA = ['ODO', 'Trip', 'Time', 'Date', 'POSN', 'Volts', 'SOG', 'COG', 'RNG', 'BRG', 'XTE', 'TTG', 'ETA', 'WPT', 'None'] as const

export function openUserCellSelect(which: 5 | 6, cell: number): void {
  const dev = useDevice()
  const cfg = which === 5 ? dev.settings.user1 : dev.settings.user2
  openSelect({
    title: 'Data',
    options: [...USER_DATA],
    idx: Math.max(0, USER_DATA.indexOf(cfg.cells[cell]!)),
    at: { x: 220, y: 50 },
    max: 7,
    onPick: (i) => (cfg.cells[cell] = USER_DATA[i]!),
  })
}

export function openUserDisplayMenu(): void {
  const dev = useDevice()
  const configure = (which: 1 | 2): void => {
    const cfg = which === 1 ? dev.settings.user1 : dev.settings.user2
    const kinds = which === 1 ? (['Digital', 'Speedometer', 'COG'] as const) : (['Digital', 'Speedometer', 'COG', 'Off'] as const)
    openSelect({
      options: [...kinds],
      idx: Math.max(0, (kinds as readonly string[]).indexOf(cfg.kind)),
      at: popupAt(),
      onPick: (i) => {
        cfg.kind = kinds[i]!
        // User display 2 sur Off alors qu'il est affiché : retour à l'écran précédent
        if (which === 2 && cfg.kind === 'Off' && dev.settings.display === 6) dev.settings.display = 5
        if (cfg.kind === 'Digital') {
          openSelect({
            title: 'Cells',
            options: ['1', '2', '3', '4'],
            idx: cfg.layout - 1,
            at: popupAt(),
            onPick: (n) => {
              cfg.layout = (n + 1) as 1 | 2 | 3 | 4
              // choisit les données A, B, C, D successivement (manuel §7.6)
              const chain = (c: number): void => {
                if (c >= cfg.layout) return
                openSelect({
                  title: `Cell ${'ABCD'[c]}`,
                  options: [...USER_DATA],
                  idx: Math.max(0, USER_DATA.indexOf(cfg.cells[c]!)),
                  at: { x: 200, y: 40 },
                  max: 7,
                  onPick: (k) => {
                    cfg.cells[c] = USER_DATA[k]!
                    chain(c + 1)
                  },
                })
              }
              chain(0)
            },
          })
        }
      },
    })
  }
  settingsList('Menu >User Display', [12, 2, 12, 8], () => {
    const u1 = dev.settings.user1
    const u2 = dev.settings.user2
    const rng = (c: typeof u1): Spec[] =>
      c.kind === 'Speedometer'
        ? [
            choice(
              ['0-20', '0-40', '0-80'],
              () => `0-${c.speedoRange}`,
              (v) => (c.speedoRange = Number(v.slice(2)) as 20 | 40 | 80),
            ),
          ]
        : []
    return [
      srow('Display 1', [{ v: u1.kind, edit: () => configure(1) }, ...rng(u1)]),
      srow('Display 2', [{ v: u2.kind, edit: () => configure(2) }, ...rng(u2)]),
    ]
  })
}

// ---------------------------------------------------------------- Pos/TD Setup

function openPosTdSetup(): void {
  const dev = useDevice()
  settingsList('Menu >Pos/TD Setup', [10, 2, 14], () => [
    srow('Display', [
      choice(
        ["xx.xxx'", `xx'xx.x"`, 'LC TD', 'DE TD'],
        () => dev.settings.posFormat,
        (v) => {
          if (v === 'LC TD' || v === 'DE TD')
            return void openMessage('Pos/TD Setup', ['Loran C / Decca TDs', 'are not emulated.', 'Push any key.'])
          dev.settings.posFormat = v as PosFormat
        },
      ),
    ]),
    { cells: [{ dim: 'Loran C : 4990: Central Pacific' }], info: true },
    { cells: [{ dim: 'DECCA   : 25, G-P' }], info: true },
  ])
}

// ---------------------------------------------------------------- System

function openSystemMenu(): void {
  const dev = useDevice()
  settingsList('Menu >System', [22, 2, 12], () => {
    const s = dev.settings
    const off = s.timeOffsetMin
    const offText = formatOffset(off)
    return [
      srow('Key Beep', [
        choice(
          onOff,
          () => bool(s.keyBeep),
          (v) => (s.keyBeep = v === 'On'),
        ),
      ]),
      srow('Language', [
        choice(
          ['English', 'French', 'Spanish', 'Vietnamese', 'Malay', 'Indonesian', 'Simplified Chinese', 'Thai'],
          () => s.language,
          (v) => {
            s.language = v as typeof s.language
            if (v !== 'English') openMessage('Language', ['Only the English interface', 'is available in the emulator.', 'Push any key.'])
          },
          { width: 18 },
        ),
      ]),
      srow('Units', [
        choice(
          ['NM, kn', 'km, km/h', 'sm, mph'],
          () => s.units,
          (v) => (s.units = v as typeof s.units),
        ),
      ]),
      srow('Time Offset', [
        {
          v: offText,
          edit: () =>
            openEdit({
              slots: slotsFromPattern('+99:99'),
              init: `${off < 0 ? '-' : '+'}${String(Math.floor(Math.abs(off) / 60)).padStart(2, '0')}:${String(Math.abs(off) % 60).padStart(2, '0')}`,
              at: popupAt(),
              onDone: (t) => {
                const sign = t[0] === '-' ? -1 : 1
                const m = sign * (Number(t.slice(1, 3)) * 60 + Number(t.slice(4, 6)))
                if (m < -840 || m > 840 || m % 15) return showToast('INVALID VALUE')
                s.timeOffsetMin = m
              },
            }),
        },
      ]),
      srow('Daylight Saving Time', [
        choice(
          onOff,
          () => bool(s.dst),
          (v) => (s.dst = v === 'On'),
        ),
      ]),
      srow('Time Display', [
        choice(
          ['12Hour', '24Hour'],
          () => s.timeDisplay,
          (v) => (s.timeDisplay = v as typeof s.timeDisplay),
        ),
      ]),
      srow('Date Display', [
        choice(
          ['DD/MMM/YY', 'MM/DD/YY'],
          () => s.dateDisplay,
          (v) => (s.dateDisplay = v as typeof s.dateDisplay),
        ),
      ]),
      { cells: ['Demo'], enter: openDemoMenu },
      { cells: ['Self Test'], enter: openSelfTestMenu },
      { cells: ['Reset'], enter: openResetMenu },
      srow('Operation Mode', [
        choice(
          ['GP-39', 'SCX-21'],
          () => s.operationMode,
          (v) => {
            s.operationMode = v as 'GP-39' | 'SCX-21'
            if (v === 'SCX-21') openMessage('Operation Mode', ['SCX-21 mode is not emulated.', 'Push any key.'])
          },
        ),
      ]),
    ]
  })
}

function openDemoMenu(): void {
  const dev = useDevice()
  settingsList('Menu >System >Demo', [12, 2, 14, 8], () => {
    const sm = dev.sim
    const fmt = dev.settings.posFormat
    const latP = fmt === `xx'xx.x"` ? `99°99'99.9"N` : `99°99.999'N`
    const lonP = fmt === `xx'xx.x"` ? `999°99'99.9"E` : `999°99.999'E`
    const coord = (isLat: boolean): Spec => {
      const val = isLat ? dev.ship.lat : dev.ship.lon
      const text = formatCoord(val, isLat, fmt)
      const pat = isLat ? latP : lonP
      return {
        v: text,
        edit: () =>
          openEdit({
            slots: slotsFromPattern(pat),
            init: text.padStart(pat.length, '0'),
            at: popupAt(150),
            onDone: (t) => {
              const v = parseCoord(t, isLat, fmt)
              if (v == null) return showToast('INVALID VALUE')
              if (isLat) dev.setShipPosition(v, dev.ship.lon)
              else dev.setShipPosition(dev.ship.lat, v)
            },
          }),
      }
    }
    return [
      srow('Mode', [
        choice(
          onOff,
          () => bool(sm.demo),
          (v) => (sm.demo = v === 'On'),
        ),
      ]),
      srow('Speed', [num('99', sm.speed, (n) => (sm.speed = n), 'kn')]),
      srow('Course', [
        choice(
          ['Auto', 'Manual'],
          () => sm.courseMode,
          (v) => (sm.courseMode = v as 'Auto' | 'Manual'),
        ),
        ...(sm.courseMode === 'Manual' ? [num('999', sm.course, (n) => (sm.course = n % 360), '°')] : []),
      ]),
      srow('Latitude', [coord(true)]),
      srow('Longitude', [coord(false)]),
    ]
  })
}

function openSelfTestMenu(): void {
  settingsList('Menu >System >Self Test', [14, 2, 4], () => [
    { cells: ['System Test'], enter: openSystemTest },
    { cells: ['LCD Test'], enter: openLcdTest },
  ])
}

function openSystemTest(): void {
  const v = reactive({
    kind: 'test' as const,
    pressed: new Set<string>(),
    handle(key: KeyName): boolean {
      v.pressed.add(key)
      // MENU trois fois de suite pour quitter (manuel §8.4)
      if (key === 'menu') {
        menuCount++
        if (menuCount >= 3) popView()
      } else menuCount = 0
      return true
    },
  })
  let menuCount = 0
  pushView(v)
}

function openLcdTest(): void {
  const v = reactive({
    kind: 'lcdtest' as const,
    step: 0,
    handle(key: KeyName): boolean {
      if (key === 'menu') popView()
      else if (v.step >= 8) popView()
      else v.step++
      return true
    },
  })
  pushView(v)
}

function openResetMenu(): void {
  const dev = useDevice()
  const ask = (label: string, run: () => void | Promise<void>): Spec => ({
    v: 'Off',
    edit: () =>
      openSelect({
        options: ['Off', 'On'],
        at: popupAt(),
        onPick: (i) => {
          if (i !== 1) return
          openConfirm({
            title: `Reset ${label}`,
            lines: [`Reset ${label}?`, 'Are you sure?'],
            idx: 1,
            onPick: (k) => k === 0 && void run(),
          })
        },
      }),
  })
  settingsList('Menu >System >Reset', [16, 2, 10], () => [
    srow(`Trip (${Math.round(dev.trip)} NM)`, [ask('Trip', () => void (dev.trip = 0))]),
    srow('GPS', [ask('GPS', () => void (dev.sinceFix = 0))]),
    srow('Menu Settings', [ask('Menu Settings', () => void Object.assign(dev.settings, defaultSettings()))]),
    srow('Factory Reset', [ask('all data', () => dev.factoryReset(true))]),
  ])
}

// ---------------------------------------------------------------- fenêtres diverses

export function openBrillWindow(which: 0 | 1): BrillView {
  const dev = useDevice()
  const v: BrillView = reactive({
    kind: 'brill' as const,
    which,
    handle(key: KeyName): boolean {
      const s = dev.settings
      if (key === 'left') s.brillLcd = Math.max(1, s.brillLcd - 1)
      else if (key === 'right') s.brillLcd = Math.min(7, s.brillLcd + 1)
      else if (key === 'up') s.brillKey = Math.min(7, s.brillKey + 1)
      else if (key === 'down') s.brillKey = Math.max(1, s.brillKey - 1)
      else if (key === 'ent' || key === 'menu') popView()
      else return false
      return true
    },
  })
  return pushView(v)
}

export function openMobDialog(): void {
  const dev = useDevice()
  openConfirm({
    title: 'MOB',
    lines: ['Saved To MOB', '', 'Goto MOB ?'],
    options: ['Yes', 'No'],
    idx: 0,
    onPick: (i) => {
      if (i !== 0) return
      dev.setDestMob()
      dev.settings.display = 0
      if (dev.mob) ui.center = { lat: dev.ship.lat, lon: dev.ship.lon }
    },
  })
}

export function openShipPopup(): void {
  const dev = useDevice()
  const s = dev.settings
  const opts = [`Track ${s.trackShow ? 'Off' : 'On'}`, `COG Line ${s.cogLine ? 'Off' : 'On'}`]
  openSelect({
    options: opts,
    at: { x: 120, y: 90 },
    onPick: (i) => {
      if (i === 0) s.trackShow = !s.trackShow
      else s.cogLine = !s.cogLine
    },
  })
}

export function openLegPopup(): void {
  const dev = useDevice()
  const d = dev.dest
  if (!d || d.kind !== 'route') return
  const next = d.direction === 'Reverse' ? 'Forward' : 'Reverse'
  openSelect({
    options: [next, 'Cancel Route'],
    at: { x: 120, y: 90 },
    onPick: (i) => {
      if (i === 0) openConfirm({ title: next, lines: [`Change to ${next}?`], idx: 1, onPick: (k) => k === 0 && dev.reverseRoute(next) })
      else openConfirm({ title: 'Cancel Route', lines: ['Cancel route?'], idx: 1, onPick: (k) => k === 0 && dev.cancelDest() })
    },
  })
}
