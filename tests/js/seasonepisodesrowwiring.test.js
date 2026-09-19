'use strict';
// Câblage lot 3 (BRIEF-COMMUN.md / MESURES.md « page saison ») :
// SeasonEpisodesRow.qml expose currentItemReady pour que seasonpage.qml
// puisse s'assurer, avant de lever le rideau, que le délégué de l'épisode
// courant est réellement créé (pas seulement son index posé). Composant non
// instancié en test (réseau/model) : câblage vérifié par lecture du source,
// comme documenté dans CLAUDE.md.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const SRC = fs.readFileSync(
    path.join(__dirname, '..', '..', 'qml', 'components', 'SeasonEpisodesRow.qml'),
    'utf8'
);

test('SeasonEpisodesRow.qml expose currentItemReady, dérivé de list.currentItem', () => {
    assert.match(SRC, /readonly property bool currentItemReady:\s*!!\(list && list\.currentItem\)/);
});
