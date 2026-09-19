'use strict';
// Point 4 (BRIEF-COMMUN.md, fiches lot 2) : NextUpBlock.qml refait un GET
// /Shows/{id}/Seasons (_ensureSeasons(), pour sa barre de position saison)
// alors que detailSeriePage.qml a déjà (ou aura, en parallèle, F3) la même
// liste. Vérifié par lecture du source (la page ne s'instancie pas en
// test : réseau, ~3100 lignes) — le comportement du composant lui-même est
// couvert par tests/qml/tst_nextupblock_seasonshint.qml.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const src = fs.readFileSync(
    path.join(__dirname, '..', '..', 'qml', 'pages', 'detailSeriePage.qml'),
    'utf8'
);

test('wireNextUpLoader() passe seasonsHint (garde hasOwnProperty, comme fallbackPosterUrl/seriesScopedOnly)', () => {
    const start = src.indexOf('function wireNextUpLoader()');
    assert.notEqual(start, -1);
    const end = src.indexOf('function _applySeriesUserDataFlag', start);
    const body = src.slice(start, end);
    assert.match(body, /if\s*\(it\.hasOwnProperty\("seasonsHint"\)\)\s*it\.seasonsHint\s*=\s*seasonsFetched\s*\?\s*seasons\s*:\s*null/);
});

test("fetchSeasons() relaie la réponse à nextUpLoader.item.seasonsHint si le rail est déjà chargé", () => {
    const start = src.indexOf('function fetchSeasons(isRetry)');
    assert.notEqual(start, -1);
    const end = src.indexOf('function fetchSeasons', start + 1) === -1
        ? src.indexOf('function _resetAverageEpisodeDuration', start)
        : src.length;
    const body = src.slice(start, start + 3000);
    assert.match(body, /nextUpLoader\.item\.seasonsHint\s*=\s*seasons/);
});

test('NextUpBlock.qml déclare seasonsHint et retombe sur le réseau si absente/scopée à une autre série', () => {
    const nextUp = fs.readFileSync(
        path.join(__dirname, '..', '..', 'qml', 'pages', 'NextUpBlock.qml'),
        'utf8'
    );
    assert.match(nextUp, /property var\s+seasonsHint:\s*null/);
    assert.match(nextUp, /function _seasonsFromHint\(sId\)/);
    assert.match(nextUp, /function _ensureSeasons\(sId\)\{[\s\S]*?_seasonsFromHint\(sId\)/);
    // Le repli réseau (Jellyfin.fetchSeasons) doit toujours exister derrière.
    assert.match(nextUp, /Jellyfin\.fetchSeasons\(serverUrl, accessToken, userId, sId/);
});
