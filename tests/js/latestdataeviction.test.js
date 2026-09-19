'use strict';
// latestdataeviction.test.js — contrat du constat 10 de l'audit accueil.
//
// _evictFarLatestData() vidait entry.items (les données JSON, ~50 Ko par
// section) au-delà de 2,2 écrans de distance, EN PLUS de l'éviction déjà
// faite au niveau délégué/texture par _evictLatestSections() (sec.evicted,
// qui vide déjà latestList.model via sectionModelActive). Cela faisait
// réapparaître « Rechargement… » et repartir une requête réseau en
// remontant, pour un gain mémoire jugé négligeable par l'audit face au
// coût de re-fetch. Le drapeau nommé latestDataEvictionEnabled neutralise
// cet effet sans changer le câblage des Timer (retour arrière en une
// ligne) ; l'éviction légère des délégués/textures n'est pas touchée.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const SRC = fs.readFileSync(
    path.join(__dirname, '..', '..', 'qml', 'pages', 'postergrid.qml'), 'utf8');

test('latestDataEvictionEnabled est désactivé par défaut', () => {
    assert.match(SRC, /readonly property bool latestDataEvictionEnabled:\s*false\b/);
});

test('_evictFarLatestData() sort immédiatement quand le drapeau est désactivé', () => {
    const fn = SRC.match(/function _evictFarLatestData\(\)\s*\{[\s\S]*?\n {4}\}/);
    assert.ok(fn, 'fonction _evictFarLatestData introuvable');
    const lines = fn[0].split('\n');
    // La garde doit être la toute première instruction du corps.
    assert.match(lines[1], /if \(!postergrid\.latestDataEvictionEnabled\) return/);
});

test('le câblage des minuteurs (léger + données) reste inchangé', () => {
    // scheduleLatestEvict() continue d'armer les deux minuteurs : seul
    // l'EFFET de celui des données est neutralisé, pas son déclenchement,
    // pour que le retour arrière tienne en une ligne (le drapeau).
    assert.match(SRC,
        /function scheduleLatestEvict\(\)\{[^}]*latestEvictTimer\.restart\(\);\s*latestDataEvictTimer\.restart\(\)/);
});

test('_evictLatestSections() (éviction légère délégués/textures) ne référence pas le drapeau', () => {
    // Le mécanisme léger (sec.evicted, qui vide déjà latestList.model via
    // sectionModelActive) doit rester actif indépendamment de ce constat.
    const fn = SRC.match(/function _evictLatestSections\(\)\s*\{[\s\S]*?\n {4}\}/);
    assert.ok(fn, 'fonction _evictLatestSections introuvable');
    assert.doesNotMatch(fn[0], /latestDataEvictionEnabled/);
});
