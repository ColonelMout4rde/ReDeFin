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
 * Timer appelant) est conservé à l'identique : c'est lui qui protège contre
 * une grille qui ne se stabilise jamais.
 *
 * Aucune dépendance Qt : testable directement avec Node.
 */
.pragma library

// Stabilité de mise en page exigée avant de lever le rideau. Ne mesure plus
// que « le focus est posé et la grille ne bouge plus », donc une marge très
// courte suffit ; on ne réhausse cette valeur qu'avec une mesure sur boîtier
// à l'appui.
var SETTLE_MS = 150;

// Nombre maximal de passages du Timer appelant avant la levée forcée du
// rideau (garde-fou), inchangé par rapport au comportement précédent.
var MAX_ATTEMPTS = 80;

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
