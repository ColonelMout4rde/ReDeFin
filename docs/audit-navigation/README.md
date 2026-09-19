# Audit de la navigation (septembre 2026)

Pourquoi la navigation dans les menus était lente sur Freebox Révolution, et ce
qui a été fait. Le lecteur vidéo était hors périmètre. Les messages des commits
« navigation fluide » citent ces rapports par zone et par numéro de constat
(« audit shell F4 », « audit accueil, constat 2 »…).

| Rapport | Périmètre |
| --- | --- |
| [shell.md](shell.md) | `ShellPage` (routeur, rideaux), loader global, `ClockHUD` |
| [accueil.md](accueil.md) | `HomePage`, `postergrid`, `PosterGridCard`, fond d'accueil |
| [grilles.md](grilles.md) | `moviepage` (grille de bibliothèque), `LibraryPosterCard`, recherche |
| [fiches.md](fiches.md) | fiches film / série / collection, page saison, blocs secondaires |
| [reseau.md](reseau.md) | `jellyfinBridge.js`, cache, requêtes par écran, URL d'images |

Les rapports sont un instantané : les numéros de ligne datent du commit
`424eb1e` et tout y vient de la **lecture du code**, rien n'a été mesuré sur un
Player. Les estimations chiffrées sont des hypothèses, certaines ont été
corrigées depuis (le « ×80 » de `itemImageUrl` vaut en réalité ×8 sur la seule
normalisation et ×1,2 sur la fonction entière).

## Diagnostic en trois lignes

1. Un seul `Loader` de page : chaque navigation, retour arrière compris, détruit
   et reconstruit une page de ~2 800 lignes.
2. Hors accueil, presque rien n'est servi depuis un cache.
3. Le rideau attendait que tout soit parfait (images décodées, minuteries de
   stabilisation en série).

**Décision produit** prise à l'issue de l'audit : les pages s'affichent le plus
tôt possible et les images arrivent progressivement. Ne restent derrière le
rideau que les vrais défauts fonctionnels (focus non posé, saut de mise en
page, action sur des données périmées).

## Mesurer sur le boîtier

Chaque zone est instrumentée avec `DevLog` (inerte hors `tools/fbx-run.py`) :

| Tag | Où | Ce qu'il chronomètre |
| --- | --- | --- |
| `NAV1`…`NAV6` | `ShellPage` | demande → `Loading` → `Ready` → page chargée → rideau levé (raison) → focus rendu |
| `HOME1` | `HomePage`, `postergrid` | `fetchedOnce`, chaque `*FetchCompleted`, `homeRevealReady`, levée du rideau, cache frais/périmé |
| `GRID1`…`GRID6` | `moviepage` | création, requête, réponse, modèle affecté, restauration, levée du rideau |
| `FICHE1`…`FICHE7` | fiches film et série | création, item, fond posé/prêt, chaque porte libérée (raison), fin du rideau |
| `NET1` | `jellyfinBridge.js` | par GET : origine (cache / réseau / dé-dupliqué), statut, taille, délai réseau, délai de parse |

```bash
python3 tools/fbx-run.py -t <ip-du-player> 2>&1 | tee build/run-nav.log
grep -E 'NAV[1-6]|HOME1|GRID[1-6]|FICHE[1-7]' build/run-nav.log
```

Sous `fbx-run.py` chaque fichier QML est servi en HTTP : le temps
`NAV2 → NAV3` (chargement du type) y est gonflé par rapport au paquet installé.

## État des constats

Traité (lot 1, correctifs ponctuels, un commit et un test chacun) :

- **shell** : F3 (loader allégé pendant l'incubation), F4 (rideau levé au premier
  tick), F5 (avatar à sa taille d'affichage), F8 (écritures `Settings`).
- **accueil** : constats 1, 2, 4, 5, 6, 7, 9 (partiel), 10, 11.
- **grilles** : F1, F3, F4, F5, F6/M2, F9 (badges), F10, F11. La `MouseArea` de
  survol de F9 s'est révélée utile (elle déplace le focus) : conservée.
- **fiches** : F1, F2, F3, F4, F5, M1, M2, M4, et la révélation sans attendre les
  images (film, série, collection).
- **réseau** : M1, types d'images des listes, `fetchRandomEpisode`, cooldown 5xx.

Restant (changements structurants, à décider avec des mesures en main) :

- shell F1 : query string dans `Loader.source` (cache de types QML) ; hypothèse.
- shell F2 : accueil résident dans un second `Loader`.
- grilles F2 / réseau M3 : `ListModel` incrémental au lieu du tableau JS réaffecté.
- réseau F1 : cache de la dernière fenêtre de grille ; fiches F6 / réseau M4 :
  snapshot et cache des fiches (boutons désarmés jusqu'à la lecture autoritaire).
- accueil constat 3 (cache périmé affiché puis revalidé) et constat 8 (`_navBusy`).
- limiteur d'auto-répétition de la télécommande (toutes les zones).
- page saison (`seasonpage.qml`, plancher ~1,1 s), passes « HQ » des images (M5),
  taille du fond (M3), `OpacityMask` de `CastPage` / `SimilarItems` (M6),
  sections de recherche (grilles F7), `NextUpBlock` qui redemande `/Seasons`.
