'use strict';

/*
 * moviepage.qml — visibilité du délégué de la GridView.
 *
 * Constat (audit-grilles.md F4) : le délégué recalculait
 * `moviepage.indexVisible(index)` à chaque changement de contentY, donc un
 * appel JavaScript par délégué ET par image pendant un glissement. Sa marge
 * (≥360 px, voire cellHeight*1,5) dépassait déjà le cacheBuffer de la
 * GridView (~0,42 × hauteur de la vue) : tout délégué réellement instancié
 * par reuseItems/cacheBuffer se trouvait donc toujours dans cette marge, ce
 * qui rend le garde-fou constamment vrai et donc redondant.
 *
 * Vérifié avant correctif : `allowLoad` de LibraryPosterCard combine
 * `movieLibraryDelegate.visible && moviepage.visible` — un autre code
 * dépendait donc bien de cette propriété pour charger les images. Comme le
 * garde-fou était toujours vrai en pratique (marge > cacheBuffer), le fixer à
 * `true` ne change pas ce qui charge aujourd'hui ; il rend surtout possible
 * l'élargissement de cacheBuffer (F5) sans que ce garde-fou ne se remette à
 * masquer les nouveaux délégués préchargés.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const SOURCE = path.join(__dirname, '..', '..', 'qml', 'pages', 'moviepage.qml');
const src = fs.readFileSync(SOURCE, 'utf8');

test('le délégué de la grille n\'appelle plus indexVisible() par image', () => {
    assert.equal(src.includes('indexVisible'), false);
});

test('le délégué déclare visible: true', () => {
    const idx = src.indexOf('delegate: Item {');
    assert.notEqual(idx, -1);
    const block = src.slice(idx, idx + 900);
    assert.match(block, /visible:\s*true/);
});

test('allowLoad de LibraryPosterCard continue de dépendre de la visibilité de la page (moviepage.visible)', () => {
    assert.match(src, /allowLoad:\s*movieLibraryDelegate\.visible\s*&&\s*moviepage\.visible/);
});
