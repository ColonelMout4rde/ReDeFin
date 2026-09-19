/* GridFetchDispatch.js — décision pure « faut-il attendre l'anti-rebond de
 * 80 ms avant fetchFolder(), ou partir tout de suite » (moviepage.qml).
 *
 * Constat (docs/audit-navigation/grilles.md, chronologie « Ouverture d'une
 * bibliothèque ») : ShellPage n'injecte le contexte (folderId, accessToken/
 * userId/serverUrl via `shared`, libraryMode, playbackDeviceMode…) qu'APRÈS
 * la création de la page (Component.onCompleted la trouve vide, voir
 * CLAUDE.md « Navigation performance rules » / PageLoaderSource.js). Chaque
 * propriété injectée redéclenche scheduleFetchFolder(), qui relançait
 * systématiquement les 80 ms d'anti-rebond — mesuré à 190 ms entre GRID1
 * (onCompleted) et GRID2 (départ réel de la requête), pour une seule requête
 * qui aurait pu partir dès que le contexte devient complet.
 *
 * Règle : le tout premier moment où le contexte devient complet (à
 * onCompleted ou à n'importe quelle injection suivante) déclenche un départ
 * immédiat (au tour d'événement suivant, via Qt.callLater côté QML — jamais
 * synchrone, pour laisser les autres propriétés déjà en cours d'injection
 * dans le même appel, comme restoreIndex/restoreY, se poser avant que
 * fetchFolder() les lise). Tant que ce premier départ n'a pas eu lieu,
 * `dispatchPending` évite de reprogrammer plusieurs fois le même
 * Qt.callLater pendant la même rafale d'injections synchrones. Une fois ce
 * premier départ effectué, TOUTE injection ultérieure (ex. playbackDeviceMode
 * résolu après coup, cf. onPlaybackDeviceModeChanged) repasse par l'anti-
 * rebond existant : c'est le seul cas qu'il reste à absorber.
 *
 * Aucune dépendance Qt : testable directement avec Node.
 */
.pragma library

/**
 * state : { contextComplete, firstDispatchDone, dispatchPending } — voir les
 * noms de propriétés correspondants dans moviepage.qml.
 *
 * Renvoie { immediate, arm, dispatchPending } :
 *   - immediate      : true si l'appelant doit déclencher un départ différé
 *                       (Qt.callLater) et ne PAS toucher au minuteur d'anti-
 *                       rebond ;
 *   - arm            : true si l'appelant doit (re)démarrer l'anti-rebond
 *                       existant (80 ms) ;
 *   - dispatchPending : nouvel état à mémoriser pour l'appel suivant.
 */
function nextAction(state) {
    state = state || {};
    var contextComplete = !!state.contextComplete;
    var firstDispatchDone = !!state.firstDispatchDone;
    var dispatchPending = !!state.dispatchPending;

    if (contextComplete && !firstDispatchDone) {
        if (dispatchPending)
            return { immediate: false, arm: false, dispatchPending: true };
        return { immediate: true, arm: false, dispatchPending: true };
    }

    return { immediate: false, arm: true, dispatchPending: dispatchPending };
}
