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
 */
.pragma library

var LAYOUT_STABILITY_MS = 120; // ancien plancher minimum : 680 ms.

function revealReady(state) {
    state = state || {};
    if (state.isLoading) return false;
    if (!state.postFirstFrame) return false;
    if (!state.episodesRowSettled) return false;
    if (!state.layoutStable) return false;
    return true;
}
