'use strict';
// F3 (audit-fiches.md, detailSeriePage.qml ~1730) : fetchSeasons() ne
// nécessite que itemId (avec serverUrl/accessToken/userId), pas la réponse
// de fetchItem. Avant le correctif, il n'était lancé que dans le callback de
// succès de fetchItem, en série. Vérifié par lecture du source (la page ne
// s'instancie pas en test : réseau, ~3000 lignes).

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const src = fs.readFileSync(
    path.join(__dirname, '..', '..', 'qml', 'pages', 'detailSeriePage.qml'),
    'utf8'
);

test("fetchItemIfReady() lance fetchSeasons() avant Jellyfin.fetchItem(), pas seulement dans son callback de succès", () => {
    const start = src.indexOf('function fetchItemIfReady()');
    assert.notEqual(start, -1);
    const fetchItemCallIdx = src.indexOf('Jellyfin.fetchItem(serverUrl, accessToken, itemId', start);
    assert.notEqual(fetchItemCallIdx, -1);
    const before = src.slice(start, fetchItemCallIdx);

    assert.match(before, /fetchSeasons\(\)/,
        'fetchSeasons() doit être appelé avant le lancement de Jellyfin.fetchItem()');
});

test('le lancement en parallèle reste gardé par seasonsFetched/seasonsFetchInFlight (garde seq déjà en place dans fetchSeasons())', () => {
    const start = src.indexOf('function fetchItemIfReady()');
    const fetchItemCallIdx = src.indexOf('Jellyfin.fetchItem(serverUrl, accessToken, itemId', start);
    const before = src.slice(start, fetchItemCallIdx);
    assert.match(before, /if\s*\(!seasonsFetched\s*&&\s*!seasonsFetchInFlight\)\s*\n?\s*fetchSeasons\(\)/);
});
