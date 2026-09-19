'use strict';

/*
 * Décision pure du rideau de l'accueil (qml/js/HomeGatePolicy.js).
 * Voir docs/audit-navigation/accueil.md, constat 2, et mission « accueil »
 * lot 3 : la porte ne doit plus attendre latestFetchCompleted, sauf quand
 * une restauration de focus en attente vise la rangée « Récemment ajouté ».
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const { loadQmlJs } = require('./qmljs');

const Policy = loadQmlJs('qml/js/HomeGatePolicy.js');

function baseReadyState(overrides) {
    return Object.assign({
        hasPosterGrid: true,
        fetchedOnce: true,
        libraryFetchCompleted: true,
        resumeFetchCompleted: true,
        nextUpFetchCompleted: true,
        latestFetchCompleted: false,
        pendingFocusRestoreTargetsLatest: false,
        revealReady: true,
        waitForHomePosters: false,
        postersReady: false,
        sinceLoadingStartMs: 10000,
        sinceFetchedOnceMs: 10000,
        sinceLastChangeMs: 10000,
        minLoadingMs: 900,
        afterFetchedOnceMinMs: 900,
        settleMs: 250
    }, overrides || {});
}

test('sans postergrid, cause=no-postergrid', () => {
    const r = Policy.canFinish({ hasPosterGrid: false });
    assert.equal(r.finish, false);
    assert.equal(r.cause, 'no-postergrid');
});

test('ordre des causes bloquantes avant Latest : fetchedOnce puis library/resume/nextUp', () => {
    assert.equal(Policy.canFinish({ hasPosterGrid: true, fetchedOnce: false }).cause, 'fetchedOnce');
    assert.equal(Policy.canFinish({
        hasPosterGrid: true, fetchedOnce: true, libraryFetchCompleted: false
    }).cause, 'libraryFetchCompleted');
    assert.equal(Policy.canFinish({
        hasPosterGrid: true, fetchedOnce: true, libraryFetchCompleted: true, resumeFetchCompleted: false
    }).cause, 'resumeFetchCompleted');
    assert.equal(Policy.canFinish({
        hasPosterGrid: true, fetchedOnce: true, libraryFetchCompleted: true,
        resumeFetchCompleted: true, nextUpFetchCompleted: false
    }).cause, 'nextUpFetchCompleted');
});

test('constat traité : latestFetchCompleted ne bloque plus la porte par défaut', () => {
    // Mes médias / Reprendre / À suivre prêts, Latest encore en vol, aucune
    // restauration de focus en attente : la porte doit pouvoir se lever
    // (le reveal peut lui-même bloquer sur autre chose, mais pas sur Latest).
    const r = Policy.canFinish(baseReadyState({ latestFetchCompleted: false, pendingFocusRestoreTargetsLatest: false }));
    assert.equal(r.finish, true);
    assert.equal(r.cause, '');
});

test('exception : une restauration de focus visant Latest continue d\'attendre latestFetchCompleted', () => {
    const blocked = Policy.canFinish(baseReadyState({
        latestFetchCompleted: false, pendingFocusRestoreTargetsLatest: true
    }));
    assert.equal(blocked.finish, false);
    assert.equal(blocked.cause, 'latestFetchCompleted');

    const unblocked = Policy.canFinish(baseReadyState({
        latestFetchCompleted: true, pendingFocusRestoreTargetsLatest: true
    }));
    assert.equal(unblocked.finish, true);
});

test('homeRevealReady bloque tant que le focus n\'est pas placé', () => {
    const r = Policy.canFinish(baseReadyState({ revealReady: false }));
    assert.equal(r.finish, false);
    assert.equal(r.cause, 'homeRevealReady');
});

test('waitForHomePosters ne bloque que lorsqu\'il est actif', () => {
    const blocked = Policy.canFinish(baseReadyState({ waitForHomePosters: true, postersReady: false }));
    assert.equal(blocked.cause, 'waitForHomePosters');

    const ready = Policy.canFinish(baseReadyState({ waitForHomePosters: true, postersReady: true }));
    assert.equal(ready.finish, true);

    const ignored = Policy.canFinish(baseReadyState({ waitForHomePosters: false, postersReady: false }));
    assert.equal(ignored.finish, true);
});

test('délais minLoadingMs / afterFetchedOnceMinMs / settleMs, dans cet ordre', () => {
    assert.equal(Policy.canFinish(baseReadyState({ sinceLoadingStartMs: 0 })).cause, 'minLoadingMs');
    assert.equal(Policy.canFinish(baseReadyState({ sinceFetchedOnceMs: 0 })).cause, 'afterFetchedOnceMinMs');
    assert.equal(Policy.canFinish(baseReadyState({ sinceLastChangeMs: 0 })).cause, 'settleMs');
    assert.equal(Policy.canFinish(baseReadyState({})).finish, true);
});

test('retour rapide (fastHomeReturn) : des délais nuls ne bloquent rien', () => {
    const r = Policy.canFinish(baseReadyState({
        sinceLoadingStartMs: 0, sinceFetchedOnceMs: 0, sinceLastChangeMs: 0,
        minLoadingMs: 0, afterFetchedOnceMinMs: 0, settleMs: 40
    }));
    assert.equal(r.finish, false);
    assert.equal(r.cause, 'settleMs');
});
