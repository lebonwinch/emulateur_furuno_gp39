// Fonds de carte de la fenêtre « Position du bateau » : définitions pures (sans Leaflet) pour pouvoir les tester.
//
// Sources vérifiées (accès sans clé, en-tête CORS ouvert, tuiles 256 px en Web Mercator) :
//  - OpenStreetMap          https://tile.openstreetmap.org/{z}/{x}/{y}.png
//  - OpenSeaMap (marques)   https://tiles.openseamap.org/seamark/{z}/{x}/{y}.png   (couche transparente, à poser sur un fond)
//  - Shom « Carte littorale » : service WMTS public de la Géoplateforme (IGN) data.geopf.fr, couche
//    GEOGRAPHICALGRIDSYSTEMS.COASTALMAPS = « assemblage des cartes marines du Shom et des cartes terrestres de l'IGN »,
//    matrice PM_6_16 (zooms 6 à 16), sans clé. « Cette donnée n'est pas destinée à la navigation maritime. »
//  - Shom, couches thématiques libres : https://services.data.shom.fr/INSPIRE/wmts (matrice 3857, PNG transparents).
//  - EMODnet Bathymetry (consortium européen, CC BY 4.0) : https://ows.emodnet-bathymetry.eu/wms, couches `emodnet:mean_atlas_land`
//    (relief + profondeurs) et `emodnet:contours` (isobathes) ; couvre les mers d'Europe, dont le Royaume-Uni et l'Irlande.
//    Ce n'est PAS une carte marine : les cartes Admiralty (UKHO, Royaume-Uni et Irlande) sont payantes, sans service de tuiles libre.

export type BaseId = 'osm' | 'openseamap' | 'shom' | 'emodnet' | 'bsb' | 'none'

export interface TileSpec {
  /** identifiant stable (clé de cache, préférences) */
  id: string
  /** modèle d'URL de tuiles ({z}/{x}/{y}) ; pour un service WMS (`wms` renseigné) : adresse du service seule */
  url: string
  /** service WMS : Leaflet construit lui-même les requêtes GetMap (Web Mercator, 256 px) */
  wms?: { layers: string }
  /** HTML d'attribution affiché par Leaflet */
  attribution: string
  minZoom?: number
  /** dernier zoom réellement servi par le serveur : au-delà, Leaflet agrandit les tuiles de ce niveau */
  maxNativeZoom?: number
  maxZoom: number
  /** vrai pour les couches transparentes superposées au fond */
  overlay?: boolean
}

export interface BaseOption {
  id: BaseId
  label: string
  hint: string
}

export const BASE_OPTIONS: BaseOption[] = [
  { id: 'osm', label: 'OpenStreetMap', hint: 'Fond routier et terrestre.' },
  { id: 'openseamap', label: 'OpenSeaMap', hint: 'OpenStreetMap + marques nautiques (bouées, feux, amers) d’OpenSeaMap.' },
  {
    id: 'shom',
    label: 'Shom — cartes marines',
    hint: 'Carte littorale Shom / IGN : cartes marines en mer, cartes IGN à terre. Zoom 6 à 16 (au-delà : agrandissement), littoral français et outre-mer.',
  },
  {
    id: 'emodnet',
    label: 'Bathymétrie EMODnet (Europe)',
    hint: 'Relief, profondeurs et isobathes EMODnet + marques OpenSeaMap : mers d’Europe, dont Royaume-Uni et Irlande. Ce n’est pas une carte marine (pas de sondes ni de dangers) ; pour naviguer, utiliser les cartes Admiralty officielles.',
  },
  {
    id: 'bsb',
    label: 'Cartes BSB (dossier local)',
    hint: 'Vos cartes marines raster .kap (SHOM, NOAA…), lues sur place dans le dossier choisi : la carte la plus détaillée encore lisible s’affiche selon le zoom et la zone, comme dans OpenCPN. Non destinées à la navigation.',
  },
  { id: 'none', label: 'Sans fond', hint: 'Seulement les waypoints.' },
]

/** Zoom minimal quand le fond est une carte BSB (en dessous, la tuile couvrirait des milliers de milles : rien de lisible). */
export const BSB_MIN_ZOOM = 5

export const DEFAULT_BASE: BaseId = 'osm'

const OSM: TileSpec = {
  id: 'osm',
  url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors',
  maxZoom: 19,
}

const OPENSEAMAP: TileSpec = {
  id: 'openseamap',
  url: 'https://tiles.openseamap.org/seamark/{z}/{x}/{y}.png',
  attribution: 'Marques nautiques &copy; <a href="https://www.openseamap.org" target="_blank" rel="noopener">OpenSeaMap</a> contributors',
  minZoom: 4,
  maxNativeZoom: 18,
  maxZoom: 19,
  overlay: true,
}

const SHOM_COASTAL: TileSpec = {
  id: 'shom-coastal',
  url:
    'https://data.geopf.fr/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0' +
    '&LAYER=GEOGRAPHICALGRIDSYSTEMS.COASTALMAPS&STYLE=normal&FORMAT=image/png&TILEMATRIXSET=PM_6_16' +
    '&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}',
  attribution:
    'Cartes marines &copy; <a href="https://www.shom.fr" target="_blank" rel="noopener">Shom</a> / <a href="https://www.ign.fr" target="_blank" rel="noopener">IGN</a> — non destinées à la navigation',
  minZoom: 6,
  maxNativeZoom: 16,
  maxZoom: 19,
}

const EMODNET_WMS = 'https://ows.emodnet-bathymetry.eu/wms'
const EMODNET_ATTRIBUTION =
  'Bathymétrie &copy; <a href="https://emodnet.ec.europa.eu/en/bathymetry" target="_blank" rel="noopener">EMODnet Bathymetry Consortium</a> (CC BY 4.0) — non destinée à la navigation'

// la grille EMODnet fait ~115 m : au-delà du zoom 13, Leaflet agrandit les tuiles plutôt que d'en redemander
const EMODNET_BATHYMETRY: TileSpec = {
  id: 'emodnet-bathymetry',
  url: EMODNET_WMS,
  wms: { layers: 'emodnet:mean_atlas_land' },
  attribution: EMODNET_ATTRIBUTION,
  minZoom: 2,
  maxNativeZoom: 13,
  maxZoom: 19,
}

const EMODNET_CONTOURS: TileSpec = {
  id: 'emodnet-contours',
  url: EMODNET_WMS,
  wms: { layers: 'emodnet:contours' },
  attribution: EMODNET_ATTRIBUTION,
  minZoom: 2,
  maxNativeZoom: 13,
  maxZoom: 19,
  overlay: true,
}

/** Couches thématiques libres du Shom (service INSPIRE), superposables à n'importe quel fond. */
export interface ShomOverlay {
  id: string
  label: string
  layer: string
  maxNativeZoom: number
}

export const SHOM_OVERLAYS: ShomOverlay[] = [
  { id: 'balisage', label: 'Balisage', layer: 'BALISAGE_PYR_PNG_3857_WMTS', maxNativeZoom: 17 },
  { id: 'epaves', label: 'Épaves et obstructions', layer: 'EPAVES_PYR-PNG_WLD_3857_WMTS', maxNativeZoom: 17 },
  { id: 'ports', label: 'Informations portuaires', layer: 'INFORMATIONS_PORTUAIRES_PYR_PNG_3857_WMTS', maxNativeZoom: 17 },
  { id: 'dst', label: 'Dispositifs de séparation du trafic', layer: 'DST_PYR_PNG_3857_WMTS', maxNativeZoom: 15 },
]

export function shomOverlaySpec(o: ShomOverlay): TileSpec {
  return {
    id: `shom-${o.id}`,
    url:
      `https://services.data.shom.fr/INSPIRE/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=${o.layer}` +
      '&STYLE=normal&TILEMATRIXSET=3857&FORMAT=image/png&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}',
    attribution: '&copy; <a href="https://www.shom.fr" target="_blank" rel="noopener">Shom</a>',
    minZoom: 4,
    maxNativeZoom: o.maxNativeZoom,
    maxZoom: 19,
    overlay: true,
  }
}

export function isBaseId(v: unknown): v is BaseId {
  return typeof v === 'string' && BASE_OPTIONS.some((o) => o.id === v)
}

/** Couches de fond à empiler (de la plus basse à la plus haute) pour le choix `id`. */
export function baseLayers(id: BaseId): TileSpec[] {
  switch (id) {
    case 'osm':
      return [OSM]
    case 'openseamap':
      return [OSM, OPENSEAMAP]
    case 'shom':
      return [SHOM_COASTAL]
    case 'emodnet':
      return [EMODNET_BATHYMETRY, EMODNET_CONTOURS, OPENSEAMAP]
    default:
      return []
  }
}

/** Zoom minimal imposé à la carte par le fond choisi (la carte Shom n'existe pas en dessous de 6). */
export function baseMinZoom(id: BaseId): number {
  if (id === 'bsb') return BSB_MIN_ZOOM
  return Math.max(
    2,
    ...baseLayers(id)
      .filter((l) => !l.overlay)
      .map((l) => l.minZoom ?? 2),
  )
}

/** Lit la liste des couches Shom cochées depuis une préférence JSON (valeurs inconnues ignorées). */
export function parseShomSelection(raw: string | null | undefined): string[] {
  if (!raw) return []
  try {
    const v: unknown = JSON.parse(raw)
    if (!Array.isArray(v)) return []
    return v.filter((x): x is string => typeof x === 'string' && SHOM_OVERLAYS.some((o) => o.id === x))
  } catch {
    return []
  }
}
