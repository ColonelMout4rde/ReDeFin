'use strict';
// homegatetiming.test.js — contrat du constat 2 de l'audit accueil (traîne
// fixe d'environ 1,3 s après la dernière réponse réseau).
//
// La logique « peut-on lever le rideau » (_canFinishGate) appelle des
// méthodes avec effets de bord sur posterGridLoader.item (prepareHomeReveal
// mute l'état de PosterGrid) : elle ne se prête pas à une extraction dans un
// module .pragma library pur sans réécriture, ce que BRIEF-COMMUN.md
// autorise explicitement à sauter en faveur d'un test de contrat sur le
// texte source. Ce test fige donc :
//   - onHomeRevealReadyChanged appelle tryFinishGate(), pas
//     pokeLoadingGate() (qui relançait un plein settleMs) ;
//   - les délais réduits (latestStartDelayMs, settleMs, homeRevealSettleMs)
//     restent nommés et portent leur valeur resserrée.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const HOME_PAGE = fs.readFileSync(path.join(ROOT, 'qml', 'pages', 'HomePage.qml'), 'utf8');
const POSTERGRID = fs.readFileSync(path.join(ROOT, 'qml', 'pages', 'postergrid.qml'), 'utf8');

function connectionsBlock(src, signalName) {
    const re = new RegExp('on' + signalName + 'Changed:\\s*\\{[\\s\\S]*?\\n\\s{8}\\}');
    const m = src.match(re);
    assert.ok(m, 'bloc on' + signalName + 'Changed introuvable');
    return m[0];
}

test('onHomeRevealReadyChanged referme le rideau via tryFinishGate(), pas pokeLoadingGate()', () => {
    const block = connectionsBlock(HOME_PAGE, 'HomeRevealReady');
    assert.match(block, /homePage\.tryFinishGate\(/);
    assert.doesNotMatch(block, /homePage\.pokeLoadingGate\(\)/);
});

test('latestStartDelayMs est réduit à 16 ms (constat 2b)', () => {
    assert.match(POSTERGRID, /readonly property int latestStartDelayMs:\s*16\b/);
});

test('settleMs de HomePage est réduit à 120 ms via une constante nommée (constat 2c)', () => {
    assert.match(HOME_PAGE, /readonly property int homeGateSettleMs:\s*120\b/);
    assert.match(HOME_PAGE, /property int\s+settleMs:\s*homeGateSettleMs\b/);
});

test('homeRevealSettleMs de postergrid est réduit à 80 ms via une constante nommée (constat 2c)', () => {
    assert.match(POSTERGRID, /readonly property int homeRevealSettleDefaultMs:\s*80\b/);
    assert.match(POSTERGRID, /property int homeRevealSettleMs:\s*homeRevealSettleDefaultMs\b/);
});
