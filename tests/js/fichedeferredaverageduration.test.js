'use strict';
// F4 (audit-fiches.md) : quand la série n'a pas de RunTimeTicks plausible,
// l'estimation de durée moyenne nécessite un appel réseau (borné, voir
// fichebridgeaverageduration.test.js) ; ce test vérifie que
// detailSeriePage.qml le DIFFÈRE jusqu'à la levée du rideau au lieu de le
// lancer pendant le rideau, en concurrence avec l'item/les saisons. Vérifié
// par lecture du source : la page ne s'instancie pas en test (réseau).

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const src = fs.readFileSync(
    path.join(__dirname, '..', '..', 'qml', 'pages', 'detailSeriePage.qml'),
    'utf8'
);

test('_refreshAverageEpisodeDuration() diffère la requête réseau tant que hardLoading est vrai', () => {
    const start = src.indexOf('function _refreshAverageEpisodeDuration()');
    assert.notEqual(start, -1);
    const end = src.indexOf('property string nextUpDurationText', start);
    const body = src.slice(start, end);
    assert.match(body, /!hardLoading/);
    assert.match(body, /_avgDurationDeferredSeriesId\s*=\s*sid/);
    assert.match(body, /_avgDurationDeferredFallbackTicks\s*=\s*fallbackTicks/);
});

test('onHardLoadingChanged lance la requête différée une fois le rideau levé', () => {
    const idx = src.indexOf('onHardLoadingChanged:');
    assert.notEqual(idx, -1);
    const block = src.slice(idx, idx + 1100);
    assert.match(block, /if\s*\(_avgDurationDeferredSeriesId\)/);
    assert.match(block, /_launchAverageEpisodeDurationRequest\(/);
});

test('_resetAverageEpisodeDuration() efface aussi une requête différée en attente', () => {
    const start = src.indexOf('function _resetAverageEpisodeDuration()');
    const end = src.indexOf('function _launchAverageEpisodeDurationRequest');
    const body = src.slice(start, end);
    assert.match(body, /_avgDurationDeferredSeriesId\s*=\s*""/);
});
