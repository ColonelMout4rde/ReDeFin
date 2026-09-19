'use strict';

/*
 * F4 (audit-fiches.md) : jellyfinBridge.js#fetchSeriesAverageEpisodeRuntimeTicks
 * paginait TOUS les épisodes de la série (pages de 100, jusqu'à 3000) juste
 * pour afficher une durée moyenne pendant l'ouverture de la fiche. Corrigé
 * pour :
 *   - répondre sans requête réseau quand la série connaît déjà une durée
 *     d'épisode plausible (RunTimeTicks) ;
 *   - sinon, faire un seul appel borné (Limit=20) au lieu de paginer.
 *
 * Simulé via bridgeharness.js (aucune requête réelle, horloge figée).
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { createBridge, queryOf, pathOf } = require('./bridgeharness');

const LAN = 'http://192.168.1.5:8096';
const TOKEN = 'tok-TEST';
const USER = 'user-1';
const SERIES = 'series-1';

// 30 minutes, en ticks (unité Jellyfin : 100 ns).
const THIRTY_MIN_TICKS = 30 * 60 * 10000000;

test('RunTimeTicks connu et plausible : aucune requête réseau, réponse immédiate', () => {
    const h = createBridge();
    const calls = [];
    h.bridge.fetchSeriesAverageEpisodeRuntimeTicks(
        LAN, TOKEN, USER, SERIES, THIRTY_MIN_TICKS,
        (ticks) => calls.push(['ok', ticks]),
        (err) => calls.push(['err', err])
    );
    // Convention bridgeharness : un chemin sans requête réseau exige un
    // flush explicite pour que le rappel soit exécuté.
    h.flush();
    assert.equal(h.sentCount(), 0, 'aucun aller-retour /Shows/.../Episodes ne doit partir');
    assert.deepEqual(calls, [['ok', THIRTY_MIN_TICKS]]);
});

test("pas de RunTimeTicks plausible : un seul appel borné Limit=20, pas de pagination", () => {
    const h = createBridge();
    const calls = [];
    h.bridge.fetchSeriesAverageEpisodeRuntimeTicks(
        LAN, TOKEN, USER, SERIES, 0,
        (ticks) => calls.push(['ok', ticks]),
        (err) => calls.push(['err', err])
    );
    assert.equal(h.sentCount(), 1, 'exactement un aller-retour, jamais une pagination');
    const xhr = h.last();
    assert.equal(pathOf(xhr.url), LAN + '/Shows/' + SERIES + '/Episodes');
    assert.deepEqual(queryOf(xhr.url).Limit, '20');
    assert.equal(queryOf(xhr.url).UserId, USER);

    xhr.respondJson({
        Items: [
            { Id: 'e1', Type: 'Episode', RunTimeTicks: 20 * 60 * 10000000 },
            { Id: 'e2', Type: 'Episode', RunTimeTicks: 40 * 60 * 10000000 },
        ],
    });
    assert.equal(h.sentCount(), 1, 'la réponse ne doit déclencher aucune page suivante');
    assert.deepEqual(calls, [['ok', 30 * 60 * 10000000]]);
});

test('paramètres manquants et pas de RunTimeTicks plausible : erreur, aucune requête', () => {
    const h = createBridge();
    const calls = [];
    h.bridge.fetchSeriesAverageEpisodeRuntimeTicks(
        '', TOKEN, USER, SERIES, 0,
        (ticks) => calls.push(['ok', ticks]),
        (err) => calls.push(['err', err])
    );
    h.flush();
    assert.equal(h.sentCount(), 0);
    assert.deepEqual(calls, [['err', 'missing_params']]);
});

test("échec réseau de l'appel borné : l'appelant reçoit une erreur (le repli sur RunTimeTicks reste de son ressort)", () => {
    const h = createBridge();
    const calls = [];
    h.bridge.fetchSeriesAverageEpisodeRuntimeTicks(
        LAN, TOKEN, USER, SERIES, 0,
        (ticks) => calls.push(['ok', ticks]),
        (err) => calls.push(['err', err])
    );
    h.last().failNetwork();
    assert.equal(calls.length, 1);
    assert.equal(calls[0][0], 'err');
});

test('un RunTimeTicks trop grand pour être un épisode (agrégat série) déclenche quand même l\'appel borné', () => {
    const h = createBridge();
    const calls = [];
    // seriesRuntimeTicksFallback() rejette tout ce qui dépasse 4h : un total
    // de série (ex. 10 saisons) ne doit pas être confondu avec une durée
    // d'épisode plausible.
    const impossiblyLong = 100 * 60 * 60 * 10000000;
    h.bridge.fetchSeriesAverageEpisodeRuntimeTicks(
        LAN, TOKEN, USER, SERIES, impossiblyLong,
        (ticks) => calls.push(['ok', ticks]),
        (err) => calls.push(['err', err])
    );
    assert.equal(h.sentCount(), 1);
    assert.deepEqual(queryOf(h.last().url).Limit, '20');
});
