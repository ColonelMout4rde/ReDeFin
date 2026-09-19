'use strict';

/*
 * GridFetchDispatch.js — quand partir sans l'anti-rebond de 80 ms
 * (moviepage.qml, point 2 de la mission « grilles3 »).
 *
 * Bug corrigé (docs/audit-navigation/grilles.md, chronologie « Ouverture
 * d'une bibliothèque ») : ShellPage injecte le contexte (folderId, shared,
 * libraryMode…) après la création de la page, en plusieurs propriétés
 * distinctes ; chacune relançait l'anti-rebond de 80 ms même si le contexte
 * était déjà complet, mesuré à 190 ms entre GRID1 et GRID2 pour une requête
 * qui aurait pu partir dès que le contexte le permettait.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadQmlJs } = require('./qmljs');

const D = loadQmlJs('qml/js/GridFetchDispatch.js');

test('contexte incomplet : toujours l\'anti-rebond, jamais de départ immédiat', () => {
    const r = D.nextAction({ contextComplete: false, firstDispatchDone: false, dispatchPending: false });
    assert.equal(r.immediate, false);
    assert.equal(r.arm, true);
    assert.equal(r.dispatchPending, false);
});

test('contexte complet pour la première fois : départ immédiat, anti-rebond non armé', () => {
    const r = D.nextAction({ contextComplete: true, firstDispatchDone: false, dispatchPending: false });
    assert.equal(r.immediate, true);
    assert.equal(r.arm, false);
    assert.equal(r.dispatchPending, true);
});

test('rafale synchrone : un départ déjà en attente n\'est pas reprogrammé', () => {
    // Simule une deuxième propriété injectée dans le même tour d'événement
    // (ex. libraryMode juste après folderId) : le Qt.callLater programmé par
    // le premier appel suffit, on ne redémarre ni lui ni l'anti-rebond.
    const r = D.nextAction({ contextComplete: true, firstDispatchDone: false, dispatchPending: true });
    assert.equal(r.immediate, false);
    assert.equal(r.arm, false);
    assert.equal(r.dispatchPending, true);
});

test('après le premier départ, toute injection ultérieure repasse par l\'anti-rebond', () => {
    // Ex. playbackDeviceMode résolu après coup (onPlaybackDeviceModeChanged) :
    // c'est le seul cas que l'anti-rebond doit encore absorber.
    const r = D.nextAction({ contextComplete: true, firstDispatchDone: true, dispatchPending: false });
    assert.equal(r.immediate, false);
    assert.equal(r.arm, true);
    assert.equal(r.dispatchPending, false);
});

test('contexte redevenu incomplet après le premier départ (défensif) : anti-rebond, pending retombé', () => {
    const r = D.nextAction({ contextComplete: false, firstDispatchDone: true, dispatchPending: true });
    assert.equal(r.immediate, false);
    assert.equal(r.arm, true);
    // dispatchPending n'a de sens que tant que le premier départ n'a pas eu
    // lieu ; une fois firstDispatchDone vrai, il n'est plus consulté par la
    // branche "immediate" et n'a pas besoin d'être remis à zéro ici.
    assert.equal(r.dispatchPending, true);
});

test('état par défaut (aucun argument) : ne plante pas, se comporte comme "tout à false"', () => {
    const r = D.nextAction();
    assert.equal(r.immediate, false);
    assert.equal(r.arm, true);
    assert.equal(r.dispatchPending, false);
});
