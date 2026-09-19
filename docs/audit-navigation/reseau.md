# Audit réseau/données de la navigation ReDeFin (lecture seule, branche `dev`)

**Conclusion.** Hors accueil, rien de la navigation n'est servi depuis un cache. Chaque écran refait une requête réseau puis une reconstruction complète, y compris au retour arrière. Le traitement CPU des réponses est secondaire. Les chiffres de micro-mesure viennent de Node sur PC : seuls les ratios sont à retenir. Rien n'a été mesuré sur boîtier.

## 1. Requêtes par écran

| Écran | Requêtes | Défauts |
|---|---|---|
| Accueil (`postergrid.qml:1768`) | `/UserViews`, puis `/UserItems/Resume` et `/Shows/NextUp` (Limit 50, Total=false), puis `/Items/Latest` par bibliothèque (Limit 50, 2 en vol, départ à 110 ms) | Limit 50 pour environ 7 cartes visibles. `/Items/Latest` sans `EnableImageTypes` ni `ImageTypeLimit`. Bon cache par ailleurs. |
| Grille (`moviepage.qml:1083`) | `/Items` paginé par 50 sur Révolution, tri serveur, Total=false, Fields = `PrimaryImageAspectRatio,CustomRating,ParentId`. `/Items/{id}` complet après 500 ms de focus. | Liste légère : rien à redire. Aucun cache, donc refetch à chaque retour. La fiche du focus est environ 26 fois plus lourde qu'un item de liste (synthétique). |
| Fiche film (`detailMoviePage.qml:1360`) | `/Items/{id}?UserId` complet, puis `/Similar` (Limit 20), puis 3 images qui conditionnent l'affichage | Cache évincé avant chaque lecture. Logo demandé en PNG 900×900 pour un cadre d'environ 207×297. |
| Fiche série (`detailSeriePage.qml:1714`) | `/Items/{id}`, `/Shows/{id}/Seasons` (Fields `Overview,ChildCount`), et **tous les épisodes** via `/Shows/{id}/Episodes` par pages de 100, jusqu'à 3000 | La liste complète des épisodes sert uniquement à afficher la durée moyenne. L'`Overview` des saisons n'est jamais lu. |
| Saison (`SeasonUtils.js:985`) | `/Items/{seasonId}` complet, `/Items` épisodes par 50, `/Items/{ep}?UserId` au focus (repos de 240 ms, cache de page de 24 entrées) | `fetchItemPeople` (l. 1198) retélécharge le même item alors que `People` est déjà dans la réponse. Triple tri : serveur, `sortEpisodesInPlace`, puis l. 1030. |
| Personne (`PersonPage.qml:699`) | `/Items/{id}?UserId`, plus 2 appels `/Items?PersonIds` en parallèle (Limit **160**, Total=false) | 160 cartes par requête, c'est beaucoup pour cette machine. |
| Recherche (`SearchPage.qml:685`) | `/Search/Hints`, 2 requêtes dédiées Series/Episode, puis hydratation `/Items?Ids=` | `EnableTotalRecordCount=true` sur les chemins de repli `/Items` (l. 1287). |

Seul `fetchFolderItems` (`jellyfinBridge.js:2076`, collections) n'a pas de `Limit`. `fetchRandomEpisode` (l. 2514) ne passe pas `EnableTotalRecordCount=false`. Aucune requête ne limite les types d'images renvoyés.

## 2. Cache, concurrence, en-têtes

**Cache du bridge** (`jellyfinBridge.js:599-629`)
- Il stocke l'objet déjà parsé, partagé par référence : pas de re-parsing, pas de clone, aucun `JSON.parse(JSON.stringify())`.
- Il est limité à 64 entrées, avec éviction de la plus ancienne.
- La clé combine un epoch et des empreintes de l'origine, de l'utilisateur, du jeton et de l'URL.
- TTL : UserViews 90 s, Latest 120 s, NextUp 15 s, Resume 12 s, fiche user-scoped **2,5 s**.
- Ne sont jamais mis en cache : `/Items?…` (grilles, épisodes, personnes), `/Items/{id}` sans `UserId`, `/Similar` et `/Seasons`.

**Cache de l'accueil.** L'accueil garde en plus un store partagé de 180 s (`postergrid.qml:900`). Il fonctionne bien, mais il reste propre à l'accueil.

**Pas de déduplication hors cache.** La déduplication en vol ne couvre que les GET mémoïsables. Deux `fetchItem` identiques et simultanés partent donc tous les deux.

**Annulation.** Toutes les pages annulent leurs requêtes à la destruction. Une réponse annulée n'est pas parsée (`op.isActive()`, l. 1024).

**Pas de file globale.** Le bridge n'a ni file ni priorité globale : chaque page se limite elle-même.

**Timeouts.** Le délai par requête est de 15 s et le budget d'une opération paginée de 14 s. Un watchdog tourne toutes les 500 ms, seulement tant qu'une opération est en cours.

**Cooldowns.** Ils ne concernent que `/Items/Latest` : 10 min après une erreur 5xx, 60 s après un timeout (l. 659). Ils protègent une bibliothèque cassée et ne touchent qu'une rangée d'accueil. Les 10 min sont peut-être excessives.

**« Bounded JSON parsing ».** C'est un simple test de longueur : au-delà de 256 Ko (l. 37 et 209), la réponse est rejetée en `too_large` après téléchargement complet, puis la taille de page est divisée par deux. Cela protège la RAM et évite un parse bloquant. Avec Limit 50, une page synthétique pèse environ 47 Ko : la protection n'est jamais atteinte en navigation.

**Trafic de fond.** Pas de `validateToken`, de ping ni de requête de session pendant la navigation. Le keep-alive du transport `fbx.web.http` est inconnu.

## 3. Constats classés

### Gain fort

**F1 — Aucun cache de grille ni de fiche ; le retour arrière refait tout.**
- Mécanisme : `ShellPage.qml:2100` n'a qu'un seul `Loader`. `moviepage.qml:729` ne sauvegarde que l'index et la position de défilement, puis `fetchFolder()` relance la requête.
- Correction : conserver la dernière fenêtre de grille dans `shared`, avec `putBoundedMemory` (déjà utilisé), clé `folderId|tri`, 1 à 2 entrées, TTL d'environ 120 s. L'afficher tout de suite, puis revalider en arrière-plan.
- Risque : états vu/non vu périmés. L'invalider au retour du lecteur, comme le fait déjà `evictUserItemApiCache`.
- Mesure : DevLog `NAV1`, délai entre `Component.onCompleted` et le premier `folderLoadState=ready`, avec et sans le cache.
- Confiance : élevée sur le mécanisme, moyenne sur l'ampleur du gain.

**F2 — La fiche série télécharge tous les épisodes pour une durée moyenne.**
- Mécanisme : `detailSeriePage.qml:1722` appelle `jellyfinBridge.js:2932`, à chaque ouverture et à chaque retour. Pour N épisodes, cela fait ⌈N/100⌉ requêtes séquentielles, avec parse et tri sur le thread UI, en concurrence avec les saisons et les images.
- Correction : utiliser le `RunTimeTicks` de la série, ou un échantillon `Limit=20`, ou différer le calcul après la levée du rideau de chargement.
- Risque : faible, la moyenne devient approximative.
- Mesure : journaux Jellyfin, nombre de requêtes `/Shows/*/Episodes` par ouverture. DevLog : durée de la chaîne sur une série de 300 épisodes ou plus.
- Confiance : élevée.

**F3 — Logo demandé en PNG 900×900 alors qu'il conditionne l'affichage.**
- Mécanisme : `detailMoviePage.qml:1158` et `detailSeriePage.qml:1098` demandent environ 19 fois plus de pixels que la zone affichée. `gatePosterReady` attend ce logo (l. 1228).
- Correction : `maxWidth` entre 320 et 420.
- Risque : quasi nul.
- Mesure : DevLog, délai entre l'affectation de `source` et `Image.Ready`.
- Confiance : élevée sur le surdimensionnement, moyenne sur le gain.

### Gain moyen

**M1 — Construction des URL d'image coûteuse.**
- Mécanisme : `itemImageUrl` (l. 2541) coûte environ 80 fois une simple concaténation, à cause de `normalizeServerUrl` et de `stripAuthQueryFromUrl` rappelés à chaque URL. Pour 50 URL, cela représente environ 4 fois le `JSON.parse` de la page de 50 items, et chaque carte construit 2 à 3 URL.
- Correction : mémoïser la base normalisée (dernière entrée et sortie) et retirer le `strip`, puisque l'URL est construite localement sans secret.
- Risque : faible, couvert par les tests existants du bridge.
- Mesure : DevLog protégé par `ENABLED`, temps cumulé par page.
- Confiance : élevée sur le ratio, moyenne sur l'impact sur boîtier.

**M2 — Fiche complète au focus en grille.**
- Mécanisme : `moviepage.qml:1331` récupère `/Items/{id}` avec People, Chapters et MediaSources, pour n'afficher que quelques étiquettes techniques.
- Correction : `/Items?Ids=…&Fields=MediaStreams&EnableImages=false&EnableUserData=false`.
- Risque : faible.
- Mesure : taille de la réponse et durée, côté serveur.
- Confiance : élevée.

**M3 — Reset complet du modèle de grille à chaque page ajoutée.**
- Mécanisme : `model: folderItems` (l. 2424) est un tableau JS, donc chaque page ajoutée réinitialise tout le modèle. Le seuil d'ajout (35) est proche de la taille de page (50), si bien que le reset survient dès la troisième rangée. C'est à la frontière avec l'audit UI.
- Correction : un `ListModel` d'indices alimenté par `append`.
- Risque : moyen, à cause de la restauration du focus.
- Confiance : moyenne. Le devenir des délégués réutilisés lors d'un reset est à mesurer.

**M4 — Cache des fiches inutile.** `detailMoviePage.qml:1357` évince l'entrée avant chaque lecture, et le TTL de 2,5 s fait le reste. Correction : n'évincer qu'au retour du lecteur ou après un changement de favori ou de statut vu, et porter le TTL à 60 s environ. Risque : donnée périmée si un autre client modifie l'item. Confiance : élevée.

**M5 — Latence incompressible à l'ouverture d'une fiche.**
- Mécanisme : 80 ms d'anti-rebond sur la requête, puis 320 ms de `bgUpdateTimer` (`detailMoviePage.qml:2771`) avant même de demander le fond 1280×720 flouté, dont dépend `gateBGReady`.
- Correction : lancer le fond dès la navigation, puisque la carte de grille possède déjà `BackdropImageTags`.
- Risque : faible.
- Confiance : moyenne.

### Gain faible

- **Poster HQ au focus.** La grille redemande un poster de 243 px alors que l'affichage fait environ 185 px (162 × 1,14) et que la version basse qualité fait déjà 194 px. Inutile si la scène est en 1280×720, à confirmer.
- **Même visuel sous plusieurs URL.** Un visuel est demandé sous des URL différentes selon la page : tailles, qualité 82/88/90/92, `format=jpg` absent en grille. Le cache de pixmaps de Qt est donc contourné.
- **Tag d'image absent.** Le `tag` manque à `moviepage.qml:834` et 840. Il faudrait aussi demander `SeriesPrimaryImageTag`.
- **Rangées Latest lointaines.** L'éviction des données de ces rangées (`postergrid.qml:2118`) protège la RAM, mais ne libère qu'environ 50 Ko par rangée au prix d'un refetch.
- **Coût fixe par requête.** L'en-tête d'authentification est reconstruit et `isSensitiveRequestAllowed` est évalué 3 à 4 fois, soit environ 30 µs sur PC. C'est négligeable face à un aller-retour réseau.
- **Personne.** `creditsPageSize` de 160 est élevé.
- **Accueil.** Un Limit de 20 à 24 suffirait au lieu de 50.

## 4. Préchargements bon marché

- Appliquer F1, qui est le plus rentable.
- Précharger la fiche user-scoped du focus en grille à la place de M2, réutilisée ensuite par la fiche grâce à M4.
- Précharger le fond d'écran au focus, à l'URL exacte de la fiche.
- Ne rien précharger de plus. Le lecteur étant exclu du périmètre, l'effet sur la latence des requêtes d'une connexion supplémentaire ou de plusieurs transcodes en parallèle côté serveur n'a pas été évalué.

## 5. Ce que seule une mesure tranchera

- La répartition du temps entre réseau, CPU et rendu. Tracer par navigation : envoi, réponse, fin du parse, levée du rideau. Mesurer sur un paquet installé, car `fbx-run.py` sert aussi les fichiers QML en HTTP et gonfle le temps de chargement des pages.
- Le débit réel de `JSON.parse` sous V4, et si `resp.jsonParse()` du transport fbx est natif.
- Le keep-alive et le nombre de connexions par hôte, et si les images et l'API se partagent le même gestionnaire réseau : un GET de fiche attend-il derrière les posters en cours ?
- Le décodage du WebP par Qt 5.15 sur le Player : inconnu. Tester une URL en `format=webp` et lire `Image.status`.
- L'existence d'un cache disque d'images : inconnue, et elle détermine l'utilité réelle du `tag`.
- Le temps serveur de `/Items/Latest` en Limit=50 et de `/Similar`, à lire dans les journaux Jellyfin.

