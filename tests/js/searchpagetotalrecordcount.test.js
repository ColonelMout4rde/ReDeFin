'use strict';

/*
 * SearchPage.qml — EnableTotalRecordCount sur le chemin de repli /Items (F11,
 * audit-grilles.md).
 *
 * Constat : makeUrl() demandait EnableTotalRecordCount=true pour le chemin de
 * repli (modes "items-typed"/"items-untyped", quand /Search/Hints est
 * épuisé), alors que le total exact renvoyé par le serveur n'alimente que la
 * propriété totalRecordCount de la page — jamais lue ni affichée : le compte
 * montré à l'écran (« N résultat(s) ») vient de results.length, pas de
 * totalRecordCount. Les deux autres routes de recherche (/Search/Hints,
 * modes 0/1) demandaient déjà EnableTotalRecordCount=false.
 *
 * SearchPage.qml (~2500 lignes, dépendances réseau à l'ouverture) n'est pas
 * instanciée ici : test de contrat sur le source, comme documenté dans
 * tests/README.md pour un changement purement déclaratif.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const SOURCE = path.join(__dirname, '..', '..', 'qml', 'pages', 'SearchPage.qml');
const src = fs.readFileSync(SOURCE, 'utf8');

test('aucune route de recherche ne demande plus EnableTotalRecordCount=true', () => {
    assert.equal(/EnableTotalRecordCount=true/.test(src), false);
});

test('les trois routes de recherche demandent EnableTotalRecordCount=false', () => {
    const matches = src.match(/EnableTotalRecordCount=false/g) || [];
    assert.equal(matches.length, 3);
});

test('totalRecordCount de la page n\'est jamais utilisé pour l\'affichage du compte de résultats', () => {
    // Le texte montré à l'écran vient de results.length ; si un jour il se
    // met à lire totalRecordCount, redemander EnableTotalRecordCount=true
    // sur le chemin de repli redeviendrait nécessaire (documenté ci-dessus).
    assert.match(src, /results\.length \+ " résultat"/);
});
