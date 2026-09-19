'use strict';
// Décision produit, point 5 (audit-fiches.md) : le rideau de la fiche ne
// doit plus attendre les images (poster/logo, backdrop, art de collection).
// Vérifié par lecture du source (les pages ne s'instancient pas en test :
// réseau, ~2900 lignes).

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function readPage(file) {
    return fs.readFileSync(path.join(__dirname, '..', '..', 'qml', 'pages', file), 'utf8');
}

const movie = readPage('detailMoviePage.qml');
const serie = readPage('detailSeriePage.qml');
const collection = readPage('detailCollectionPage.qml');

for (const [name, src] of [['detailMoviePage.qml', movie], ['detailSeriePage.qml', serie]]) {
    test(name + " : hardLoading passe par DetailGatePolicy.pageCanReveal() et ne cite plus gatePosterReady/gateBGReady", () => {
        assert.match(src, /import "\.\.\/js\/DetailGatePolicy\.js" as DetailGatePolicy/);
        const idx = src.indexOf('readonly property bool hardLoading:');
        assert.notEqual(idx, -1);
        const block = src.slice(idx, idx + 300);
        assert.match(block, /DetailGatePolicy\.pageCanReveal\(/);
        assert.equal(/gatePosterReady|gateBGReady/.test(block), false,
            'hardLoading ne doit plus dépendre des gardes image');
    });

    test(name + " : gatePosterReady/gateBGReady existent encore (calculées pour les fondus)", () => {
        assert.match(src, /property bool gatePosterReady: false/);
        assert.match(src, /property bool gateBGReady: false/);
    });

    test(name + ' : minLoadTimer est réduit à 0 (plancher supprimé, rien d\'autre n\'en dépend)', () => {
        assert.match(src, /id:\s*minLoadTimer;\s*interval:\s*0\b/);
    });

    test(name + ' : layoutReadyTimer est réduit à 60 ms', () => {
        const idx = src.indexOf('id: layoutReadyTimer');
        assert.notEqual(idx, -1);
        const block = src.slice(Math.max(0, idx - 40), idx + 120);
        assert.match(block, /interval:\s*60\b/);
    });
}

test("detailCollectionPage.qml : layoutReadyTimer est réduit à 60 ms", () => {
    const idx = collection.indexOf('id: layoutReadyTimer');
    assert.notEqual(idx, -1);
    const block = collection.slice(Math.max(0, idx - 40), idx + 120);
    assert.match(block, /interval:\s*60\b/);
});

test("detailCollectionPage.qml : _gateSatisfied() ne dépend plus de heroBgDone/heroArtDone", () => {
    const idx = collection.indexOf('function _gateSatisfied()');
    assert.notEqual(idx, -1);
    const end = collection.indexOf('function _maybeEndLoadingWithGate()');
    const body = collection.slice(idx, end)
        .split('\n')
        .filter((line) => !/^\s*\/\//.test(line))
        .join('\n');
    assert.equal(/heroBgDone|heroArtDone|heroImagesTimedOut/.test(body), false);
    assert.match(body, /return true/);
});
