'use strict';
// M1 (audit-fiches.md) : detailMoviePage.qml doit fournir item.Chapters à
// ChaptersCarousel via sa nouvelle propriété itemChapters, au lieu de la
// laisser refaire son propre GET complet de l'item. Le comportement du
// composant est couvert par tests/qml/tst_chapterscarousel.qml (câblage réel
// via Qt Quick Test) ; ce test vérifie seulement le point d'entrée côté page
// par lecture du source (chaptersLoader.onLoaded).

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const src = fs.readFileSync(
    path.join(__dirname, '..', '..', 'qml', 'pages', 'detailMoviePage.qml'),
    'utf8'
);

test('chaptersLoader.onLoaded fournit item.itemChapters depuis detailMoviePage.item.Chapters', () => {
    const idx = src.indexOf('id: chaptersLoader');
    assert.notEqual(idx, -1);
    const onLoadedIdx = src.indexOf('onLoaded:', idx);
    assert.notEqual(onLoadedIdx, -1);
    const block = src.slice(onLoadedIdx, onLoadedIdx + 900);
    assert.match(block, /item\.itemChapters\s*=\s*Qt\.binding\(/);
    assert.match(block, /detailMoviePage\.item\s*&&\s*detailMoviePage\.item\.Chapters\s*!==\s*undefined/);
    assert.match(block, /detailMoviePage\.item\.Chapters\s*:\s*null/);
});
