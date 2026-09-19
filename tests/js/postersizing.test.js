'use strict';
// PosterSizing.js — taille d'image demandée au serveur pour le logo/affiche
// des fiches de détail. Voir F5 dans audit-fiches.md.
//
// Les objets renvoyés par loadQmlJs() viennent d'un autre "realm" (vm) :
// on compare les champs plutôt que d'utiliser deepStrictEqual (CLAUDE.md).

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadQmlJs } = require('./qmljs');

function load() {
    return loadQmlJs('qml/js/PosterSizing.js');
}

test("F5 (detailMoviePage.qml ~1159, detailSeriePage.qml ~1099) : 230x330 affiché à 1,3x arrondi au palier de 80 donne 320x480", () => {
    const PosterSizing = load();
    const size = PosterSizing.requestedImageSize(230, 330);
    assert.equal(size.width, 320);
    assert.equal(size.height, 480);
});

test('un cadre plus petit demande un palier plus petit', () => {
    const PosterSizing = load();
    const size = PosterSizing.requestedImageSize(100, 100);
    assert.equal(size.width, 160);
    assert.equal(size.height, 160);
});

test('oversample et palier personnalisés', () => {
    const PosterSizing = load();
    const a = PosterSizing.requestedImageSize(200, 200, 1.0, 50);
    assert.equal(a.width, 200);
    assert.equal(a.height, 200);
    const b = PosterSizing.requestedImageSize(201, 200, 1.0, 50);
    assert.equal(b.width, 250);
    assert.equal(b.height, 200);
});

test('entrées négatives ou non numériques ne produisent jamais une taille négative', () => {
    const PosterSizing = load();
    const a = PosterSizing.requestedImageSize(-10, NaN);
    assert.equal(a.width, 0);
    assert.equal(a.height, 0);
    const b = PosterSizing.requestedImageSize(undefined, null);
    assert.equal(b.width, 0);
    assert.equal(b.height, 0);
});

test('la taille demandée reste très inférieure aux 900x900 actuels pour un cadre de fiche', () => {
    const PosterSizing = load();
    const size = PosterSizing.requestedImageSize(230, 330);
    assert.ok(size.width < 900 && size.height < 900);
});
