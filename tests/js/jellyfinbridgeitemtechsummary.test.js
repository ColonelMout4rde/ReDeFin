'use strict';

/*
 * fetchUserItemTechSummary() — qml/js/jellyfinBridge.js (F6/M2, audit-grilles.md).
 *
 * Constat : au repos du focus, moviepage.qml téléchargeait la fiche COMPLÈTE
 * /Items/{id} (People, MediaSources, Chapters...) pour n'en afficher que des
 * étiquettes techniques dans l'en-tête. Ces étiquettes sont calculées par
 * MediaCatalog.movieStreamInfo() (lit uniquement it.MediaStreams) et
 * MediaCatalog.movieBrowserTagChips() (ajoute it.Genres). Les autres champs
 * scalaires lus par l'en-tête (RunTimeTicks, CommunityRating, OfficialRating,
 * PremiereDate...) sont des propriétés BaseItemDto renvoyées normalement,
 * jamais gagnées par un ItemField (voir le commentaire de _homeListFields()
 * dans jellyfinBridge.js) : elles n'ont donc pas besoin d'être demandées.
 *
 * Cette fonction interroge /Items?Ids=<id> (même endpoint de liste que
 * fetchMovieFolderItemsPage) avec seulement Fields=MediaStreams,Genres,
 * EnableImages=false (aucune image affichée par ce détail) et
 * EnableTotalRecordCount=false (un seul item attendu), et renvoie le premier
 * item de la réponse.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { createBridge, recorder, pathOf, queryOf } = require('./bridgeharness');

const LAN = 'http://192.168.1.5:8096';
const TOKEN = 'tok-TEST';
const USER = 'user-1';

test('URL : /Items?Ids=<id>&UserId=... avec Fields=MediaStreams,Genres et les deux drapeaux attendus', () => {
    const h = createBridge();
    const r = recorder();
    h.bridge.fetchUserItemTechSummary(LAN, TOKEN, USER, 'item-9', r.onSuccess, r.onError);

    const req = h.last();
    assert.equal(pathOf(req.url), LAN + '/Items');
    assert.deepEqual(queryOf(req.url), {
        UserId: USER,
        Ids: 'item-9',
        Fields: 'MediaStreams,Genres',
        EnableImages: 'false',
        EnableTotalRecordCount: 'false',
    });
});

test('le jeton reste dans Authorization, jamais en query', () => {
    const h = createBridge();
    const r = recorder();
    h.bridge.fetchUserItemTechSummary(LAN, TOKEN, USER, 'item-9', r.onSuccess, r.onError);
    const req = h.last();
    assert.equal(req.url.indexOf(TOKEN), -1);
    assert.ok(String(req.requestHeaders.Authorization || '').indexOf(TOKEN) >= 0);
});

test('succès : renvoie le premier item de Items[]', () => {
    const h = createBridge();
    const r = recorder();
    h.bridge.fetchUserItemTechSummary(LAN, TOKEN, USER, 'item-9', r.onSuccess, r.onError);
    h.last().respondJson({ Items: [{ Id: 'item-9', Name: 'Film', MediaStreams: [], Genres: ['Action'] }] });
    assert.equal(r.calls, 1);
    assert.equal(r.ok[0].Id, 'item-9');
    assert.equal(r.ok[0].Genres.length, 1);
    assert.equal(r.ok[0].Genres[0], 'Action');
});

test('réponse sans item => bad_response, pas de succès', () => {
    const h = createBridge();
    const r = recorder();
    h.bridge.fetchUserItemTechSummary(LAN, TOKEN, USER, 'item-9', r.onSuccess, r.onError);
    h.last().respondJson({ Items: [] });
    assert.equal(r.ok.length, 0);
    assert.deepEqual(r.ko, ['bad_response']);
});

test('erreur HTTP => code traduit, un seul rappel', () => {
    const h = createBridge();
    const r = recorder();
    h.bridge.fetchUserItemTechSummary(LAN, TOKEN, USER, 'item-9', r.onSuccess, r.onError);
    h.last().respond({ status: 500, body: '{}' });
    assert.equal(r.calls, 1);
    assert.deepEqual(r.ko, ['http_500']);
});

test('paramètres manquants => missing_params sans requête réseau', () => {
    for (const args of [['', TOKEN, USER, 'i1'], [LAN, '', USER, 'i1'],
                        [LAN, TOKEN, '', 'i1'], [LAN, TOKEN, USER, '']]) {
        const h = createBridge();
        const r = recorder();
        h.bridge.fetchUserItemTechSummary(args[0], args[1], args[2], args[3], r.onSuccess, r.onError);
        h.flush();
        assert.equal(h.sentCount(), 0, JSON.stringify(args));
        assert.deepEqual(r.ko, ['missing_params'], JSON.stringify(args));
    }
});
