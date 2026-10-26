# Émulateur compatible GP-39 (PWA Vue 3 / Quasar)

Émulateur de l'écran d'un traceur GPS **compatible GP-39** : il affiche un fichier GPX de waypoints (`waypoints_GP39.gpx`, balisage du Shom)
comme le matériel, avec les mêmes couleurs, les mêmes pictogrammes, les mêmes écrans, la même façade à 6 touches + CursorPad
et les mêmes menus. Référence de fonctionnement : le manuel _GP-39 Operator's Manual_ OME-44942-D du constructeur (non redistribué ici).

> Ce n'est pas un instrument de navigation.
>
> « FURUNO » et « GP-39 » sont des marques de Furuno Electric Co., Ltd., citées uniquement pour indiquer la compatibilité. Ce projet n'est
> ni affilié à Furuno ni approuvé par elle.
>
> Logiciel libre sous licence **GNU GPL v3 ou ultérieure** : voir [Licence](#licence).

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

- **Plotter** : le clic place le curseur, le glisser déplace la carte. ENT sur un waypoint ouvre _Goto / Move / Edit / Delete_ ;
  **GO TO avec le curseur** ouvre ce même menu s'il est sur un waypoint (_Goto_ trace alors le trait bleu et passe en distance/cap), et sinon crée un
  _Quick Point_ à l'endroit du curseur (manuel §5.1) — un point **temporaire** : il disparaît de la liste dès qu'il n'est plus la destination (annulation par
  son menu _Cancel Goto_, autre destination, route lancée ; le GP-39, lui, le garde jusqu'au QP suivant) ; sans curseur, GO TO ouvre le menu _Goto_ (QP, listes de waypoints et de routes). MARK enregistre un
  waypoint à la position du bateau, MARK maintenu enregistre un MOB. Le Quick Point n'est jamais refusé, même si la mémoire de waypoints est pleine
  (10 000 : il s'y ajoute, et chaque nouveau remplace le précédent) ; MARK et ENT sur la mer, eux, répondent « WAYPOINT MEMORY FULL » au lieu de ne rien faire.
- **Source de la position** (panneau de commande, bloc « Position », et haut de la fenêtre « Position du bateau… ») : deux modes, au choix,
  mémorisé d'une session à l'autre.
  - **Simulée** (par défaut) : le bateau est placé et déplacé par vos soins. Fenêtre « Position du bateau… » avec carte (fond au choix, voir « Fonds
    de carte » ; zoom molette ou +/−) : le bateau se **déplace en le faisant glisser** (ou par double-clic) ; on peut aussi saisir une position, choisir un
    port, activer un déplacement simulé (vitesse, cap, route circulaire), forcer l'état du fix GPS ou activer le mode Demo (« SIM »). Les satellites de
    l'écran Satellite monitor sont simulés.
  - **GPS de l'appareil** : la position, la vitesse et le cap viennent de la **géolocalisation du navigateur** (puce GPS d'un téléphone ou d'une tablette ;
    sur un ordinateur, le positionnement par Wi-Fi). Le navigateur demande l'autorisation au clic ; elle exige **HTTPS ou `localhost`**. Le bateau ne
    peut plus être placé à la main (champs, ports, glisser et double-clic sont désactivés ; le menu System > Demo > Latitude/Longitude affiche « USING DEVICE
    GPS ») ; la carte montre le disque d'incertitude de la position. Les réglages de simulation (déplacement, état du fix forcé) sont sans effet ; activer le
    mode Demo (menu System > Demo > Mode > On) repasse en simulation. Comme le navigateur ne donne pas de satellites :
    - **état du fix** d'après la précision annoncée : ≤ 50 m → **3D** (si l'altitude est fournie, sinon **2D**), 50 à 500 m → **DOP** (position approximative),
      au-delà de 500 m (position par adresse IP, par exemple) → position ignorée, **pas de fix** ; plus de nouvelle position → pas de fix et vitesse nulle
      (« Signal perdu ») : au bout de 5 s pour un GPS précis (≤ 50 m, une position par seconde), d'**1 min** pour une position approximative (Wi-Fi, adresse
      IP : le navigateur ne la notifie que lorsqu'elle change, ce qui est rare sur un ordinateur de bureau), ou de 3 fois l'intervalle constaté entre les
      positions s'il est plus long (5 min au plus) ; HDOP estimé d'après la précision ; écran Satellite monitor sans satellites (« DEVICE GPS — No satellite data »), altitude fournie
      par l'appareil ou `--` ; tension d'alimentation `--` ;
    - **SOG et COG** : ceux de l'appareil quand il les donne (mesure Doppler) ; sinon calculés d'après les déplacements, sur 4 à 30 s, à condition que
      l'écart dépasse 1,5 fois la précision (un récepteur immobile dont la position « bouge » dans sa marge d'erreur reste à 0 nœud). SOG < 0,2 nœud tenue pour
      nulle ; pas de COG sous 0,5 nœud ; trip et odomètre n'avancent qu'au-dessus de 0,5 nœud ;
    - **trace et route** : une coupure est ouverte à la première position et à chaque saut de plus d'1 NM (veille de l'onglet, perte de signal) ; au premier
      fix qui suit le passage en mode appareil, le tronçon de la route en cours repart de la position réelle (au simple rechargement de la page, il est conservé) ;
    - **carte du plotter** : elle ne revient sur le bateau que s'il **sort de l'écran en avançant** ; une carte qu'on a fait défiler vers une cible de GO TO reste
      où elle est (même si le GPS donne une position chaque seconde ; ENT/CNTR maintenu ramène le bateau au centre) ;
    - **alarmes** : « GPS NO FIX! » quand un fix déjà obtenu est **perdu depuis plus de 45 s** (jamais s'il n'y a pas eu de fix : localisation refusée ou en
      attente d'un clic, page en HTTP, position trop vague d'un ordinateur de bureau… l'état du GPS le dit déjà) ; comme sur le GP-39, la première touche pressée pendant une alarme ne fait que l'acquitter (GO TO, MARK… agissent
      à la pression suivante) ; « NO DIFFERENTIAL SIGNAL! » n'est évaluée que sur les satellites simulés (le navigateur ne dit pas si la position est corrigée par SBAS) ;
    - **au rechargement**, le suivi reprend seul si l'autorisation a déjà été accordée ; sinon l'état « En attente de votre autorisation » propose « Activer
      la localisation » (un geste de l'utilisateur est nécessaire) ; refus, délai dépassé, position indisponible, navigateur sans géolocalisation ou page en
      HTTP sont signalés avec leur remède et « Réessayer » ; l'écran reste allumé pendant le suivi (Screen Wake Lock, là où le navigateur le permet) ; le suivi
      continue quand l'émulateur est « éteint » (BRILL), pour que le fix soit prêt à la remise sous tension.
      Cette fonction ne s'appuie sur aucun service en ligne : la position ne quitte pas l'appareil.
- **Fonds de carte** (fenêtre « Position ») : **OpenSeaMap** (fond OpenStreetMap + marques nautiques ; c'est le fond par défaut, et OpenStreetMap
  seul n'est plus proposé puisqu'il en est le même fond sans les marques : un ancien choix « OpenStreetMap » mémorisé devient OpenSeaMap), **Shom — cartes
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
  les `.bsb` sont de simples fiches, ignorées), **MBTiles** (`.mbtiles` : tuiles raster dans une base SQLite, par exemple les cartes NOAA) ou **CM93** (cartes vectorielles C-MAP : cellules `<s><lat 3 chiffres><lon 4 chiffres>.<Z|A…G>` et
  dictionnaires `CM93OBJ.DIC` / `CM93ATTR.DIC`, qui doivent se trouver dans le dossier). Un dossier qui mêle plusieurs formats est accepté. Chrome et
  Edge mémorisent le dossier (une confirmation d'accès est redemandée à chaque session : tant qu'elle n'est pas donnée — ou si le dossier est illisible —, un
  message sur la carte le dit et propose « Autoriser l'accès » / « Choisir le dossier… » au lieu de laisser la carte vide) ; Firefox et Safari le redemandent à chaque fois. **Rien n'est
  copié, envoyé ni versionné** (`*.kap`, `*.bsb`, `*.mbtiles` et `/CM93*/` sont dans `.gitignore`) : les cartes sont sous licence, lues sur place.
  - **Affichage comme OpenCPN** : à chaque zoom et à chaque endroit, la carte la plus détaillée encore lisible est dessinée d'abord, les moins
    détaillées ne comblant que ce qu'elle ne couvre pas. Si un dossier contient plusieurs formats, chaque source donne à chaque tuile un rang de
    lisibilité et la plus lisible passe devant : une carte BSB à une échelle lisible, ou une tuile MBTiles de son propre niveau de zoom, devant le CM93 ;
    une carte BSB trop détaillée ou agrandie, ou une tuile MBTiles agrandie de 2 niveaux ou plus, derrière le CM93 (qui choisit toujours son échelle d'après
    le zoom).
  - **Pourquoi ça reste léger** : jamais de carte chargée en entier. Parcours du dossier : seuls les noms de fichiers sont lus (~1 s pour les 24 800
    cellules d'un CM93 complet) ; BSB : l'en-tête de chaque carte (quelques Ko, mis en cache) ; CM93 : les deux dictionnaires (30 Ko). À l'affichage,
    chaque tuile ne lit que ce qu'elle recouvre (BSB : les lignes de raster utiles ; CM93 : les 1 à 4 cellules de l'échelle voulue, plus les échelles
    plus petites tant que la tuile n'est pas entièrement couverte). Le décodage et le dessin se font dans des Web Workers (cœurs − 1, 4 au plus) :
    l'interface ne gèle pas. Les tuiles demandées en dernier passent d'abord, celles qu'on a quittées sont annulées. Zoom 5 à 19 (BSB), 3 à 19 (CM93).
  - **BSB** : au plus 2 pixels de carte par pixel d'écran, au moins 0,5 ; découpage selon le polygone `PLY` de chaque carte (marges, légendes et cartouches
    ne s'affichent pas). Calage : points `REF` ajustés par moindres carrés (Mercator : plan longitude × Mercator(latitude) ; gnomonique et Transverse
    Mercator : plan longitude × latitude, terme bilinéaire), décalage de datum `DTM` appliqué (carte → WGS84, en secondes d'arc : ED50 ≈ −3,6″ en
    latitude et −5″ en longitude à Lorient). Vérifié sur une carte réelle : le feu de Kernevel du balisage SHOM tombe sur le symbole ★ de la carte.
  - **MBTiles** : lecteur SQLite minimal maison (`src/gp39/mbtiles/sqlite.ts`, sans sql.js ni dépendance) qui lit le fichier par plages d'octets — jamais
    chargé en entier, des centaines de Mo ou Go restent sur le disque : en-tête, schéma, métadonnées au scan ; à l'affichage 3 ou 4 pages d'index puis la page
    de la tuile (suite de pages de débordement comprise), avec un cache de 8 Mo par fichier. Prend en charge `tiles` en table avec index
    `(zoom_level, tile_column, tile_row)` ou clé primaire, `WITHOUT ROWID`, et l'organisation `map` + `images` (`tiles` en vue : MBUtil, MapTiler) ;
    tuiles PNG, JPEG et WebP (reconnues d'après leurs octets), lignes TMS (ou `scheme=xyz`), tuiles de 256 ou 512 px. Un fichier est choisi pour une
    tuile d'après son emprise (`bounds`) et ses zooms (`minzoom`/`maxzoom`) : tuiles natives d'abord (le fichier au dernier zoom le plus grand en tête),
    puis fichiers à agrandir au-delà de leur dernier zoom ; les trous d'une tuile sont comblés par le fichier suivant. Un fichier n'a de tuiles que là où il y a
    des données (et son `maxzoom` n'est pas toujours atteint partout, comme dans les fichiers NOAA) : quand la tuile du niveau voulu est absente, on utilise celle du
    niveau juste au-dessus, agrandie, puis du suivant… jusqu'à 5 niveaux ou au zoom minimal du fichier, pour que rien ne disparaisse quand on zoome ; une tuile
    présente mais vide, elle, est crue (elle dit qu'il n'y a rien). Décodage des images (`createImageBitmap`) et
    assemblage dans des Web Workers. L'attribution des métadonnées est affichée en texte seul (balises retirées). **Limites** : tuiles vectorielles
    (`pbf`) non prises en charge (fichier ignoré, raison indiquée dans le panneau) ; fichier sans index sur les trois colonnes de clé ignoré (la
    lecture serait trop lente) ; pas de WAL ni de UTFGrid ; une carte NOAA ou autre garde ses couleurs et son rendu : l'émulateur ne les interprète pas.
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
    code de ce dépôt est une réécriture en TypeScript (qui n'est pas pour autant une réécriture « en salle blanche » : la source d'OpenCPN a été lue
    pour la comprendre). Le projet étant sous GPL-3.0-or-later, il est compatible avec la GPL-2.0-or-later d'OpenCPN : voir [Licence](#licence).
- **Éditeur de waypoints** (panneau de commande, bloc « Données », bouton « Éditeur de waypoints… ») : fenêtre à carte (même choix de fond que
  la fenêtre « Position », partagé) qui **modifie directement les waypoints de l'appareil** : ce qu'on crée, édite ou supprime se voit aussitôt sur le plotter.
  - **Calques** : un calque par fichier GPX importé (« Importer des GPX… » ou glisser-déposer sur le panneau ; chargé en fusion, les
    calques existants restent). Œil = afficher/masquer sur la carte de l'éditeur (le plotter de l'appareil n'est pas concerné), loupe = cadrer,
    corbeille = supprimer le calque **et ses waypoints**, clic sur le nom = renommer. « Ignorer les doublons déjà présents » (coché par défaut) n'importe
    pas un waypoint identique (nom, position à 1 m près, symbole, couleur) à un waypoint déjà chargé. Les waypoints créés sur l'appareil (MARK, MOB) et les
    données d'avant les calques sont dans le calque « Appareil ». Les traces `<trk>` ne sont pas lues.
  - **Sélection multiple** : à la souris, _Déplacer_ (clic = sélectionner, Ctrl/Maj + clic = ajouter, **Maj + glisser = rectangle de sélection**) et _Sélection_
    (glisser = rectangle ; Ctrl = ajouter à la sélection). **Sur téléphone ou tablette** (pas de Ctrl ni de Maj) : le mode _Sélection_ trace le rectangle **au doigt**
    (deux doigts déplacent et zooment la carte), et le bouton **Multi** de la barre d'outils fait _ajouter à la sélection_ au lieu de la remplacer, pour les
    touchers (un second toucher retire le waypoint) comme pour les rectangles ; la tolérance de visée d'un toucher est plus large que celle d'une souris. Les
    rectangles utilisent les événements « pointeur » (souris, doigt, stylet), les événements souris n'existent pas pour un glissement au doigt.
  - **Modes** : _Déplacer_, _Sélection_ (ci-dessus) et _Ajouter_ (un clic crée un waypoint dans le calque actif, repéré par le bouton rond de la liste ; il reprend le **dernier symbole et la dernière couleur**
    choisis, qu'on voit sélectionnés dans le formulaire du volet de droite dès la création ; on les change en modifiant ceux du waypoint sélectionné ; rond vert au départ, mémorisés dans le navigateur). Échap quitte le mode puis
    vide la sélection ; Suppr supprime la sélection.
  - **Édition** : un seul waypoint sélectionné → formulaire (nom 8 car., commentaire 13 car., symbole, couleur, latitude/longitude, calque, affichage sur le
    plotter) et repère orange à **glisser** pour le déplacer. Plusieurs sélectionnés → déplacer vers un calque, ou **supprimer** (confirmation).
    Un waypoint non affiché sur le plotter (GP39Flag 0) est pâle sur la carte. La destination en cours ne peut pas être supprimée (règle du GP-39).
  - **Export** : tous les waypoints de tous les calques (et les routes) dans **un seul fichier**, au nom modifiable (`.gpx` ajouté, caractères interdits
    remplacés par `_` ; le GP-39, lui, ne relit que `GP39_WptRte.gpx`). « Seulement les calques affichés » limite l'export aux calques visibles (une route
    n'est alors exportée que si tous ses points y sont). Le Quick Point n'est jamais exporté.
- **Éditeur de routes** (panneau de commande, bloc « Données », bouton « Éditeur de routes… ») : fenêtre à carte qui partage avec l'éditeur de waypoints **le même
  code** : fond de carte (choix mémorisé, cartes marines du dossier de l'utilisateur), couche de waypoints avec leurs pictogrammes GP-39 (`useEditorMap.ts`,
  `useBaseMap.ts`, `BaseMapPicker.vue`), import de GPX (`useGpxImport.ts`), panneau d'export (`GpxExportPanel.vue`), fiche d'un waypoint (`WaypointForm.vue`).
  Une route est une suite de waypoints (30 au plus), 100 routes au plus, nom de 6 caractères et commentaire de 18 caractères dans le jeu de caractères de
  l'appareil (majuscules A-Z, chiffres et `& ( ) + - / = ? > _` ; la saisie est filtrée comme sur le GP-39).
  - **Liste des routes** : nom, commentaire, nombre de points, longueur en NM ; une icône signale les routes à problèmes (waypoint sans nom, disparu…).
    Un clic sur une route (dans la liste ou sur la carte) la montre en trait épais avec ses numéros et ses flèches de sens ; modifier (crayon) ou supprimer
    (corbeille, avec confirmation ; la route qui est la destination en cours ne peut pas l'être). Le bouton **« Créer une nouvelle route »** ouvre l'édition.
    Cette liste se **reconstitue depuis des fichiers GPX importés** (« Importer des GPX… » ou glisser-déposer) : leurs routes sont ajoutées, les points
    rattachés aux waypoints par leur nom (et leur position), nom et commentaire ramenés au jeu de caractères du GP-39 (avec un avertissement).
  - **Édition** (une copie de la route : rien n'est écrit dans l'appareil avant « Enregistrer ») : dans le panneau de droite, le **nom** (6 car.) et le commentaire ;
    **un clic sur un waypoint de la carte** (ou une recherche par nom ou commentaire) le sélectionne et fait apparaître **« Ajouter à la route »**, et
    « Insérer après le point N » quand un point de la liste est choisi. La liste des points se met à jour aussitôt (numéros, longueur de chaque tronçon et
    relèvement, total en NM) ; chaque point se monte, se descend, s'ignore (**skip** : la navigation le saute) ou se retire ; « Inverser » et « Vider ».
    Un balisage et son feu sans nom sont souvent au même endroit : le waypoint **nommé** est choisi d'abord, et les autres s'offrent en « Aussi à cet endroit ».
    Un waypoint sans nom ne peut pas être ajouté : on le **nomme dans la fiche** (le GP-39 relie les routes aux waypoints par leur nom). Refus : 31e point, même
    waypoint voisin, nom de route absent ou déjà pris. **« Enregistrer » est possible à tout moment** (une route de moins de 2 points est signalée comme
    incomplète) et **quitte le mode édition** ; « Annuler » ou la fermeture de la fenêtre demandent confirmation s'il y a des modifications.
  - **Export vers le GP-39** : le même fichier `GP39_WptRte.gpx` que l'éditeur de waypoints (les `<wpt>`, puis les routes ; case « Inclure les routes »), avec
    **le format de route fourni pour l'appareil** :
    ```xml
    <rte>
      <name>RTE001</name>
      <cmt>MON ITINERAIRE</cmt>
      <rtept lat="47.6432100" lon="-2.9123450"><name>WP0001</name></rtept>
      <rtept lat="47.6521000" lon="-2.9245670"><name>WP0002</name></rtept>
    </rte>
    ```
    Chaque `<rtept>` reprend **exactement le nom et les coordonnées d'un `<wpt>` du même fichier**. Nom (6 car.) et commentaire (18 car.) sont nettoyés (jeu de
    caractères de l'appareil), `<cmt>` est toujours écrit (vide au besoin), une route est limitée à 30 points, il n'y a ni `<number>` ni skip : **les points
    « skip » ne sont pas exportés** (le contrôle le signale). Avant l'export, un contrôle signale ce qui empêcherait l'appareil de relire une route (waypoint sans
    nom, disparu, nom porté par plusieurs waypoints, plus de 100 routes…) et demande confirmation.
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
- Le format des **routes** dans le GPX exporté (`<rte>`/`<rtept>`) est celui **fourni par l'utilisateur** pour l'appareil (ni le manuel ni les sources publiques ne le
  documentent) ; il n'a pas été comparé à un fichier écrit par le GP-39 lui-même, ni chargé sur un GP-39 depuis cet émulateur. Les `<wpt>` ont, eux, la structure de
  fichiers réels (`GP39Symbol`, `FECColor`, `GP39Comment`, `GP39Flag`). Le format n'a pas de skip : un point « skip » n'est pas exporté. **Le chargement dans le
  GP-39 efface toutes ses données** : essayer d'abord avec une sauvegarde, ou exporter sans les routes (case « Inclure les routes »). L'import lit aussi le
  commentaire d'une route dans `GP39Comment` ou `<desc>`, et un `GP39Skip` éventuel.
- **GPS de l'appareil** : la position est celle que fournit le navigateur, sans satellites ni DOP réels (HDOP estimé) ; sur un ordinateur sans puce GPS, la
  précision (souvent 20 m à plusieurs km) est celle du positionnement Wi-Fi ou par adresse IP, et les positions de plus de 500 m d'incertitude sont ignorées ;
  les navigateurs suspendent la géolocalisation d'une page en arrière-plan ou d'un écran verrouillé (le suivi reprend au retour, avec une coupure dans la
  trace) ; vérifié avec une fausse API de géolocalisation (tests et navigateur intégré), **pas encore sur un téléphone en mer**. Ce n'est pas un instrument de navigation.
- Le service worker n'a pu être vérifié que par lecture du fichier généré (le navigateur intégré à l'outil de développement
  refuse l'enregistrement) : à contrôler une fois déployé en HTTPS.

## Structure

```
src/gp39/            domaine pur (testé) : géodésie, GPX, symboles, formats, simulation, persistance
src/gp39/ui/         touches → vues (menus, éditeurs, plotter) ; menus.ts = arborescence du manuel
src/stores/device.ts état de l'appareil (Pinia) : waypoints, routes, traces, navigation, alarmes, boucle 1 Hz, source de la position (simulée / GPS de l'appareil)
src/gp39/deviceGps.ts  GPS de l'appareil : position du navigateur → fix, HDOP, SOG/COG (Kinematics), suivi (DeviceGps), détection et autorisation ; screenWake.ts : écran maintenu allumé
src/gp39/bsb/        cartes BSB : kap.ts (en-tête, RLE, index), georef.ts (calage), tiles.ts (choix des cartes selon le zoom, rendu), catalog.ts, engine.ts + bsbWorker.ts
src/gp39/cm93/       cartes CM93 : decode.ts + cell.ts (cellule), dict.ts + attrs.ts (dictionnaires, attributs), scales.ts + plan.ts (échelles, cellules d'une tuile), prepare.ts + style.ts + draw.ts (dessin), tile.ts (quilt), engine.ts + cm93Worker.ts
src/gp39/mbtiles/      cartes MBTiles : sqlite.ts (lecteur SQLite minimal), mbtiles.ts (tables, métadonnées, tuile), plan.ts (fichiers d'une tuile), render.ts, catalog.ts, engine.ts + mbtilesWorker.ts
src/gp39/library.ts  dossier de cartes : parcours, reconnaissance automatique du format (BSB / CM93) ; tileQueue.ts : file des tuiles ; workerPool.ts : pool de Workers ; tileCompose.ts + chartsLayer.ts : superposition des formats, couche Leaflet commune
src/gp39/layers.ts   calques et outils de l'éditeur (rattachement, rectangle de sélection, doublons, contenu d'un export) ; gpxFile.ts : nom du fichier exporté
src/gp39/routes.ts   routes : noms et commentaires du GP-39, points (ajout, ordre, skip), longueurs, contrôles et rapport avant export ; charset.ts : jeux de caractères de l'appareil ; selection.ts : règles de sélection de l'éditeur de waypoints
src/components/      façade (GP39Device), LCD 480×272, écrans, fenêtres « Position », « Éditeur de waypoints » et « Éditeur de routes » (RouteEditorDialog.vue), panneau de contrôle ; useEditorMap / useGpxImport / GpxExportPanel : briques communes aux deux éditeurs
public/data/         waypoints_GP39.gpx (jeu de données chargé au premier lancement ; citation du Shom dans ses métadonnées GPX)
public/legal/        LICENSE et THIRD_PARTY_NOTICES.md servis avec l'application (copies générées par `npm run notices`)
scripts/notices.mjs  génère THIRD_PARTY_NOTICES.md (avis et textes de licence des composants embarqués)
src/gp39/about.ts    identité, licence et crédits (écran « À propos et licences », THIRD_PARTY_NOTICES.md, tests)
LICENSE              GNU General Public License version 3
THIRD_PARTY_NOTICES.md  composants tiers, données, services et textes de licence (fichier généré)
```

Pour changer le jeu de données livré avec l'application, remplacer `public/data/waypoints_GP39.gpx` puis reconstruire ; dans un
navigateur qui a déjà lancé l'application, utiliser « Recharger waypoints_GP39.gpx » (les données sont mémorisées localement).

## Licence

Copyright © 2026 Vincent Aizier.

Ce programme est un logiciel libre : vous pouvez le redistribuer et/ou le modifier selon les termes de la **GNU General Public License**
publiée par la Free Software Foundation, soit la **version 3** de la licence, soit (à votre choix) toute version ultérieure
(`GPL-3.0-or-later`, texte complet dans [`LICENSE`](LICENSE)). Il est distribué dans l'espoir qu'il sera utile, mais **sans aucune garantie**,
pas même celle de sa valeur marchande ni de son adéquation à un usage particulier.

- **Code source** : toute personne qui reçoit l'application (servie sur le web, installée comme PWA) doit pouvoir obtenir le code source
  correspondant ; l'écran « À propos et licences » du panneau de commande renvoie au dépôt. Qui publie une version modifiée doit en faire de même.
- **Composants tiers** : [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md) (copie servie avec l'application dans `legal/`) donne, pour chaque
  composant embarqué (Vue, Quasar, Pinia, Vue Router, Leaflet, geomagnetism, polices Roboto / Roboto Condensed / VT323, icônes Material, workbox…),
  sa version, sa licence et son texte. Tous sont compatibles avec la GPL-3.0-or-later (MIT, BSD, Apache-2.0, SIL OFL). Le fichier est généré :
  après toute mise à jour des dépendances, lancer `npm run notices`.
- **Format CM93** : voir « Origine du décodage CM93 » plus haut. Le projet étant lui-même sous GPL, la réutilisation de la table de substitution
  d'octets relevée dans OpenCPN (GPL-2.0 ou ultérieure, © 2010 David S. Register) ne pose pas de conflit de licence.
- **Marques** : « FURUNO » et « GP-39 » sont des marques de Furuno Electric Co., Ltd. Le nom du dépôt (`emulateur_furuno_gp39`) les cite pour
  la même raison (compatibilité) ; l'application, elle, s'appelle « Émulateur compatible GP-39 » et n'affiche pas le logo du constructeur.
  La façade reproduit la disposition des touches du matériel : à modifier si l'on veut s'en éloigner.
- **Données livrées** — `public/data/waypoints_GP39.gpx` : 2 252 balises extraites du jeu « Balisage maritime (aides à la navigation) » du Shom,
  filtrées et converties au format GPX, symboles et couleurs GP-39 ajoutés. Licence Ouverte Etalab 2.0 ; citation obligatoire :
  **« Shom, 2026. https://dx.doi.org/10.17183/DOI_BALISAGE_MARITIME »**. Ces données ne doivent pas servir à la navigation. La citation figure dans
  les métadonnées du fichier GPX et dans l'écran « À propos et licences ».
- **Fonds de carte en ligne** (chargés par le navigateur de l'utilisateur, jamais copiés ni mis en cache par l'application) : OpenStreetMap (ODbL,
  [politique d'usage des tuiles](https://operations.osmfoundation.org/policies/tiles/) à respecter : usage léger, attribution visible),
  OpenSeaMap (données ODbL, tuiles CC BY-SA 2.0), Géoplateforme de l'IGN ([CGU](https://cartes.gouv.fr/cgu) ; licence propre à chaque jeu de données),
  couches libres du Shom, EMODnet Bathymetry (CC BY 4.0). Chacun affiche sa source en bas à droite de la carte.
- **Cartes de l'utilisateur** (BSB/KAP, CM93, MBTiles) : lues sur place dans le navigateur, jamais envoyées ni versionnées. Leur licence est celle de
  leur éditeur (SHOM, C-MAP, NOAA…) et reste à la charge de l'utilisateur ; l'application ne contient ni ne distribue aucune carte.
