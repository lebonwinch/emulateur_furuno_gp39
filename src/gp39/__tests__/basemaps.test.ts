import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  BASE_OPTIONS,
  SHOM_OVERLAYS,
  baseLayers,
  baseMinZoom,
  isBaseId,
  parseShomSelection,
  shomOverlaySpec,
  type BaseId,
  type TileSpec,
} from '../basemaps'

const html = readFileSync(fileURLToPath(new URL('../../../index.html', import.meta.url)), 'utf8')

const allSpecs = (): TileSpec[] => [
  ...(['osm', 'openseamap', 'shom', 'emodnet', 'none'] as BaseId[]).flatMap((id) => baseLayers(id)),
  ...SHOM_OVERLAYS.map(shomOverlaySpec),
]

describe('fonds de carte', () => {
  it('propose OpenStreetMap, OpenSeaMap, Shom, EMODnet et « sans fond »', () => {
    expect(BASE_OPTIONS.map((o) => o.id)).toEqual(['osm', 'openseamap', 'shom', 'emodnet', 'none'])
    expect(BASE_OPTIONS.every((o) => o.label && o.hint)).toBe(true)
  })

  it('EMODnet : bathymétrie WMS + isobathes + marques OpenSeaMap, mers du Royaume-Uni et d’Irlande comprises', () => {
    const l = baseLayers('emodnet')
    expect(l.map((s) => s.id)).toEqual(['emodnet-bathymetry', 'emodnet-contours', 'openseamap'])
    expect(l[0]!.wms?.layers).toBe('emodnet:mean_atlas_land')
    expect(l[0]!.overlay).toBeFalsy()
    expect(l[1]!.wms?.layers).toBe('emodnet:contours')
    expect(l[1]!.overlay).toBe(true)
    expect(l[0]!.url).toBe('https://ows.emodnet-bathymetry.eu/wms')
    expect(baseMinZoom('emodnet')).toBe(2)
    // l'avertissement « pas pour la navigation » et la licence doivent figurer dans l'attribution affichée
    expect(l[0]!.attribution).toContain('CC BY 4.0')
    expect(l[0]!.attribution).toContain('non destinée à la navigation')
    expect(BASE_OPTIONS.find((o) => o.id === 'emodnet')!.hint).toContain('Admiralty')
  })

  it('OpenSeaMap = fond OpenStreetMap + couche de marques nautiques transparente par-dessus', () => {
    const l = baseLayers('openseamap')
    expect(l.map((s) => s.id)).toEqual(['osm', 'openseamap'])
    expect(l[0]!.overlay).toBeFalsy()
    expect(l[1]!.overlay).toBe(true)
    expect(l[1]!.url).toBe('https://tiles.openseamap.org/seamark/{z}/{x}/{y}.png')
  })

  it('Shom = Carte littorale de la Géoplateforme, zooms 6 à 16 puis agrandissement', () => {
    const [shom] = baseLayers('shom')
    expect(shom!.url).toContain('https://data.geopf.fr/wmts?')
    expect(shom!.url).toContain('LAYER=GEOGRAPHICALGRIDSYSTEMS.COASTALMAPS')
    expect(shom!.url).toContain('TILEMATRIXSET=PM_6_16')
    expect(shom!.minZoom).toBe(6)
    expect(shom!.maxNativeZoom).toBe(16)
    expect(shom!.maxZoom).toBeGreaterThan(16)
    expect(baseMinZoom('shom')).toBe(6)
    expect(baseMinZoom('osm')).toBe(2)
    expect(baseMinZoom('none')).toBe(2)
  })

  it('« sans fond » n’empile aucune couche', () => {
    expect(baseLayers('none')).toEqual([])
  })

  it('chaque URL est en https et contient les trois variables de tuile (XYZ ou WMTS)', () => {
    for (const s of allSpecs()) {
      expect(s.url.startsWith('https://')).toBe(true)
      // service WMS : Leaflet fabrique lui-même les requêtes GetMap, l'URL est l'adresse du service
      if (s.wms) {
        expect(s.wms.layers.length).toBeGreaterThan(0)
        expect(s.url).not.toContain('{')
        continue
      }
      expect(s.url).toContain('{z}')
      expect(s.url.includes('{x}') || s.url.includes('TILECOL={x}')).toBe(true)
      expect(s.url.includes('{y}') || s.url.includes('TILEROW={y}')).toBe(true)
    }
  })

  it('les couches Shom libres : 4 couches distinctes sur le service INSPIRE, zooms natifs bornés', () => {
    expect(SHOM_OVERLAYS.map((o) => o.id)).toEqual(['balisage', 'epaves', 'ports', 'dst'])
    expect(new Set(SHOM_OVERLAYS.map((o) => o.layer)).size).toBe(4)
    for (const o of SHOM_OVERLAYS) {
      const s = shomOverlaySpec(o)
      expect(s.url).toContain('https://services.data.shom.fr/INSPIRE/wmts?')
      expect(s.url).toContain(`LAYER=${o.layer}`)
      expect(s.url).toContain('TILEMATRIXSET=3857')
      expect(s.overlay).toBe(true)
      expect(s.maxNativeZoom).toBe(o.maxNativeZoom)
    }
    expect(SHOM_OVERLAYS.find((o) => o.id === 'dst')!.maxNativeZoom).toBe(15)
  })

  it('attributions : OpenStreetMap avec lien vers le copyright et « contributors », OpenSeaMap, Shom/IGN', () => {
    const [osm] = baseLayers('osm')
    expect(osm!.attribution).toContain('https://www.openstreetmap.org/copyright')
    expect(osm!.attribution).toContain('contributors')
    expect(baseLayers('openseamap')[1]!.attribution).toContain('OpenSeaMap')
    const shom = baseLayers('shom')[0]!.attribution
    expect(shom).toContain('Shom')
    expect(shom).toContain('IGN')
    expect(shom).toContain('non destinées à la navigation')
    expect(allSpecs().every((s) => s.attribution.length > 0)).toBe(true)
  })

  it('la politique CSP de index.html autorise le serveur de chaque fond (sinon les tuiles seraient bloquées)', () => {
    const csp = /img-src([^;]*);/.exec(html)![1]!
    for (const s of allSpecs()) {
      const host = new URL(s.url.replace(/\{[^}]*\}/g, '0')).host
      expect(csp, `img-src doit autoriser ${host}`).toContain(host)
    }
  })

  it('préférences : valeurs inconnues ignorées', () => {
    expect(isBaseId('shom')).toBe(true)
    expect(isBaseId('google')).toBe(false)
    expect(parseShomSelection('["balisage","dst"]')).toEqual(['balisage', 'dst'])
    expect(parseShomSelection('["balisage","inconnue",3]')).toEqual(['balisage'])
    expect(parseShomSelection('pas du json')).toEqual([])
    expect(parseShomSelection('{"a":1}')).toEqual([])
    expect(parseShomSelection(null)).toEqual([])
  })
})
