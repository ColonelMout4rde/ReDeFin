'use strict';
// latestpublishgate.test.js — contrat du constat 1 de l'audit accueil.
//
// _rebuildLatestByFolderFromTemp() est appelée à chaque bibliothèque Latest
// reçue (_finishLatestRequest, une fois par bibliothèque, 6 bibliothèques ->
// jusqu'à 6 appels avant le premier reveal). Avant le correctif, chaque
// appel republiait latestByFolder inconditionnellement, ce qui vide et
// régénère tout le Repeater (QQuickRepeater::setModel) à chaque réponse
// alors que le rideau attend de toute façon la dernière.
//
// postergrid.qml dépend du réseau et de l'arbre de rendu réel : ce contrat
// est vérifié par lecture du source (voir aussi homeposterreadytimeout.test.js
// pour la même justification). Il fige :
//   - la publication (_publishLatestFromTemp) est gardée par une condition,
//     pas inconditionnelle ;
//   - la garde autorise la publication soit après le premier reveal
//     (homeRevealReady), soit quand toutes les réponses attendues sont
//     arrivées (_latestAllComplete) — jamais dans les deux cas contraires ;
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
    assert.match(body,
        /if \(postergrid\._homeRevealReady \|\| postergrid\._latestAllComplete\) \{\s*\n\s*postergrid\._publishLatestFromTemp\(\)\s*\n\s*\}/);
    // Un seul appel à _publishLatestFromTemp dans toute la fonction, et il
    // est bien à l'intérieur du bloc conditionnel (pas un second appel
    // inconditionnel resté par erreur).
    const calls = body.match(/_publishLatestFromTemp\(\)/g) || [];
    assert.equal(calls.length, 1);
});
