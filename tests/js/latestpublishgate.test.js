'use strict';
// latestpublishgate.test.js — contrat du constat 1 de l'audit accueil.
//
// _rebuildLatestByFolderFromTemp() est appelée à chaque bibliothèque Latest
// reçue (_finishLatestRequest, une fois par bibliothèque, 6 bibliothèques ->
// jusqu'à 6 appels). Avant le correctif initial, chaque appel republiait
// latestByFolder inconditionnellement, ce qui vide et régénère tout le
// Repeater (QQuickRepeater::setModel) à chaque réponse.
//
// Mission « accueil » lot 3, point 2 : depuis que la porte de HomePage ne
// dépend plus de latestFetchCompleted (HomeGatePolicy.canFinish), le
// premier reveal peut survenir AVANT que toutes les bibliothèques Latest
// aient répondu. Gater la publication sur `homeRevealReady` (comme le
// faisait la version précédente de ce test) republierait donc à nouveau une
// fois par bibliothèque, pendant que l'utilisateur navigue déjà — pire que
// le défaut d'origine. Le contrat devient : un drapeau persistant
// (_latestInitialPublishDone, remis à faux à chaque nouvelle file dans
// _startLatestInitialQueue) mémorise que la première publication complète a
// eu lieu ; tant qu'il est faux, on attend _latestAllComplete (une seule
// publication pour tout le lot initial, quel que soit l'état du reveal).
//
// postergrid.qml dépend du réseau et de l'arbre de rendu réel : ce contrat
// est vérifié par lecture du source (voir aussi homeposterreadytimeout.test.js
// pour la même justification). Il fige :
//   - la publication (_publishLatestFromTemp) est gardée par une condition,
//     pas inconditionnelle, et ne référence plus homeRevealReady ;
//   - la garde autorise la publication soit après la première publication
//     complète (_latestInitialPublishDone), soit quand toutes les réponses
//     attendues sont arrivées (_latestAllComplete) ;
//   - _latestInitialPublishDone est remis à faux à chaque nouvelle file
//     initiale (_startLatestInitialQueue), pour qu'un retour Home après
//     expiration du cache republie une seule fois lui aussi ;
//   - le calcul de _latestAllComplete / latestFetchCompleted reste
//     inconditionnel (le rideau HomePage en dépend indépendamment de la
//     publication du modèle).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const SRC = fs.readFileSync(
    path.join(__dirname, '..', '..', 'qml', 'pages', 'postergrid.qml'), 'utf8');

function fnBody(name) {
    const re = new RegExp('function ' + name + '\\(\\)\\s*\\{[\\s\\S]*?\\n {4}\\}');
    const m = SRC.match(re);
    assert.ok(m, 'fonction ' + name + ' introuvable');
    return m[0];
}

test('_rebuildLatestByFolderFromTemp met toujours à jour latestFetchCompleted', () => {
    const body = fnBody('_rebuildLatestByFolderFromTemp');
    assert.match(body, /_latestAllComplete = postergrid\._latestQueueDone\(\)/);
    assert.match(body, /latestFetchCompleted = postergrid\._latestAllComplete/);
    // Ces deux affectations doivent précéder toute condition (jamais dans un if).
    const idxAllComplete = body.indexOf('_latestAllComplete = postergrid._latestQueueDone()');
    const idxFirstIf = body.indexOf('if (');
    assert.ok(idxAllComplete >= 0 && idxAllComplete < idxFirstIf,
        'latestFetchCompleted doit être recalculé avant toute condition');
});

test('_rebuildLatestByFolderFromTemp ne publie latestByFolder que sous condition', () => {
    const body = fnBody('_rebuildLatestByFolderFromTemp');
    const code = body.split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
    // homeRevealReady peut désormais devenir vrai avant que toutes les
    // bibliothèques Latest aient répondu (HomeGatePolicy) : il ne doit plus
    // gouverner la publication.
    assert.doesNotMatch(code, /_homeRevealReady/);
    assert.match(code,
        /if \(postergrid\._latestInitialPublishDone \|\| postergrid\._latestAllComplete\) \{\s*\n\s*postergrid\._latestInitialPublishDone = true\s*\n\s*postergrid\._publishLatestFromTemp\(\)\s*\n\s*\}/);
    // Un seul appel à _publishLatestFromTemp dans toute la fonction, et il
    // est bien à l'intérieur du bloc conditionnel (pas un second appel
    // inconditionnel resté par erreur).
    const calls = code.match(/_publishLatestFromTemp\(\)/g) || [];
    assert.equal(calls.length, 1);
});

test('_latestInitialPublishDone existe et est un drapeau persistant', () => {
    assert.match(SRC, /property bool _latestInitialPublishDone:\s*false\b/);
});

test('_startLatestInitialQueue remet _latestInitialPublishDone à faux avant chaque nouvelle file', () => {
    const re = /function _startLatestInitialQueue\(libs, fetchSeq\)\s*\{[\s\S]*?\n {4}\}/;
    const m = SRC.match(re);
    assert.ok(m, 'fonction _startLatestInitialQueue introuvable');
    assert.match(m[0],
        /postergrid\.latestFetchCompleted = false[\s\S]*?postergrid\._latestInitialPublishDone = false/);
});
