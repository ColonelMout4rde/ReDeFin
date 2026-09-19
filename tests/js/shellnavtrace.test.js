'use strict';

/*
 * Câblage de l'instrumentation NAV1-NAV6 dans qml/pages/ShellPage.qml
 * (chantier « navigation fluide », zone shell).
 *
 * ShellPage.qml ne s'instancie qu'au prix d'une Application fbx complète
 * (voir tests/qml/tst_settingssanitize.qml) et les traces dépendent de l'état
 * interne du Loader/du rideau, difficilement déclenchable depuis un test Qt
 * Quick sans reproduire tout le routeur. On vérifie donc ici le contrat par
 * lecture de source, comme le permettent les conventions du projet pour un
 * changement purement déclaratif/instrumental :
 *   - DevLog est importé et utilisé, jamais console.log directement ;
 *   - chaque tag NAV1..NAV6 est bien émis via DevLog.log(...) ;
 *   - chaque appel DevLog.log est protégé par `if (DevLog.ENABLED)` (chemin
 *     chaud : Loader/Timer/callLater) ;
 *   - DevLog.ENABLED reste à false dans le dépôt (déjà couvert par
 *     devlog.test.js ; revérifié ici au niveau du module réellement importé
 *     par ShellPage.qml).
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { loadQmlJs } = require('./qmljs');

const SHELL_PATH = path.join(__dirname, '..', '..', 'qml', 'pages', 'ShellPage.qml');
const SRC = fs.readFileSync(SHELL_PATH, 'utf8');

const NAV_TAGS = ['NAV1', 'NAV2', 'NAV3', 'NAV4', 'NAV5', 'NAV6'];

test('ShellPage.qml importe DevLog.js', () => {
  assert.match(SRC, /import\s+"\.\.\/js\/DevLog\.js"\s+as\s+DevLog/);
});

test('ShellPage.qml n\'appelle jamais console.log directement', () => {
  assert.doesNotMatch(SRC, /\bconsole\.log\s*\(/);
});

for (const tag of NAV_TAGS) {
  test(`ShellPage.qml émet la trace ${tag} via DevLog.log`, () => {
    const re = new RegExp('DevLog\\.log\\(\\s*"' + tag + '"');
    assert.match(SRC, re, `aucun DevLog.log("${tag}", ...) trouvé dans ShellPage.qml`);
  });
}

test('chaque DevLog.log(...) de ShellPage.qml est gardé par if (DevLog.ENABLED)', () => {
  const lines = SRC.split('\n');
  lines.forEach((line, i) => {
    // Ignore les mentions en commentaire (ex. le commentaire d'en-tête qui
    // explique la convention) : seul un véritable appel nous intéresse.
    if (/^\s*\/\//.test(line)) return;
    if (!/DevLog\.log\(/.test(line)) return;
    // Le garde peut être sur la ligne précédente (if (DevLog.ENABLED)\n DevLog.log(...)),
    // sur la même ligne, ou composé avec une autre condition
    // (if (cond && DevLog.ENABLED) { ... DevLog.log(...) }).
    const window = lines.slice(Math.max(0, i - 1), i + 1).join('\n');
    assert.match(
      window,
      /if\s*\([^)]*\bDevLog\.ENABLED\b[^)]*\)/,
      `ligne ${i + 1} : DevLog.log(...) sans garde "if (DevLog.ENABLED)" à proximité :\n${lines[i]}`
    );
  });
});

test('le module DevLog réellement importé par ShellPage.qml reste désactivé', () => {
  const DevLog = loadQmlJs('qml/js/DevLog.js');
  assert.equal(DevLog.ENABLED, false);
});
