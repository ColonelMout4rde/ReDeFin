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
