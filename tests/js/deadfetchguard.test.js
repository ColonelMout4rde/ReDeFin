'use strict';
// deadfetchguard.test.js — contrat du constat 11 de l'audit accueil.
//
// _applyContextToPosterGrid() (HomePage.qml) contenait :
//
//   if (alreadyWarm && !shouldAskFetch)
//
//   if (shouldAskFetch) { ... beginStaggeredFetch()/fetchHomeData() ... }
//
// Sans accolades sur le premier « if », son corps est la ligne suivante :
// c'est donc « if (alreadyWarm && !shouldAskFetch) { if (shouldAskFetch)
// {...} } ». Les deux conditions s'excluent mutuellement (l'une exige
// shouldAskFetch faux, l'autre vrai) : le bloc de fetch n'a donc jamais pu
// s'exécuter depuis HomePage. Sans effet sur les performances (le
// chargement démarre par postergrid.ensureBootFetch(), qui n'est pas
// concerné), mais trompeur pour quiconque relit ce code en pensant que
// HomePage peut aussi déclencher un fetch.
//
// Le correctif rend l'imbrication explicite avec des accolades, SANS
// changer le comportement (toujours mort). Ce test fige :
//   - la structure imbriquée (le if intérieur reste bien À L'INTÉRIEUR du
//     if extérieur, pas une réécriture qui le rendrait atteignable) ;
//   - qu'aucun appel à beginStaggeredFetch()/fetchHomeData() n'existe en
//     dehors de ce bloc mort dans HomePage.qml (le seul déclencheur reste
//     postergrid.ensureBootFetch(), hors zone de ce fichier).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const SRC = fs.readFileSync(
    path.join(__dirname, '..', '..', 'qml', 'pages', 'HomePage.qml'), 'utf8');

test('le if extérieur (alreadyWarm && !shouldAskFetch) a des accolades explicites', () => {
    assert.match(SRC, /if \(alreadyWarm && !shouldAskFetch\) \{/);
});

test('le if (shouldAskFetch) reste imbriqué DANS le if extérieur (code mort inchangé)', () => {
    const outer = SRC.match(
        /if \(alreadyWarm && !shouldAskFetch\) \{\s*\n([\s\S]*?)\n {16}\}\s*\n {12}\}/);
    assert.ok(outer, 'imbrication if(alreadyWarm...){ if(shouldAskFetch){...} } introuvable');
    assert.match(outer[1], /if \(shouldAskFetch\) \{/);
    assert.match(outer[1], /beginStaggeredFetch\(\)/);
});

test('HomePage.qml n\'appelle beginStaggeredFetch()/fetchHomeData() que dans ce bloc mort', () => {
    const beginCalls = (SRC.match(/pg\.beginStaggeredFetch\(\)/g) || []).length;
    const fetchCalls = (SRC.match(/pg\.fetchHomeData\(\)/g) || []).length;
    assert.equal(beginCalls, 1);
    assert.equal(fetchCalls, 1);
});
