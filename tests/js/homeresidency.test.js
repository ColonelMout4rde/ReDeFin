'use strict';
// Décision « accueil résident » (ShellPage.qml). Mesure d'origine :
// docs/audit-navigation (shell F2) — reconstruire l'accueil à chaque retour
// coûtait ~3,7 s sur Révolution, type QML en cache compris.
const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const fs = require('node:fs');
const { loadQmlJs } = require('./qmljs');

const ROOT = path.join(__dirname, '..', '..');
const H = loadQmlJs(path.join(ROOT, 'qml', 'js', 'HomeResidency.js'));
const HOME = 'HomePage.qml?ctx=1&ageMax=99';

function run(state, page, playerActive, enabled) {
  const r = H.plan(state, page, playerActive === true, enabled !== false);
  return { r, state: { source: r.source, page: r.page } };
}

test('reconnaît l\'accueil quelle que soit la casse et la query', () => {
  assert.strictEqual(H.isHomePage('HomePage.qml?ctx=1'), true);
  assert.strictEqual(H.isHomePage('homepage.qml'), true);
  assert.strictEqual(H.isHomePage('moviepage.qml?x=HomePage.qml'), false);
  assert.strictEqual(H.isHomePage(''), false);
});

test('première visite : l\'accueil est chargé par son URL de base, rideau armé', () => {
  const { r } = run(H.createState(), HOME, false);
  assert.strictEqual(r.source, 'HomePage.qml');
  assert.strictEqual(r.page, HOME);
  assert.strictEqual(r.shown, true);
  assert.strictEqual(r.arm, true);
  assert.strictEqual(r.resumed, false);
});

test('une autre page : l\'accueil reste en vie, caché', () => {
  let s = run(H.createState(), HOME, false).state;
  const { r } = run(s, 'detailSeriePage.qml?itemId=x', false);
  assert.strictEqual(r.source, 'HomePage.qml');
  assert.strictEqual(r.page, HOME);
  assert.strictEqual(r.shown, false);
  assert.strictEqual(r.arm, false);
});

test('retour à l\'accueil : réaffiché sans rechargement ni rideau armé', () => {
  let s = run(H.createState(), HOME, false).state;
  s = run(s, 'moviepage.qml?folderId=f', false).state;
  const { r } = run(s, HOME, false);
  assert.strictEqual(r.source, 'HomePage.qml');
  assert.strictEqual(r.shown, true);
  assert.strictEqual(r.resumed, true);
  assert.strictEqual(r.arm, false);
  assert.strictEqual(r.blankFirst, false);
});

test('ouverture du lecteur : l\'accueil est détruit, la mémoire va au lecteur', () => {
  let s = run(H.createState(), HOME, false).state;
  const open = run(s, HOME, true);
  assert.strictEqual(open.r.source, '');
  assert.strictEqual(open.r.shown, false);
  // Retour du lecteur sur l'accueil : reconstruit, comme avant.
  const back = run(open.state, HOME, false);
  assert.strictEqual(back.r.source, 'HomePage.qml');
  assert.strictEqual(back.r.arm, true);
  assert.strictEqual(back.r.resumed, false);
});

test('frontières de session : un autre profil n\'hérite jamais de l\'accueil', () => {
  for (const boundary of ['LoginPage.qml?ctx=1', 'serverpage.qml', 'SplashPage.qml']) {
    let s = run(H.createState(), HOME, false).state;
    s = run(s, 'moviepage.qml', false).state;
    const { r } = run(s, boundary, false);
    assert.strictEqual(r.source, '', boundary);
    assert.strictEqual(r.page, '', boundary);
    assert.strictEqual(r.shown, false, boundary);
  }
});

test('page vide transitoire (rechargement forcé du shell) : l\'accueil résident est conservé', () => {
  let s = run(H.createState(), HOME, false).state;
  s = run(s, 'detailMoviePage.qml?itemId=a', false).state;
  const { r } = run(s, '', false);
  assert.strictEqual(r.source, 'HomePage.qml');
  assert.strictEqual(r.shown, false);
});

test('autres paramètres d\'accueil : détruit puis reconstruit au tour suivant', () => {
  let s = run(H.createState(), HOME, false).state;
  const blank = run(s, 'HomePage.qml?ctx=1&ageMax=12', false);
  assert.strictEqual(blank.r.blankFirst, true);
  assert.strictEqual(blank.r.source, '');
  assert.strictEqual(blank.r.shown, false);
  const again = run(blank.state, 'HomePage.qml?ctx=1&ageMax=12', false);
  assert.strictEqual(again.r.source, 'HomePage.qml');
  assert.strictEqual(again.r.page, 'HomePage.qml?ctx=1&ageMax=12');
  assert.strictEqual(again.r.arm, true);
});

test('retour arrière en une ligne : désactivé, l\'accueil n\'est jamais résident', () => {
  const { r } = run({ source: 'HomePage.qml', page: HOME }, HOME, false, false);
  assert.strictEqual(r.source, '');
  assert.strictEqual(r.shown, false);
});

test('plan() ne modifie jamais l\'état reçu', () => {
  const s = { source: 'HomePage.qml', page: HOME };
  H.plan(s, 'LoginPage.qml', false, true);
  assert.strictEqual(s.source, 'HomePage.qml');
  assert.strictEqual(s.page, HOME);
});

test('câblage de ShellPage : second Loader caché ET désactivé, page active unique', () => {
  const src = fs.readFileSync(path.join(ROOT, 'qml', 'pages', 'ShellPage.qml'), 'utf8');
  assert.match(src, /readonly property bool keepHomeResident:\s*true/);
  const loader = src.slice(src.indexOf('id: homeLoader'));
  assert.match(loader.slice(0, 400), /source:\s*shell\._homeResidentSource/);
  assert.match(loader.slice(0, 400), /visible:\s*shell\._homeResidentShown/);
  assert.match(loader.slice(0, 400), /enabled:\s*visible/);
  // Le Loader de page est vidé AVANT que l'accueil arme son rideau.
  const sync = src.slice(src.indexOf('function _syncPageLoaderSource()'), src.indexOf('function _syncHomeResident()'));
  assert.ok(sync.indexOf('shell._pageLoaderSource = next.source') < sync.indexOf('shell._syncHomeResident()'));
  // L'état de chargement et le focus suivent la page réellement à l'écran.
  assert.match(src, /readonly property bool _pageReportedLoading:\s*\{\s*var p = shell\._activePageItem/);
});
