'use strict';

/*
 * Câblage du cache de fenêtre de grille (GridWindowCache.js) dans
 * moviepage.qml — point 1 de la mission « grilles3 » (docs/audit-navigation
 * F1). Toute la décision vit dans le module pur (tests/js/gridwindowcache.test.js) ;
 * ce test lit seulement le source QML pour vérifier que moviepage l'appelle
 * bien et respecte le contrat attendu : lecture de cache uniquement
 * synchrone (pas de réseau), revalidation séparée qui ne réaffecte le modèle
 * que si le contenu diffère, retour arrière en une ligne via
 * gridWindowCacheEnabled, et une entrée de cache par grille annulée à la
 * destruction de la page.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const SOURCE = path.join(__dirname, '..', '..', 'qml', 'pages', 'moviepage.qml');
const src = fs.readFileSync(SOURCE, 'utf8');

test('moviepage importe GridWindowCache.js sous l\'alias GridWindowCache', () => {
    assert.match(src, /import\s+"\.\.\/js\/GridWindowCache\.js"\s+as\s+GridWindowCache/);
});

test('un interrupteur nommé permet un retour arrière en une ligne', () => {
    assert.match(src, /readonly property bool gridWindowCacheEnabled: true/);
});

test('fetchFolder tente le cache avant de partir en réseau, sauf bypass explicite', () => {
    const idx = src.indexOf('function fetchFolder(bypassCache)');
    assert.notEqual(idx, -1);
    const body = src.slice(idx, idx + 1800);
    const cacheIdx = body.indexOf('_tryServeFromWindowCache()');
    const requestIdx = body.indexOf('_requestFolderPage(true)');
    assert.notEqual(cacheIdx, -1);
    assert.notEqual(requestIdx, -1);
    assert.ok(cacheIdx < requestIdx, 'le cache doit être tenté avant le départ réseau normal');
    assert.match(body, /if \(!bypassCache && gridWindowCacheEnabled/);
});

test('la revalidation ne réaffecte le modèle que si la signature diffère', () => {
    const idx = src.indexOf('function _revalidateWindowCache');
    assert.notEqual(idx, -1);
    const body = src.slice(idx, idx + 1200);
    assert.match(body, /GridWindowCache\.computeSignature/);
    assert.match(body, /if \(changed\) fetchFolder\(true\)/);
    // Elle ne doit PAS passer par le pipeline générique de fusion de page
    // (browserAppendWindowItems ignore un identifiant déjà connu, donc un
    // simple vu/reprise mis à jour resterait invisible).
    assert.doesNotMatch(body, /_appendWindowFolderItems/);
});

test('les traces GRID7 couvrent hit/miss/stale et le résultat de la revalidation', () => {
    assert.match(src, /DevLog\.log\("GRID7", "cache " \+ res\.status\)/);
    assert.match(src, /DevLog\.log\("GRID7", "cache hit/);
    assert.match(src, /DevLog\.log\("GRID7", "cache revalidated changed=" \+ changed\)/);
});

test('la revalidation en cours est annulée à la destruction de la page', () => {
    const idx = src.indexOf('Component.onDestruction');
    assert.notEqual(idx, -1);
    const body = src.slice(idx, idx + 300);
    assert.match(body, /_cancelWindowCacheRevalidate\("destroyed"\)/);
});

test('la clé de cache inclut serveur et profil (protection changement de serveur/profil)', () => {
    const idx = src.indexOf('function _windowCacheKey');
    assert.notEqual(idx, -1);
    const body = src.slice(idx, idx + 300);
    assert.match(body, /GridWindowCache\.cacheKey\(serverUrl, userId, folderId, normalizedLibraryMode, sortMode/);
});
