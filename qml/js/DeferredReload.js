/* DeferredReload.js — modèle pur des réglages du lecteur ReDeFin.
 *
 * Ce module décrit UNIQUEMENT les sélections Audio / Sous-titres / Qualité
 * vidéo sous forme de valeurs comparables. Il ne connaît ni Qt, ni QtMultimedia,
 * ni PlayerOverlay : aucune dépendance, aucun état global mutable, donc
 * testable directement avec Node (tests/js/deferredreload.test.js).
 *
 * Convention d'égalité : deux sélections sont identiques lorsqu'elles
 * désignent la MÊME LIGNE que le panneau de réglages affiche comme appliquée.
 * C'est exactement ce que voit l'utilisateur (la coche), et donc le bon
 * critère pour décider qu'une resélection ne doit rien déclencher.
 */
.pragma library

var KIND_AUDIO = "audio";
var KIND_SUBTITLE = "subtitle";
var KIND_QUALITY = "quality";

/* Valeurs négatives réservées aux modes de lecture du panneau Qualité vidéo.
 * Elles reprennent strictement PlayerSettingsOverlay.qml. */
var QUALITY_AUTO = -3;
var QUALITY_REMUX = -2;
var QUALITY_DIRECTPLAY = -1;
var QUALITY_NONE = 0;

function _int(value, fallback) {
    // Number(null) et Number("") valent 0 : on refuse explicitement les
    // valeurs vides avant toute conversion.
    if (value === undefined || value === null || value === "") return fallback;
    var n = Number(value);
    if (!isFinite(n) || isNaN(n)) return fallback;
    return Math.floor(n);
}

/* ===== Descripteurs de sélection ===== */

function audioSelection(streamIdx, uiIndex, manualDirectPlay) {
    return {
        kind: KIND_AUDIO,
        stream: _int(streamIdx, -1),
        uiIndex: _int(uiIndex, -1),
        manualDirectPlay: manualDirectPlay === true
    };
}

function subtitleSelection(streamIdx, uiIndex) {
    return {
        kind: KIND_SUBTITLE,
        stream: _int(streamIdx, -1),
        uiIndex: _int(uiIndex, -1)
    };
}

function qualitySelection(value) {
    return {
        kind: KIND_QUALITY,
        value: _int(value, QUALITY_NONE)
    };
}

/*
 * Égalité de sélection.
 *
 * Audio et sous-titres sont comparés sur l'index visuel du menu : c'est la
 * ligne cochée, donc la seule notion de « déjà actif » que l'utilisateur
 * perçoit. L'index de flux n'est pas utilisé : en DirectPlay pur, Jellyfin ne
 * renvoie aucun AudioStreamIndex et effectiveAudioStream vaut -1 alors que le
 * menu coche bien la piste réellement lue.
 *
 * La qualité est comparée sur la valeur du panneau (Automatique, DirectPlay,
 * Remux ou plafond de transcodage).
 */
function sameSelection(a, b) {
    if (!a || !b) return false;
    if (a.kind !== b.kind) return false;
    if (a.kind === KIND_QUALITY)
        return a.value === b.value && a.value !== QUALITY_NONE;
    return a.uiIndex >= 0 && a.uiIndex === b.uiIndex;
}

function describeSelection(selection) {
    if (!selection) return "";
    if (selection.kind === KIND_QUALITY)
        return KIND_QUALITY + ":" + selection.value;
    return selection.kind + ":ui=" + selection.uiIndex + ",stream=" + selection.stream;
}
