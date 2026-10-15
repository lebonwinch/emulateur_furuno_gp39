import { describe, expect, it } from 'vitest'
import {
  DEVICE_LAYER_NAME,
  MAX_LAYER_NAME,
  cleanLayerName,
  duplicateKey,
  layerCounts,
  normaliseLayers,
  selectForExport,
  waypointsInBox,
} from '../layers'
import { gpxFileName, DEFAULT_EXPORT_NAME } from '../gpxFile'
import type { Layer, Route, Waypoint } from '../types'

const wp = (id: number, lat: number, lon: number, extra: Partial<Waypoint> = {}): Waypoint => ({
  id,
  name: `W${id}`,
  lat,
  lon,
  symbol: 0,
  color: 2,
  comment: '',
  display: true,
  ...extra,
})

describe('cleanLayerName', () => {
  it('retire les espaces et caractères de contrôle, limite la longueur, remplace un nom vide', () => {
    expect(cleanLayerName('  Mon fichier.gpx  ')).toBe('Mon fichier.gpx')
    expect(cleanLayerName('a\u0001b\u001fc')).toBe('abc')
    expect(cleanLayerName('x'.repeat(100))).toBe('x'.repeat(MAX_LAYER_NAME))
    expect(cleanLayerName('')).toBe('Calque')
    expect(cleanLayerName('   ', 'Import')).toBe('Import')
    expect(cleanLayerName('été Bretagne')).toBe('été Bretagne')
  })
})

describe('normaliseLayers (données d’avant les calques)', () => {
  it('rattache les waypoints sans calque au calque « Appareil », créé une seule fois', () => {
    const w = [wp(1, 48, -4), wp(2, 48.1, -4)]
    const r = normaliseLayers(w, [])
    expect(r.layers).toEqual([{ id: 1, name: DEVICE_LAYER_NAME, visible: true }])
    expect(r.assigned).toBe(2)
    expect(w.map((x) => x.layer)).toEqual([1, 1])
  })

  it('garde les calques existants, réutilise « Appareil » s’il existe, rattache les calques disparus', () => {
    const layers: Layer[] = [
      { id: 4, name: 'a.gpx', visible: false },
      { id: 9, name: DEVICE_LAYER_NAME, visible: true },
    ]
    const w = [wp(1, 48, -4, { layer: 4 }), wp(2, 48, -4, { layer: 77 }), wp(3, 48, -4)]
    const r = normaliseLayers(w, layers)
    expect(r.layers).toHaveLength(2)
    expect(r.layers[0]).toEqual({ id: 4, name: 'a.gpx', visible: false })
    expect(w.map((x) => x.layer)).toEqual([4, 9, 9])
    expect(r.assigned).toBe(2)
  })

  it('ne crée rien quand tout est déjà rattaché ; ignore les doublons d’identifiant ; visible par défaut', () => {
    const layers = [{ id: 1, name: 'a', visible: true }, { id: 1, name: 'doublon', visible: true }, { id: 2, name: 'b' } as Layer]
    const r = normaliseLayers([wp(1, 1, 1, { layer: 2 })], layers)
    expect(r.layers.map((l) => [l.id, l.name, l.visible])).toEqual([
      [1, 'a', true],
      [2, 'b', true],
    ])
    expect(r.assigned).toBe(0)
  })
})

describe('layerCounts', () => {
  it('compte par calque, sans le Quick Point', () => {
    const m = layerCounts([
      wp(1, 1, 1, { layer: 1 }),
      wp(2, 1, 1, { layer: 1 }),
      wp(3, 1, 1, { layer: 2 }),
      wp(4, 1, 1, { layer: 1, qp: true }),
    ])
    expect([...m.entries()]).toEqual([
      [1, 2],
      [2, 1],
    ])
  })
})

describe('waypointsInBox (rectangle de sélection)', () => {
  const list = [wp(1, 48.0, -4.0), wp(2, 48.5, -3.5), wp(3, 49.0, -3.0), wp(4, 47.0, -4.0)]
  it('sélectionne les waypoints dans le rectangle, bornes comprises', () => {
    const box = { south: 48, west: -4, north: 48.5, east: -3.5 }
    expect(waypointsInBox(list, box).map((w) => w.id)).toEqual([1, 2])
  })
  it('un rectangle vide ne sélectionne rien ; le filtre `include` s’applique', () => {
    expect(waypointsInBox(list, { south: 10, west: 10, north: 11, east: 11 })).toEqual([])
    expect(waypointsInBox(list, { south: 40, west: -10, north: 60, east: 10 }, (w) => w.id % 2 === 0).map((w) => w.id)).toEqual([2, 4])
  })
})

describe('duplicateKey', () => {
  const base = { name: 'P', lat: 48, lon: -4, symbol: 0, color: 2 }
  it('même nom, position à 1 m près, symbole et couleur', () => {
    expect(duplicateKey({ ...base, lat: 48.000001, lon: -4.000001 })).toBe(duplicateKey(base))
    expect(duplicateKey({ ...base, lat: 48.001 })).not.toBe(duplicateKey(base))
    expect(duplicateKey({ ...base, name: 'Q' })).not.toBe(duplicateKey(base))
    expect(duplicateKey({ ...base, symbol: 8 })).not.toBe(duplicateKey(base))
    expect(duplicateKey({ ...base, color: 3 })).not.toBe(duplicateKey(base))
  })
})

describe('selectForExport', () => {
  const wpts = [wp(1, 1, 1, { layer: 1 }), wp(2, 1, 1, { layer: 1 }), wp(3, 1, 1, { layer: 2 }), wp(4, 1, 1, { layer: 1, qp: true })]
  const route = (no: number, ...ids: number[]): Route => ({
    no,
    name: `R${no}`,
    comment: '',
    points: ids.map((wptId) => ({ wptId, skip: false })),
  })
  const routes = [route(1, 1, 2), route(2, 2, 3)]

  it('sans filtre : tout sauf le Quick Point, routes comprises', () => {
    const s = selectForExport(wpts, routes, null)
    expect(s.waypoints.map((w) => w.id)).toEqual([1, 2, 3])
    expect(s.routes).toHaveLength(2)
  })
  it('avec des calques : seulement leurs waypoints et les routes entièrement contenues', () => {
    const s = selectForExport(wpts, routes, new Set([1]))
    expect(s.waypoints.map((w) => w.id)).toEqual([1, 2])
    expect(s.routes.map((r) => r.no)).toEqual([1]) // la route 2 passe par le waypoint 3 (calque 2) : omise
  })
  it('aucun calque : rien', () => {
    const s = selectForExport(wpts, routes, new Set())
    expect(s.waypoints).toEqual([])
    expect(s.routes.every((r) => r.points.length === 0)).toBe(true)
  })
})

describe('nom du fichier exporté', () => {
  it('ajoute .gpx, sans le doubler et sans tenir compte de la casse', () => {
    expect(gpxFileName('mon fichier')).toBe('mon fichier.gpx')
    expect(gpxFileName('mon fichier.gpx')).toBe('mon fichier.gpx')
    expect(gpxFileName('Brest.GPX')).toBe('Brest.gpx')
    expect(gpxFileName('  espaces autour  ')).toBe('espaces autour.gpx')
  })
  it('remplace les caractères interdits par « _ » et garde les accents', () => {
    expect(gpxFileName('a/b\\c:d*e?f"g<h>i|j')).toBe('a_b_c_d_e_f_g_h_i_j.gpx')
    expect(gpxFileName('Bretagne été 2026')).toBe('Bretagne été 2026.gpx')
    expect(gpxFileName('a\u0001b\u001fc')).toBe('a_b_c.gpx')
  })
  it('nom vide ou fait uniquement de points/espaces : retombe sur le nom reconnu par le GP-39', () => {
    for (const raw of ['', '   ', '...', ' . ', '.gpx']) expect(gpxFileName(raw)).toBe(`${DEFAULT_EXPORT_NAME}.gpx`)
    expect(DEFAULT_EXPORT_NAME).toBe('GP39_WptRte')
  })
  it('pas de point ni d’espace en fin de nom (interdit sous Windows)', () => {
    expect(gpxFileName('nom.')).toBe('nom.gpx')
    expect(gpxFileName('nom.gpx.')).toBe('nom.gpx')
  })
  it('évite les noms de périphériques Windows', () => {
    expect(gpxFileName('CON')).toBe('_CON.gpx')
    expect(gpxFileName('nul.txt')).toBe('_nul.txt.gpx')
    expect(gpxFileName('com1')).toBe('_com1.gpx')
    expect(gpxFileName('console')).toBe('console.gpx')
  })
  it('limite la longueur du nom à 96 caractères (100 avec .gpx)', () => {
    const n = gpxFileName('x'.repeat(300))
    expect(n).toBe(`${'x'.repeat(96)}.gpx`)
    expect(n.length).toBe(100)
  })
})
