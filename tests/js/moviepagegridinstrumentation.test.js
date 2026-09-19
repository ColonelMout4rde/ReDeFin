'use strict';

/*
 * Instrumentation DevLog du chemin critique de la grille de bibliothèque
 * (moviepage.qml), préalable aux optimisations de la zone « grilles »
 * (voir audit-grilles.md, chronologie « Ouverture d'une bibliothèque »).
 *
 * moviepage.qml (~2 800 lignes) n'est pas instancié en Qt Quick Test :
 * QtGraphicalEffects/ClockHUD et les dépendances réseau du chargement
 * initial rendraient le test lourd sans rien prouver de plus qu'une lecture
 * du câblage. Ce test lit donc le source et vérifie le contrat minimal
 * demandé par le brief : chaque étape mesurée porte une trace GRID<n>, le
 * fichier importe DevLog et n'appelle jamais console.log directement (seul
 * DevLog.log() peut écrire sur la console, et seulement en mode développeur).
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const SOURCE = path.join(__dirname, '..', '..', 'qml', 'pages', 'moviepage.qml');
const src = fs.readFileSync(SOURCE, 'utf8');

test('moviepage importe DevLog.js sous l\'alias DevLog', () => {
    assert.match(src, /import\s+"\.\.\/js\/DevLog\.js"\s+as\s+DevLog/);
});

test('moviepage n\'appelle jamais console.log directement', () => {
    const offenders = src.split('\n')
        .map((line, i) => ({ line, n: i + 1 }))
        .filter((l) => /console\.log/.test(l.line));
    assert.deepEqual(offenders, []);
});

test('les six étapes du chemin critique de la grille sont tracées', () => {
    // GRID1 onCompleted, GRID2 départ fetchFolder, GRID3 réponse serveur,
    // GRID4 affectation du modèle (dt mesuré via Qt.callLater), GRID5
    // restauration d'index, GRID6 levée du rideau avec sa raison.
    const expected = ['GRID1', 'GRID2', 'GRID3', 'GRID4', 'GRID5', 'GRID6'];
    for (const tag of expected) {
        const re = new RegExp('DevLog\\.log\\("' + tag + '"');
        assert.match(src, re, tag + ' absent de moviepage.qml');
    }
});

test('GRID4 mesure le délai entre l\'affectation de folderItems et le Qt.callLater qui suit', () => {
    const idx = src.indexOf('folderItems = result.items || []');
    assert.notEqual(idx, -1);
    const around = src.slice(idx, idx + 400);
    assert.match(around, /Qt\.callLater/);
    assert.match(around, /GRID4/);
});

test('GRID6 (levée du rideau) porte une raison explicite à chaque appel', () => {
    const re = /_releaseFolderRestoreVisualLoading\(([^)]*)\)/g;
    const calls = [];
    let m;
    while ((m = re.exec(src)) !== null) calls.push(m[1].trim());
    assert.ok(calls.length >= 3, 'au moins les trois sites d\'appel attendus');
    for (const arg of calls) {
        // La déclaration de la fonction elle-même (paramètre "reason") est
        // exclue : on ne vérifie que les appels, qui doivent porter un
        // littéral de raison non vide.
        if (arg === 'reason') continue;
        assert.notEqual(arg, '', 'appel sans raison : _releaseFolderRestoreVisualLoading()');
    }
});

test('DevLog reste inerte par défaut (garde-fou déjà vérifié par tests/js/devlog.test.js)', () => {
    const devlogSrc = fs.readFileSync(
        path.join(__dirname, '..', '..', 'qml', 'js', 'DevLog.js'), 'utf8');
    assert.match(devlogSrc, /^var ENABLED = false;$/m);
});
