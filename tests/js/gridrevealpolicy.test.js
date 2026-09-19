'use strict';

/*
 * GridRevealPolicy.js — quand lever le rideau de restauration de la grille
 * de bibliothèque (moviepage.qml).
 *
 * Bug/constat corrigé (audit-grilles.md, F1) : le rideau exigeait l'affiche
 * focalisée entièrement décodée PLUS 1100 ms de stabilité ininterrompue,
 * héritage du principe upstream « ne jamais montrer une affiche qui apparaît
 * après coup ». Décision produit : les affiches peuvent arriver
 * progressivement ; le rideau ne protège plus que le focus et la mise en
 * page. La fenêtre de stabilité tombe donc à 150 ms et ne dépend plus de
 * l'état de décodage d'aucune image. Le garde-fou de temps maximal (nombre
 * de passages) est conservé à l'identique.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadQmlJs } = require('./qmljs');

const GridReveal = loadQmlJs('qml/js/GridRevealPolicy.js');

test('constantes : stabilité courte (150 ms), garde-fou de passages inchangé (80)', () => {
    assert.equal(GridReveal.SETTLE_MS, 150);
    assert.equal(GridReveal.MAX_ATTEMPTS, 80);
});

test('pas prêt (focus non posé ou grille en mouvement) : jamais de release, la série de stabilité est purgée', () => {
    const r = GridReveal.tick({ delegateReady: false, gridMoving: false, stableSinceMs: 500, attempts: 3 }, 1000);
    assert.equal(r.release, false);
    assert.equal(r.reason, null);
    assert.equal(r.stableSinceMs, 0);
    assert.equal(r.attempts, 4);
});

test('grille en mouvement malgré un délégué posé : pas de release, série purgée', () => {
    const r = GridReveal.tick({ delegateReady: true, gridMoving: true, stableSinceMs: 500, attempts: 3 }, 1000);
    assert.equal(r.release, false);
    assert.equal(r.stableSinceMs, 0);
});

test('premier passage stable : amorce la série mais ne libère pas avant SETTLE_MS', () => {
    const r = GridReveal.tick({ delegateReady: true, gridMoving: false, stableSinceMs: 0, attempts: 0 }, 1000);
    assert.equal(r.release, false);
    assert.equal(r.stableSinceMs, 1000);
    assert.equal(r.attempts, 1);
});

test('stable depuis SETTLE_MS : release avec la raison "settled", sans attendre 1100 ms', () => {
    const r = GridReveal.tick({ delegateReady: true, gridMoving: false, stableSinceMs: 1000, attempts: 5 }, 1000 + GridReveal.SETTLE_MS);
    assert.equal(r.release, true);
    assert.equal(r.reason, 'settled');
});

test('stable depuis moins de SETTLE_MS : ne libère pas encore', () => {
    const r = GridReveal.tick({ delegateReady: true, gridMoving: false, stableSinceMs: 1000, attempts: 5 }, 1000 + GridReveal.SETTLE_MS - 1);
    assert.equal(r.release, false);
});

test('garde-fou de temps maximal : release forcée même si jamais stable', () => {
    const r = GridReveal.tick({ delegateReady: false, gridMoving: false, stableSinceMs: 0, attempts: GridReveal.MAX_ATTEMPTS - 1 }, 999999);
    assert.equal(r.release, true);
    assert.equal(r.reason, 'timeout-guard');
});

test('tick() ne mute jamais l\'objet state reçu', () => {
    const state = { delegateReady: true, gridMoving: false, stableSinceMs: 0, attempts: 0 };
    const frozen = JSON.parse(JSON.stringify(state));
    GridReveal.tick(state, 1234);
    assert.deepEqual(state, frozen);
});
