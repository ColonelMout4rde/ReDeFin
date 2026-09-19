# Audit de performance de l'accueil ReDeFin (lecture seule, aucun fichier modifié)

Rien n'a été exécuté ni mesuré : tous les délais en ms ci-dessous sont lus dans le code. Les rangées de l'accueil vivent dans `qml/pages/postergrid.qml` et `qml/pages/PosterGridCard.qml`, chargés par `HomePage.qml`, et je les ai donc audités. `NextUpBlock.qml` et `LibraryPosterCard.qml` ne servent pas à l'accueil (fiche série, grilles de bibliothèque). Je n'ai fait qu'un survol (recherche de motifs) de `NextUpBlock.qml`, `LibraryPosterCard.qml` et `PersonalMediaPage.qml`, sans constat à en tirer ; `LoginPage.qml` : seul le délégué de profil a été lu (constat 9).

## 1. Chronologies

### Premier chargement de l'accueil

`postergrid.qml:1768-1868` pour les requêtes, `HomePage.qml:564-617` pour la porte qui retient le rideau.

1. `GET /UserViews` part seul (durée r1). Sa réponse passe `fetchedOnce` à vrai.
2. Partent alors en parallèle `Resume`, `NextUp` et la file des `/Items/Latest`. Il y a une requête Latest par bibliothèque, 50 items chacune, 2 en vol au maximum. Chaque lancement attend 110 ms (`latestPumpTimer`, l.1407/1414), soit environ ⌈N/2⌉ × (rL + 110 ms) pour N bibliothèques.
3. Le rideau exige les quatre drapeaux `*FetchCompleted`. Toutes les bibliothèques sont donc attendues, car `_latestStageTarget` vaut le nombre de bibliothèques (l.1491). Le chargement « par proximité » est inactif au démarrage.
4. Après la dernière réponse, une traîne fixe s'ajoute :
   - 450 ms de `settleMs` ;
   - `prepareHomeReveal()` n'est appelé qu'à ce moment, puis 240 ms de `homeRevealSettleMs` ;
   - `onHomeRevealReadyChanged` rappelle `pokeLoadingGate()`, ce qui relance 450 ms ;
   - 180 ms de fondu.
   - Total : environ 1,3 s incompressible.

`minLoadingMs` et `afterFetchedOnceMinMs` (900 ms chacun) sont toujours couverts par cette traîne et ne changent rien. Plancher théorique : r1 + 110 + rL + 1,3 s. Le rideau propre à ShellPage s'y ajoute (hors périmètre).

### Retour à l'accueil depuis une fiche

ShellPage charge les pages via `Loader.source` (l.2099), donc HomePage, postergrid et tous les délégués sont détruits puis recréés à chaque retour.

- **Cache de moins de 180 s** (`homeCacheFreshMs`, l.700) : aucune requête API. Le déroulé est :
  - réinstanciation ;
  - 110 ms de `focusRestoreTimer` ;
  - 240 ms de reveal, en parallèle de 4 × 55 ms de recalage horizontal ;
  - attente que toutes les images visibles soient `Ready`. Le sondage tourne toutes les 45 ms, bloqué les 240 premières ms par `_homeImageReturnFreeze`, puis 90 ms de stabilisation ;
  - 40 ms, puis 180 ms de fondu.
  - Les cartes sont en `cache: false` (`PosterGridCard.qml:48,851`) : 25 à 30 affiches sont re-téléchargées et re-décodées sous le rideau.
  - Plancher : environ 0,7 s + instanciation + images.
- **Cache de plus de 180 s** (donc après tout visionnage) : tout le réseau de l'étape 1 est refait, Latest compris.

### Déplacement de focus

Un appui Droite dans une rangée « Récemment ajouté » :

- `latestIndicesByGroup` (propriété `var`) est copié et réaffecté (l.1264-1266). Le binding `selectedIndex` est alors réévalué sur **toutes** les rangées Latest. `cardSelected` et les bindings d'hydratation le sont sur les 12 à 14 délégués de la rangée active.
- Sur les 2 cartes dont la sélection change, `_syncHomeLoader()` réécrit 17 propriétés puis appelle `_syncStableSource()`. Celui-ci concatène une clé de 13 champs et reconstruit l'URL de l'image, pour constater que rien n'a changé.
- Animations simultanées : zoom 120 + 90 ms (sortie 130 ms), translation 120 ms, cadre 110 ms, voile 120 ms, glissement du rail 180 ms (120 ms natif pour « Mes médias » et « À suivre »).
- Les appuis ne sont ni mis en file ni verrouillés par l'application : chaque appui repart de la position affichée (`_animateRailX`, l.1140). En revanche Qt ne compresse pas les auto-répétitions. Si une image dure plus que la période de répétition, les appuis s'empilent et le focus dépasse la cible.
- Le fond attend 750 ms puis 80 ms avant de se charger (`HomeBackdrop.qml:75,201`). L'affiche HD arrive à 320 ms et le défilement du titre (marquee) à 700 ms.
- Un appui Haut/Bas ajoute une animation de `contentY` de 220 ms et l'animation de la barre du haut (180 et 140 ms).

## 2. Constats classés

### Gain fort

**1. Le Repeater des Latest est entièrement régénéré à chaque réponse.** Confiance : moyenne-haute sur le mécanisme, à chiffrer.
- Mécanisme :
  - `model: latestByFolder.length` (`postergrid.qml:2612`). `_finishLatestRequest` appelle `_rebuildLatestByFolderFromTemp` à chaque bibliothèque reçue (l.1632).
  - Quand la longueur change, `QQuickRepeater::setModel` vide tout et régénère. À ma connaissance, de mémoire des sources Qt, non vérifié.
  - Toutes les sections sont détruites et recréées, y compris les 3 proches de l'écran avec environ 14 cartes chacune. Leurs images en `cache: false` sont annulées puis redemandées.
- Coût estimé pour 6 bibliothèques : environ 210 créations de cartes pour 42 utiles, sur le fil principal d'un CE4100.
- Correction : ne publier `latestByFolder` qu'une seule fois, quand `stageDone` est atteint. Le rideau attend de toute façon. Garder la publication incrémentale après le reveal.
- Risque : faible. Le délai maximal de 12 s publie déjà tout via `forceHomeBootstrapCompletion`.
- Mesure : `DevLog.log("H1", "latest k=… dt=…")` dans `_finishLatestRequest`, plus un compteur dans `onLoaded` des cartes.

**2. Traîne fixe d'environ 1,3 s après la dernière réponse.** Confiance : haute, c'est une lecture directe du code.
- Ce qu'elle protège : ne jamais montrer le focus ou le `contentY` en train de se placer.
- Correction :
  - appeler `prepareHomeReveal()` dès que « Mes médias » est rempli quand il n'y a pas de focus à restaurer ;
  - dans `onHomeRevealReadyChanged`, appeler `tryFinishGate()` au lieu de `pokeLoadingGate()` ;
  - passer `latestStartDelayMs` de 110 à environ 16 ms.
  - Gain visé : 0,7 à 1 s.
- Risque : focus visible trop tôt si une restauration vers une rangée Latest est en attente. Conserver le chemin actuel dans ce cas.
- Mesure : `DevLog.log("H2", …)` à `fetchedOnce`, à chaque `*FetchCompleted`, à `homeRevealReady` et à `_loading=false`.

**3. Retour après lecture : tout est refait, Latest compris.** Confiance : haute.
- Après 180 s, toutes les requêtes repartent alors que seuls `Resume` et `NextUp` ont changé.
- Correction : afficher tout de suite le cache périmé (stale-while-revalidate). Rafraîchir `Resume` et `NextUp` d'abord, puis Latest en arrière-plan. `_setListIfChanged` évite déjà les réaffectations identiques.
- Risque : une carte obsolète reste visible quelques secondes.
- Mesure : durée du rideau en retour avec cache frais puis périmé.

**4. Le rideau de retour attend toutes les affiches visibles, qui sont re-téléchargées.** Confiance : moyenne.
- Ce que ça protège : ne pas voir les affiches apparaître une à une.
- Pistes : borner l'attente à environ 300 ms, ou n'attendre que la rangée focalisée. Le placeholder `#1f233a` et le fondu de 90 ms existent déjà.
- Le passage à `cache: true` rapporte peu. De mémoire, le cache pixmap de Qt 5 garde environ 2 Mo non référencés ; ordre de grandeur non vérifié.
- Mesure : `DevLog.log("H4", "pending=…/total=…")` dans `_probeHomePosterVisualReady`.

### Gain moyen

**5. Marquee avec `OpacityMask`.** Confiance : haute sur la création des objets, moyenne sur l'effet perçu.
- Deux `OpacityMask` sont instanciés dans **chaque** carte (`PosterCardTitleLayer.qml:258,386`). Cela fait environ 20 Items inutiles par carte, plus un ShaderEffect, et alourdit chaque création et chaque retour.
- Après 700 ms de repos, le marquee tourne en boucle infinie avec `cached:false`. La scène 1080p est alors redessinée en continu pendant que l'utilisateur s'apprête à rappuyer.
- Une tuile portrait de 156 px laisse place à environ 13 caractères, donc presque tous les titres défilent.
- Upstream a déjà retiré ce mécanisme ailleurs (commentaire `PersonPage.qml:1987`, pas cadencé à 20 i/s).
- Correction : `Loader { active: maskActive }`, ou un simple clip sans fondu avec un pas cadencé à 20 i/s.
- Risque : esthétique, plus un à-coup au premier démarrage du shader.

**6. Surfaces plein écran translucides.** Confiance : moyenne, à mesurer.
- Le fond est affiché avec `opacity: 0.90`, puis un Rectangle noir à 0.40 le recouvre (`HomeBackdrop.qml:214,246-257`). Cela fait deux mélanges alpha de 2 Mpx par image animée sur un SGX535.
- Équivalent exact : une seule image à une opacité de 0,54 sur le fond noir, et suppression du Rectangle noir.
- Le fond flouté en 1280×720 q80 peut descendre à 960×540 (flouté et assombri), soit 44 % de décodage et de transfert GPU en moins.
- Risque : nul pour la fusion, un très léger flou supplémentaire pour la réduction.
- Mesure : durée d'image pendant un glissement, avec et sans fond (focus sur « Mes médias », où le fond est vide).

**7. Affiches demandées à 1,35 fois la taille, qualité 90, sans `sourceSize`.** Confiance : haute sur le mécanisme.
- Réglage : `posterScale` et `posterQFast` (`postergrid.qml:1047`). Seule la carte focalisée est zoomée (×1,14), et elle reçoit de toute façon la version HD 1,6× q92 après 320 ms.
- Coût : toutes les autres cartes paient 82 % de pixels en trop.
- Correction : échelle 1,0 à 1,14 et qualité 80-85.
- Risque : affiche focalisée plus molle pendant environ 0,4 s.

**8. Les protections « pendant le défilement » sont inertes à la télécommande.** Confiance : moyenne-haute.
- `isScrollingEff` et `_scrollingEff` lisent `moving`, `dragging` et `flicking`. Une écriture de `contentY` par Behavior ne les active pas.
- Conséquence : le « Tweak 10 », l'arrêt du GIF de l'avatar et le report du chargement du fond (`scheduleTimer`) ne se déclenchent jamais au D-Pad.
- Correction : un drapeau `_navBusy`, armé environ 250 ms à chaque appui, qui alimente `allowAnims` et ces protections.
- Risque : moyen, car `allowAnims` pilote aussi le zoom des cartes. À découpler.

### Gain faible

**9. Coûts dispersés sur le chemin d'un appui.**
- `onCardSelectedChanged` passe par `_syncHomeLoader()` complet (`PosterGridCard.qml:156`). Ne recopier que `selected`.
- `saveFocusSnapshot` est appelé deux fois par appui dans « Mes médias » (l.98 et l.2799).
- L'hydratation progressive ne limite plus aucun chargement d'image : `_everSectionActive` ou `nearViewport` est vrai dès que des délégués existent. Elle réévalue pourtant `nearFocusedIndex` sur tous les délégués Latest, 5 fois toutes les 120 ms, après chaque changement de rangée.
- `focusSectionScrollTimer` rejoue `_focusSection` une seconde fois.
- `LoginPage.qml` : chaque avatar porte un `ShaderEffectSource` live et un `OpacityMask` (l.2812-2823). Borné à 6 profils. Confiance : haute, gain faible.

**10. Éviction des données Latest après 4,2 s.**
- Au-delà de 2,2 écrans de distance, les données sont supprimées (l.2116). Cela protège la RAM. La réaffectation de `latestByFolder` qui s'ensuit fait repasser `setModel` sur les rangées actives.
- Conséquence : l'écran affiche « Rechargement… » et une requête repart quand on remonte.
- La protection est probablement surdimensionnée : le gain de RAM vient des délégués et des textures, déjà évincés séparément. Environ 50 Ko de JSON par section ne pèsent pas. À confirmer par une mesure mémoire.

**11. Code mort.** `HomePage.qml:253` contient un `if (alreadyWarm && !shouldAskFetch)` sans corps, qui capture le bloc suivant. `beginStaggeredFetch()` n'est donc jamais appelé depuis HomePage. Le chargement démarre par `ensureBootFetch` de postergrid. Sans effet sur la performance, mais trompeur.

### Bon et à conserver

- `reuseItems` existe bien en Qt 5.15.
- `cacheBuffer` est borné.
- Le flou du fond est calculé côté serveur. Le fond attend 750 ms avant de se charger, utilise deux tampons, avec `smooth:false`.
- Aucun `layer` ni `DropShadow` dans les cartes.
- L'affiche HD passe par un Loader.
- `clip:true` par rangée limite la reconstruction des lots de rendu quand le `z` change.

## 3. À trancher uniquement sur le Player

- Boucle de rendu `basic` ou `threaded`, et durée réelle d'une image pendant un glissement avec fond visible. Cela conditionne les constats 5, 6 et 8.
- Coût unitaire de création d'une `PosterGridCard`. Cela conditionne les constats 1, 4 et 5.
- Latences r1 et rL du serveur, pour savoir si le plancher vient du réseau ou de la traîne (constat 2).
- Période d'auto-répétition de la télécommande, et si la file d'événements s'allonge réellement : tracer `Date.now()` dans `Keys.onPressed` et comparer aux fins d'animation.
- Décodage du fond 1280×720 : provoque-t-il un à-coup vers t+830 ms ?
- Hypothèse Qt 5.15 à vérifier : une propriété `var` réémet son signal même si on lui réaffecte le même objet.

Pour tracer, il faut ajouter `import "../js/DevLog.js" as DevLog` dans postergrid, HomePage et HomeBackdrop, qui ne l'importent pas aujourd'hui, et garder chaque trace de chemin chaud sous `if (DevLog.ENABLED)`.