/* DetailGatePolicy.js — décisions pures des gardes de chargement des fiches
 * de détail (detailMoviePage.qml, detailSeriePage.qml, detailCollectionPage.qml).
 *
 * Aucune dépendance à Qt/QML, aucun état global mutable : testable
 * directement avec Node (tests/js/detailgatepolicy.test.js). Les pages ne
 * font que lire l'état de leurs Loader/blocs et appeler ces fonctions ;
 * toute la logique de décision vit ici.
 */
.pragma library

/* ===== Garde « À suivre » (série) =====
 *
 * Avant ce module, la garde gateNextUpReady n'était libérée que si le rail
 * NextUpBlock avait une hauteur > 0, ou sur le signal onHasContentChanged
 * du bloc. Or NextUpBlock.height reste à 0 quand la requête ne renvoie
 * aucun épisode (série entièrement vue), et hasContent ne change alors
 * jamais de valeur (il vaut déjà false) : onHasContentChanged ne part
 * donc jamais, et seul le timeout de secours (2600 ms) libérait la garde.
 *
 * nextUpGateReleased() corrige cela : une requête terminée sans contenu
 * (blockReady === true, hasContent === false) libère la garde
 * immédiatement, sans attendre une hauteur ou un changement qui ne
 * viendra pas.
 *
 * @param {object} state
 * @param {string} state.loaderStatus "ready" | "error" | tout autre (loading/null)
 * @param {boolean} state.blockReady NextUpBlock.ready : la requête (avec ou
 *        sans contenu) est terminée.
 * @param {boolean} state.hasContent NextUpBlock.hasContent.
 * @param {number} state.height Hauteur actuelle publiée par le Loader.
 * @returns {boolean} true si la garde peut être levée.
 */
function nextUpGateReleased(state) {
    state = state || {};
    // Le Loader a échoué à charger le composant : ne jamais bloquer la
    // fiche pour un rail qui ne verra jamais le jour.
    if (state.loaderStatus === "error") return true;
    if (state.loaderStatus !== "ready") return false;
    if (!state.blockReady) return false;
    // Requête terminée sans contenu : rien à attendre de plus, la rangée
    // restera de hauteur nulle (NextUpBlock.implicitHeight suit hasContent).
    if (!state.hasContent) return true;
    return (state.height | 0) > 0;
}

/* ===== Décision produit : le rideau n'attend plus les images =====
 *
 * (audit-fiches.md, point 5) L'ancien principe upstream retenait le rideau
 * « dur » (hardLoading côté film/série) jusqu'à ce que le poster/logo ET le
 * backdrop soient chacun Ready ou Error. Un placeholder de couleur et un
 * fondu existent déjà sur ces images : les faire arriver après le reste de
 * la fiche n'est plus un défaut, c'est le nouveau principe produit.
 *
 * pageCanReveal() ne retient donc plus que le réseau (l'item lui-même) et
 * un plancher de temps anti-clignotement, jamais l'état d'une image.
 *
 * @param {object} state
 * @param {boolean} state.fetchInFlight requête réseau de l'item en cours,
 *        sans snapshot chaud affichable pendant ce temps.
 * @param {boolean} state.itemReady l'item est arrivé (callback fetch, ou
 *        snapshot chaud appliqué).
 * @param {boolean} state.minDelayReady le plancher de temps minimal
 *        anti-clignotement est passé (peut être toujours true si la page
 *        n'en a pas/plus).
 * @returns {boolean} true si le rideau dur peut se lever.
 */
function pageCanReveal(state) {
    state = state || {};
    if (state.fetchInFlight) return false;
    if (!state.itemReady) return false;
    if (!state.minDelayReady) return false;
    return true;
}
