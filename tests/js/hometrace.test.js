'use strict';
// hometrace.test.js — contrat d'instrumentation HOME1 de la zone « accueil ».
//
// HomePage.qml et postergrid.qml sont des fichiers QML (pas du JS pur) :
// tests/js/qmljs.js ne peut pas les charger. Ce test lit donc leur code
// source pour vérifier le contrat imposé par BRIEF-COMMUN.md :
//   - import de DevLog.js ;
//   - aucun appel direct à console.log (uniquement DevLog.log) ;
//   - chaque étape du chemin de chargement de l'accueil (fetchedOnce, les
//     quatre *FetchCompleted, homeRevealReady, la levée du rideau avec sa
//     raison, le chemin de retour cache frais/périmé) est tracée sous le
//     tag HOME1, derrière « if (DevLog.ENABLED) ».
//
// Ce test ne vérifie ni le texte exact des messages ni le rendu : seulement
// que le point d'instrumentation existe et reste gardé par DevLog.ENABLED.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const HOME_PAGE = fs.readFileSync(path.join(ROOT, 'qml', 'pages', 'HomePage.qml'), 'utf8');
const POSTERGRID = fs.readFileSync(path.join(ROOT, 'qml', 'pages', 'postergrid.qml'), 'utf8');

function assertNoDirectConsoleLog(src, label) {
    const offenders = src.split('\n').filter((l) => /\bconsole\.log\s*\(/.test(l));
    assert.deepEqual(offenders, [], label + ' appelle console.log directement (utiliser DevLog)');
}

test('HomePage.qml et postergrid.qml importent DevLog.js', () => {
    assert.match(HOME_PAGE, /import\s+"\.\.\/js\/DevLog\.js"\s+as\s+DevLog/);
    assert.match(POSTERGRID, /import\s+"\.\.\/js\/DevLog\.js"\s+as\s+DevLog/);
});

test('aucun console.log direct dans HomePage.qml / postergrid.qml', () => {
    assertNoDirectConsoleLog(HOME_PAGE, 'HomePage.qml');
    assertNoDirectConsoleLog(POSTERGRID, 'postergrid.qml');
});

test('postergrid.qml trace fetchedOnce et les quatre *FetchCompleted sous HOME1', () => {
    assert.match(POSTERGRID, /onFetchedOnceChanged:\s*\{\s*\n\s*if \(DevLog\.ENABLED\) DevLog\.log\("HOME1"/);
    ['LibraryFetchCompleted', 'ResumeFetchCompleted', 'NextUpFetchCompleted', 'LatestFetchCompleted'].forEach((name) => {
        const re = new RegExp('on' + name + 'Changed:\\s*\\{\\s*\\n\\s*if \\(DevLog\\.ENABLED\\) DevLog\\.log\\("HOME1"');
        assert.match(POSTERGRID, re, 'trace manquante pour ' + name);
    });
});

test('postergrid.qml trace homeRevealReady et le chemin de cache frais/périmé', () => {
    assert.match(POSTERGRID, /onHomeRevealReadyChanged:\s*\{\s*\n\s*if \(DevLog\.ENABLED\) DevLog\.log\("HOME1", "homeRevealReady=/);
    assert.match(POSTERGRID, /path=" \+ \(hadCacheEntry \? "cache-perime" : "cache-absent"\)/);
    assert.match(POSTERGRID, /path=cache-frais/);
});

test('HomePage.qml trace la levée du rideau avec sa raison', () => {
    assert.match(HOME_PAGE, /function tryFinishGate\(reason\)/);
    assert.match(HOME_PAGE, /DevLog\.log\("HOME1", "gate release reason=" \+ \(reason \|\| "unspecified"\)/);
    // Le chemin de récupération forcée (gateHardRecoveryTimer) contourne
    // tryFinishGate() : il doit tracer sa propre raison fixe.
    assert.match(HOME_PAGE, /DevLog\.log\("HOME1", "gate release reason=hard-recovery-timeout"/);
});

test('HomePage.qml trace la levée du rideau par rapport à nextUpFetchCompleted (mission accueil lot 3)', () => {
    // Constat 2 : mesurer sur boîtier l'écart entre la dernière donnée
    // nécessaire au reveal (nextUpFetchCompleted) et la levée effective du
    // rideau, maintenant que celui-ci n'attend plus latestFetchCompleted.
    assert.match(POSTERGRID, /property double _nextUpFetchCompletedAtMs:\s*0\b/);
    assert.match(POSTERGRID, /if \(nextUpFetchCompleted\) _nextUpFetchCompletedAtMs = Date\.now\(\)/);
    assert.match(HOME_PAGE, /DevLog\.log\("HOME1", "gate release reason=" \+ \(reason \|\| "unspecified"\)[\s\S]*?sinceNextUp=" \+ sinceNextUp\)/);
});

test('postergrid.qml trace la durée de blocage de la publication Latest (mission accueil lot 3)', () => {
    // MESURES.md : ~1,36 s sans aucune trace entre la publication et la
    // suite (thread UI bloqué par la création synchrone des sections/
    // cartes). Qt.callLater ne s'exécute qu'une fois la boucle d'événements
    // libre, donc le delta mesuré couvre bien la création synchrone
    // déclenchée par la publication.
    assert.match(POSTERGRID, /var publishBlockStartMs = DevLog\.ENABLED \? Date\.now\(\) : 0/);
    assert.match(POSTERGRID, /Qt\.callLater\(function\(\) \{\s*\n\s*if \(DevLog\.ENABLED\) DevLog\.log\("HOME1", "latestByFolder publish blocked ms="/);
});

test('les traces HOME1 sur le chemin chaud restent derrière DevLog.ENABLED', () => {
    // Toute ligne DevLog.log("HOME1" doit être précédée (même ligne ou la
    // précédente) d'une garde if (DevLog.ENABLED).
    [HOME_PAGE, POSTERGRID].forEach((src) => {
        const lines = src.split('\n');
        lines.forEach((line, i) => {
            if (!/DevLog\.log\("HOME1"/.test(line)) return;
            const window = lines.slice(Math.max(0, i - 1), i + 1).join('\n');
            assert.match(window, /if \(DevLog\.ENABLED\)/, 'trace HOME1 non gardée ligne ' + (i + 1));
        });
    });
});
