'use strict';

/*
 * moviepage.qml — câblage du détail de l'item focalisé (F6/M2, audit-grilles.md).
 *
 * Le résumé technique léger (Jellyfin.fetchUserItemTechSummary, Fields=
 * MediaStreams,Genres) remplace fetchItem() (fiche complète) pour les modes
 * Films/Séries/Mixte, dont l'en-tête ne lit que MediaStreams et Genres. Le
 * mode « personal » garde fetchItem() : MediaCatalog.personalMediaStreamInfo()
 * lit en plus Width/Height/Container/Bitrate (dimensions d'une photo), hors
 * du périmètre du résumé technique.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const SOURCE = path.join(__dirname, '..', '..', 'qml', 'pages', 'moviepage.qml');
const src = fs.readFileSync(SOURCE, 'utf8');

const fnStart = src.indexOf('function _fetchSelectedItemDetailForTags()');
const fnEnd = src.indexOf('\n    }', fnStart);
const fnBlock = src.slice(fnStart, fnEnd);

test('_fetchSelectedItemDetailForTags existe et a bien été isolée', () => {
    assert.notEqual(fnStart, -1);
    assert.ok(fnBlock.length > 0 && fnBlock.length < 3000);
});

test('mode personnel : garde fetchItem() (fiche complète)', () => {
    assert.match(fnBlock, /if \(personalMode\) \{[\s\S]*?Jellyfin\.fetchItem\(serverUrl, accessToken, id, onDetail, onDetailError\)/);
});

test('autres modes : utilise fetchUserItemTechSummary() (résumé léger)', () => {
    assert.match(fnBlock, /else \{[\s\S]*?Jellyfin\.fetchUserItemTechSummary\(serverUrl, accessToken, userId, id, onDetail, onDetailError\)/);
});
