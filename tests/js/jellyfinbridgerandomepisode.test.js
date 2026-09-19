'use strict';

/*
 * Point 4 de l'audit réseau : fetchRandomEpisode() ne lit jamais le total
 * (un seul item est demandé, Limit=1, et seul items[0] est utilisé), mais
 * omettait EnableTotalRecordCount=false, forçant Jellyfin à compter la
 * bibliothèque entière pour un résultat jeté.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { createBridge, recorder, queryOf } = require('./bridgeharness');

const LAN = 'http://192.168.1.5:8096';
const TOKEN = 'tok-TEST';
const USER = 'user-1';

test('fetchRandomEpisode : EnableTotalRecordCount=false, total jamais lu', () => {
    const h = createBridge();
    const r = recorder();
    h.bridge.fetchRandomEpisode(LAN, TOKEN, USER, 'parent-1', false, r.onSuccess, r.onError);
    assert.equal(queryOf(h.last().url).EnableTotalRecordCount, 'false');

    h.last().respondJson({ Items: [{ Id: 'ep1' }], TotalRecordCount: 1234 });
    assert.equal(r.ko.length, 0);
    assert.equal(r.ok[0].Id, 'ep1');
});

test('fetchRandomEpisode : même paramètre sur le repli "déjà vu" quand Filters=IsUnplayed échoue', () => {
    const h = createBridge();
    const r = recorder();
    h.bridge.fetchRandomEpisode(LAN, TOKEN, USER, 'parent-1', true, r.onSuccess, r.onError);
    const first = h.last();
    assert.equal(queryOf(first.url).Filters, 'IsUnplayed');
    assert.equal(queryOf(first.url).EnableTotalRecordCount, 'false');

    first.respondJson({ Items: [] });
    const second = h.last();
    assert.notEqual(second, first, 'un repli doit repartir sur une deuxième requête');
    assert.equal(queryOf(second.url).Filters, undefined);
    assert.equal(queryOf(second.url).EnableTotalRecordCount, 'false');
});
