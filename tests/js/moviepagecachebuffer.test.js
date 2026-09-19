'use strict';

/*
 * moviepage.qml — cacheBuffer de la GridView de bibliothèque.
 *
 * Constat (audit-grilles.md F5) : cacheBuffer valait 0,42 × la hauteur de la
 * vue (~245 px), inférieur à une cellule (~293 px). La rangée N+2 était donc
 * créée PENDANT le glissement plutôt que d'être prête à l'arrêt. Porté à une
 * rangée entière (gridCellH), dans une constante nommée et commentée sur le
 * compromis mémoire (une rangée de délégués/images en plus reste toujours
 * hors du viewport, RAM limitée sur Révolution).
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const SOURCE = path.join(__dirname, '..', '..', 'qml', 'pages', 'moviepage.qml');
const src = fs.readFileSync(SOURCE, 'utf8');

test('la marge de cache de la grille est une constante nommée valant une rangée (gridCellH)', () => {
    assert.match(src, /readonly property int\s+gridCacheBufferPx:\s*gridCellH/);
});

test('la constante porte un commentaire sur le compromis mémoire', () => {
    const idx = src.indexOf('gridCacheBufferPx');
    assert.notEqual(idx, -1);
    const before = src.slice(Math.max(0, idx - 700), idx);
    assert.match(before, /mémoire/i);
});

test('la GridView utilise cette constante pour cacheBuffer (plus de calcul en 0,42 × height)', () => {
    assert.match(src, /cacheBuffer:\s*gridCacheBufferPx/);
    assert.equal(/cacheBuffer:\s*Math\.round\(height \* 0\.42\)/.test(src), false);
});
