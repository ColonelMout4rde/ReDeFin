'use strict';
// homeposterreadytimeout.test.js — contrat du constat 4 de l'audit accueil.
//
// Le rideau de retour (_probeHomePosterVisualReady, postergrid.qml)
// attendait sans borne que TOUTES les affiches visibles soient Ready avant
// de révéler l'accueil, alors qu'elles sont re-téléchargées (cache:false).
// Décision produit : borner cette attente à ~300 ms puis révéler quand même,
// les affiches manquantes arrivant ensuite derrière leur placeholder/fondu.
//
// postergrid.qml est un fichier QML de ~2900 lignes truffé d'appels réseau
// et de dépendances à l'arbre de rendu (_visibleHomePosterState scanne des
// délégués réels) : l'instancier en Qt Quick Test pour ce seul point serait
// disproportionné (BRIEF-COMMUN.md demande de ne pas dépasser la mission).
// Ce test fige donc, par lecture du source, que la borne existe, qu'elle
// vaut 300 ms, qu'elle est armée exactement quand le rideau apparaît et
// désarmée quand il disparaît, et que _probeHomePosterVisualReady la
// consulte avant toute autre condition de blocage.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const SRC = fs.readFileSync(
    path.join(__dirname, '..', '..', 'qml', 'pages', 'postergrid.qml'), 'utf8');

test('la borne homePosterVisualReadyMaxWaitMs vaut 300 ms', () => {
    assert.match(SRC, /readonly property int homePosterVisualReadyMaxWaitMs:\s*300\b/);
});

test('la borne est armée quand homeCurtainVisible devient vrai, désarmée sinon', () => {
    const block = SRC.match(/onHomeCurtainVisibleChanged:\s*\{[\s\S]*?\n {4}\}/);
    assert.ok(block, 'bloc onHomeCurtainVisibleChanged introuvable');
    const [ifTrue, ifFalse] = block[0].split('} else {');
    assert.match(ifTrue, /_homePosterVisualReadyDeadlineMs = Date\.now\(\)/);
    assert.match(ifFalse, /_homePosterVisualReadyDeadlineMs = 0/);
});

test('_probeHomePosterVisualReady force homePosterVisualReady=true au-delà de la borne, avant toute autre condition', () => {
    const fn = SRC.match(/function _probeHomePosterVisualReady\(\)\s*\{[\s\S]*?\n {4}\}/);
    assert.ok(fn, 'fonction _probeHomePosterVisualReady introuvable');
    const body = fn[0];

    const deadlineCheckIdx = body.indexOf('_homePosterVisualReadyDeadlineMs > 0');
    const firstOtherGuardIdx = body.indexOf('_hasVisibleHomeData()');
    assert.ok(deadlineCheckIdx >= 0, 'vérification de la borne absente');
    assert.ok(firstOtherGuardIdx > deadlineCheckIdx,
        'la borne doit être vérifiée avant les autres conditions de blocage');

    // Le bloc de dépassement doit lever le rideau et arrêter les minuteurs
    // de sondage, pas seulement journaliser.
    const timeoutBlockEnd = body.indexOf('_hasVisibleHomeData()');
    const timeoutBlock = body.slice(deadlineCheckIdx, timeoutBlockEnd);
    assert.match(timeoutBlock, /_homePosterVisualReady = true/);
    assert.match(timeoutBlock, /homePosterProbeTimer\.stop\(\)/);
    assert.match(timeoutBlock, /homePosterReadySettleTimer\.stop\(\)/);
});
