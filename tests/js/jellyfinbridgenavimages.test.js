'use strict';

/*
 * Vérifie le point 3 de l'audit réseau : les listes de navigation (grille
 * paginée, /Items/Latest, Resume, NextUp, Similar) demandent explicitement
 * les types d'images qu'elles consomment réellement, au lieu de laisser
 * Jellyfin renvoyer ImageTags/BackdropImageTags pour tous ses types sur
 * chaque item de la page.
 *
 * Le choix des types par écran est établi par grep sur les consommateurs
 * QML (moviepage.qml, PosterGridCard.qml, NextUpBlock.qml, SimilarItems.qml)
 * -- voir le commentaire au-dessus de IMG_TYPES_NAV_* dans jellyfinBridge.js.
 * Ces tests figent seulement le contrat d'URL observable (présence des
 * paramètres, jamais leur ordre), pas les valeurs internes du bridge.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { createBridge, recorder, queryOf } = require('./bridgeharness');

const LAN = 'http://192.168.1.5:8096';
const TOKEN = 'tok-TEST';
const USER = 'user-1';

test('grille paginée (fetchMovieFolderItemsPage) : Primary, Thumb, Backdrop, limite à 1 par type', () => {
    const h = createBridge();
    const r = recorder();
    h.bridge.fetchMovieFolderItemsPage(LAN, TOKEN, USER, 'folder-1', 0, 50, 0, r.onSuccess, r.onError);
    const q = queryOf(h.last().url);
    assert.equal(q.EnableImageTypes, 'Primary,Thumb,Backdrop');
    assert.equal(q.ImageTypeLimit, '1');
});

test('/UserItems/Resume (fetchHomeResumeItems) : Primary, Thumb, Backdrop, limite à 1 par type', () => {
    const h = createBridge();
    const r = recorder();
    h.bridge.fetchHomeResumeItems(LAN, TOKEN, USER, 20, r.onSuccess, r.onError);
    const q = queryOf(h.last().url);
    assert.equal(q.EnableImageTypes, 'Primary,Thumb,Backdrop');
    assert.equal(q.ImageTypeLimit, '1');
});

test('/Shows/NextUp (fetchHomeNextUpItems) : Primary, Thumb seulement, limite à 1 par type', () => {
    const h = createBridge();
    const r = recorder();
    h.bridge.fetchHomeNextUpItems(LAN, TOKEN, USER, 20, r.onSuccess, r.onError);
    const q = queryOf(h.last().url);
    assert.equal(q.EnableImageTypes, 'Primary,Thumb');
    assert.equal(q.ImageTypeLimit, '1');
    // Le Backdrop affiché pour NextUp vient de ParentBackdropImageTags, un
    // champ Fields= distinct, jamais de BackdropImageTags propre à l'item.
    assert.equal(q.EnableImageTypes.indexOf('Backdrop'), -1);
});

test('/Items/{id}/Similar (fetchSimilarItems) : Primary seul, limite à 1', () => {
    const h = createBridge();
    const r = recorder();
    h.bridge.fetchSimilarItems(LAN, TOKEN, USER, 'item-1', 20, r.onSuccess, r.onError);
    const q = queryOf(h.last().url);
    assert.equal(q.EnableImageTypes, 'Primary');
    assert.equal(q.ImageTypeLimit, '1');
});

test('/Items/Latest (fetchHomeLatestItemsForParent) : Primary, Thumb, Backdrop, limite à 1 par type', () => {
    const h = createBridge();
    const r = recorder();
    h.bridge.fetchHomeLatestItemsForParent(LAN, TOKEN, USER, 'parent-1', 20, r.onSuccess, r.onError, false);
    const q = queryOf(h.last().url);
    assert.equal(q.EnableImageTypes, 'Primary,Thumb,Backdrop');
    assert.equal(q.ImageTypeLimit, '1');
});

test('les réponses normales ne sont pas affectées par l\'ajout des paramètres', () => {
    const h = createBridge();
    const r = recorder();
    h.bridge.fetchSimilarItems(LAN, TOKEN, USER, 'item-1', 20, r.onSuccess, r.onError);
    h.last().respondJson({ Items: [{ Id: 'i1', Type: 'Movie' }] });
    assert.equal(r.ko.length, 0);
    assert.equal(r.ok[0].length, 1);
    assert.equal(r.ok[0][0].Id, 'i1');
});
