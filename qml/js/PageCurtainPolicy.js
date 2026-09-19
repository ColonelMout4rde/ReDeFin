/* PageCurtainPolicy.js — décision pure « quand lever le rideau de page » du
 * shell ReDeFin (ShellPage.qml).
 *
 * Contexte (audit shell, constat F4) : après Loader.Ready, ShellPage attendait
 * systématiquement un plancher de 180 ms puis deux ticks consécutifs (60 ms)
 * où la page ne se déclare plus en chargement (`shellLoading`), avant de
 * lever le rideau global. Ce plancher protège une page qui arme SON PROPRE
 * chargement juste après Ready (fiche, grille, accueil) : sans lui, le rideau
 * pourrait se lever puis retomber aussitôt. Mais une fois qu'une page A
 * RÉELLEMENT déclaré ce contrat (shellLoading est passé à true puis à false),
 * l'attente est inutile : on sait que son chargement est fini, il n'y a plus
 * rien à protéger. Seule une page qui N'A JAMAIS déclaré shellLoading (donc
 * dont on ne sait rien) conserve l'ancien plancher par prudence.
 *
 * Ce module ne connaît ni Qt ni QML : il prend un petit état comparable et un
 * "tick" d'observation, et répond si le rideau doit être levé MAINTENANT et
 * pourquoi (`reason`), pour que ShellPage n'ait qu'à appliquer la décision et
 * que le mécanisme se teste avec Node (tests/js/pagecurtainpolicy.test.js).
 *
 * Aucun état global mutable : createState()/evaluate() sont des fonctions
 * pures, l'appelant conserve et repasse l'état à chaque tick.
 */
.pragma library

var REASON_LOADING = "loading";
var REASON_DECLARED_DONE = "declared-done";
var REASON_HOLD = "hold";
var REASON_STABLE = "stable";
var REASON_STABILIZING = "stabilizing";

var DEFAULT_MIN_HOLD_MS = 180;
var DEFAULT_STABLE_TICKS_REQUIRED = 2;

/* État initial d'une nouvelle séquence de rideau (nouvelle navigation ou
 * nouveau Loader.Ready). À réinitialiser à chaque fois que ShellPage arme un
 * nouveau cycle (_beginPageCurtainTransition côté QML). */
function createState() {
    return {
        sawLoadingTrue: false,
        stableTicks: 0
    };
}

function _int(value, fallback) {
    if (value === undefined || value === null || value === "") return fallback;
    var n = Number(value);
    if (!isFinite(n) || isNaN(n)) return fallback;
    return Math.floor(n);
}

/*
 * evaluate(state, opts) -> { state, release, reason }
 *
 * opts:
 *   - pageLoading           : shellLoading actuel de la page (bool), tel que
 *                              lu par ShellPage._pageReportedLoading.
 *   - elapsedSinceReadyMs   : millisecondes écoulées depuis Loader.Ready pour
 *                              cette séquence (ignoré si la page a déjà
 *                              déclaré puis terminé son chargement).
 *   - minHoldMs             : plancher (défaut 180) pour une page qui n'a
 *                              jamais déclaré shellLoading.
 *   - stableTicksRequired   : nombre de ticks consécutifs "non chargé" requis
 *                              dans ce même cas (défaut 2).
 *
 * Ne mute jamais `state` : renvoie toujours un état neuf.
 */
function evaluate(state, opts) {
    var s = {
        sawLoadingTrue: !!(state && state.sawLoadingTrue),
        stableTicks: _int(state && state.stableTicks, 0)
    };
    var o = opts || {};
    var pageLoading = o.pageLoading === true;

    if (pageLoading) {
        s.sawLoadingTrue = true;
        s.stableTicks = 0;
        return { state: s, release: false, reason: REASON_LOADING };
    }

    // Règle F4 : la page a déclaré vrai PUIS faux -> plus rien à protéger,
    // on lève au premier tick qui l'observe, sans plancher ni stabilité.
    if (s.sawLoadingTrue) {
        return { state: s, release: true, reason: REASON_DECLARED_DONE };
    }

    // Page qui n'a jamais rien déclaré : comportement historique, prudent.
    var minHoldMs = _int(o.minHoldMs, DEFAULT_MIN_HOLD_MS);
    var stableTicksRequired = _int(o.stableTicksRequired, DEFAULT_STABLE_TICKS_REQUIRED);
    var elapsed = _int(o.elapsedSinceReadyMs, 0);

    if (elapsed < minHoldMs) {
        s.stableTicks = 0;
        return { state: s, release: false, reason: REASON_HOLD };
    }

    s.stableTicks = s.stableTicks + 1;
    if (s.stableTicks >= stableTicksRequired) {
        return { state: s, release: true, reason: REASON_STABLE };
    }
    return { state: s, release: false, reason: REASON_STABILIZING };
}
