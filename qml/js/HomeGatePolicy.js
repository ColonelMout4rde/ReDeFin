// qml/js/HomeGatePolicy.js
// Décision pure « le rideau de l'accueil peut-il se lever ? », utilisée par
// HomePage.qml (_canFinishGate). Voir docs/audit-navigation/accueil.md,
// constat 2, et CLAUDE.md, section « Navigation performance rules ».
//
// Décision produit : la porte de l'accueil ne doit plus exiger que TOUTES
// les bibliothèques « Récemment ajouté » aient répondu (latestFetchCompleted)
// avant de révéler la page — seules « Mes médias », « Reprendre » et
// « À suivre » sont bloquantes. Exception : si une restauration de focus en
// attente vise une rangée « Récemment ajouté » (le snapshot de focus a été
// pris sur cette section), le focus qu'on s'apprête à replacer dépend des
// données Latest, donc on continue d'attendre latestFetchCompleted dans ce
// cas précis pour ne pas révéler une rangée vide ni faire sauter le focus
// une fois les données arrivées.
//
// Ce module ne contient AUCUN état global mutable et ne dépend d'aucune API
// Qt / fbx.* : il est testable en Node (tests/js/homegatepolicy.test.js).
// Les effets de bord (préparer le reveal, restaurer le focus, armer des
// timers) restent dans HomePage.qml/postergrid.qml : ce module se contente
// de dire QUELLE condition bloque encore, dans l'ordre où HomePage.qml doit
// les évaluer, avec le même vocabulaire de « cause » que les traces
// « gate blocked cause=… » existantes.

.pragma library

/**
 * @param {object} state
 *   - hasPosterGrid                    {bool} postergrid est chargé.
 *   - fetchedOnce                      {bool}
 *   - libraryFetchCompleted            {bool}
 *   - resumeFetchCompleted             {bool}
 *   - nextUpFetchCompleted             {bool}
 *   - latestFetchCompleted             {bool}
 *   - pendingFocusRestoreTargetsLatest {bool} snapshot de focus en attente
 *                                             dont focusSection vise la
 *                                             rangée « Récemment ajouté ».
 *   - revealReady                      {bool} résultat de
 *                                             postergrid.prepareHomeReveal()
 *                                             (focus placé, pas de
 *                                             restauration en cours).
 *   - waitForHomePosters               {bool} retour externe : on attend en
 *                                             plus les affiches visibles.
 *   - postersReady                     {bool} résultat de
 *                                             _prepareHomePosterReturn().
 *   - sinceLoadingStartMs              {number}
 *   - sinceFetchedOnceMs               {number}
 *   - sinceLastChangeMs                {number}
 *   - minLoadingMs                     {number}
 *   - afterFetchedOnceMinMs            {number}
 *   - settleMs                         {number}
 *
 * @returns {{finish: boolean, cause: string}} cause vaut "" quand finish
 *   est vrai ; sinon elle reprend exactement les noms utilisés par les
 *   traces "HOME1 gate blocked cause=…" historiques.
 */
function canFinish(state) {
    state = state || {};

    if (!state.hasPosterGrid) return { finish: false, cause: "no-postergrid" };
    if (state.fetchedOnce !== true) return { finish: false, cause: "fetchedOnce" };
    if (state.libraryFetchCompleted !== true) return { finish: false, cause: "libraryFetchCompleted" };
    if (state.resumeFetchCompleted !== true) return { finish: false, cause: "resumeFetchCompleted" };
    if (state.nextUpFetchCompleted !== true) return { finish: false, cause: "nextUpFetchCompleted" };

    if (state.pendingFocusRestoreTargetsLatest === true && state.latestFetchCompleted !== true) {
        return { finish: false, cause: "latestFetchCompleted" };
    }

    if (state.revealReady !== true) return { finish: false, cause: "homeRevealReady" };

    if (state.waitForHomePosters === true && state.postersReady !== true) {
        return { finish: false, cause: "waitForHomePosters" };
    }

    var minLoadingMs = state.minLoadingMs || 0;
    var afterFetchedOnceMinMs = state.afterFetchedOnceMinMs || 0;
    var settleMs = state.settleMs || 0;

    if ((state.sinceLoadingStartMs || 0) < minLoadingMs) return { finish: false, cause: "minLoadingMs" };
    if ((state.sinceFetchedOnceMs || 0) < afterFetchedOnceMinMs) return { finish: false, cause: "afterFetchedOnceMinMs" };
    if ((state.sinceLastChangeMs || 0) < settleMs) return { finish: false, cause: "settleMs" };

    return { finish: true, cause: "" };
}
