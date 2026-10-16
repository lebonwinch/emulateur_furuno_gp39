# Émulateur Furuno GP-39 (PWA Vue 3 / Quasar)

Émulateur de l'écran du GPS **Furuno GP-39** : il affiche un fichier GPX de waypoints (`waypoints_GP39.gpx`, balisage SHOM)
comme le matériel, avec les mêmes couleurs, les mêmes pictogrammes, les mêmes écrans, la même façade à 6 touches + CursorPad
et les mêmes menus. Référence : manuel officiel _GP-39 Operator's Manual_ OME-44942-D (dossier `../doc_gp39`).

> Ce n'est pas un instrument de navigation.

## Démarrer

Prérequis : Node 24 (ou 22.12+).

```bash
npm install
npm run dev          # http://localhost:9000  (mode SPA)
npm run build:pwa    # production : dist/pwa  (service worker + manifeste)
npm test             # tests unitaires et d'intégration (vitest)
npm run typecheck    # vue-tsc
npm run lint:check   # oxfmt + oxlint
```

`dist/pwa` est un site statique (routage en `#`) : il se sert depuis n'importe quel serveur HTTP(S). Pour l'héberger dans un
sous-dossier, renseigner `build.publicPath` dans `quasar.config.ts` avant `npm run build:pwa`. L'installation en PWA et le
service worker exigent HTTPS (ou `localhost`).

## Utilisation

- **Touches de la façade** : à la souris / au doigt, ou au clavier.

  | Clavier                         | Touche GP-39                    |
  | ------------------------------- | ------------------------------- |
  | `↑ ↓ ← →`, `Home PgUp End PgDn` | CursorPad (8 directions)        |
  | `Entrée` (maintenu 1 s)         | ENT/CNTR (centrer le bateau)    |
  | `M` ou `Échap`                  | MENU                            |
  | `D` (maintenu 1,5 s)            | DISP (sens inverse)             |
  | `G`                             | GO TO                           |
  | `Espace` (maintenu 1 s)         | MARK / MOB                      |
  | `B` (maintenu 3 s)              | BRILL / marche-arrêt            |
  | `+` `−`, molette sur l'écran    | zoom du plotter (0,02 → 320 NM) |

  Dans un éditeur de champ (nom, latitude…), les caractères se tapent directement au clavier.

- **Plotter** : le clic place le curseur, le glisser déplace la carte. ENT sur un waypoint ouvre _Goto / Move / Edit / Delete_,
  GO TO avec le curseur crée un _Quick Point_, MARK enregistre un waypoint à la position du bateau, MARK maintenu enregistre un MOB.
- **Position du bateau** (bouton « Position du bateau… ») : fenêtre avec carte (fond au choix, voir « Fonds de carte » ; zoom molette ou +/−). Le bateau se
  **déplace en le faisant glisser** ; on peut aussi saisir une position, choisir un port, activer un déplacement simulé
  (vitesse, cap, route circulaire), forcer l'état du fix GPS ou activer le mode Demo (« SIM »).
- **Fonds de carte** (fenêtre « Position ») : **OpenStreetMap**, **OpenSeaMap** (OpenStreetMap + marques nautiques), **Shom — cartes
  marines** (Carte littorale Shom/IGN), **Bathymétrie EMODnet** (relief, profondeurs et isobathes des mers d'Europe + marques
  OpenSeaMap) ou **sans fond**. Des couches Shom libres (balisage, épaves et obstructions, informations portuaires, dispositifs de
  séparation du trafic) se superposent à n'importe quel fond. Le choix est mémorisé. Aucun de ces services ne demande de clé ; chacun
  affiche sa source en bas à droite de la carte. Sources : `tile.openstreetmap.org`, `tiles.openseamap.org/seamark`,
  `data.geopf.fr/wmts` (couche `GEOGRAPHICALGRIDSYSTEMS.COASTALMAPS`, zooms 6 à 16 puis agrandissement, littoral français et
  outre-mer), `services.data.shom.fr/INSPIRE/wmts`, `ows.emodnet-bathymetry.eu/wms` (couches `emodnet:mean_atlas_land` et
  `emodnet:contours`, CC BY 4.0). Ces cartes ne sont **pas destinées à la navigation**.
  **Royaume-Uni et Irlande** : il n'existe pas de service libre de cartes marines (les cartes Admiralty du UKHO, également utilisées
  pour l'Irlande, sont payantes et sous licence) ; seuls les fonds OpenSeaMap et EMODnet couvrent ces eaux. Pour ajouter un fond
  (par exemple Admiralty sous licence) : `src/gp39/basemaps.ts` (et son domaine dans la CSP de `index.html`).
- **Cartes marines (dossier local)** — cinquième fond des fenêtres « Position » et « Éditeur de waypoints » : on choisit **un dossier** (sous-dossiers
  compris) et l'application **reconnaît seule le format** de ce qu'il contient, d'après le nom des fichiers : **BSB/KAP** (cartes raster : SHOM, NOAA… ;
  les `.bsb` sont de simples fiches, ignorées) ou **CM93** (cartes vectorielles C-MAP : cellules `<s><lat 3 chiffres><lon 4 chiffres>.<Z|A…G>` et
  dictionnaires `CM93OBJ.DIC` / `CM93ATTR.DIC`, qui doivent se trouver dans le dossier). Un dossier qui mêle les deux formats est accepté. Chrome et
  Edge mémorisent le dossier (une confirmation d'accès est redemandée à chaque session) ; Firefox et Safari le redemandent à chaque fois. **Rien n'est
  copié, envoyé ni versionné** (`*.kap`, `*.bsb` et `CM93*/` sont dans `.gitignore`) : les cartes sont sous licence, lues sur place.
  - **Affichage comme OpenCPN** : à chaque zoom et à chaque endroit, la carte la plus détaillée encore lisible est dessinée d'abord, les moins
    détaillées ne comblant que ce qu'elle ne couvre pas. Si un dossier contient des BSB et du CM93, les BSB passent devant tant qu'une carte BSB est à
    une échelle lisible, sinon le CM93 (qui choisit toujours son échelle d'après le zoom).
  - **Pourquoi ça reste léger** : jamais de carte chargée en entier. Parcours du dossier : seuls les noms de fichiers sont lus (~1 s pour les 24 800
    cellules d'un CM93 complet) ; BSB : l'en-tête de chaque carte (quelques Ko, mis en cache) ; CM93 : les deux dictionnaires (30 Ko). À l'affichage,
    chaque tuile ne lit que ce qu'elle recouvre (BSB : les lignes de raster utiles ; CM93 : les 1 à 4 cellules de l'échelle voulue, plus les échelles
    plus petites tant que la tuile n'est pas entièrement couverte). Le décodage et le dessin se font dans des Web Workers (cœurs − 1, 4 au plus) :
    l'interface ne gèle pas. Les tuiles demandées en dernier passent d'abord, celles qu'on a quittées sont annulées. Zoom 5 à 19 (BSB), 3 à 19 (CM93).
  - **BSB** : au plus 2 pixels de carte par pixel d'écran, au moins 0,5 ; découpage selon le polygone `PLY` de chaque carte (marges, légendes et cartouches
    ne s'affichent pas). Calage : points `REF` ajustés par moindres carrés (Mercator : plan longitude × Mercator(latitude) ; gnomonique et Transverse
    Mercator : plan longitude × latitude, terme bilinéaire), décalage de datum `DTM` appliqué (carte → WGS84, en secondes d'arc : ED50 ≈ −3,6″ en
    latitude et −5″ en longitude à Lorient). Vérifié sur une carte réelle : le feu de Kernevel du balisage SHOM tombe sur le symbole ★ de la carte.
  - **CM93** : échelles Z (1:20 M), A (1:3 M), B (1:1 M), C (1:200 000), D (1:100 000), E (1:50 000), F (1:20 000), G (1:7 500), choisies d'après les
    mètres par pixel avec les seuils d'OpenCPN ; chaque échelle est limitée à la zone que ses cellules couvrent réellement (polygones `_m_sor`, un par
    carte source), les échelles plus petites complétant le reste (« quilt »). Les cellules sont décodées (table de substitution d'octets, coordonnées 16
    bits interpolées entre les bornes Mercator de l'en-tête, rayon CM93 6 378 388 m) puis dessinées avec une **présentation simplifiée** inspirée de la
    carte électronique S-52 : teintes de profondeur (intertidal, < 2 m, < 10 m, < 30 m, au-delà), terre, côte, isobathes, sondes (une par case de 30 px,
    la plus faible), bouées et balises (formes et couleurs `COLOUR`, marques de tête des cardinales), feux (fanion ou arcs de secteur dès le zoom 12,
    caractère « Fl(2)WR.10s14m12M » dès le zoom 13), épaves, roches, obstructions, zones réglementées, noms. Sur écran Retina, tuiles en double
    résolution. Les cellules lues sont gardées en mémoire (32 par Worker, les moins récemment utilisées sont oubliées).
  - **Limites** : les cartes BSB gardent leurs couleurs « jour » ; pas de palettes nuit ; les cartes BSB sans points `REF` exploitables sont ignorées
    (liste dans le panneau). CM93 : le dessin n'est **pas** la présentation S-52 complète d'OpenCPN (pas de profondeur de sécurité réglable, pas de
    motifs de surface, pas de décalages WGS84 par carte source) ; **environ 2,4 % des cellules** de la collection testée (593 sur 24 594, presque toutes à
    l'échelle C) ne passent pas le contrôle d'intégrité (taille du fichier ≠ somme des longueurs de l'en-tête) et sont ignorées, comme le fait OpenCPN :
    l'échelle inférieure s'affiche alors à leur place. Ce ne sont pas des cartes de navigation.
  - **Origine du décodage CM93** : le format n'est pas documenté publiquement. La table de substitution d'octets (`src/gp39/cm93/decode.ts`, 256 octets)
    et la structure des cellules ont été relevées dans la source d'OpenCPN (`cm93.cpp`, licence GPL-2+), qui sert de référence de compatibilité ; le
    code de ce dépôt est une réécriture indépendante en TypeScript. **Avant toute publication**, trancher la question de licence : une table de 256
    octets est une constante fonctionnelle, mais elle vient d'un projet GPL.
- **Éditeur de waypoints** (panneau de commande, bloc « Données », bouton « Éditeur de waypoints… ») : fenêtre à carte (même choix de fond que
  la fenêtre « Position », partagé) qui **modifie directement les waypoints de l'appareil** : ce qu'on crée, édite ou supprime se voit aussitôt sur le plotter.
  - **Calques** : un calque par fichier GPX importé (« Importer des GPX… » ou glisser-déposer sur le panneau ; chargé en fusion, les
    calques existants restent). Œil = afficher/masquer sur la carte de l'éditeur (le plotter de l'appareil n'est pas concerné), loupe = cadrer,
    corbeille = supprimer le calque **et ses waypoints**, clic sur le nom = renommer. « Ignorer les doublons déjà présents » (coché par défaut) n'importe
    pas un waypoint identique (nom, position à 1 m près, symbole, couleur) à un waypoint déjà chargé. Les waypoints créés sur l'appareil (MARK, MOB) et les
    données d'avant les calques sont dans le calque « Appareil ». Les traces `<trk>` ne sont pas lues.
  - **Modes** : _Déplacer_ (clic = sélectionner, Ctrl/Maj + clic = ajouter, **Maj + glisser = rectangle de sélection**), _Sélection_ (glisser = rectangle ;
    Ctrl = ajouter à la sélection) et _Ajouter_ (un clic crée un waypoint dans le calque actif, repéré par le bouton rond de la liste ; il reprend le **dernier symbole et la dernière couleur**
    choisis, qu'on voit sélectionnés dans le formulaire du volet de droite dès la création ; on les change en modifiant ceux du waypoint sélectionné ; rond vert au départ, mémorisés dans le navigateur). Échap quitte le mode puis
    vide la sélection ; Suppr supprime la sélection.
  - **Édition** : un seul waypoint sélectionné → formulaire (nom 8 car., commentaire 13 car., symbole, couleur, latitude/longitude, calque, affichage sur le
    plotter) et repère orange à **glisser** pour le déplacer. Plusieurs sélectionnés → déplacer vers un calque, ou **supprimer** (confirmation).
    Un waypoint non affiché sur le plotter (GP39Flag 0) est pâle sur la carte. La destination en cours ne peut pas être supprimée (règle du GP-39).
  - **Export** : tous les waypoints de tous les calques (et les routes) dans **un seul fichier**, au nom modifiable (`.gpx` ajouté, caractères interdits
    remplacés par `_` ; le GP-39, lui, ne relit que `GP39_WptRte.gpx`). « Seulement les calques affichés » limite l'export aux calques visibles (une route
    n'est alors exportée que si tous ses points y sont). Le Quick Point n'est jamais exporté.
- **Symboles** : le bouton « Légende des symboles… » affiche les règles `GP39Symbol` / `FECColor` appliquées, avec le nombre de
  waypoints de chaque code dans le fichier chargé. Sur la carte de la fenêtre « Position », les waypoints gardent leur pictogramme et
  leur couleur ; survoler un point affiche son nom, son commentaire et ses codes.
- **Données** : chargement d'un GPX (bouton ou glisser-déposer), export `GP39_WptRte.gpx` (le seul nom que le GP-39 sait relire),
  rechargement du jeu de données d'origine. Tout (waypoints, routes, traces, réglages, position) est mémorisé dans le navigateur
  (IndexedDB) et l'application fonctionne hors ligne ; seul le fond de carte de la fenêtre « Position » demande une connexion.

## Ce qui est reproduit

- 7 écrans (DISP) : **Plotter, Highway, Steering, Nav Data, Satellite monitor, User display 1 et 2** (digital 1-4 cases,
  compteur de vitesse, COG), mêmes libellés, unités et plafonds d'affichage que le manuel.
- **Waypoints** (10 000), **routes** (100 × 30), **traces** (3 000 points, 7 couleurs), Goto / Quick Point / route
  avant-arrière, **MOB**, arrivée automatique de route, TTG/ETA, XTE, loxodromie / orthodromie, déclinaison magnétique (WMM).
- **8 alarmes** (arrivée, mouillage, XTE, vitesse, SBAS, heure, trip, odomètre) avec avertisseur sonore et acquittement par touche.
- Arborescence complète des menus (annexe 1 du manuel) : Tracks, Waypoints, Routes, Plotter Setup, Alarms, Messages, Delete,
  GPS Setup, SBAS, I/O Setup (export/import GPX), User Display, Pos/TD Setup, System (Demo, Self Test, Reset…).
- Échelles du plotter : 0,02 / 0,05 / 0,1 / 0,2 / 0,5 / 1 / 2 / 5 / 10 / 20 / 40 / 80 / 160 / 320 NM ; Highway : 0,2 → 16 NM.

### Couleurs et pictogrammes des waypoints

`FECColor` = rang dans la liste _Color_ du GP-39 : 0 rouge `#CA0000`, 1 jaune `#F0E000`, 2 vert `#00B80C`, 3 bleu `#005AE0`,
4 violet `#8B008B`, 5 noir `#00000C`, 6 brun `#C87137` (valeurs relevées dans `symbols.pdf`).
`GP39Symbol` = rang dans la liste _Symbol_ : 0 rond, 1 carré, 2 losange, 3-5 poissons, 6-7 _(provisoires)_, 8 tête de mort,
9 drapeau. La tête de mort et le drapeau reprennent les tracés vectoriels de `symbols.pdf`.

## Limites connues

- Le manuel ne montre que 6 des 10 symboles : les symboles **6 (ancre) et 7 (croix) sont des hypothèses** ; ils n'apparaissent
  pas dans `waypoints_GP39.gpx` (qui n'utilise que 0, 2, 8 et 9).
- Dans `waypoints_GP39.gpx` fourni, **902 des 2252 waypoints n'ont pas de `<name>`** (les feux violets). Ils s'affichent sans
  nom (`--------` dans les listes). Les fichiers `export/balisage_GP39_*.gpx` générés par `export_gp39.py` leur attribuent un nom.
- Réglages mémorisés mais **sans effet** : décalages Lat/Lon, lissages, datum, désactivation de satellites ; hors périmètre :
  mode SCX-21, TDs Loran C / Decca, import GP-32, interface autre qu'anglaise.
- Le format des **routes** dans le GPX exporté (`<rte>`/`<rtept>`) est une convention de l'émulateur : le manuel ne le documente
  pas (seuls les waypoints sont dans le format des fichiers du GP-39).
- Le service worker n'a pu être vérifié que par lecture du fichier généré (le navigateur intégré à l'outil de développement
  refuse l'enregistrement) : à contrôler une fois déployé en HTTPS.

## Structure

```
src/gp39/            domaine pur (testé) : géodésie, GPX, symboles, formats, simulation, persistance
src/gp39/ui/         touches → vues (menus, éditeurs, plotter) ; menus.ts = arborescence du manuel
src/stores/device.ts état de l'appareil (Pinia) : waypoints, routes, traces, navigation, alarmes, boucle 1 Hz
src/gp39/bsb/        cartes BSB : kap.ts (en-tête, RLE, index), georef.ts (calage), tiles.ts (choix des cartes selon le zoom, rendu), catalog.ts, engine.ts + bsbWorker.ts
src/gp39/cm93/       cartes CM93 : decode.ts + cell.ts (cellule), dict.ts + attrs.ts (dictionnaires, attributs), scales.ts + plan.ts (échelles, cellules d'une tuile), prepare.ts + style.ts + draw.ts (dessin), tile.ts (quilt), engine.ts + cm93Worker.ts
src/gp39/library.ts  dossier de cartes : parcours, reconnaissance automatique du format (BSB / CM93) ; tileQueue.ts : file des tuiles ; chartsLayer.ts : couche Leaflet commune
src/gp39/layers.ts   calques et outils de l'éditeur (rattachement, rectangle de sélection, doublons, contenu d'un export) ; gpxFile.ts : nom du fichier exporté
src/components/      façade (GP39Device), LCD 480×272, écrans, fenêtres « Position » et « Éditeur de waypoints », panneau de contrôle
public/data/         waypoints_GP39.gpx (jeu de données chargé au premier lancement)
```

Pour changer le jeu de données livré avec l'application, remplacer `public/data/waypoints_GP39.gpx` puis reconstruire ; dans un
navigateur qui a déjà lancé l'application, utiliser « Recharger waypoints_GP39.gpx » (les données sont mémorisées localement).
