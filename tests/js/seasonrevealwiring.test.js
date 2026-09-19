'use strict';
// Câblage du visual reveal de seasonpage.qml sur SeasonRevealPolicy.js
// (lot 2, BRIEF-COMMUN.md / MESURES.md « page saison »). La page ne
// s'instancie pas en test (fetchs réseau, ~2800 lignes) : vérifié par
// lecture du source, comme documenté dans CLAUDE.md pour un changement
// purement déclaratif (voir tests/js/fichecurtainreveal.test.js pour le
// même principe sur les fiches film/série).

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const SRC = fs.readFileSync(
    path.join(__dirname, '..', '..', 'qml', 'pages', 'seasonpage.qml'),
    'utf8'
);

test('seasonpage.qml importe SeasonRevealPolicy.js', () => {
    assert.match(SRC, /import "\.\.\/js\/SeasonRevealPolicy\.js" as SeasonRevealPolicy/);
});

test('_visualAssetsSettled() passe par SeasonRevealPolicy.revealReady() et ne cite plus le fond/logo/panneau d\'actions/fiche détaillée', () => {
    const idx = SRC.indexOf('function _visualAssetsSettled()');
    assert.notEqual(idx, -1);
    const end = SRC.indexOf('function _armVisualReveal(');
    const body = SRC.slice(idx, end);
    assert.match(body, /SeasonRevealPolicy\.revealReady\(/);
    assert.equal(
        /_bgActiveUrl|_bgWantedUrl|_logoArmed|seriesLogoImage|actionButtonsLoader|_actionsArmed|selectedDetails|_visualDetailsSettled|_visualImageSettled/.test(body),
        false,
        '_visualAssetsSettled() ne doit plus dépendre du fond/logo/panneau d\'actions/fiche détaillée'
    );
});

test('_visualImageSettled() et _visualDetailsSettled() ont été supprimées (devenues mortes)', () => {
    assert.equal(/function _visualImageSettled\(/.test(SRC), false);
    assert.equal(/function _visualDetailsSettled\(/.test(SRC), false);
});

test('_visualEpisodesRowSettled() (structurel, pas image) reste utilisée par _visualAssetsSettled()', () => {
    const idx = SRC.indexOf('function _visualAssetsSettled()');
    const end = SRC.indexOf('function _armVisualReveal(');
    const body = SRC.slice(idx, end);
    assert.match(body, /episodesRowSettled:\s*_visualEpisodesRowSettled\(\)/);
});

test('_visualEpisodesRowSettled() passe par SeasonRevealPolicy.episodesRowStructurallyReady() (lot 3, testable sans QML)', () => {
    const idx = SRC.indexOf('function _visualEpisodesRowSettled()');
    const end = SRC.indexOf('function _visualAssetsSettled()');
    assert.notEqual(idx, -1);
    const body = SRC.slice(idx, end);
    assert.match(body, /SeasonRevealPolicy\.episodesRowStructurallyReady\(/);
});

test("_visualEpisodesRowSettled() lit currentItemReady sur le délégué (lot 3 : délégué de l'épisode cible créé)", () => {
    const idx = SRC.indexOf('function _visualEpisodesRowSettled()');
    const end = SRC.indexOf('function _visualAssetsSettled()');
    const body = SRC.slice(idx, end);
    assert.match(body, /currentItemReady/);
});

test('visualRevealInitialMinMs est aligné sur SeasonRevealPolicy.LAYOUT_STABILITY_MS (ancien plancher : 680 ms)', () => {
    assert.match(SRC, /property int visualRevealInitialMinMs:\s*SeasonRevealPolicy\.LAYOUT_STABILITY_MS/);
});

test('le timeout dur du visual reveal reste à 3200 ms', () => {
    assert.match(SRC, /property int visualRevealHardTimeoutMs:\s*3200\b/);
});

test('_armVisualReveal()/_releaseVisualReveal()/beginLoading() arment et purgent la fenêtre de stabilité de mise en page', () => {
    assert.match(SRC, /_revealLayoutStable = false; revealLayoutStabilityTimer\.restart\(\);/);
    assert.match(SRC, /revealLayoutStabilityTimer\.stop\(\);/);
});

test('minLoadingMs et loadingOffTimer sont alignés sur SeasonRevealPolicy.LOADING_OFF_MIN_MS (lot 3, anciens planchers 350 ms / 140 ms)', () => {
    assert.match(SRC, /property int minLoadingMs:\s*SeasonRevealPolicy\.LOADING_OFF_MIN_MS/);
    assert.match(SRC, /id: loadingOffTimer\s*\n\s*\/\/[^\n]*\n\s*interval:\s*Math\.max\(0,\s*SeasonRevealPolicy\.LOADING_OFF_MIN_MS\)/);
    assert.match(SRC, /loadingOffTimer\.interval = Math\.max\(0, minLoadingMs - \(Date\.now\(\) - _loadingStartedMs\)\);/);
});
