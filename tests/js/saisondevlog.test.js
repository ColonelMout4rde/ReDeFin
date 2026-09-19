'use strict';
// Instrumentation SAISON (chronométrage du chemin du rideau de
// seasonpage.qml : onCompleted, réponse de la saison, réponse des
// épisodes, modèle d'épisodes posé, chaque étape du visual reveal avec sa
// raison, fin du rideau). La page ne s'instancie pas en test (fetchs
// réseau, ~2800 lignes) : on vérifie donc le câblage par lecture du
// source, comme documenté dans CLAUDE.md pour un changement purement
// déclaratif/instrumental (voir tests/js/fichedevlog.test.js pour le même
// principe sur les fiches film/série).

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const PAGE_PATH = path.join(__dirname, '..', '..', 'qml', 'pages', 'seasonpage.qml');
const SRC = fs.readFileSync(PAGE_PATH, 'utf8');

test('seasonpage.qml importe DevLog et n\'appelle jamais console.log', () => {
    assert.match(SRC, /import "\.\.\/js\/DevLog\.js" as DevLog/);
    assert.equal(/\bconsole\.log\s*\(/.test(SRC), false);
});

test('seasonpage.qml initialise _saisonT0 dans le Component.onCompleted de la page', () => {
    // La page contient plusieurs Component.onCompleted imbriqués (délégués,
    // marquee...) : on cible celui qui suit _hydrateSensitiveContextFromShared,
    // propre au onCompleted racine de seasonpage.
    const idx = SRC.indexOf('_hydrateSensitiveContextFromShared();');
    assert.notEqual(idx, -1);
    const body = SRC.slice(Math.max(0, idx - 200), idx);
    assert.match(body, /Component\.onCompleted:\s*\{\s*\n\s*_saisonT0 = Date\.now\(\);/);
});

test('seasonpage.qml trace SAISON1 (onCompleted) sans attendre de dt', () => {
    assert.match(SRC, /DevLog\.log\("SAISON1",\s*"onCompleted dt=0"\)/);
});

for (const tag of ['SAISON2', 'SAISON3', 'SAISON4', 'SAISON5', 'SAISON6']) {
    test('seasonpage.qml trace ' + tag + ' avec un dt depuis _saisonT0', () => {
        const re = new RegExp('DevLog\\.log\\("' + tag + '",[^\\n]*\\(Date\\.now\\(\\)\\s*-\\s*_saisonT0\\)');
        assert.match(SRC, re, tag + ' doit apparaître avec un dt depuis _saisonT0');
    });
}

test('SAISON2 trace la réponse de la saison (onSeasonItemChanged)', () => {
    const idx = SRC.indexOf('onSeasonItemChanged:');
    assert.notEqual(idx, -1);
    const body = SRC.slice(idx, idx + 300);
    assert.match(body, /DevLog\.log\("SAISON2"/);
});

test('SAISON3 et SAISON4 tracent la réponse des épisodes puis le modèle posé (onEpisodesChanged)', () => {
    const idx = SRC.indexOf('onEpisodesChanged:');
    assert.notEqual(idx, -1);
    const body = SRC.slice(idx, idx + 700);
    const i3 = body.indexOf('DevLog.log("SAISON3"');
    const i4 = body.indexOf('DevLog.log("SAISON4"');
    assert.notEqual(i3, -1, 'SAISON3 doit apparaître dans onEpisodesChanged');
    assert.notEqual(i4, -1, 'SAISON4 doit apparaître dans onEpisodesChanged');
    assert.ok(i3 < i4, 'SAISON3 (réponse) doit précéder SAISON4 (modèle posé)');
});

test('SAISON5 trace chaque étape du visual reveal avec sa raison (arm/release) ou son nom', () => {
    const matches = SRC.match(/DevLog\.log\("SAISON5",\s*"step=([^"\s]+)/g) || [];
    const steps = matches.map((m) => /step=([^"\s]+)/.exec(m)[1]);
    for (const expected of ['layoutSettle', 'posterWarmup', 'logoArmed', 'bgActive', 'detailsFetch', 'detailsReady', 'armVisualReveal', 'releaseVisualReveal']) {
        assert.ok(steps.indexOf(expected) !== -1, 'étape manquante dans SAISON5 : ' + expected);
    }
});

test('SAISON5 (arm/release) journalise la raison passée à _armVisualReveal/_releaseVisualReveal', () => {
    assert.match(SRC, /step=armVisualReveal reason="\s*\+\s*\(reason \|\| ""\)/);
    assert.match(SRC, /step=releaseVisualReveal reason="\s*\+\s*\(reason \|\| ""\)/);
});

test('SAISON6 trace la fin du rideau sur loadingGateActive redevenant faux', () => {
    const re = /onLoadingGateActiveChanged:\s*if\s*\(!loadingGateActive\)\s*DevLog\.log\("SAISON6"/;
    assert.match(SRC, re);
});

test('le module DevLog réellement importé par seasonpage.qml reste désactivé', () => {
    const { loadQmlJs } = require('./qmljs');
    const DevLog = loadQmlJs('qml/js/DevLog.js');
    assert.equal(DevLog.ENABLED, false);
});
