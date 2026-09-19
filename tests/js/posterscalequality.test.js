'use strict';
// posterscalequality.test.js — contrat du constat 7 de l'audit accueil.
//
// Sur l'accueil, toutes les cartes visibles (20 à 30) demandaient leur
// affiche à 1.35x en qualité 90, alors que seule la carte focalisée est
// zoomée (~1.14x) et reçoit de toute façon la version HD après 320 ms.
// postergrid.posterScale/posterQFast sont resserrés à 1.15x/q82.
//
// PosterGridCard.qml est partagé avec SearchPage/PersonalMediaPage : ses
// valeurs de repli internes (utilisées seulement quand le controller ne
// fournit pas la propriété) ne font PAS partie de ce constat et ne doivent
// pas changer, pour ne pas modifier la qualité des grilles hors accueil.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const POSTERGRID = fs.readFileSync(path.join(ROOT, 'qml', 'pages', 'postergrid.qml'), 'utf8');
const CARD = fs.readFileSync(path.join(ROOT, 'qml', 'pages', 'PosterGridCard.qml'), 'utf8');

test('postergrid.posterScale/posterQFast sont resserrés à 1.15 / 82', () => {
    assert.match(POSTERGRID, /readonly property real posterScale:\s*1\.15\b/);
    assert.match(POSTERGRID, /readonly property int posterQFast:\s*82\b/);
});

test('les valeurs de repli de PosterGridCard.qml restent inchangées (SearchPage)', () => {
    assert.match(CARD, /_numProp\(controller, "posterQFast", 90\)/);
    assert.match(CARD, /_numProp\(controller, "posterScale", 1\.35\)/);
});
