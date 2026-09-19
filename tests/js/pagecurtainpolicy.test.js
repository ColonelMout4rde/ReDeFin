'use strict';

/*
 * Décision pure « quand lever le rideau de page » (qml/js/PageCurtainPolicy.js,
 * F4 de l'audit shell). Le module ne doit connaître ni Qt ni QML : chargé et
 * testé directement avec Node via tests/js/qmljs.js.
 */

const test = require('node:test');
const assert = require('node:assert');

const { loadQmlJs } = require('./qmljs');

const Policy = loadQmlJs('qml/js/PageCurtainPolicy.js');

test('createState renvoie un état neutre', () => {
  const s = Policy.createState();
  assert.strictEqual(s.sawLoadingTrue, false);
  assert.strictEqual(s.stableTicks, 0);
});

/* ===== Page qui déclare shellLoading (fiche, grille, accueil) ===== */

test('page qui déclare loading=true : aucune levée, l\'état retient la déclaration', () => {
  const s0 = Policy.createState();
  const r = Policy.evaluate(s0, { pageLoading: true, elapsedSinceReadyMs: 0 });
  assert.strictEqual(r.release, false);
  assert.strictEqual(r.reason, 'loading');
  assert.strictEqual(r.state.sawLoadingTrue, true);
});

test('déclaré vrai PUIS faux : levée au tout premier tick, même sans plancher écoulé', () => {
  var state = Policy.createState();
  var r1 = Policy.evaluate(state, { pageLoading: true, elapsedSinceReadyMs: 0 });
  state = r1.state;
  assert.strictEqual(r1.release, false);

  // Un seul tick à 1 ms après Ready : bien en dessous des 180 ms historiques.
  var r2 = Policy.evaluate(state, { pageLoading: false, elapsedSinceReadyMs: 1 });
  assert.strictEqual(r2.release, true, 'la page a fini son propre chargement, plus rien à protéger');
  assert.strictEqual(r2.reason, 'declared-done');
});

test('déclaré vrai PUIS faux PUIS vrai à nouveau : la nouvelle déclaration prime', () => {
  var state = Policy.createState();
  state = Policy.evaluate(state, { pageLoading: true, elapsedSinceReadyMs: 0 }).state;
  var afterFalse = Policy.evaluate(state, { pageLoading: false, elapsedSinceReadyMs: 1 });
  assert.strictEqual(afterFalse.release, true);

  // Un réarmement (ex. detailReturnRefreshGate) doit être revu comme "loading"
  // s'il est réévalué, pas comme une confirmation supplémentaire de fin.
  var reArmed = Policy.evaluate(afterFalse.state, { pageLoading: true, elapsedSinceReadyMs: 5 });
  assert.strictEqual(reArmed.release, false);
  assert.strictEqual(reArmed.reason, 'loading');
});

/* ===== Page qui ne déclare jamais shellLoading : comportement historique ===== */

test('jamais déclaré : le plancher de 180 ms est respecté avant tout tick stable', () => {
  var state = Policy.createState();
  var r = Policy.evaluate(state, { pageLoading: false, elapsedSinceReadyMs: 60 });
  assert.strictEqual(r.release, false);
  assert.strictEqual(r.reason, 'hold');
  assert.strictEqual(r.state.stableTicks, 0);
});

test('jamais déclaré : deux ticks stables après le plancher lèvent le rideau', () => {
  var state = Policy.createState();
  var r1 = Policy.evaluate(state, { pageLoading: false, elapsedSinceReadyMs: 180 });
  assert.strictEqual(r1.release, false);
  assert.strictEqual(r1.reason, 'stabilizing');
  assert.strictEqual(r1.state.stableTicks, 1);

  var r2 = Policy.evaluate(r1.state, { pageLoading: false, elapsedSinceReadyMs: 240 });
  assert.strictEqual(r2.release, true);
  assert.strictEqual(r2.reason, 'stable');
});

test('jamais déclaré : un seul tick stable ne suffit pas (stableTicksRequired=2 par défaut)', () => {
  var state = Policy.createState();
  var r1 = Policy.evaluate(state, { pageLoading: false, elapsedSinceReadyMs: 200 });
  assert.strictEqual(r1.release, false);
  assert.strictEqual(r1.state.stableTicks, 1);
});

test('jamais déclaré : une re-déclaration de chargement remet stableTicks à zéro', () => {
  var state = Policy.createState();
  var r1 = Policy.evaluate(state, { pageLoading: false, elapsedSinceReadyMs: 200 });
  assert.strictEqual(r1.state.stableTicks, 1);

  var r2 = Policy.evaluate(r1.state, { pageLoading: true, elapsedSinceReadyMs: 260 });
  assert.strictEqual(r2.release, false);
  assert.strictEqual(r2.state.stableTicks, 0);
  assert.strictEqual(r2.state.sawLoadingTrue, true);
});

test('paramètres minHoldMs/stableTicksRequired personnalisés sont respectés', () => {
  var state = Policy.createState();
  var r1 = Policy.evaluate(state, {
    pageLoading: false, elapsedSinceReadyMs: 50, minHoldMs: 40, stableTicksRequired: 1
  });
  assert.strictEqual(r1.release, true, 'plancher réduit déjà dépassé, un seul tick requis');
  assert.strictEqual(r1.reason, 'stable');
});

test('evaluate ne mute jamais l\'état reçu en entrée', () => {
  const state = Policy.createState();
  const frozenCopy = { sawLoadingTrue: state.sawLoadingTrue, stableTicks: state.stableTicks };
  Policy.evaluate(state, { pageLoading: true, elapsedSinceReadyMs: 0 });
  assert.strictEqual(state.sawLoadingTrue, frozenCopy.sawLoadingTrue);
  assert.strictEqual(state.stableTicks, frozenCopy.stableTicks);
});
