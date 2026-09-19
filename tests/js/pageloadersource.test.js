'use strict';
// Décision « quelle source donner au Loader de page » (ShellPage.qml).
// Mesure d'origine : docs/audit-navigation (shell F1) — la query string dans
// Loader.source faisait recompiler la page à chaque item sur Révolution.
const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const fs = require('node:fs');
const { loadQmlJs } = require('./qmljs');

const ROOT = path.join(__dirname, '..', '..');
const P = loadQmlJs(path.join(ROOT, 'qml', 'js', 'PageLoaderSource.js'));

function step(state, page, playerActive, useBase) {
  const r = P.plan(state, page, playerActive === true, useBase);
  return { r, state: r.noop ? state : { source: r.source, page: r.page } };
}

test('la source est l\'URL de base : deux items de la même page partagent le type QML en cache', () => {
  assert.strictEqual(P.sourceFor('detailSeriePage.qml?ctx=1&itemId=aaa', true), 'detailSeriePage.qml');
  assert.strictEqual(P.sourceFor('detailSeriePage.qml?ctx=1&itemId=bbb', true), 'detailSeriePage.qml');
  assert.strictEqual(P.sourceFor('  moviepage.qml?startIndex=6 ', true), 'moviepage.qml');
  assert.strictEqual(P.sourceFor('', true), '');
});

test('retour arrière en une ligne : useBaseUrl=false rend l\'URL complète', () => {
  assert.strictEqual(P.sourceFor('moviepage.qml?startIndex=6', false), 'moviepage.qml?startIndex=6');
});

test('première page : chargée et rideau armé', () => {
  const { r } = step(P.createState(), 'SplashPage.qml', false, true);
  assert.strictEqual(r.source, 'SplashPage.qml');
  assert.strictEqual(r.arm, true);
  assert.strictEqual(r.blankFirst, false);
  assert.strictEqual(r.noop, false);
});

test('changement de page : nouvelle base, rideau armé avant le changement de source', () => {
  let s = step(P.createState(), 'HomePage.qml?ctx=1', false, true).state;
  const { r } = step(s, 'moviepage.qml?ctx=1&folderId=f', false, true);
  assert.strictEqual(r.source, 'moviepage.qml');
  assert.strictEqual(r.page, 'moviepage.qml?ctx=1&folderId=f');
  assert.strictEqual(r.arm, true);
});

test('même composant, autres paramètres : le Loader est vidé puis rechargé, rideau armé au rechargement', () => {
  let s = step(P.createState(), 'moviepage.qml?folderId=a', false, true).state;
  const blank = step(s, 'moviepage.qml?folderId=b', false, true);
  assert.strictEqual(blank.r.blankFirst, true);
  assert.strictEqual(blank.r.source, '');
  assert.strictEqual(blank.r.arm, false);
  const reload = step(blank.state, 'moviepage.qml?folderId=b', false, true);
  assert.strictEqual(reload.r.source, 'moviepage.qml');
  assert.strictEqual(reload.r.page, 'moviepage.qml?folderId=b');
  assert.strictEqual(reload.r.arm, true);
  assert.strictEqual(reload.r.blankFirst, false);
});

test('même page, mêmes paramètres : rien à faire', () => {
  const s = step(P.createState(), 'HomePage.qml?ctx=1', false, true).state;
  assert.strictEqual(step(s, 'HomePage.qml?ctx=1', false, true).r.noop, true);
});

test('lecteur : la page est déchargée, puis rechargée au retour SANS réarmer le rideau', () => {
  let s = step(P.createState(), 'seasonpage.qml?seasonId=s', false, true).state;
  const open = step(s, 'seasonpage.qml?seasonId=s', true, true);
  assert.strictEqual(open.r.source, '');
  assert.strictEqual(open.r.arm, false);
  assert.strictEqual(open.r.page, 'seasonpage.qml?seasonId=s');
  const back = step(open.state, 'seasonpage.qml?seasonId=s', false, true);
  assert.strictEqual(back.r.source, 'seasonpage.qml');
  assert.strictEqual(back.r.arm, false);
});

test('page changée pendant la lecture : au retour c\'est une navigation, rideau armé', () => {
  let s = step(P.createState(), 'seasonpage.qml?seasonId=s', false, true).state;
  s = step(s, 'seasonpage.qml?seasonId=s', true, true).state;
  s = step(s, 'detailSeriePage.qml?itemId=x', true, true).state;
  const back = step(s, 'detailSeriePage.qml?itemId=x', false, true);
  assert.strictEqual(back.r.source, 'detailSeriePage.qml');
  assert.strictEqual(back.r.arm, true);
});

test('rechargement forcé historique (currentPage vidée puis reposée) : toujours un rechargement armé', () => {
  let s = step(P.createState(), 'detailMoviePage.qml?itemId=a', false, true).state;
  const empty = step(s, '', false, true);
  assert.strictEqual(empty.r.source, '');
  assert.strictEqual(empty.r.page, '');
  const again = step(empty.state, 'detailMoviePage.qml?itemId=b', false, true);
  assert.strictEqual(again.r.source, 'detailMoviePage.qml');
  assert.strictEqual(again.r.arm, true);
});

test('plan() ne modifie jamais l\'état reçu', () => {
  const s = { source: 'moviepage.qml', page: 'moviepage.qml?folderId=a' };
  P.plan(s, 'moviepage.qml?folderId=b', false, true);
  assert.strictEqual(s.source, 'moviepage.qml');
  assert.strictEqual(s.page, 'moviepage.qml?folderId=a');
});

test('câblage : ShellPage donne au Loader la source décidée par le module, jamais currentPage', () => {
  const src = fs.readFileSync(path.join(ROOT, 'qml', 'pages', 'ShellPage.qml'), 'utf8');
  assert.match(src, /id:\s*pageLoader[\s\S]{0,120}source:\s*shell\._pageLoaderSource/);
  assert.doesNotMatch(src, /source:\s*!playerActive\s*\?\s*_stripSensitiveQueryForCtx\(currentPage\)/);
  assert.match(src, /readonly property bool pageLoaderUsesBaseUrl:\s*true/);
  // Le rideau est armé avant l'affectation de la source.
  const fn = src.slice(src.indexOf('function _syncPageLoaderSource()'));
  assert.ok(fn.indexOf('_beginPageCurtainTransition()') < fn.indexOf('shell._pageLoaderSource = next.source'));
});
