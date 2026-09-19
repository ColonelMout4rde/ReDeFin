/* SeasonRevealPolicy.js — décision pure du « visual reveal » de
 * seasonpage.qml (rideau secondaire tenu au-dessus du contenu déjà chargé,
 * voir loadingLayer/visualRevealPending dans la page).
 *
 * Aucune dépendance à Qt/QML, aucun état global mutable : testable
 * directement avec Node (tests/js/seasonrevealpolicy.test.js). La page ne
 * fait que lire son état (isLoading, postFirstFrame, la rangée d'épisodes,
 * la minuterie de stabilité) et appeler revealReady() ; toute la décision
 * vit ici.
 *
 * Constat (BRIEF-COMMUN.md lot 2, MESURES.md « page saison ») : 1,9 s
 * s'écoulaient entre le Loader Ready et la fin du rideau, uniquement des
 * minuteries en série sans rapport avec un vrai défaut fonctionnel : settle
 * 380 ms, réchauffage d'affiches 340 ms, armement du logo 420 ms, bgDebounce
 * 520 ms, fiche de l'épisode sélectionné (debounce 240 ms), stabilisation
 * 160 ms, plus un plancher minimum de 680 ms appliqué même une fois tout
 * prêt. Or `isLoading` (voir seasonpage.qml) garantit déjà, au moment où il
 * retombe, que la liste d'épisodes est posée ET que l'épisode cible est
 * sélectionné (SeasonUtils.fetchSeasonAndEpisodes affecte ctx.episodes puis
 * ctx.currentIndex dans le même callback réseau, avant que quoi que ce soit
 * ne relise isLoading) ; le focus est placé par _releaseVisualReveal() ->
 * requestApplyFocus() au moment même où le rideau se lève, donc dans le même
 * mécanisme, pas avant.
 *
 * Décision produit : le rideau se lève dès que l'item n'est plus en
 * chargement, qu'une image a déjà été peinte (postFirstFrame) et que la
 * rangée d'épisodes est structurellement prête (chargée, plus en boot).
 * Logo, fond, affiches d'épisodes et fiche détaillée de l'épisode
 * sélectionné arrivent ensuite, sous rideau levé — comme pageCanReveal() /
 * detailCurtainActive() sur les fiches film et série (DetailGatePolicy.js).
 * revealReady() ne prend volontairement PAS l'état de ces éléments en
 * paramètre.
 *
 * LAYOUT_STABILITY_MS remplace la chaîne de minuteries précédente par une
 * seule fenêtre de stabilité de mise en page (le temps qu'un Loader
 * asynchrone republie sa géométrie), plafonnée à 150 ms. Retour arrière en
 * une ligne : remonter cette constante (et/ou la valeur par défaut de
 * seasonpage.visualRevealInitialMinMs qui s'y aligne).
 *
 * Lot 3 (BRIEF-COMMUN.md, MESURES.md « page saison », run 2) :
 * LOADING_OFF_MIN_MS remplace le plancher minLoadingMs (350 ms) et le
 * plancher fixe du Timer loadingOffTimer (140 ms) de seasonpage.qml. Les
 * deux ne protégeaient qu'un anti-clignotement du spinner interne à la page
 * (ShellPage tient déjà son propre rideau, voir CLAUDE.md « Navigation
 * performance rules ») : aucun défaut fonctionnel ne dépend du délai entre
 * l'arrivée des données et la retombée de isLoading. Le rideau visuel réel
 * (visualRevealPending / revealReady() ci-dessus) continue de retenir
 * l'affichage tant que la rangée d'épisodes n'est pas structurellement
 * prête, donc aucun flash ne peut apparaître. Retour arrière en une ligne :
 * remonter cette constante.
 *
 * episodesRowStructurallyReady() rend testable, sans QML, la partie de
 * _visualEpisodesRowSettled() (seasonpage.qml) qui décide si la rangée
 * d'épisodes est prête à être révélée : Loader instancié (Ready), plus en
 * boot, fenêtre de posters calculée (posterGateMax, un index de fenêtre —
 * pas un état de décodage d'image) et délégué de l'épisode courant
 * réellement créé (currentItemReady, SeasonEpisodesRow.qml, nécessaire pour
 * que le focus se pose vraiment dessus à la levée du rideau). Une saison
 * sans épisode est toujours prête.
 */
.pragma library

var LAYOUT_STABILITY_MS = 120; // ancien plancher minimum : 680 ms.
var LOADING_OFF_MIN_MS = 0; // anciens planchers : minLoadingMs 350 ms, loadingOffTimer 140 ms.

function revealReady(state) {
    state = state || {};
    if (state.isLoading) return false;
    if (!state.postFirstFrame) return false;
    if (!state.episodesRowSettled) return false;
    if (!state.layoutStable) return false;
    return true;
}

function episodesRowStructurallyReady(state) {
    state = state || {};
    if (!state.hasEpisodes) return true; // saison sans épisode : rien à attendre.
    if (!state.loaderReady) return false; // rangée pas encore instanciée (Loader).
    if (state.booting) return false; // index/restauration pas encore posés.
    if (state.posterGateMax !== undefined && Number(state.posterGateMax) < 0) return false; // fenêtre pas encore calculée (pas les affiches elles-mêmes).
    if (state.currentItemReady === false) return false; // délégué de l'épisode courant pas encore créé.
    return true;
}
