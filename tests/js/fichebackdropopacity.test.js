'use strict';
// M4 (audit-fiches.md) : le fond des fiches empilait une image à opacité a
// sur un fond noir, puis un voile noir plein écran à opacité b (bgDarken)
// PAR-DESSUS. Composer un voile noir d'opacité b sur une image déjà à
// opacité a (elle-même posée sur un fond noir) équivaut mathématiquement à
// afficher directement cette image à l'opacité (1-b)*a : le voile noir sur
// fond noir ne fait qu'assombrir uniformément, sans rien ajouter que
// l'opacité de l'image ne pourrait déjà exprimer seule.
//
// film/série : a=0,90, b=0,40 -> (1-0,40)*0,90 = 0,54.
// collection : a=0,95 (pas 0,90, contrairement à l'hypothèse de l'audit
// « idem série/collection »), b=0,40 -> (1-0,40)*0,95 = 0,57.
//
// Vérifié par lecture du source : les pages ne s'instancient pas en test
// (réseau, ~2900-2900 lignes) et le rendu réel (SGX535) ne peut être jugé
// que sur boîtier.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function readPage(file) {
    return fs.readFileSync(path.join(__dirname, '..', '..', 'qml', 'pages', file), 'utf8');
}

function equivalentOpacity(imageOpacity, veilOpacity) {
    return Math.round((1 - veilOpacity) * imageOpacity * 100) / 100;
}

/** Retire les lignes de commentaire QML/JS (//...), pour ne pas confondre
 *  un mot cité dans une explication avec du code encore actif. */
function withoutComments(src) {
    return src.split('\n').filter((line) => !/^\s*\/\//.test(line)).join('\n');
}

test('vérification de calcul : (1-0.40)*0.90 = 0.54 et (1-0.40)*0.95 = 0.57', () => {
    assert.equal(equivalentOpacity(0.90, 0.40), 0.54);
    assert.equal(equivalentOpacity(0.95, 0.40), 0.57);
});

for (const file of ['detailMoviePage.qml', 'detailSeriePage.qml']) {
    const src = readPage(file);

    test(file + " : bgOpacity vaut 0.54 (fusion de l'image à 0,90 et du voile à 0,40)", () => {
        assert.match(src, /readonly property real bgOpacity:\s*0\.54/);
    });

    test(file + " : plus aucun voile noir séparé (bgDarken) sur le backdrop", () => {
        assert.equal(/bgDarken/.test(withoutComments(src)), false);
    });

    test(file + " : le backdrop passe à bgOpacity (pas 0.90 en dur) quand l'image est prête", () => {
        const idx = src.indexOf('id: backdrop');
        assert.notEqual(idx, -1);
        const block = src.slice(idx, idx + 1400);
        assert.match(block, /opacity\s*=\s*bgOpacity/);
        assert.equal(/opacity\s*=\s*0\.90/.test(block), false);
    });
}

const collection = readPage('detailCollectionPage.qml');

test("detailCollectionPage.qml : bgOpacity vaut 0.57 (l'image de fond y est à 0,95, pas 0,90)", () => {
    assert.match(collection, /readonly property real bgOpacity:\s*0\.57/);
});

test('detailCollectionPage.qml : plus aucun voile noir séparé (bgDarken) sur le backdrop', () => {
    assert.equal(/bgDarken/.test(withoutComments(collection)), false);
});

test('detailCollectionPage.qml : les deux buffers de fond (A/B) utilisent bgOpacity, pas 0.95 en dur', () => {
    const idx = collection.indexOf('id: staticScene');
    assert.notEqual(idx, -1);
    const block = collection.slice(idx, idx + 1600);
    assert.equal(/0\.95/.test(block), false);
    assert.match(block, /detailCollectionPage\.bgOpacity/);
    // Deux Image (blurredBGA/blurredBGB) doivent chacune référencer bgOpacity.
    const count = (block.match(/detailCollectionPage\.bgOpacity/g) || []).length;
    assert.equal(count, 2);
});
