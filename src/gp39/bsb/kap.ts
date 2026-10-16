// Lecteur de cartes BSB/KAP (format raster des cartes marines : SHOM, NOAA, BSB…), sans Vue ni DOM : testable sous Node.
//
// Un fichier .kap = un en-tête texte (CHT/, BSB/, KNP/, REF/, PLY/, DTM/, RGB/…) terminé par 0x1A 0x00, un octet de profondeur
// (bits par pixel), puis les lignes du raster en RLE, puis une table d'index (un offset de 4 octets par ligne) suivie de 4 octets :
// l'offset de cette table. On ne lit JAMAIS le fichier en entier : en-tête au scan, table d'index au premier usage, puis
// seulement les lignes dont une tuile a besoin (`ByteSource.read`).

/** Accès aux octets d'un fichier par plage (Blob/File dans le navigateur, tampon en mémoire dans les tests). */
export interface ByteSource {
  readonly size: number
  /** octets [start, end[ (bornés à la taille du fichier) */
  read(start: number, end: number): Promise<Uint8Array>
}

export function bufferSource(data: Uint8Array): ByteSource {
  return { size: data.length, read: async (s, e) => data.subarray(Math.max(0, s), Math.min(data.length, e)) }
}

export function blobSource(blob: Blob): ByteSource {
  return {
    size: blob.size,
    read: async (s, e) => new Uint8Array(await blob.slice(Math.max(0, s), Math.min(blob.size, e)).arrayBuffer()),
  }
}

export interface KapRef {
  x: number
  y: number
  lat: number
  lon: number
}

export interface KapHeader {
  name: string
  number: string
  width: number
  height: number
  /** résolution du scan (points par pouce), 254 pour le SHOM */
  dpi: number
  /** dénominateur de l'échelle nominale (KNP/SC) */
  scale: number
  projection: string
  datum: string
  /** décalage datum de la carte → WGS84 en secondes d'arc (DTM/) : lat WGS84 = lat carte + dtmLat / 3600 */
  dtmLat: number
  dtmLon: number
  /** points de calage pixel ↔ lat/lon (dans le datum de la carte) */
  refs: KapRef[]
  /** polygone de la zone utile de la carte (hors marges, légendes, cartouches), dans le datum de la carte */
  ply: { lat: number; lon: number }[]
  /** couleur de chaque valeur de pixel, 4 octets RGBA ; indice 0 = transparent */
  palette: Uint32Array
  /** bits par pixel (1 à 7) */
  depth: number
  /** offset du premier octet du raster */
  dataStart: number
}

const decodeLatin1 = (b: Uint8Array): string => {
  let s = ''
  for (let i = 0; i < b.length; i += 8192) s += String.fromCharCode(...b.subarray(i, Math.min(b.length, i + 8192)))
  return s
}

/**
 * Lit l'en-tête à partir des premiers octets du fichier. Renvoie null s'il n'y a pas de séparateur 0x1A (fichier tronqué ou autre
 * format) ou si les informations indispensables (taille, points de calage) manquent.
 */
export function parseKapHeader(bytes: Uint8Array): KapHeader | null {
  const end = bytes.indexOf(0x1a)
  if (end < 0 || end + 2 >= bytes.length) return null
  const lines: string[] = []
  for (const raw of decodeLatin1(bytes.subarray(0, end)).split(/\r?\n/)) {
    // une ligne qui commence par 4 espaces prolonge la précédente (la coupure tient lieu de virgule : « …1950 » / « PR=MERCATOR »)
    if (/^ {4}/.test(raw) && lines.length) lines[lines.length - 1] += `,${raw.trim()}`
    else lines.push(raw.trimEnd())
  }
  const all = (tag: string): string[] => lines.filter((l) => l.startsWith(`${tag}/`)).map((l) => l.slice(tag.length + 1))
  const first = (tag: string): string => all(tag)[0] ?? ''
  const nums = (s: string): number[] => s.split(',').map((v) => Number(v.trim()))

  const bsb = first('BSB')
  const ra = /RA=(\d+),\s*(\d+)/.exec(bsb)
  if (!ra) return null
  const knp = first('KNP')
  const refs = all('REF')
    .map(nums)
    .filter((n) => n.length >= 5 && n.every(Number.isFinite))
    .map((n) => ({ x: n[1]!, y: n[2]!, lat: n[3]!, lon: n[4]! }))
  if (refs.length < 3) return null
  const ply = all('PLY')
    .map(nums)
    .filter((n) => n.length >= 3 && n.every(Number.isFinite))
    .map((n) => ({ lat: n[1]!, lon: n[2]! }))
  const dtm = nums(first('DTM'))
  const name = /NA=(.*?),\s*NU=/.exec(bsb)?.[1] ?? /NA=([^,]*)/.exec(bsb)?.[1] ?? ''
  const nameScale = /\(1:(\d+)\)/.exec(name)?.[1]

  // palette : RGB/n,r,g,b (n à partir de 1 ; la valeur 0 reste transparente)
  const rgb = all('RGB')
    .map(nums)
    .filter((n) => n.length >= 4 && n.every(Number.isFinite))
  const size = Math.max(1, ...rgb.map((n) => n[0]! + 1))
  const bytesPal = new Uint8Array(size * 4)
  for (const [i, r, g, b] of rgb as [number, number, number, number][]) {
    bytesPal.set([r & 255, g & 255, b & 255, 255], i * 4)
  }
  const depth = bytes[end + 2]!
  if (depth < 1 || depth > 7) return null

  return {
    name,
    number: /NU=([^,]*)/.exec(bsb)?.[1]?.trim() ?? '',
    width: Number(ra[1]),
    height: Number(ra[2]),
    dpi: Number(/DU=(\d+)/.exec(bsb)?.[1] ?? 254),
    scale: Number(/SC=(\d+)/.exec(knp)?.[1] ?? nameScale ?? 0),
    projection: (/PR=([^,]+)/.exec(knp)?.[1] ?? 'MERCATOR').trim().toUpperCase(),
    datum: (/GD=([^,]+)/.exec(knp)?.[1] ?? '').trim(),
    dtmLat: Number.isFinite(dtm[0]) ? dtm[0]! : 0,
    dtmLon: Number.isFinite(dtm[1]) ? dtm[1]! : 0,
    refs,
    ply,
    palette: new Uint32Array(bytesPal.buffer),
    depth,
    dataStart: end + 3,
  }
}

/** Lit l'en-tête d'un fichier (16 Ko suffisent en pratique ; on élargit jusqu'à 256 Ko si le séparateur est plus loin). */
export async function readKapHeader(src: ByteSource): Promise<KapHeader | null> {
  for (const n of [16 * 1024, 256 * 1024]) {
    const bytes = await src.read(0, Math.min(src.size, n))
    if (bytes.indexOf(0x1a) >= 0 || bytes.length >= src.size) return parseKapHeader(bytes)
  }
  return null
}

/**
 * Décode une ligne du raster depuis `data[pos]` : marqueur de ligne (entier 7 bits à bit de continuation), puis suites
 * « valeur de pixel + longueur » : octet = [continuation | valeur sur `depth` bits | début de la longueur], longueur
 * complétée par des octets à 7 bits tant que la continuation est levée ; la ligne se termine par 0x00.
 * N'écrit que les pixels d'abscisse < `xLimit` dans `out` (indexés depuis x = 0) et renvoie la position suivante.
 */
export function decodeRow(data: Uint8Array, pos: number, depth: number, width: number, xLimit: number, out: Uint8Array): number {
  const shift = 7 - depth
  const colorMask = ((1 << depth) - 1) << shift
  const countMask = (1 << shift) - 1
  const limit = Math.min(width, xLimit, out.length)
  let b: number
  do {
    b = data[pos++] ?? 0
  } while (b & 0x80 && pos < data.length)
  let x = 0
  while (pos < data.length) {
    b = data[pos++]!
    if (b === 0) break
    const value = (b & colorMask) >> shift
    let run = b & countMask
    while (b & 0x80 && pos < data.length) {
      b = data[pos++]!
      run = run * 128 + (b & 0x7f)
    }
    run += 1
    if (x < limit) out.fill(value, x, Math.min(limit, x + run))
    x += run
    // plus de pixel à écrire : on saute le reste de la ligne (utile seulement à qui enchaîne les lignes sans table d'index)
    if (x >= limit) return skipToRowEnd(data, pos)
  }
  return pos
}

/** Avance jusqu'à la fin de la ligne (octet 0x00 hors des octets de longueur) sans rien écrire. */
function skipToRowEnd(data: Uint8Array, pos: number): number {
  while (pos < data.length) {
    let b = data[pos++]!
    if (b === 0) return pos
    while (b & 0x80 && pos < data.length) b = data[pos++]!
  }
  return pos
}

/** Vrai si `offsets` est une table plausible : croissante, comprise entre le début du raster et celui de la table. */
function plausibleIndex(offsets: Uint32Array, dataStart: number, tableStart: number): boolean {
  if (!offsets.length || offsets[0]! < dataStart) return false
  for (let i = 1; i < offsets.length; i++) if (offsets[i]! <= offsets[i - 1]!) return false
  return offsets[offsets.length - 1]! < tableStart
}

/**
 * Offset de chaque ligne du raster, plus une dernière entrée : la fin du raster (donc height + 1 valeurs). Lit seulement la
 * table de fin de fichier (4 octets par ligne) ; si elle est absente ou invalide, parcourt le raster une fois (lent : tout le
 * fichier est lu, par blocs de 8 Mo).
 */
export async function readRowIndex(src: ByteSource, h: KapHeader): Promise<Uint32Array> {
  if (src.size > h.dataStart + 4) {
    const tail = await src.read(src.size - 4, src.size)
    const tableStart = new DataView(tail.buffer, tail.byteOffset, 4).getUint32(0, false)
    const bytes = h.height * 4
    if (tableStart >= h.dataStart && tableStart + bytes + 4 === src.size) {
      const raw = await src.read(tableStart, tableStart + bytes)
      const dv = new DataView(raw.buffer, raw.byteOffset, raw.byteLength)
      const offsets = new Uint32Array(h.height + 1)
      for (let i = 0; i < h.height; i++) offsets[i] = dv.getUint32(i * 4, false)
      offsets[h.height] = tableStart
      if (plausibleIndex(offsets.subarray(0, h.height), h.dataStart, tableStart)) return offsets
    }
  }
  return scanRowIndex(src, h)
}

/** Reconstruit la table des lignes en parcourant tout le raster (machine à états sur les octets, par blocs de 8 Mo). */
export async function scanRowIndex(src: ByteSource, h: KapHeader): Promise<Uint32Array> {
  const offsets = new Uint32Array(h.height + 1)
  const CHUNK = 8 * 1024 * 1024
  const MARKER = 0 // octets du marqueur de ligne (continuation tant que le bit 0x80 est levé)
  const RUNS = 1 // octets de valeur/longueur ; 0x00 termine la ligne
  const COUNT = 2 // octets de longueur supplémentaires d'une suite
  let state = MARKER
  let row = 0
  let fileBase = h.dataStart
  let buf = await src.read(fileBase, fileBase + CHUNK)
  let p = 0
  let rowStart = h.dataStart
  let atRowStart = true
  while (row < h.height) {
    if (p >= buf.length) {
      fileBase += buf.length
      if (fileBase >= src.size) break
      buf = await src.read(fileBase, fileBase + CHUNK)
      p = 0
      if (!buf.length) break
    }
    if (atRowStart) {
      offsets[row] = rowStart
      atRowStart = false
    }
    const b = buf[p++]!
    if (state === MARKER) {
      if (!(b & 0x80)) state = RUNS
    } else if (state === COUNT) {
      if (!(b & 0x80)) state = RUNS
    } else if (b === 0) {
      row++
      state = MARKER
      rowStart = fileBase + p
      atRowStart = true
    } else if (b & 0x80) {
      state = COUNT
    }
  }
  if (row < h.height) throw new Error(`Raster incomplet : ${row} lignes sur ${h.height}`)
  offsets[h.height] = rowStart
  return offsets
}
