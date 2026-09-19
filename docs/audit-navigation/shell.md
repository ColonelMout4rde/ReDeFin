# Audit de performance — shell et routage (lecture seule, aucun fichier modifié)

La lenteur vient surtout de la reconstruction complète de la page à chaque navigation, retour arrière compris, derrière un rideau noir qui ne se lève qu'une fois tout chargé. Trois causes côté shell pèsent probablement le plus : F1, F2 et F3. F1 et F3 sont des hypothèses à mesurer sur le Player. Aucun timer permanent ne pose problème.

## Chronologie : Accueil → fiche film → retour

Les X sont des durées que la lecture ne donne pas.

1. **t0, touche OK.** `handleNavigation` → `_navigateTo` (ShellPage.qml:1659) arme le rideau (`_prepareDetailCurtainBeforeNavigation`, :1706) puis change `currentPage`. Le Loader détruit la page d'accueil. **X1** = démontage de HomePage et de la grille sur le thread UI, avant la première image du rideau.
2. **Chargement du type QML, X2.** La source du Loader est `detailMoviePage.qml?ctx=1&itemId=…` (:2102). Voir F1.
3. **Incubation asynchrone, X3.** Elle se fait pendant que CircleDots s'anime (F3).
4. **`Loader.Ready`.** `_onPageLoaded` injecte les propriétés (léger). La page enchaîne ensuite ses propres attentes, hors de mon périmètre et lues rapidement :
   - `fetchDebounce` 80 ms, puis la requête ;
   - `minLoadTimer` 220 ms en parallèle ;
   - affiche et fond d'écran (`bgUpdateTimer` 320 ms avant même de demander le fond) ;
   - `layoutReadyTimer` 320 ms, armé seulement une fois ces étapes finies ;
   - les Loaders casting et similaires.
5. **`shellLoading` repasse à false.** Le timer du shell tourne à 60 ms et exige 2 ticks stables, soit **+60 à 120 ms**. Le plancher absolu est de **240 à 300 ms après Ready** (maintien de 180 ms + 2 ticks ; :193-194, :222-258).
6. **Le rideau tombe.** Le focus est rendu via `Qt.callLater` (:279), soit un tour de boucle.

Attentes incompressibles après Ready pour une fiche film : environ **0,5 à 0,8 s de timers purs**, à ajouter à X1, X2, X3, au réseau et aux images.

Pour le retour vers l'accueil, le rideau est armé quand le Loader passe en Loading, puis le chemin est identique : démontage, chargement du type, incubation complète. Le chemin `fastHomeReturn` stabilise en 40 ms au lieu de 900 + 450 ms. S'y ajoutent les 60 à 120 ms du shell. Le cache API du bridge évite une partie des requêtes.

## Constats à gain fort

### F1 — La query string fait partie de la source du Loader (hypothèse, confiance moyenne)

- **Où :** ShellPage.qml:2102, et :1014 pour `startIndex`.
- **Mécanisme :** dans Qt 5.15, le cache de types de `QQmlTypeLoader` est indexé par l'URL complète, query comprise.
  - Chaque `itemId` nouveau serait donc un échec de cache, avec une nouvelle analyse et compilation d'un fichier d'environ 2 900 lignes.
  - Chaque retour sur la grille des films avec un `startIndex` différent aurait le même effet.
- **Ce qui est sûr :** les paramètres sont de toute façon réinjectés en propriétés par `_loadedPageParams` (:1848). La query ne sert donc à rien pour le Loader.
- **Ce qui ne l'est pas :** le coût réel dépend de la présence d'un cache disque `.qmlc` sur le Player. Sous `fbx-run.py`, le fichier servi en HTTP est de plus retéléchargé à chaque fois.
- **Correction :** `setSource(_baseOf(currentPage), props)`. Cela fournit aussi les propriétés dès la construction, au lieu de les poser après coup.
- **Risque :** deux URL de même base ne déclencheraient plus de rechargement. Il faut un rechargement explicite, en généralisant le chemin `sameBase` (:1720) et `goBackOrHome`. Les pages qui supposent des propriétés vides à `onCompleted` sont aussi à vérifier.
- **Mesure :**
  - `DevLog` aux statuts Loading et Ready ;
  - comparer film A (1er passage), film A de nouveau, puis film B : si B ≈ premier A ≫ second A, c'est confirmé ;
  - compter les `GET detailMoviePage.qml` dans la console de `fbx-run`.

### F2 — Aucune page n'est conservée (fait, confiance haute)

- **Où :** un Loader unique, ShellPage.qml:2099-2121.
- **Mécanisme :** le retour arrière reconstruit toute la page. Seul l'état est restauré : `focusMemory`/`startIndex` (:982-1016), l'API de focus des fiches (:646-730), les instantanés de fiche (:1228-1304) et `fastHomeReturn`. L'accueil est le carrefour de toutes les navigations.
- **Correction :** garder HomePage résidente dans un second Loader (`visible:false`, `enabled:false`).
  - `postergrid` a déjà `suspendVisualTextures` (postergrid.qml:673) et un `pageActive` lié à `visible`.
  - Coût mémoire : l'arbre d'objets et le tas JS. Les textures seraient libérées puis rechargées.
- **Risques :**
  - lignes « Reprendre » et « À suivre » périmées après lecture, donc rafraîchissement ciblé à prévoir ;
  - destruction obligatoire au changement de profil ;
  - timers cachés de la page ;
  - pression mémoire : décharger quand `playerActive`, comme aujourd'hui.
- **Mesure :** délai entre la touche Back et la tombée du rideau, avant et après.

### F3 — L'animation CircleDots tourne pendant l'incubation (hypothèse, confiance moyenne)

- **Où :** CircleDotsLoader.qml:36-41 et :105 ; ShellPage.qml:2161-2173.
- **Mécanisme :** un pas toutes les 64 ms et douze `Behavior` de 140 ms.
  - Une animation est donc toujours en cours, et le rendu est continu.
  - Avec la boucle de rendu threadée, Qt 5.15 limite alors l'incubation à environ un tiers de trame par trame, contre des tranches de 10 ms sans animation.
  - Sur un seul cœur, la page peut se construire 2 à 4 fois plus lentement.
- **Correction :** une propriété qui désactive le `Behavior` pour le rideau global, avec des pas secs de 100 à 120 ms.
- **Risque :** esthétique seulement.
- **Mesure :** test A/B avec `globalPageDots.running:false`, en relevant la durée Loading → Ready.

## Constats à gain moyen

### F4 — Le plancher de levée du rideau est sur-dimensionné (délai volontaire)

- **Où :** ShellPage.qml:186-194.
- **Ce qu'il protège :** une page qui arme son chargement juste après Ready, d'où un enchaînement page → loader visible. C'est inutile pour les pages dont `shellLoading` vaut vrai dès la construction (fiches, grille des films, accueil).
- **Correction :** si `shellLoading` a été vu à vrai, lever le rideau au premier faux plus un tick. Garder 180 ms pour les pages sans ce contrat.
- **Gain :** 60 à 240 ms par navigation.
- **Risque :** clignotement si une page réarme une attente, par exemple `detailReturnRefreshGate`.
- **Mesure :** tracer N4 (chargement fini) et N5 (rideau levé).
- **Confiance :** haute.

### F5 — L'avatar du ClockHUD est rechargé à chaque page (coût accidentel, confiance moyenne)

- **Où :** ClockHUD.qml:220 et :685-702 ; UserStore.js:911.
- **Mécanisme :** `/UserImage` est demandé sans redimensionnement (le code parle lui-même d'environ 2 Mo), via `AnimatedImage`, à chaque création de page : accueil, grille des films, fiches, PersonPage.
  - Le décodage `QMovie` se fait sur le thread UI, au moment où la page doit apparaître.
  - Pendant l'animation, `layer` + `OpacityMask` ne sont pas mis en cache (:627-634). Cela donne un envoi de texture et un passage FBO permanents, qui entretiennent le rendu continu et dégradent le déplacement du focus.
- **Correction :** déterminer une fois par session si l'avatar est animé ou statique, et mémoriser le résultat dans `shared`. S'il est statique, utiliser `Image` en 70 px avec le cache pixmap.
  - Variante : n'animer que lorsque l'avatar a le focus (`avatarAnimateAlways:false`).
- **Risque :** le bouclage des GIF sur Freebox a un historique fragile. Ne pas toucher à la voie GIF elle-même.
- **Mesure :** profil sans avatar contre profil avec GIF : latence du focus et délai Ready → révélation.

### F6 — Les attentes internes aux pages (hors périmètre, à transmettre à l'auditeur des pages)

- **detailMoviePage :** timers de 80, 220, 320 et 320 ms en cascade (:587-595, :1305, :2771).
- **HomePage, première entrée :** 900 + 450 ms (:306-308).
- Le rideau du shell attend que tout soit parfait. La latence perçue est donc la somme de tout ; une révélation progressive serait à envisager.

## Constats à gain faible

- **F7 — Touches pendant le rideau** (:2201-2207). Tout est absorbé sauf Back, qui annule et revient. C'est volontaire : la page n'a pas encore de focus. Rien n'est mis en file. Raccourcir le rideau est le vrai remède.
- **F8 — Écritures de Settings à chaque chargement de l'accueil** (ShellPage.qml:2041-2047 ; main.qml:130-137). Trois écritures sans comparaison préalable, alors que les booléens sont gardés. Le code note lui-même que la Freebox réémet le signal même à valeur identique, d'où un risque d'E/S synchrone. Correction : `if (settings.x !== v)`. Risque nul ; coût réel inconnu.
- **F9 — Démarrage.** Deux timers de 2000 ms redondants (ShellPage.qml:2593 ; SplashPage.qml:117 et :180), soit 2 s fixes, au démarrage uniquement.
- **F10 — Ouverture du lecteur.** Elle détruit la page (`source:""`, :2102), donc le retour reconstruit tout. C'est volontaire, pour libérer la mémoire au profit d'IntelCE : ne pas y toucher.
- **F11 — OverlayHub.** Ses 1 258 lignes sont réinstanciées à chaque ouverture (Loader asynchrone des fiches), avec un armement en trois temps (timer 0, puis deux `callLater`). Le panneau de réglages a une animation de 220 ms. Acceptable.

## Timers permanents : rien d'anormal

- `httpWatchdog` (500 ms) ne tourne que pendant les requêtes (:393).
- L'horloge ne se réveille qu'une fois par minute.
- `loopWatchdog` (520 ms) ne tourne que si un GIF est animé.
- Les temporisations de HomeBackdrop (750/180 + 80 ms) évitent des téléchargements pendant le déplacement du focus et sont hors du chemin critique.
- TopBar n'est utilisé que par le lecteur.
- Travail synchrone du shell pendant la transition : extraction de paramètres, clone superficiel de l'instantané, trois `shortHash`. Négligeable.

## Ce qui demande une mesure sur le Player

- Le type de boucle de rendu (threadée ou non), qui conditionne F3.
- L'existence d'un cache `.qmlc` inscriptible, qui conditionne F1.
- Les durées X1 (démontage), X2 (compilation) et X3 (incubation), et le nombre d'images par seconde réel sous le rideau.
- La mémoire disponible pour garder l'accueil résident.

Instrumentation proposée : importer `DevLog` dans ShellPage et tracer N1 (demande de navigation), N2 (Loading), N3 (Ready), N4 (`_pageReportedLoading` à faux), N5 (rideau levé), N6 (focus rendu), chacun avec `Date.now()`.

Fichiers lus :
- `main.qml`
- `qml/pages/ShellPage.qml`
- `qml/pages/HomeBackdrop.qml`
- `qml/pages/SplashPage.qml`
- `qml/pages/TopBar.qml`
- `qml/pages/OverlayHub.qml`
- `qml/components/CircleDotsLoader.qml`
- `qml/components/ClockHUD.qml`
- `qml/components/AppSettings.qml`
- `qml/components/SettingsSidePanel.qml`
- extraits de `qml/pages/detailMoviePage.qml`, de `qml/pages/HomePage.qml` et de `qml/pages/postergrid.qml`