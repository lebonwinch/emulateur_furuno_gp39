// Modèle des vues « texte » du GP-39 (menus, listes, fenêtres) et des touches de la façade.

export type KeyName =
  | 'up'
  | 'down'
  | 'left'
  | 'right'
  | 'upleft'
  | 'upright'
  | 'downleft'
  | 'downright'
  | 'menu'
  | 'ent'
  | 'disp'
  | 'goto'
  | 'mark'
  | 'brill'

/** Contenu d'une cellule de liste. */
export type Cell = string | { mark: [number, number] } | { icon: [number, number] } | { dim: string }

export interface ListRow {
  cells: Cell[]
  /** menu : valeur éditable (cellules) pour ◀ ▶ ; index de cellules pouvant être sélectionnées */
  editable?: number[]
  /** action de la touche ENT sur la cellule `cell` */
  enter?: (cell: number) => void
  /** ligne grisée, non sélectionnable */
  disabled?: boolean
  /** ligne d'info non sélectionnable (ex. « Memory Used 0% ») */
  info?: boolean
}

interface Base {
  /** touche reçue par cette vue ; renvoie true si elle l'a traitée */
  handle(key: KeyName, long: boolean): boolean
  /** caractère tapé au clavier physique (éditeurs) */
  typed?(ch: string): boolean
}

export interface ListView extends Base {
  kind: 'list'
  /** ex. « Menu >Plotter Setup » */
  title: string
  /** en-têtes de colonnes (listes) */
  header?: string[]
  /** largeur des colonnes en caractères */
  cols: number[]
  /** menu : ligne entière surlignée ; settings : cellule active surlignée ; table : ligne entière */
  mode: 'menu' | 'settings' | 'table'
  count: () => number
  row: (i: number) => ListRow
  idx: number
  /** cellule active (mode settings) */
  cell: number
  top: number
  footer?: string
  /** nombre de lignes visibles (calculé par le rendu) */
  visible?: number
}

export interface SelectView extends Base {
  kind: 'select'
  options: string[]
  idx: number
  top: number
  title?: string
  /** position de la fenêtre dans l'écran (px LCD) ; centrée par défaut */
  at?: { x: number; y: number }
  /** une icône SVG optionnelle par option (liste de symboles) */
  icons?: string[]
  /** nombre max de lignes visibles */
  max: number
  /** largeur en caractères (sinon calculée) */
  width?: number
}

export interface EditSlot {
  /** caractères autorisés ; absent = caractère littéral non éditable */
  set?: string
  /** pour un littéral : le caractère */
  lit?: string
}

export interface EditView extends Base {
  kind: 'edit'
  label?: string
  slots: EditSlot[]
  buf: string[]
  pos: number
  at?: { x: number; y: number }
  /** texte après le champ (ex. « NM ») */
  suffix?: string
  /** libellé de gauche (ex. « Name ») */
  prefix?: string
}

export interface ConfirmView extends Base {
  kind: 'confirm'
  title: string
  lines: string[]
  options: string[]
  idx: number
}

export interface MessageView extends Base {
  kind: 'message'
  title: string
  lines: string[]
}

export interface ZoomView extends Base {
  kind: 'zoom'
}

export interface BrillView extends Base {
  kind: 'brill'
  /** 0 = rétro-éclairage LCD, 1 = clavier */
  which: 0 | 1
}

/** Fenêtre « Self Test » : zone d'essai du clavier. */
export interface TestView extends Base {
  kind: 'test'
  pressed: Set<string>
}

export interface LcdTestView extends Base {
  kind: 'lcdtest'
  step: number
}

export type View = ListView | SelectView | EditView | ConfirmView | MessageView | ZoomView | BrillView | TestView | LcdTestView
