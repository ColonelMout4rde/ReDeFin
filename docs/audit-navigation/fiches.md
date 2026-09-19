# Audit de performance des fiches de détail (lecture seule, aucun fichier modifié)

Sur le film et la série, l'essentiel de l'attente vient de minuteries enchaînées en série sur le chemin du rideau de chargement, auxquelles s'ajoutent des requêtes inutiles ou placées trop tard. `seasonpage.qml` est aussi minuté (plancher d'environ 1,1 s au 1er affichage), mais pour stabiliser le rendu : à chronométrer avant d'y toucher. Tout vient de la lecture du code, rien n'a été mesuré sur le Player. Les durées de la forme « R ≈ 150 ms » sont des hypothèses LAN.

## Duplication

- `detailMoviePage.qml` et `detailSeriePage.qml` sont des copies divergentes d'un même squelette : environ 190 identifiants communs sur 400.
- Elles partagent les mêmes gardes et les mêmes valeurs : `minLoadTimer` 220, `gateTimeoutTimer` 1800, `layoutReadyTimer` 320, `extendedLoadingTimeout` 2600, `bgUpdateTimer` 320, `heavyStageTimer` 130, logo demandé en 900 px, affiche HQ à 300 ms.
- `detailCollectionPage.qml` en reprend environ un tiers (timeout étendu à 1900).
- `seasonpage.qml` a une autre architecture (« visual reveal »).
- Un correctif de garde est donc à reporter deux ou trois fois.

## Chronologies

X = compilation et instanciation de la page (~2 900 lignes plus 3 modules JS), non mesurable hors boîtier. R = aller-retour HTTP plus `JSON.parse`. B = backdrop (flou serveur, téléchargement, décodage du 1280×720).

**Fiche film**
- t0 + 80 ms (`fetchDebounce`) : `fetchUserItem`. Le cache est évincé juste avant (`detailMoviePage.qml:1357`), donc la requête part toujours sur le réseau, avec l'item complet.
- Après R1 : le logo/affiche part tout de suite. En parallèle : chargement de `CastPage`, chargement des chapitres suivi d'un second GET de l'item, et 3 portraits de préchauffage.
- +320 ms (`bgUpdateTimer`) : la requête du backdrop part seulement à ce moment. Après B, `hardLoading` tombe si le logo est prêt.
- +130 ms : `SimilarItems` s'instancie. `layoutReadyTimer` ajoute 320 ms avant la fin du rideau côté page.
- `ShellPage.qml:222` ajoute 2 ticks stables de 60 ms (~120–180 ms), puis un fondu de 160–180 ms.
- Le plancher de minuteries pures est d'environ 870 ms hors réseau. Estimation LAN : 1,3 s + X.

**Fiche série**
- `fetchItem` part immédiatement (le debounce est déjà contourné, `detailSeriePage.qml:1780`).
- Après R1 seulement : `fetchSeasons` (`:1730`) et le calcul de durée moyenne, qui pagine tous les épisodes.
- +320 ms + B : `hardLoading` tombe.
- `NextUpBlock` s'instancie, lance sa requête R3, puis souvent R4 (`fetchSeasonItemsFromIndex`).
- Le rideau attend qu'il ait de la hauteur, que `SeasonsBlock` soit peuplé (+130 ms) et les 320 ms de `layoutReadyTimer`.
- Estimation : 1,6 s + X.
- Série entièrement vue (NextUp vide) : `hardLoading` + 2600 ms, soit environ 3,3 s ou plus.

**Ouverture d'une saison**
- Chaque saison ouvre une nouvelle page `seasonpage.qml` ; la fiche série est détruite.
- `fetchItem(saison)` et `fetchEpisodes` partent en parallèle (pages de 50, en série entre elles).
- `minLoadingMs` 350, puis un « visual reveal » avec un minimum de 680 ms.
- Ce reveal attend : `settleTimer` 380, réchauffage des affiches 340, armement du logo 420, `bgDebounce` 520 puis backdrop, et la fiche de l'épisode sélectionné (debounce 240 relancé tant que `layoutSettle` est actif, puis un `fetchUserItem` complet). 160 ms de stabilisation s'ajoutent à la fin.
- Plancher d'environ 1,1–1,3 s plus le réseau. Timeout dur à 3200 ms.

## Constats — gain fort

**F1. NextUp vide retient le rideau 2,6 s** — `detailSeriePage.qml:1042-1046`, `:2693`. Confiance élevée (lecture du code).
- Mécanisme : `gateNextUpReady` n'est libérée que si le bloc a une hauteur > 0, ou sur `onHasContentChanged`. Quand la réponse est vide (série entièrement vue), `hasContent` reste `false`, le signal ne part jamais, et seul le timeout libère.
- Correction : libérer aussi sur `ready === true` de `NextUpBlock`.
- Ce que la garde protège : éviter un saut de mise en page quand la rangée apparaît. Cette protection reste intacte.
- Risque faible.
- Mesure : `DevLog.log("N3", …)` à la libération de la garde, avec la raison.

**F2. Backdrop retardé de 320 ms sur le chemin critique** — `detailMoviePage.qml:2771` et `:1379`, `detailSeriePage.qml:1189`. Confiance élevée.
- Mécanisme : ce debounce protégeait contre des changements d'item en rafale. Or la page est recréée à chaque navigation, et `updateBackdropNow()` déduplique déjà l'URL.
- Correction : appel direct à l'arrivée de l'item, en gardant le timer pour les rafraîchissements.
- Gain : ~300 ms sur chaque ouverture. Risque faible.

**F3. Saisons demandées après l'item alors que seul `itemId` est nécessaire** — `detailSeriePage.qml:1730`. Confiance élevée.
- Correction : lancer `fetchSeasons()` en même temps que `fetchItem`.
- Gain : environ R2 sur le chemin du rideau (`seasonsStrictLoading`).
- En plus, `NextUpBlock.qml:462` refait la requête `/Seasons`. Elle n'est pas mémoïsable, donc pas dédupliquée par le bridge. Lui passer la liste déjà obtenue.
- Risque faible (le garde `seq` existe déjà).

**F4. Tous les épisodes de la série téléchargés pour afficher une « durée moyenne »** — `detailSeriePage.qml:1722`, `jellyfinBridge.js:2932`. Confiance élevée sur le mécanisme ; le gain dépend de la taille de la série.
- Mécanisme : pages de 100, en série, à chaque ouverture et pendant le rideau. `JSON.parse` tourne sur le thread GUI du mono-cœur.
- Correction : utiliser `RunTimeTicks` de la série (le repli existe déjà), ou différer après la levée du rideau, ou mettre en cache par série.
- Risque : durée affichée moins exacte.

**F5. Logo demandé en PNG 900 px, affiché à environ 207×297, sans `sourceSize`, et il retient le rideau** — `detailMoviePage.qml:1158`, `detailSeriePage.qml:1099`. Confiance élevée.
- Mécanisme : `gatePosterReady` attend le logo. Le décodage PNG est lent sur Atom et la texture fait 10× trop de pixels.
- Correction : `maxWidth` ≈ 300 pour la fiche. Le 900 px n'est demandé que par `openPosterOverlay`, qui réutilise la même URL.
- Risque : qualité de l'overlay si les deux URL ne sont pas séparées.

**F6. Le snapshot chaud du film n'est jamais montré** — `detailMoviePage.qml:411`. Confiance élevée sur le mécanisme ; gain fort seulement à la ré-ouverture.
- Mécanisme : `initialAuthoritativeFetchPending` garde le rideau même quand `_useWarmDetailSnapshot()` a tout peuplé. C'est volontaire : les boutons lisent `UserData`, et le commentaire redoute un flash fiche → loader. La série, elle, montre son snapshot.
- Piste : montrer le snapshot avec `actionsArmed` à `false` jusqu'à la lecture autoritaire.
- Risque moyen : bouton « Reprendre » périmé. Le retour depuis le Player force déjà son propre rideau.
- Aucune donnée de la vignette d'origine (titre, affiche) n'est exploitée. Le snapshot ne vient que d'une visite précédente (ShellPage, 10 entrées, 6 h).

## Constats — gain moyen

**M1. Second GET complet de l'item pour les chapitres** — `ChaptersCarousel.qml:87`, via `fetchItemChapters` → `fetchItem` (`jellyfinBridge.js:2433`). Confiance moyenne-haute.
- Mécanisme : la requête part 150 ms après l'arrivée de l'item, pendant le rideau. L'URL n'a pas d'`UserId`, donc elle n'est ni mémoïsée ni dédupliquée. Or `item.Chapters` est déjà présent dans la réponse de la page.
- Correction : passer `chapters` en propriété depuis la page.

**M2. Préchauffage des portraits du casting inopérant (film uniquement)** — `detailMoviePage.qml:105-106`, `:147`. Confiance élevée.
- Mécanisme : le préchauffage demande 322×483 en qualité 82. `CastPage.qml:276-280` demande 226×339 en qualité 85. Les URL diffèrent, donc rien n'est jamais réutilisé. De 3 à 6 téléchargements et décodages sont lancés pendant le rideau.
- Correction : aligner l'URL et le `sourceSize`, ou supprimer le préchauffage.

**M3. Backdrop incohérent et jamais gardé en cache**
- Mécanisme : la fiche série demande `quality=80&format=jpg`, la page saison `quality=70` sans format (`seasonpage.qml:209`, `SeasonUtils.js:100`). La même image est donc retraitée par le serveur et retéléchargée.
- `cache: false` protège la RAM. De toute façon, un 1280×720 (~3,5 Mo) dépasse le cache de pixmaps non référencés de Qt (2 Mo, de mémoire, à vérifier).
- Piste : l'image est floutée à 8, donc demander 640×360 avec `smooth: true` et `cache: true`. Cela fait 4× moins de décodage et de texture, et l'image tiendrait dans le cache pour le retour arrière.
- Confiance moyenne. À valider visuellement.

**M4. Une couche plein écran en trop**
- Mécanisme : fond noir, image à 0,90, puis rectangle noir à 0,40 (`detailMoviePage.qml:1613-1627`). Visuellement, cela équivaut à l'image seule à 0,54.
- Gain : environ 0,9 Mpx de remplissage alpha économisés par image rendue sur le SGX535, pendant tout défilement ou animation.
- Risque nul sur le film. Sur la page saison, la teinte est `#0b0d14` : ajuster le fond.
- Confiance moyenne.

**M5. Passe « HQ » 300 ms après chaque prise de focus**
- Concerne l'affiche, les épisodes (540×360 q90 après 468×312 q85 pour une carte de 360×240), le casting, les similaires et les saisons.
- Mécanisme : second téléchargement et décodage au moment précis où part la requête de détails de l'épisode (debounce 240 ms).
- L'interface fait 1280×720, donc un suréchantillonnage de 1,3 suffit déjà.
- Correction : supprimer la passe HQ et ramener les facteurs vers 1,0–1,15.
- Risque : netteté au zoom de focus.

**M6. Délégués lourds**
- Mécanisme : `CastPage` instancie 2 `OpacityMask` par carte, `SimilarItems` 1, avec masques à dégradé, animations et timers. Tout est créé même quand l'effet est inactif. Le rendu est bien gardé par `maskActive`, c'est l'instanciation qui coûte.
- Piste : envelopper le marquee dans un `Loader` actif seulement si la carte est focalisée et que le texte déborde.
- Confiance moyenne.

## Constats — gain faible

- **Debounce de 80 ms du film** (`detailMoviePage.qml:1495`) : la série l'a déjà contourné, le film non.
- **Marquees du film** (4 `OpacityMask` avec `cached: false`, boucle infinie) : ils tournent même quand l'en-tête est hors écran, car `allowMarquee` ignore `contentY`. Ils sont déjà coupés pendant le flick. Ajouter une condition sur la visibilité.
- **`GlassCircleButton*`** : aucun shader. Dégradés plus un `Canvas` en suréchantillonnage 2× (`GlassCircleButton.qml:410`), 4 à 5 instances par fiche. Le coût est à l'instanciation, il est déjà optimisé : ne pas y toucher.
- **Poll de ShellPage** : 2 ticks stables de 60 ms, soit 120–180 ms à chaque page.

## Focus et touche maintenue

- **Horizontal** : `currentIndex++` sans limitation de débit. `highlightMoveDuration` 170 avec `StrictlyEnforceRange`, `reuseItems` activé. Rien n'est absorbé.
  - Hypothèse : si le thread GUI est saturé, les auto-répétitions s'empilent et le focus dépasse la cible au relâchement.
  - Dans la page saison, chaque pas exécute un gros handler synchrone (`seasonpage.qml:2278-2297`) plus tous les bindings de `selectedEpisode`.
  - La requête de détails est bien debouncée (240 ms) et mise en cache (24 entrées) : bonne protection.
- **Vertical** : `scrollToY` animé de 180 à 520 ms (`detailMoviePage.qml:1676`). Le `Behavior` sur `contentY` est correctement gardé.

## Retour arrière

- Il n'y a qu'un seul `Loader` de page : tout est détruit puis reconstruit.
- Le cache du bridge ne joue presque pas :
  - la fiche a un TTL de 2,5 s et elle est évincée avant lecture ;
  - la série utilise `fetchItem` sans `UserId`, non mémoïsable ;
  - saisons, épisodes et similaires ne sont pas mémoïsés ;
  - seul `NextUp` l'est (15 s).
- Ce qui reste : le snapshot chaud (effectif pour la série, masqué pour le film, voir F6) et le cache d'images QML pour les affiches.

## À trancher sur le Player

- X, le temps de compilation et d'instanciation des pages, avec la 1re ouverture comparée aux suivantes. C'est potentiellement le premier poste.
- R et B réels, et le temps de `JSON.parse` de l'item complet.
- L'existence d'un cache HTTP disque dans le firmware.
- Le remplissage réel du GPU (scène en 720p ou 1080p).
- La cadence d'auto-répétition de la télécommande et le dépassement de cible.
- Le rendu du backdrop en 640×360.

Instrumentation proposée, en `DevLog.log("N1".."N9", Date.now() - t0 + " " + étape)` :
- `Component.onCompleted` ;
- arrivée de l'item ;
- source du backdrop posée, puis backdrop `Ready` ;
- chaque libération de garde, avec sa raison ;
- `visualLoading` à `false` ;
- dans ShellPage, `_pageLoadCurtainHold` à `false` ;
- début et fin du handler `onUserIndexChanged`, sous `if (DevLog.ENABLED)`.