// Identité, licence et crédits du projet : une seule source pour l'écran « À propos », le fichier THIRD_PARTY_NOTICES.md (généré par
// scripts/notices.mjs) et les tests de conformité. Sans Vue ni DOM. Syntaxe « effaçable » uniquement (Node lit ce fichier tel quel).

export const APP_NAME = 'Émulateur compatible GP-39'
export const LICENSE_ID = 'GPL-3.0-or-later'
export const LICENSE_NAME = 'GNU General Public License, version 3 ou ultérieure'
/** Le code source correspondant à la version servie : la GPL impose de le proposer à qui reçoit le programme. */
export const REPO_URL = 'https://github.com/lebonwinch/emulateur_furuno_gp39'
export const COPYRIGHT_HOLDER = 'Vincent Aizier'
export const COPYRIGHT = `Copyright © 2026 ${COPYRIGHT_HOLDER}`

export const WARRANTY_NOTICE =
  'Ce programme est un logiciel libre : vous pouvez le redistribuer et/ou le modifier selon les termes de la licence ci-dessus. ' +
  'Il est distribué dans l’espoir qu’il sera utile, mais SANS AUCUNE GARANTIE, pas même celle de sa valeur marchande ni de son adéquation à un usage particulier.'

export const TRADEMARK_NOTICE =
  '« FURUNO » et « GP-39 » sont des marques de Furuno Electric Co., Ltd., citées uniquement pour indiquer la compatibilité. ' +
  'Ce projet n’est ni affilié à Furuno ni approuvé par elle.'

export const NAVIGATION_NOTICE =
  'Ce n’est pas un instrument de navigation : les cartes et les données affichées ne sont pas destinées à la navigation.'

export interface Credit {
  name: string
  /** ce que le projet en fait */
  what: string
  licence: string
  url?: string
  /** domaines interrogés par l'application pour ce service (le test de conformité les rapproche de la CSP de index.html) */
  hosts?: string[]
  /** formule de citation imposée par la licence, à reproduire telle quelle */
  citation?: string
}

/** Citation exigée par le Shom pour le jeu « Balisage maritime » (fiche de catalogue du Shom). */
export const SHOM_CITATION = 'Shom, 2026. https://dx.doi.org/10.17183/DOI_BALISAGE_MARITIME'
export const ETALAB_URL = 'https://www.etalab.gouv.fr/licence-ouverte-open-licence/'

/** Données livrées avec l'application et services en ligne qu'elle interroge. */
export const DATA_CREDITS: Credit[] = [
  {
    name: 'Shom — Balisage maritime (aides à la navigation)',
    what:
      'Les 2 252 waypoints livrés (waypoints_GP39.gpx) sont extraits de ce jeu, filtrés et convertis au format GPX, avec les symboles et les couleurs ' +
      'du GP-39 attribués par l’émulateur. Ces données ne doivent pas servir à la navigation.',
    licence: 'Licence Ouverte Etalab 2.0',
    url: ETALAB_URL,
    citation: SHOM_CITATION,
  },
  {
    name: 'OpenStreetMap',
    what: 'Fond de carte en ligne (tuiles du serveur de la Fondation OpenStreetMap).',
    licence: 'ODbL 1.0 — © les contributeurs d’OpenStreetMap',
    url: 'https://www.openstreetmap.org/copyright',
    hosts: ['tile.openstreetmap.org', '*.tile.openstreetmap.org'],
  },
  {
    name: 'OpenSeaMap',
    what: 'Marques nautiques superposées au fond de carte (tuiles en ligne).',
    licence: 'Données ODbL 1.0 ; tuiles CC BY-SA 2.0 (selon la FAQ d’OpenSeaMap)',
    url: 'https://www.openseamap.org',
    hosts: ['tiles.openseamap.org'],
  },
  {
    name: 'Géoplateforme (IGN) — Carte littorale Shom / IGN',
    what: 'Assemblage des cartes marines du Shom et des cartes terrestres de l’IGN (tuiles en ligne).',
    licence: 'Conditions générales d’utilisation de la Géoplateforme ; licence propre à chaque jeu de données',
    url: 'https://cartes.gouv.fr/cgu',
    hosts: ['data.geopf.fr'],
  },
  {
    name: 'Shom — couches thématiques libres',
    what: 'Balisage, épaves et obstructions, informations portuaires, dispositifs de séparation du trafic (tuiles en ligne).',
    licence: 'Conditions de réutilisation du catalogue du Shom — © Shom',
    url: 'https://data.shom.fr',
    hosts: ['services.data.shom.fr'],
  },
  {
    name: 'EMODnet Bathymetry',
    what: 'Relief, profondeurs et isobathes des mers d’Europe (service WMS en ligne).',
    licence: 'CC BY 4.0 — © EMODnet Bathymetry Consortium',
    url: 'https://emodnet.ec.europa.eu/en/bathymetry',
    hosts: ['ows.emodnet-bathymetry.eu'],
  },
]

/** Travaux de référence : leur code n'est pas repris tel quel, mais le format CM93 est compris grâce à eux. */
export const REFERENCE_CREDITS: Credit[] = [
  {
    name: 'OpenCPN (cm93.cpp)',
    what:
      'Référence de compatibilité du format de cartes CM93 : table de substitution d’octets, structure des cellules, seuils d’échelle et ' +
      'correspondance des couleurs. Le lecteur de ce projet est une réécriture en TypeScript.',
    licence: 'GNU GPL version 2 ou ultérieure — © 2010 David S. Register et les contributeurs d’OpenCPN',
    url: 'https://github.com/OpenCPN/OpenCPN',
  },
  {
    name: 'World Magnetic Model (NOAA / NCEI et BGS)',
    what: 'Déclinaison magnétique, par la bibliothèque geomagnetism.',
    licence: 'Domaine public (NOAA)',
    url: 'https://www.ncei.noaa.gov/products/world-magnetic-model',
  },
]

/** Composants embarqués dans l'application (versions et textes complets : THIRD_PARTY_NOTICES.md). */
export const LIBRARIES: Credit[] = [
  { name: 'Vue', what: 'Interface', licence: 'MIT', url: 'https://vuejs.org' },
  { name: 'Quasar', what: 'Composants d’interface, mode PWA', licence: 'MIT', url: 'https://quasar.dev' },
  { name: 'Pinia', what: 'État de l’appareil', licence: 'MIT', url: 'https://pinia.vuejs.org' },
  { name: 'Vue Router', what: 'Navigation', licence: 'MIT', url: 'https://router.vuejs.org' },
  { name: 'Leaflet', what: 'Cartes', licence: 'BSD-2-Clause', url: 'https://leafletjs.com' },
  {
    name: 'geomagnetism',
    what: 'Déclinaison magnétique (World Magnetic Model)',
    licence: 'Apache-2.0',
    url: 'https://github.com/naturalatlas/geomagnetism',
  },
  {
    name: 'Workbox et register-service-worker',
    what: 'Fonctionnement hors ligne (service worker)',
    licence: 'MIT',
    url: 'https://developer.chrome.com/docs/workbox',
  },
  { name: 'Roboto', what: 'Police', licence: 'Apache-2.0', url: 'https://fonts.google.com/specimen/Roboto' },
  {
    name: 'Roboto Condensed',
    what: 'Police des touches et des écrans',
    licence: 'SIL OFL 1.1',
    url: 'https://fonts.google.com/specimen/Roboto+Condensed',
  },
  { name: 'VT323', what: 'Police de l’écran LCD', licence: 'SIL OFL 1.1', url: 'https://fonts.google.com/specimen/VT323' },
  { name: 'Material Icons', what: 'Icônes', licence: 'Apache-2.0', url: 'https://fonts.google.com/icons' },
]

/** Métadonnées GPX de la citation du Shom (copiées dans le fichier de données livré). */
export const GPX_METADATA =
  '<metadata>\n' +
  '  <name>Balisage maritime du Shom — extraction pour l’émulateur GP-39</name>\n' +
  `  <desc>${SHOM_CITATION}. Données filtrées et converties au format GPX, symboles et couleurs GP-39 ajoutés. Ne pas utiliser pour la navigation.</desc>\n` +
  '  <copyright author="Shom">\n' +
  '    <year>2026</year>\n' +
  `    <license>${ETALAB_URL}</license>\n` +
  '  </copyright>\n' +
  '</metadata>\n'
