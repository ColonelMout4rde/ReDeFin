'use strict';

/*
 * Contrat F8 (audit shell) sur main.qml : trois champs de
 * fbx.application.Settings (serverUrl, lastUserId, lastUserName) étaient
 * réécrits dans _applySettingsPayload() sans comparaison préalable, alors que
 * les booléens du même bloc (maximumSessionSecurity, rememberJellyfinSession)
 * étaient déjà gardés. Le commentaire du fichier explique pourquoi cela
 * compte : « L'implémentation Freebox peut réémettre le signal même pour une
 * valeur identique », donc une écriture répétée sans changement réel peut
 * déclencher une E/S synchrone à chaque chargement de l'accueil.
 *
 * Sous le harnais Qt Quick Test local, fbx.application.Settings est un objet
 * QML ordinaire (pas le vrai singleton Freebox) : y assigner deux fois la
 * même valeur ne réémet déjà pas le signal de changement, donc un test
 * comportemental ne distinguerait pas "gardé" de "non gardé" ici. On vérifie
 * donc le contrat par lecture de source, comme le permettent les conventions
 * du projet pour ce type de changement.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const SRC = fs.readFileSync(path.join(__dirname, '..', '..', 'main.qml'), 'utf8');

const FIELDS = [
  { payload: 'serverUrl', settings: 'serverUrl' },
  { payload: 'lastUserId', settings: 'lastUserId' },
  { payload: 'lastUserName', settings: 'lastUserName' },
];

for (const f of FIELDS) {
  test(`_applySettingsPayload compare settings.${f.settings} avant de le réécrire`, () => {
    // On isole le bloc "if (payload.<champ> !== undefined ...) { ... }" et on
    // vérifie qu'il contient une comparaison settings.<champ> !== ... AVANT
    // toute affectation settings.<champ> = ..., pas une affectation nue.
    const guardRe = new RegExp(
      'if\\s*\\(\\s*payload\\.' + f.payload + '\\s*!==\\s*undefined[\\s\\S]{0,400}?\\n\\s*\\}',
    );
    const m = SRC.match(guardRe);
    assert.ok(m, `bloc payload.${f.payload} introuvable dans main.qml`);
    const block = m[0];

    assert.match(
      block,
      new RegExp('if\\s*\\(\\s*settings\\.' + f.settings + '\\s*!==\\s*\\w'),
      `settings.${f.settings} doit être comparé avant réaffectation :\n${block}`,
    );
  });
}

test('les écritures booléennes déjà gardées le restent (non-régression)', () => {
  assert.match(SRC, /if\s*\(\s*settings\.maximumSessionSecurity\s*!==\s*nextMaximumSecurity\s*\)/);
  assert.match(SRC, /if\s*\(\s*settings\.rememberJellyfinSession\s*!==\s*nextRememberSession\s*\)/);
});
