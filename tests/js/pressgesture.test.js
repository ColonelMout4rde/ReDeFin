'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadQmlJs } = require('./qmljs');

const PressGesture = loadQmlJs('qml/js/PressGesture.js');

// Réglages identiques à ceux des appelants QML (tuile de profil LoginPage,
// ligne de serveur mémorisé ServerOverlay).
const CFG = { commitMs: 1000, fallbackLongMs: 2000 };

function decide(extra) {
    return PressGesture.decideRelease(Object.assign({}, CFG, extra));
}

test('decideRelease : tout relâchement sous le seuil de suppression sélectionne', () => {
    // Tap franc.
    assert.equal(decide({ dur: 50, armed: false }), 'select');
    assert.equal(decide({ dur: 0, armed: false }), 'select');

    // Ancienne « zone morte » silencieuse (201..1999 ms) : c'était le bug.
    assert.equal(decide({ dur: 201, armed: false }), 'select');
    assert.equal(decide({ dur: 300, armed: false }), 'select');
    assert.equal(decide({ dur: 900, armed: false }), 'select');
    assert.equal(decide({ dur: 1500, armed: false }), 'select');
    assert.equal(decide({ dur: 1999, armed: false }), 'select');
});

test('decideRelease : appui long amorcé puis abandonné sélectionne', () => {
    // L'anneau a démarré (armed) mais l'utilisateur relâche avant la fin.
    assert.equal(decide({ dur: 1300, armed: true, armedDur: 300 }), 'select');
    assert.equal(decide({ dur: 1999, armed: true, armedDur: 999 }), 'select');
});

test('decideRelease : appui long confirmé supprime', () => {
    // Anneau arrivé au bout.
    assert.equal(decide({ dur: 1000, armed: true, armedDur: 1000 }), 'remove');
    assert.equal(decide({ dur: 1500, armed: true, armedDur: 1400 }), 'remove');

    // Garde-fou : appui total très long, même sans amorçage (timer non tiré).
    assert.equal(decide({ dur: 2000, armed: false }), 'remove');
    assert.equal(decide({ dur: 5000, armed: false }), 'remove');
    assert.equal(decide({ dur: 3000, armed: true, armedDur: 10 }), 'remove');
});

test('decideRelease : bornes exactes', () => {
    // commitMs : >= supprime, juste en dessous sélectionne.
    assert.equal(decide({ dur: 1200, armed: true, armedDur: 999 }), 'select');
    assert.equal(decide({ dur: 1200, armed: true, armedDur: 1000 }), 'remove');

    // fallbackLongMs : >= supprime, juste en dessous sélectionne.
    assert.equal(decide({ dur: 1999, armed: false }), 'select');
    assert.equal(decide({ dur: 2000, armed: false }), 'remove');

    // armedDur n'est pris en compte que si armed vaut vrai.
    assert.equal(decide({ dur: 500, armed: false, armedDur: 9999 }), 'select');
});

test('decideRelease : aucun appui en cours => "none"', () => {
    assert.equal(decide({ active: false, dur: 50 }), 'none');
    assert.equal(decide({ active: false, dur: 9999, armed: true, armedDur: 9999 }), 'none');

    // active absent ou vrai => l'appui est considéré en cours.
    assert.equal(decide({ active: true, dur: 50 }), 'select');
    assert.equal(PressGesture.decideRelease({ dur: 50 }), 'select');
});

test('decideRelease : entrées invalides retombent sur des valeurs sûres', () => {
    assert.equal(PressGesture.decideRelease(), 'select');
    assert.equal(PressGesture.decideRelease(null), 'select');

    // dur non numérique => 0 ms => sélection (jamais de suppression surprise).
    assert.equal(decide({ dur: undefined, armed: false }), 'select');
    assert.equal(decide({ dur: NaN, armed: false }), 'select');
    assert.equal(decide({ dur: 'abc', armed: false }), 'select');

    // Seuils absents ou aberrants : repli sur 1000 / 2000 ms.
    assert.equal(PressGesture.decideRelease({ dur: 2500 }), 'remove');
    assert.equal(PressGesture.decideRelease({ dur: 1500 }), 'select');
    assert.equal(
        PressGesture.decideRelease({ dur: 1200, armed: true, armedDur: 1100, commitMs: 0 }),
        'remove'
    );
});
