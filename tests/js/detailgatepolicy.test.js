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

test('pageCanReveal() (décision produit, point 5) : ne dépend plus des images, seulement du réseau et du plancher de temps', () => {
    const Policy = load();
    // Toutes conditions réunies : le rideau dur peut se lever, sans savoir
    // quoi que ce soit sur le poster/logo/backdrop.
    assert.equal(Policy.pageCanReveal({
        fetchInFlight: false,
        itemReady: true,
        minDelayReady: true,
    }), true);
});

test('pageCanReveal() reste fermé pendant que le fetch réseau est en cours (sans snapshot chaud)', () => {
    const Policy = load();
    assert.equal(Policy.pageCanReveal({
        fetchInFlight: true,
        itemReady: false,
        minDelayReady: true,
    }), false);
});

test("pageCanReveal() reste fermé tant que l'item n'est pas arrivé", () => {
    const Policy = load();
    assert.equal(Policy.pageCanReveal({
        fetchInFlight: false,
        itemReady: false,
        minDelayReady: true,
    }), false);
});

test('pageCanReveal() reste fermé pendant le plancher anti-clignotement', () => {
    const Policy = load();
    assert.equal(Policy.pageCanReveal({
        fetchInFlight: false,
        itemReady: true,
        minDelayReady: false,
    }), false);
});

test('pageCanReveal() ne prend aucun paramètre image : un état sans clé poster/backdrop se lève quand même', () => {
    const Policy = load();
    // Reproduit exactement le nouveau contrat : avant le correctif, l'ancien
    // hardLoading exigeait aussi gatePosterReady/gateBGReady. pageCanReveal()
    // n'a même pas ces clés dans sa signature.
    assert.equal(Policy.pageCanReveal({
        fetchInFlight: false,
        itemReady: true,
        minDelayReady: true,
        gatePosterReady: false,
        gateBGReady: false,
    }), true);
});

test('detailCurtainActive() (lot 2, MESURES.md « fiche série ») : ne dépend plus des blocs secondaires — hardLoading=false suffit à lever le rideau même si nextUp/seasons ne le sont pas', () => {
    const Policy = load();
    // Reproduit exactement l'état mesuré sur boîtier à dt=350 (hardLoading
    // tombe) alors que gate=nextUp (798) et gate=seasons (912) ne sont pas
    // encore atteintes. detailCurtainActive() n'a même pas ces clés dans sa
    // signature : les repasser ne changerait rien.
    assert.equal(Policy.detailCurtainActive({
        hardLoading: false,
        gateNextUpReady: false,
        gateSeasonsBlockReady: false,
    }), false);
});

test('detailCurtainActive() reste actif tant que hardLoading est vrai', () => {
    const Policy = load();
    assert.equal(Policy.detailCurtainActive({ hardLoading: true }), true);
});

test('detailCurtainActive() reste actif sur un vrai défaut fonctionnel même une fois hardLoading retombé', () => {
    const Policy = load();
    assert.equal(Policy.detailCurtainActive({
        hardLoading: false,
        functionalHazard: true,
    }), true);
});

test('detailCurtainActive() se lève quand hardLoading est retombé et qu’aucun défaut fonctionnel ne subsiste', () => {
    const Policy = load();
    assert.equal(Policy.detailCurtainActive({
        hardLoading: false,
        functionalHazard: false,
    }), false);
    assert.equal(Policy.detailCurtainActive({}), false);
});

test('seasonsReservedHeight() (lot 2) : réserve la hauteur nominale tant que /Seasons n’a pas répondu', () => {
    const Policy = load();
    assert.equal(Policy.seasonsReservedHeight({
        hasItem: true,
        seasonsFetched: false,
        seasonsCount: 0,
    }) > 0, true);
});

test('seasonsReservedHeight() : rien à réserver avant que l’item (la série) ne soit connu', () => {
    const Policy = load();
    assert.equal(Policy.seasonsReservedHeight({
        hasItem: false,
        seasonsFetched: false,
        seasonsCount: 0,
    }), 0);
});

test('seasonsReservedHeight() : /Seasons a répondu sans saison, la réservation tombe à 0 (cas anormal mais géré)', () => {
    const Policy = load();
    assert.equal(Policy.seasonsReservedHeight({
        hasItem: true,
        seasonsFetched: true,
        seasonsCount: 0,
    }), 0);
});

test('seasonsReservedHeight() : /Seasons a répondu avec des saisons, la réservation reste (le vrai bloc n’est pas encore mesuré)', () => {
    const Policy = load();
    assert.equal(Policy.seasonsReservedHeight({
        hasItem: true,
        seasonsFetched: true,
        seasonsCount: 3,
    }) > 0, true);
});
