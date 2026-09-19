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
 * l'état de décodage d'aucune image.
 *
 * Deuxième bug corrigé (MESURES.md, « Retour d'une fiche vers la grille ») :
 * la levée mesurée arrivait ~250 ms après la restauration (4 passages) au
 * lieu des 150 ms de SETTLE_MS, parce que le Timer appelant sondait toutes
 * les 60 ms sans échantillon au démarrage. POLL_INTERVAL_MS (50 ms, avec un
 * passage immédiat côté QML) aligne la période de sondage sur SETTLE_MS ;
 * MAX_ATTEMPTS passe de 80 à 96 pour garder EXACTEMENT la même durée totale
 * de garde-fou (80*60 = 96*50 = 4800 ms) : seule la latence du cas normal
 * change, pas la protection contre une grille qui ne se stabilise jamais.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadQmlJs } = require('./qmljs');

const GridReveal = loadQmlJs('qml/js/GridRevealPolicy.js');

test('constantes : stabilité courte (150 ms), période de sondage alignée (50 ms), garde-fou à durée totale inchangée', () => {
    assert.equal(GridReveal.SETTLE_MS, 150);
    assert.equal(GridReveal.POLL_INTERVAL_MS, 50);
    assert.equal(GridReveal.MAX_ATTEMPTS, 96);
    // SETTLE_MS doit être un multiple exact de POLL_INTERVAL_MS : sinon un
    // passage supplémentaire serait nécessaire pour franchir le seuil.
    assert.equal(GridReveal.SETTLE_MS % GridReveal.POLL_INTERVAL_MS, 0);
    // Durée totale du garde-fou inchangée par rapport à l'ancien 80 * 60 ms.
    assert.equal(GridReveal.MAX_ATTEMPTS * GridReveal.POLL_INTERVAL_MS, 80 * 60);
});

test('avec un échantillon immédiat au démarrage (triggeredOnStart), la levée arrive à SETTLE_MS pile, sans latence de sondage supplémentaire', () => {
    // Simule moviepage.qml::restoreRevealTimer avec triggeredOnStart:true et
    // interval:POLL_INTERVAL_MS : un passage à l'instant de la restauration
    // (l'état est déjà stable dès ce moment-là), puis un passage toutes les
    // POLL_INTERVAL_MS. Horodatage de départ non nul, comme un vrai
    // Date.now() (0 est la valeur sentinelle « aucune série en cours »).
    const t0 = 1000;
    let state = { attempts: 0, stableSinceMs: 0 };
    let released = null;
    for (let t = t0; released === null; t += GridReveal.POLL_INTERVAL_MS) {
        const r = GridReveal.tick({ delegateReady: true, gridMoving: false,
                                     stableSinceMs: state.stableSinceMs, attempts: state.attempts }, t);
        state = r;
        if (r.release) released = t;
    }
    assert.equal(released, t0 + GridReveal.SETTLE_MS);
    assert.equal(state.reason, 'settled');
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
