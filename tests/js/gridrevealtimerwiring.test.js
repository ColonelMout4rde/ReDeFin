'use strict';

/*
 * Câblage du Timer de sondage de la restauration de grille (moviepage.qml)
 * sur GridRevealPolicy.js — point 3 de la mission « grilles3 ». La décision
 * pure (quand lever le rideau) est testée dans tests/js/gridrevealpolicy.test.js ;
 * ce test vérifie seulement que le Timer QML utilise bien la période exportée
 * par le module (et non une valeur recopiée à la main, qui pourrait diverger
 * en silence) et échantillonne dès son démarrage (triggeredOnStart), sans
 * quoi la latence de sondage supplémentaire mesurée dans MESURES.md revient.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const SOURCE = path.join(__dirname, '..', '..', 'qml', 'pages', 'moviepage.qml');
const src = fs.readFileSync(SOURCE, 'utf8');

function timerBlock() {
    const idx = src.indexOf('id: restoreRevealTimer');
    assert.notEqual(idx, -1, 'Timer restoreRevealTimer introuvable');
    return src.slice(idx, idx + 700);
}

test('restoreRevealTimer utilise la période exportée par GridRevealPolicy (pas une valeur recopiée)', () => {
    const block = timerBlock();
    assert.match(block, /interval:\s*GridReveal\.POLL_INTERVAL_MS/);
    assert.doesNotMatch(block, /interval:\s*60\b/);
});

test('restoreRevealTimer échantillonne dès son démarrage (triggeredOnStart)', () => {
    const block = timerBlock();
    assert.match(block, /triggeredOnStart:\s*true/);
});
