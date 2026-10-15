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
- **Position du bateau** (bouton « Position du bateau… ») : fenêtre avec carte OpenStreetMap (zoom molette ou +/−). Le bateau se
  **déplace en le faisant glisser** ; on peut aussi saisir une position, choisir un port, activer un déplacement simulé
  (vitesse, cap, route circulaire), forcer l'état du fix GPS ou activer le mode Demo (« SIM »).
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
src/components/      façade (GP39Device), LCD 480×272, écrans, fenêtre « Position », panneau de contrôle
public/data/         waypoints_GP39.gpx (jeu de données chargé au premier lancement)
```

Pour changer le jeu de données livré avec l'application, remplacer `public/data/waypoints_GP39.gpx` puis reconstruire ; dans un
navigateur qui a déjà lancé l'application, utiliser « Recharger waypoints_GP39.gpx » (les données sont mémorisées localement).
