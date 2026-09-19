'use strict';

/*
 * Câblage de GridFetchDispatch.js dans moviepage.qml — point 2 de la mission
 * « grilles3 » (docs/audit-navigation/grilles.md, GRID1→GRID2 mesuré à
 * 190 ms). La décision pure est testée dans tests/js/gridfetchdispatch.test.js ;
 * ce test lit le source QML pour vérifier que scheduleFetchFolder() délègue
 * bien à GridFetchDispatch.nextAction() et ne déclenche jamais fetchFolder()
 * de façon synchrone depuis un onXChanged (toujours Qt.callLater, pour ne
 * pas lire des propriétés que ShellPage n'a pas fini d'injecter).
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const SOURCE = path.join(__dirname, '..', '..', 'qml', 'pages', 'moviepage.qml');
const src = fs.readFileSync(SOURCE, 'utf8');

test('moviepage importe GridFetchDispatch.js sous l\'alias GridFetchDispatch', () => {
    assert.match(src, /import\s+"\.\.\/js\/GridFetchDispatch\.js"\s+as\s+GridFetchDispatch/);
});

test('scheduleFetchFolder délègue la décision à GridFetchDispatch.nextAction', () => {
    const idx = src.indexOf('function scheduleFetchFolder()');
    assert.notEqual(idx, -1);
    const body = src.slice(idx, idx + 1200);
    assert.match(body, /GridFetchDispatch\.nextAction\(/);
    assert.match(body, /contextComplete: !!\(accessToken && userId && serverUrl && folderId\)/);
});

test('le départ immédiat passe par Qt.callLater, jamais un appel synchrone', () => {
    const idx = src.indexOf('if (action.immediate)');
    assert.notEqual(idx, -1);
    const body = src.slice(idx, idx + 450);
    assert.match(body, /Qt\.callLater\(_dispatchFetchNow\)/);
    assert.doesNotMatch(body, /\bfetchFolder\(\)/);
});

test('_dispatchFetchNow marque le premier départ effectué avant d\'appeler fetchFolder', () => {
    const idx = src.indexOf('function _dispatchFetchNow()');
    assert.notEqual(idx, -1);
    const body = src.slice(idx, idx + 200);
    const flagIdx = body.indexOf('_firstFetchDispatched = true');
    const callIdx = body.indexOf('fetchFolder()');
    assert.notEqual(flagIdx, -1);
    assert.notEqual(callIdx, -1);
    assert.ok(flagIdx < callIdx);
});

test('l\'anti-rebond n\'est (re)armé que si l\'action le demande', () => {
    const idx = src.indexOf('if (action.arm) fetchDebounceTimer.restart()');
    assert.notEqual(idx, -1);
});
