/* GridRevealPolicy.js — décision pure « quand lever le rideau de restauration
 * de la grille de bibliothèque » (moviepage.qml).
 *
 * Décision produit (voir BRIEF « navigation fluide ») : l'ancien principe
 * upstream (« ne jamais montrer une affiche qui apparaît après coup ») est
 * abandonné. Le rideau ne protège plus que ce qui casserait vraiment
 * l'expérience : un focus non posé ou une grille encore en mouvement. Il ne
 * dépend plus de l'état de décodage de l'affiche focalisée
 * (posterVisualReady) : les affiches peuvent arriver progressivement.
 *
 * En conséquence la fenêtre de stabilité exigée passe de 1100 ms (absorber le
 * flash de décodage des affiches voisines) à SETTLE_MS, une courte marge
 * anti-scintillement pendant qu'un glissement ou un chargement de page
 * s'achève. Le garde-fou de temps maximal (MAX_ATTEMPTS à l'intervalle du
 * Timer appelant) est conservé — même durée totale qu'avant, voir plus bas.
 *
 * Mesure (MESURES.md, « Retour d'une fiche vers la grille ») : la levée
 * réelle arrivait ~250 ms après la restauration (4 passages) alors que
 * SETTLE_MS ne vaut que 150 ms. Écart dû au Timer appelant (moviepage.qml) :
 * il sondait toutes les 60 ms SANS échantillon au démarrage, donc le premier
 * passage qui voit l'état stable arrive déjà 60 ms après la restauration, et
 * il faut ensuite attendre que l'écart cumulé atteigne SETTLE_MS par pas de
 * 60 ms (60→240 ms). POLL_INTERVAL_MS ci-dessous est la période que le Timer
 * appelant doit utiliser, avec un échantillon immédiat au démarrage
 * (triggeredOnStart) : le premier passage capture alors le vrai instant où
 * l'état devient stable (stableSinceMs = l'horodatage réel, pas un multiple
 * de l'intervalle), et 150/POLL_INTERVAL_MS passages suffisent ensuite pour
 * franchir SETTLE_MS — au total SETTLE_MS + POLL_INTERVAL_MS au pire cas
 * (~160-200 ms selon la marge du Player), contre ~250 ms avant.
 *
 * Aucune dépendance Qt : testable directement avec Node.
 */
.pragma library

// Stabilité de mise en page exigée avant de lever le rideau. Ne mesure plus
// que « le focus est posé et la grille ne bouge plus », donc une marge très
// courte suffit ; on ne réhausse cette valeur qu'avec une mesure sur boîtier
// à l'appui.
var SETTLE_MS = 150;

// Période du Timer appelant (moviepage.qml::restoreRevealTimer), à utiliser
// avec triggeredOnStart:true. Divise SETTLE_MS exactement (150/50 = 3) pour
// ne pas ajouter de latence inutile entre deux passages consécutifs.
var POLL_INTERVAL_MS = 50;

// Nombre maximal de passages du Timer appelant avant la levée forcée du
// rideau (garde-fou). Ajusté avec POLL_INTERVAL_MS (60 -> 50 ms) pour
// conserver la même durée totale de garde-fou qu'avant (80 * 60 = 96 * 50 =
// 4800 ms) : la latence normale change, pas la protection contre une grille
// qui ne se stabilise jamais.
var MAX_ATTEMPTS = 96;

/**
 * Un pas de la boucle de révélation.
 *
 * state:
 *   - delegateReady  : le délégué de l'index cible existe et est le courant.
 *   - gridMoving     : la grille est en glissement/défilement/chargement.
 *   - stableSinceMs  : horodatage (ms) depuis lequel l'état est stable en
 *                       continu, ou 0/undefined si aucune série en cours.
 *   - attempts       : nombre de passages déjà effectués (avant celui-ci).
 * nowMs : horodatage courant (ms).
 *
 * Renvoie { release, reason, stableSinceMs, attempts } :
 *   - release  : true si le rideau doit être levé à ce passage ;
 *   - reason   : "settled" | "timeout-guard" | null (non levé) ;
 *   - stableSinceMs / attempts : nouvel état à mémoriser pour le passage
 *     suivant (jamais muté sur l'argument reçu).
 */
function tick(state, nowMs) {
    state = state || {};
    var attempts = (Number(state.attempts) || 0) + 1;
    var stableSinceMs = Number(state.stableSinceMs) || 0;
    var ready = !!state.delegateReady && !state.gridMoving;

    if (ready) {
        if (stableSinceMs <= 0) stableSinceMs = nowMs;
        if ((nowMs - stableSinceMs) >= SETTLE_MS)
            return { release: true, reason: "settled", stableSinceMs: stableSinceMs, attempts: attempts };
    } else {
        stableSinceMs = 0;
    }

    if (attempts >= MAX_ATTEMPTS)
        return { release: true, reason: "timeout-guard", stableSinceMs: stableSinceMs, attempts: attempts };

    return { release: false, reason: null, stableSinceMs: stableSinceMs, attempts: attempts };
}
