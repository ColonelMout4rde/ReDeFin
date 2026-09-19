'use strict';
// M2 (audit-fiches.md) : le préchauffage des portraits de casting du film
// demandait 322x483 q82, une URL qui ne correspond jamais à celle utilisée
// par CastPage.qml (226x339 q85 selon l'audit ; les tailles exactes suivent
// cardWidth/posterOversample, mais quality diffère aussi) : les images
// préchargées n'étaient donc jamais réutilisées, pour 3 à 6 téléchargements
// et décodages inutiles pendant le rideau. Supprimé entièrement.
//
// Vérifié par lecture du source (la page ne s'instancie pas en test :
// réseau, ~2900 lignes).

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const src = fs.readFileSync(
    path.join(__dirname, '..', '..', 'qml', 'pages', 'detailMoviePage.qml'),
    'utf8'
);

test('detailMoviePage.qml ne contient plus aucune trace du préchauffage des portraits de casting', () => {
    assert.equal(/castPortraitPrewarm/i.test(src), false);
    assert.equal(/_personPrimaryTagForPrewarm/.test(src), false);
});

test('la fiche continue de fonctionner sans préchauffage : casting toujours peuplé normalement', () => {
    // Garde non-régression : _applyCastWarm() et le câblage castPageLoader
    // doivent avoir survécu à la suppression du préchauffage, qui vivait
    // juste à côté.
    assert.match(src, /function _applyCastWarm\(\)/);
    assert.match(src, /onLoaded:\s*\{\s*wireCastLoader\(\);\s*_updateExtendedSectionGates\(\)\s*\}/);
});
