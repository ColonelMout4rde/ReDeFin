'use strict';
// F2 (audit-fiches.md) : le backdrop ne doit plus attendre les 320 ms du
// debounce (bgUpdateTimer) au premier affichage, ni les 80 ms du debounce de
// fetch (fetchDebounce) au tout premier fetchItemIfReady() de la page. Les
// pages ne s'instancient pas en test (réseau, ~2900 lignes) : contrat vérifié
// par lecture du source, comme documenté dans CLAUDE.md.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const PAGES = ['detailMoviePage.qml', 'detailSeriePage.qml'];

function readPage(file) {
    return fs.readFileSync(path.join(__dirname, '..', '..', 'qml', 'pages', file), 'utf8');
}

for (const file of PAGES) {
    const src = readPage(file);

    test(file + " : Component.onCompleted contourne le debounce de 80 ms pour le tout premier fetch", () => {
        const idx = src.indexOf('Component.onCompleted');
        assert.notEqual(idx, -1);
        const body = src.slice(idx, idx + 900);
        const stopIdx = body.indexOf('fetchDebounce.stop()');
        const fetchIdx = body.indexOf('fetchItemIfReady()');
        assert.notEqual(stopIdx, -1, 'doit stopper fetchDebounce avant le premier appel');
        assert.notEqual(fetchIdx, -1, 'doit appeler fetchItemIfReady() directement');
        assert.ok(stopIdx < fetchIdx, 'fetchDebounce.stop() doit précéder fetchItemIfReady()');
        // Ne doit plus armer le debounce de 80 ms pour ce premier appel.
        assert.equal(/safeRestart\(fetchDebounce\)|fetchDebounce\.restart\(\)/.test(body), false);
    });

    test(file + " : l'arrivée de l'item (FICHE2) déclenche le backdrop immédiatement, pas via bgUpdateTimer", () => {
        const idx = src.indexOf('DevLog.log("FICHE2"');
        assert.notEqual(idx, -1);
        const window = src.slice(idx, idx + 1400);
        assert.match(window, /backdrop\.updateBackdropNow\(\)/,
            'le premier affichage doit appeler updateBackdropNow() directement');
        assert.equal(/safeRestart\(bgUpdateTimer\)|bgUpdateTimer\.restart\(\)/.test(window), false,
            "le chemin d'arrivée de l'item ne doit plus passer par le debounce de 320 ms");
    });

    test(file + " : bgUpdateTimer existe encore pour les rafraîchissements suivants", () => {
        assert.match(src, /id:\s*bgUpdateTimer/);
        assert.match(src, /interval:\s*320/);
    });
}
