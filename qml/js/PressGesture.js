// qml/js/PressGesture.js
// Décision pure du geste « appui / relâchement de OK » utilisé par les
// tuiles de profil (LoginPage) et les lignes de serveurs mémorisés
// (ServerOverlay).
//
// Ce module ne contient AUCUN état global mutable et ne dépend d'aucune API
// Qt / fbx.* : il est donc testable en Node (tests/js/pressgesture.test.js)
// et rejouable à l'identique quel que soit l'appelant.
//
// Règle du geste :
//   - un appui long confirmé (anneau de progression arrivé au bout, ou appui
//     maintenu au-delà du garde-fou) demande la SUPPRESSION ;
//   - tout autre relâchement SÉLECTIONNE. Il n'existe plus de « zone morte »
//     entre le tap court et l'appui long : un appui de 300 ms, ou un appui
//     long abandonné avant la confirmation, sélectionne normalement.

.pragma library

// Valeurs de repli, alignées sur les réglages des appelants.
var DEFAULT_COMMIT_MS = 1000;
var DEFAULT_FALLBACK_LONG_MS = 2000;

function _num(v, def) {
    var n = Number(v);
    if (typeof n !== "number" || isNaN(n) || !isFinite(n)) return def;
    return n;
}

function _posMs(v, def) {
    var n = _num(v, def);
    return n > 0 ? n : def;
}

/**
 * Décide de l'action à exécuter au relâchement de la touche OK.
 *
 * @param {object} opts
 *   - active         {bool}   faux si aucun appui n'était en cours (relâchement
 *                             fantôme) : aucune action. Absent => appui en cours.
 *   - dur            {number} durée totale de l'appui, en ms.
 *   - armed          {bool}   vrai si la phase « appui long » est amorcée.
 *   - armedDur       {number} durée écoulée depuis l'amorçage, en ms.
 *   - commitMs       {number} durée d'amorçage nécessaire pour supprimer.
 *   - fallbackLongMs {number} garde-fou : appui total au-delà => suppression.
 * @returns {string} "select" | "remove" | "none"
 */
function decideRelease(opts) {
    var o = opts || {};

    if (o.active === false) return "none";

    var dur = _num(o.dur, 0);
    var commitMs = _posMs(o.commitMs, DEFAULT_COMMIT_MS);
    var fallbackLongMs = _posMs(o.fallbackLongMs, DEFAULT_FALLBACK_LONG_MS);

    // Garde-fou : la touche est restée enfoncée très longtemps, même si le
    // timer d'amorçage n'a pas pu se déclencher (interface figée, etc.).
    if (dur >= fallbackLongMs) return "remove";

    // Appui long amorcé et maintenu jusqu'au bout de l'anneau de progression.
    if (o.armed === true && _num(o.armedDur, 0) >= commitMs) return "remove";

    // Tout le reste sélectionne : tap court, appui moyen, appui long relâché
    // avant la confirmation.
    return "select";
}
