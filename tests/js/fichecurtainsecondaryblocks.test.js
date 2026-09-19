'use strict';
// Lot 2 (BRIEF-COMMUN.md « fiches »), MESURES.md « fiche série » : dt=339
// arrivée item, hardLoading=false à dt=350, mais le rideau ne se levait qu'à
// dt=912 car il attendait encore gate=nextUp (798) et gate=seasons (912) —
// deux blocs dont les composants (NextUpBlock.qml, SeasonsBlock.qml) ne sont
// même chargés qu'après l'arrivée de l'item. La fiche film a le même
// mécanisme sur Cast/Similar (gateCastBlockReady/gateSimilarBlockReady).
//
// Décision produit : le rideau se lève dès que l'en-tête est peuplé
// (hardLoading) ; les blocs secondaires arrivent ensuite, sous rideau levé.
// Vérifié par lecture du source (les pages ne s'instancient pas en test :
// réseau, ~2900-3100 lignes) — voir tests/js/fichecurtainreveal.test.js pour
// le même principe sur le point 5 (images).

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function readPage(file) {
    return fs.readFileSync(path.join(__dirname, '..', '..', 'qml', 'pages', file), 'utf8');
}

const serie = readPage('detailSeriePage.qml');
const movie = readPage('detailMoviePage.qml');

test("detailSeriePage.qml : visualLoading passe par DetailGatePolicy.detailCurtainActive() et ne cite plus gateNextUpReady/gateSeasonsBlockReady/seasonsStrictLoading", () => {
    const idx = serie.indexOf('readonly property bool visualLoading:');
    assert.notEqual(idx, -1);
    const block = serie.slice(idx, idx + 260);
    assert.match(block, /DetailGatePolicy\.detailCurtainActive\(/);
    assert.equal(/gateNextUpReady|gateSeasonsBlockReady|seasonsStrictLoading|extendedLoading\b/.test(block), false,
        'visualLoading ne doit plus dépendre des gardes des blocs secondaires');
});

test("detailSeriePage.qml : visualLoading garde les vrais défauts fonctionnels (retour, restauration)", () => {
    const idx = serie.indexOf('readonly property bool visualLoading:');
    const block = serie.slice(idx, idx + 260);
    assert.match(block, /_personReturnGate/);
    assert.match(block, /_playerNextUpRestorePending/);
    assert.match(block, /_castViewportRestorePending/);
});

test("detailSeriePage.qml : gateNextUpReady/gateSeasonsBlockReady restent calculées (instrumentation FICHE5)", () => {
    assert.match(serie, /onGateNextUpReadyChanged:.*DevLog\.log\("FICHE5"/);
    assert.match(serie, /onGateSeasonsBlockReadyChanged:.*DevLog\.log\("FICHE5"/);
});

test("detailSeriePage.qml : le slot Saisons réserve une hauteur nominale tant que le bloc n'est pas mesuré", () => {
    const idx = serie.indexOf('id: seasonsLoader');
    assert.notEqual(idx, -1);
    const block = serie.slice(idx, idx + 1100);
    assert.match(block, /DetailGatePolicy\.seasonsReservedHeight\(/);
});

test("detailMoviePage.qml : baseVisualLoading passe par DetailGatePolicy.detailCurtainActive() et ne cite plus gateCastBlockReady/gateSimilarBlockReady", () => {
    const idx = movie.indexOf('readonly property bool baseVisualLoading:');
    assert.notEqual(idx, -1);
    const block = movie.slice(idx, idx + 260);
    assert.match(block, /DetailGatePolicy\.detailCurtainActive\(/);
    assert.equal(/gateCastBlockReady|gateSimilarBlockReady|extendedLoading\b/.test(block), false,
        'baseVisualLoading ne doit plus dépendre des gardes Cast/Similar');
});

test("detailMoviePage.qml : visualLoading garde detailReturnRefreshGate/initialAuthoritativeFetchPending", () => {
    const idx = movie.indexOf('readonly property bool visualLoading:');
    assert.notEqual(idx, -1);
    const block = movie.slice(idx, idx + 200);
    assert.match(block, /detailReturnRefreshGate/);
    assert.match(block, /initialAuthoritativeFetchPending/);
});

test("detailMoviePage.qml : gateCastBlockReady/gateSimilarBlockReady restent calculées (instrumentation FICHE5)", () => {
    assert.match(movie, /onGateCastBlockReadyChanged:.*DevLog\.log\("FICHE5"/);
    assert.match(movie, /onGateSimilarBlockReadyChanged:.*DevLog\.log\("FICHE5"/);
});

for (const [name, src] of [['detailSeriePage.qml', serie], ['detailMoviePage.qml', movie]]) {
    test(name + ' : extendedLoadingTimeout reste le filet de secours (non supprimé)', () => {
        assert.match(src, /id:\s*extendedLoadingTimeout/);
    });
}
