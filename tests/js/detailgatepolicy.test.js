'use strict';
// DetailGatePolicy.js — gardes de chargement des fiches de détail.
// Voir tests/README.md pour la convention (module pur, testé via qmljs.js).

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadQmlJs } = require('./qmljs');

function load() {
    return loadQmlJs('qml/js/DetailGatePolicy.js');
}

test('F1 (detailSeriePage.qml ~1042-1046, ~2693) : une série entièrement vue libère gateNextUpReady sans attendre le timeout', () => {
    const Policy = load();
    // Reproduit exactement le défaut : le rail a fini de charger (Loader
    // Ready), NextUpBlock a terminé sa requête (ready=true) mais elle est
    // vide (hasContent=false, donc height=0 puisque implicitHeight suit
    // hasContent). Avant le correctif, seule onHasContentChanged ou une
    // hauteur > 0 libérait la garde ; aucune des deux ne se produit ici.
    const released = Policy.nextUpGateReleased({
        loaderStatus: 'ready',
        blockReady: true,
        hasContent: false,
        height: 0,
    });
    assert.equal(released, true);
});

test('rail encore en cours de requête : la garde reste fermée', () => {
    const Policy = load();
    assert.equal(Policy.nextUpGateReleased({
        loaderStatus: 'ready',
        blockReady: false,
        hasContent: false,
        height: 0,
    }), false);
});

test('Loader pas encore actif/chargé (heavyStageNextUp pas encore armé) : la garde reste fermée', () => {
    const Policy = load();
    assert.equal(Policy.nextUpGateReleased({
        loaderStatus: 'loading',
        blockReady: false,
        hasContent: false,
        height: 0,
    }), false);
    assert.equal(Policy.nextUpGateReleased({}), false);
});

test('Loader en erreur : la garde se libère (rien à attendre)', () => {
    const Policy = load();
    assert.equal(Policy.nextUpGateReleased({ loaderStatus: 'error' }), true);
});

test('contenu présent et rendu (hauteur > 0) : la garde se libère', () => {
    const Policy = load();
    assert.equal(Policy.nextUpGateReleased({
        loaderStatus: 'ready',
        blockReady: true,
        hasContent: true,
        height: 210,
    }), true);
});

test('contenu annoncé mais pas encore mesuré (hauteur encore à 0) : la garde reste fermée', () => {
    const Policy = load();
    // Cas transitoire : hasContent vient de passer à true mais le Loader
    // n'a pas encore republié sa hauteur (évite un saut de mise en page).
    assert.equal(Policy.nextUpGateReleased({
        loaderStatus: 'ready',
        blockReady: true,
        hasContent: true,
        height: 0,
    }), false);
});
