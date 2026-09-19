# Audit de performance des grilles et de la recherche (lecture seule, aucune mesure sur boîtier)

## 0. `postergrid.qml` et `moviepage.qml` ne font pas doublon

- **`postergrid.qml`** est le contenu de l'accueil : des rails horizontaux (Mes médias, Reprendre, À suivre, Récemment ajouté) plafonnés à 50 éléments. Il est chargé par `HomePage` et ses cartes sont des `PosterGridCard` (rendu riche).
- **`moviepage.qml`** est l'unique grille de bibliothèque. Elle sert les modes `movies`, `series`, `mixed`, `collections` et `personal`, avec une pagination par fenêtre glissante.
- La grille de bibliothèque n'utilise pas `PosterGridCard` mais **`LibraryPosterCard.qml`** (761 lignes, hors de la liste que tu m'avais donnée), volontairement allégé : « ne pas fusionner les deux arbres visuels ». `PosterGridCard` ne sert qu'à l'accueil et à la recherche.
- Aucun `OpacityMask`, `layer.enabled` ni `DropShadow` dans une vignette de grille : ce point est sain.

## 1. Chronologies

**Ouverture d'une bibliothèque sur Révolution**

1. Le chargeur de page asynchrone compile et instancie `moviepage.qml` avec `LibraryPosterCard`, ClockHUD et QtGraphicalEffects. Durée inconnue, à mesurer.
2. `Component.onCompleted` arme un délai de 80 ms (`fetchDebounceTimer`, l.1348), relancé à chaque injection de contexte.
3. Une seule requête part : `Limit=50` (la taille de page tombe de 220 à 50 sur Révolution, l.73).
   - Paramètres : `EnableTotalRecordCount=false`, tri côté serveur, `Fields=PrimaryImageAspectRatio,CustomRating,ParentId` (bridge l.2196-2206, 2149).
   - Ni `EnableImageTypes` ni `ImageTypeLimit` : tous les `ImageTags`, `BackdropImageTags` et `ImageBlurHashes` reviennent.
   - Estimation non mesurée : 60 à 100 Ko. Le plafond est de 256 Ko (l.37) ; en cas de dépassement, le bridge divise la page par deux et refait la requête.
4. À la réponse, tout est synchrone :
   - `JSON.parse` de la réponse.
   - Filtrage par type.
   - Copie clé par clé des 50 objets (`browserAppendWindowItems`, `MediaCatalog.js:902-906`).
   - `folderItems = …` : les 50 entrées arrivent d'un coup et environ 21 à 28 délégués sont créés, avec autant d'images demandées en `cache:false`.
5. ShellPage garde son rideau au moins 180 ms, puis exige 2 coups de minuterie de 60 ms (ShellPage l.193-194).
6. Traitements différés : fond d'écran à +180 ms (un JPEG 1280×720 flouté), détail de l'élément à +500 ms, affiche haute qualité à +600 ms.

Les délais fixes avant affichage représentent environ 200 à 260 ms, ce qui est raisonnable. Le **retour depuis une fiche** est bien plus lent : voir F1.

**Déplacement de focus**

- La touche change `currentIndex`. Dans le même passage de boucle, de façon synchrone :
  - La liaison `selected` de chaque délégué instancié est réévaluée.
  - Toute la chaîne de l'en-tête est recalculée (l.1812-1852) : `movieStreamInfo`, `movieBrowserTagChips`, le titre en 34 px, le Repeater de puces, les deux compteurs.
  - `ensureVisible` est appelé.
- Animations : zoom en 120 puis 90 ms sur la nouvelle vignette et 130 ms sur l'ancienne, translation en 120 ms, cadre, halo et dégradé en 110 à 120 ms. Cela fait environ 6 animations pendant 210 ms.
- Changement de rangée : glissement de `contentY` en 220 ms (l.2498).
- À l'arrêt : requête de détail à +500 ms, affiche haute qualité à +600 ms, fond d'écran à +750 ms.
- Touche maintenue : aucun filtre sur `isAutoRepeat`. Chaque répétition refait tout ce qui précède et redémarre le glissement.
  - Hypothèse : si un pas coûte plus que l'intervalle de répétition, les appuis s'empilent (Qt ne les jette pas) et la grille continue d'avancer après le relâchement.

**Arrivée d'une page suivante**

- Déclencheur : focus à moins de 35 éléments de la fin (l.95), vérifié 140 ms après stabilisation (l.1173). La page fait 50 éléments et la fenêtre est plafonnée à 200.
- À l'arrivée : parse, copie, `concat`, `splice` éventuel de 50 éléments en tête, puis `folderItems = nouveau tableau` (l.619).

## 2. Constats

### Gain fort

**F1. Rideau noir d'au moins 1,1 s à chaque retour de fiche** — `moviepage.qml:87, 873-914`.
- Mécanisme :
  - ShellPage recrée la page à chaque retour.
  - Les pages de dossier partent en `cacheBypass: true`, donc la requête est refaite.
  - `restoreRevealTimer` exige ensuite l'affiche focalisée prête et 1100 ms de stabilité ininterrompue, avec un garde-fou à 4,8 s.
- Ce que ça protège : les flashs des affiches voisines pendant leur décodage.
- Piste : réduire à 250-300 ms, ou révéler dès que l'affiche courante est prête (le fond `#1f233a` reste visible derrière les voisines).
- Risque : faible, purement esthétique.
- Mesure : `DevLog.log("G1", …)` à `fetchFolder`, à la réponse, dans `_applyRestore` et à la libération du rideau.
- Confiance : élevée sur le mécanisme.

**F2. Chaque page reçue réinitialise tout le modèle** — `moviepage.qml:619, 1101, 2424`.
- Mécanisme :
  - `model: folderItems` est un tableau JavaScript. Le réaffecter détruit et recrée tous les délégués.
  - Avec `imageCache:false` (l.2658), toutes les affiches visibles sont aussi rechargées.
  - `contentY` est remis à zéro, puis replacé par `ensureVisible(immediate)`. L'alignement de la rangée peut changer.
- Fréquence : toutes les 7 rangées environ.
- Aggravant probable : Qt 5.15 convertit en profondeur le tableau en `QVariantList` (jusqu'à 200 DTO complets) à chaque affectation. Confiance moyenne sur ce point.
- Ce que `cache:false` protège : la mémoire vive.
- Piste :
  - Remplacer le modèle par un `ListModel` minimal `{itemId}` avec `append` et `remove(0,50)`.
  - Garder les données dans une table JavaScript indexée par identifiant.
  - Réduire les objets aux champs réellement lus.
- Risque : moyen à élevé (restauration d'index, ajout en tête, contrat `catalog*` de PersonalMediaPage).
- Mesure : `Date.now()` avant l'affectation, puis dans un `Qt.callLater` après.
- Confiance : élevée sur la réinitialisation, moyenne sur l'ampleur estimée (150 à 400 ms).

**F3. Deux mécanismes pilotent `contentY` en même temps** — `moviepage.qml:2410-2431`.
- Mécanisme :
  - La grille ne désactive pas `highlightFollowsCurrentItem`. Par défaut, Qt crée un highlight invisible et suit l'élément courant en 150 ms.
  - `glideY` écrit lui aussi `contentY`, ce qui fait deux écritures par image et autant de `onContentYChanged`.
  - SearchPage (l.2234-2239) et postergrid neutralisent explicitement ce suivi ; moviepage non.
- Piste : `highlightFollowsCurrentItem:false; highlightMoveDuration:0`.
- Risque : faible.
- Mesure : compter les `onContentYChanged` par glissement.
- Confiance : moyenne, à confirmer sur le Player.

### Gain moyen

**F4. `visible: moviepage.indexVisible(index)`** — l.2549, 483.
- Mécanisme :
  - Un appel JavaScript par délégué et par image pendant le glissement, puisque la fonction dépend de `contentY`.
  - Sa marge (au moins 360 px) dépasse le `cacheBuffer` (environ 245 px). Presque tous les délégués instanciés sont donc « visibles » et le garde-fou est redondant.
- Ce que ça protège : le chargement d'images hors champ.
- Piste : remplacer par `true`, ou recalculer une seule fois à l'arrêt.
- Risque : faible.
- Confiance : élevée sur le coût, moyenne sur le gain.

**F5. `cacheBuffer` inférieur à une rangée** — l.2431.
- Mécanisme :
  - Il vaut 0,42 × hauteur, soit environ 245 px pour une cellule d'environ 293 px.
  - La rangée N+2 est donc créée pendant le glissement : 7 délégués et 7 images.
- Ce que ça protège : la mémoire vive et la rafale de création initiale.
- Piste : le porter à une rangée entière (`cellHeight`), ce qui prépare à chaque arrêt la rangée dont le prochain glissement aura besoin, création qui déborde aujourd'hui sur le glissement.
- À trancher par la mesure.
- Confiance : moyenne.

**F6. L'en-tête est recalculé sans délai à chaque pas, puis une seconde fois** — l.1812-1852.
- La requête de détail est `GET /Items/{id}` complet (bridge l.2407) : People, MediaSources, Chapters, soit 15 à 60 Ko parsés sur le thread d'interface 500 ms après chaque arrêt.
- À ce moment, l'affiche haute qualité (600 ms) et le fond d'écran (750 ms) se disputent déjà le seul cœur.
- Piste :
  - Demander `/Items?Ids=…&Fields=MediaStreams,Genres`.
  - Étaler les trois minuteries.
  - En touche maintenue, ne mettre à jour que le titre.
- Risque : faible.
- Confiance : élevée sur le mécanisme.

**F7. Recherche : les sections sont reconstruites entièrement à chaque fragment de résultats** — `SearchPage.qml:344, 2167`.
- Mécanisme :
  - `resultSections = sections` alimente un Repeater par tableau JavaScript.
  - Tous les rails (ListView avec `PosterGridCard` riches) sont recréés, jusqu'à toutes les 125 ms (l.44).
- Piste : ne remplacer que les sections dont la clé ou les éléments ont changé (les clés `key` existent déjà).
- Risque : moyen.
- Points sains :
  - Délai de saisie : 480 ms.
  - Seuil : 2 caractères minimum.
  - Annulation : la frappe suivante annule la requête en cours.
  - Clavier : c'est celui du firmware (`Qt.inputMethod`), sans coût côté application.
- Non audité : le moteur de recherche fait environ 1000 lignes ; je n'ai pas compté le nombre de requêtes lancées par recherche.
- Confiance : élevée sur le mécanisme.

**F8. Charge utile des listes** — bridge l.2196-2206.
- Piste : ajouter `EnableImageTypes=Primary,Thumb,Backdrop&ImageTypeLimit=1`.
- Effet attendu : moins de JSON, moins de conversion, et un éloignement du plafond de 256 Ko.
- Risque : faible (vérifier les repli sur l'image `Thumb`).
- Confiance : élevée. Gain : à mesurer.

### Gain faible

**F9.** Environ 12 des quelque 22 Items de `LibraryPosterCard` sont créés alors qu'ils sont invisibles (l.537-726). Les deux points suivants sont tous deux de confiance moyenne :
- Cas le plus coûteux : le badge « vu » avec ses 3 rectangles tournés en `antialiasing`. Piste : le placer derrière un `Loader` activé à la demande.
- Une `MouseArea` avec survol est créée par délégué, alors que le Player n'a pas de pointeur.

**F10.** `guestpage.qml:1318-1350` : chaque carte d'invité instancie deux ensembles `ShaderEffectSource` + `OpacityMask` + dégradé, inactifs hors focus. Piste : un `Loader` actif sur `marqueeOn`. Confiance moyenne.

**F11.** `SearchPage:1287` utilise `EnableTotalRecordCount=true`, sur le chemin de repli seulement.

**F12.** Tri (SortHudButton) : `setSortMode` relance `fetchFolder`, donc requête et grille complètes derrière le rideau. C'est inévitable avec un tri serveur paginé et c'est correct.

**`serverpage.qml`** : rien de notable.

## 3. Ce que seul le Player peut trancher

- Coût réel d'un pas de focus comparé à l'intervalle de répétition de la télécommande.
  - Journaliser `isAutoRepeat`, l'écart `Date.now()` entre appuis et le nombre d'appuis traités après `Keys.onReleased`.
  - Garder ces traces sous `if (DevLog.ENABLED)`.
- Durée du gel à l'arrivée d'une page (F2) et présence ou non d'un cache HTTP dans le firmware : les affiches sont-elles retéléchargées ?
- Conflit entre highlight et glissement (F3).
  - Mesure possible : une minuterie de 16 ms qui journalise l'écart maximal entre deux déclenchements pendant `glideY.running`.
- Taille réelle du JSON (`responseText.length`) et durée de `JSON.parse`.
- Temps de compilation de `moviepage.qml` : existe-t-il un cache `.qmlc` dans le firmware ?
- Effet du `cacheBuffer` (F5) sur la mémoire vive.

`moviepage.qml` n'importe pas encore `DevLog.js` : il faudra l'ajouter pour poser les traces.

Fichiers :
- `qml/pages/moviepage.qml`
- `qml/pages/LibraryPosterCard.qml`
- `qml/pages/SearchPage.qml`
- `qml/pages/guestpage.qml`
- `qml/js/jellyfinBridge.js`
- `qml/js/MediaCatalog.js`