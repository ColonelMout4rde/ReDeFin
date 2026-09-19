'use strict';
// homefocuscoststhinning.test.js — contrat du constat 9 (partiel) de l'audit
// accueil : coûts dispersés sur le chemin d'un appui.
//
// 1) postergrid.qml : un appui dans « Mes médias » appelait saveFocusSnapshot
//    deux fois — une fois explicitement dans _setFolderIndexFromUser(), une
//    fois via onCurrentFolderIndexChanged() déclenché synchroniquement par
//    l'affectation « currentFolderIndex = want » qui précède, avec le même
//    contexte (focusSection, drapeaux de restauration). L'appel explicite est
//    redondant et a été retiré ; le handler onCurrentFolderIndexChanged
//    reste la seule source de vérité.
// 2) PosterGridCard.qml : onCardSelectedChanged (un des signaux les plus
//    fréquents sur les rangées Latest, où un appui recalcule selectedIndex
//    sur toutes les rangées) appelait _syncHomeLoader(), qui réécrit 15
//    propriétés et relance la transaction de résolution d'image, pour un
//    seul booléen. Il recopie maintenant directement `selected`.
//
// postergrid.qml et PosterGridCard.qml dépendent tous deux de l'arbre de
// rendu / du réseau pour un test de bout en bout ; contrat sur le source,
// comme pour les autres points de cette zone qui s'y prêtent mal.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const POSTERGRID = fs.readFileSync(path.join(ROOT, 'qml', 'pages', 'postergrid.qml'), 'utf8');
const CARD = fs.readFileSync(path.join(ROOT, 'qml', 'pages', 'PosterGridCard.qml'), 'utf8');

function fnBody(src, name) {
    const re = new RegExp('function ' + name + '\\([^)]*\\)\\s*\\{[\\s\\S]*?\\n {4}\\}');
    const m = src.match(re);
    assert.ok(m, 'fonction ' + name + ' introuvable');
    return m[0];
}

test('_setFolderIndexFromUser ne double-appelle plus saveFocusSnapshot', () => {
    const body = fnBody(POSTERGRID, '_setFolderIndexFromUser');
    // Ignore les lignes de commentaire (le commentaire explicatif du
    // correctif cite lui-même saveFocusSnapshot en toutes lettres).
    const codeLines = body.split('\n').filter((l) => !/^\s*\/\//.test(l));
    const offenders = codeLines.filter((l) => /\bsaveFocusSnapshot\(/.test(l));
    assert.deepEqual(offenders, [],
        'saveFocusSnapshot ne doit plus être appelé explicitement ici : ' +
        'onCurrentFolderIndexChanged le fait déjà de façon synchrone.');
});

test('onCurrentFolderIndexChanged reste l\'unique appelant de saveFocusSnapshot pour ce rail', () => {
    const block = POSTERGRID.match(/onCurrentFolderIndexChanged:\s*\{[\s\S]*?\n {4}\}/);
    assert.ok(block, 'bloc onCurrentFolderIndexChanged introuvable');
    assert.match(block[0], /saveFocusSnapshot\("folderIndex"\)/);
});

test('onCardSelectedChanged recopie directement selected au lieu d\'appeler _syncHomeLoader()', () => {
    const block = CARD.match(/function onCardSelectedChanged\(\)\s*\{[\s\S]*?\n {16}\}/);
    assert.ok(block, 'handler onCardSelectedChanged introuvable');
    const codeLines = block[0].split('\n').filter((l) => !/^\s*\/\//.test(l));
    const offenders = codeLines.filter((l) => /cardRoot\._syncHomeLoader\(\)/.test(l));
    assert.deepEqual(offenders, []);
    assert.match(block[0], /cardRoot\.selected = cardRoot\.homeLoader\.cardSelected === true/);
});
