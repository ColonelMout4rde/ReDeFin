'use strict';

/*
 * GridWindowCache.js — cache de la dernière fenêtre affichée d'une grille de
 * bibliothèque (moviepage.qml), point 1 de la mission « grilles3 ».
 *
 * Constat corrigé (docs/audit-navigation/reseau.md F1, grilles.md F1) : un
 * retour d'une fiche vers la grille refait toujours la requête et reconstruit
 * toutes les vignettes, mesuré à 1,34 s sur Freebox Révolution (0,26 s de
 * réseau + 0,5 s de vignettes + 0,25 s de stabilité). Toute la décision (clé,
 * fraîcheur, signature de contenu, réaffectation) vit ici ; moviepage.qml
 * n'est qu'un appelant.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const { loadQmlJs } = require('./qmljs');

const Cache = loadQmlJs('qml/js/GridWindowCache.js');

test('constantes : au plus 2 entrées, TTL de 120 s', () => {
    assert.equal(Cache.MAX_ENTRIES, 2);
    assert.equal(Cache.TTL_MS, 120000);
});

test('cacheKey distingue serveur, profil, dossier, mode et tri', () => {
    const base = Cache.cacheKey('http://srv', 'u1', 'f1', 'movies', 0, '');
    assert.notEqual(base, Cache.cacheKey('http://other', 'u1', 'f1', 'movies', 0, ''));
    assert.notEqual(base, Cache.cacheKey('http://srv', 'u2', 'f1', 'movies', 0, ''));
    assert.notEqual(base, Cache.cacheKey('http://srv', 'u1', 'f2', 'movies', 0, ''));
    assert.notEqual(base, Cache.cacheKey('http://srv', 'u1', 'f1', 'series', 0, ''));
    assert.notEqual(base, Cache.cacheKey('http://srv', 'u1', 'f1', 'movies', 1, ''));
    assert.equal(base, Cache.cacheKey('http://srv', 'u1', 'f1', 'movies', 0, ''));
});

test('cacheKey ne plante pas sur des paramètres absents', () => {
    assert.equal(Cache.cacheKey(), Cache.cacheKey('', '', '', '', 0, ''));
    assert.doesNotThrow(() => Cache.cacheKey(undefined, null, undefined, null, undefined, undefined));
});

test('computeSignature : vu, position de reprise et compteur de non-vus (UserData ou racine)', () => {
    const a = [
        { Id: '1', UserData: { Played: false, PlaybackPositionTicks: 1000, UnplayedItemCount: 3 } },
        { Id: '2', UserData: { Played: true } }
    ];
    const b = [
        { Id: '1', UserData: { Played: false, PlaybackPositionTicks: 1000, UnplayedItemCount: 3 } },
        { Id: '2', UserData: { Played: true } }
    ];
    assert.equal(Cache.computeSignature(a), Cache.computeSignature(b));

    // Champ à la racine de l'item (forme parfois renvoyée sans UserData) :
    // même signature que la forme UserData équivalente.
    const c = [{ Id: '1', Played: false, PlaybackPositionTicks: 1000, UnplayedItemCount: 3 }, { Id: '2', Played: true }];
    assert.equal(Cache.computeSignature(a), Cache.computeSignature(c));
});

test('computeSignature change quand Played, la position ou le compteur non-vu changent', () => {
    const base = [{ Id: '1', UserData: { Played: false, PlaybackPositionTicks: 1000, UnplayedItemCount: 3 } }];
    const played = [{ Id: '1', UserData: { Played: true, PlaybackPositionTicks: 1000, UnplayedItemCount: 3 } }];
    const moved = [{ Id: '1', UserData: { Played: false, PlaybackPositionTicks: 5000, UnplayedItemCount: 3 } }];
    const unread = [{ Id: '1', UserData: { Played: false, PlaybackPositionTicks: 1000, UnplayedItemCount: 2 } }];
    const sig = Cache.computeSignature(base);
    assert.notEqual(sig, Cache.computeSignature(played));
    assert.notEqual(sig, Cache.computeSignature(moved));
    assert.notEqual(sig, Cache.computeSignature(unread));
});

test('computeSignature ignore IsFavorite (non lu par LibraryPosterCard)', () => {
    const a = [{ Id: '1', UserData: { Played: false, IsFavorite: false } }];
    const b = [{ Id: '1', UserData: { Played: false, IsFavorite: true } }];
    assert.equal(Cache.computeSignature(a), Cache.computeSignature(b));
});

test('computeSignature change avec le nombre d\'items ou leur ordre', () => {
    const two = [{ Id: '1' }, { Id: '2' }];
    const one = [{ Id: '1' }];
    const swapped = [{ Id: '2' }, { Id: '1' }];
    assert.notEqual(Cache.computeSignature(two), Cache.computeSignature(one));
    assert.notEqual(Cache.computeSignature(two), Cache.computeSignature(swapped));
});

test('computeSignature([]) et (null) sont stables et distincts d\'une vraie liste', () => {
    assert.equal(Cache.computeSignature([]), Cache.computeSignature(null));
    assert.notEqual(Cache.computeSignature([]), Cache.computeSignature([{ Id: '1' }]));
});

test('readEntry : miss si rien en cache', () => {
    const r = Cache.readEntry({}, 'k', 1000, 0);
    assert.equal(r.status, 'miss');
    assert.equal(r.entry, null);
});

test('readEntry : hit si présent, frais et même fenêtre', () => {
    const entry = Cache.buildEntry(1000, 0, 50, true, false, [{ Id: '1' }]);
    const bucket = { k: entry };
    const r = Cache.readEntry(bucket, 'k', 1000 + Cache.TTL_MS - 1, 0);
    assert.equal(r.status, 'hit');
    assert.equal(r.entry, entry);
});

test('readEntry : stale une fois le TTL dépassé', () => {
    const entry = Cache.buildEntry(1000, 0, 50, true, false, [{ Id: '1' }]);
    const bucket = { k: entry };
    const r = Cache.readEntry(bucket, 'k', 1000 + Cache.TTL_MS, 0);
    assert.equal(r.status, 'stale');
    assert.equal(r.entry, null);
});

test('readEntry : miss (pas stale) si la fenêtre attendue diffère', () => {
    const entry = Cache.buildEntry(1000, 100, 150, true, true, [{ Id: '1' }]);
    const bucket = { k: entry };
    // La cible de restauration courante pointe vers la fenêtre 0, pas 100 :
    // ce n'est pas la même portion de la bibliothèque, donc pas un hit,
    // et pas davantage un « stale » puisque l'entrée elle-même est fraîche.
    const r = Cache.readEntry(bucket, 'k', 1000, 0);
    assert.equal(r.status, 'miss');
});

test('readEntry : l\'horodatage futur (horloge remise à zéro) ne passe pas pour frais', () => {
    const entry = Cache.buildEntry(2000, 0, 50, true, false, [{ Id: '1' }]);
    const r = Cache.readEntry({ k: entry }, 'k', 1000, 0);
    assert.equal(r.status, 'stale');
});

test('buildEntry conserve les items tels quels et calcule la signature', () => {
    const items = [{ Id: '1', UserData: { Played: true } }];
    const entry = Cache.buildEntry(500, 0, 50, true, false, items);
    assert.equal(entry.ts, 500);
    assert.equal(entry.windowStartIndex, 0);
    assert.equal(entry.nextStart, 50);
    assert.equal(entry.hasMore, true);
    assert.equal(entry.hasPrevious, false);
    assert.deepEqual(entry.rawItems, items);
    assert.equal(entry.signature, Cache.computeSignature(items));
});
