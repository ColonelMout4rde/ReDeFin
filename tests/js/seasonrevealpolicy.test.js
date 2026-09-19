'use strict';
// SeasonRevealPolicy.js — décision pure du visual reveal de seasonpage.qml.
// Voir tests/README.md pour la convention (module pur, testé via qmljs.js).

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadQmlJs } = require('./qmljs');

function load() {
    return loadQmlJs('qml/js/SeasonRevealPolicy.js');
}

test('revealReady() (lot 2, MESURES.md « page saison ») : se lève dès isLoading=false + première image peinte + rangée structurellement prête + fenêtre de stabilité écoulée', () => {
    const Policy = load();
    assert.equal(Policy.revealReady({
        isLoading: false,
        postFirstFrame: true,
        episodesRowSettled: true,
        layoutStable: true,
    }), true);
});

test('revealReady() reste fermé tant que isLoading est vrai', () => {
    const Policy = load();
    assert.equal(Policy.revealReady({
        isLoading: true,
        postFirstFrame: true,
        episodesRowSettled: true,
        layoutStable: true,
    }), false);
});

test("revealReady() reste fermé avant la première image peinte (postFirstFrame)", () => {
    const Policy = load();
    assert.equal(Policy.revealReady({
        isLoading: false,
        postFirstFrame: false,
        episodesRowSettled: true,
        layoutStable: true,
    }), false);
});

test('revealReady() reste fermé tant que la rangée d\'épisodes n\'est pas structurellement prête (Loader/booting)', () => {
    const Policy = load();
    assert.equal(Policy.revealReady({
        isLoading: false,
        postFirstFrame: true,
        episodesRowSettled: false,
        layoutStable: true,
    }), false);
});

test("revealReady() reste fermé tant que la fenêtre de stabilité de mise en page n'est pas écoulée", () => {
    const Policy = load();
    assert.equal(Policy.revealReady({
        isLoading: false,
        postFirstFrame: true,
        episodesRowSettled: true,
        layoutStable: false,
    }), false);
});

test("revealReady() ne prend aucun paramètre logo/fond/détails : un état sans ces clés se lève quand même (décision produit)", () => {
    const Policy = load();
    // Reproduit exactement le nouveau contrat : avant le correctif,
    // _visualAssetsSettled() attendait aussi logo/fond/action panel/fiche de
    // l'épisode sélectionné. revealReady() n'a même pas ces clés dans sa
    // signature.
    assert.equal(Policy.revealReady({
        isLoading: false,
        postFirstFrame: true,
        episodesRowSettled: true,
        layoutStable: true,
        logoReady: false,
        bgReady: false,
        detailsReady: false,
        actionsArmed: false,
    }), true);
});

test('revealReady() sur un état vide reste fermé', () => {
    const Policy = load();
    assert.equal(Policy.revealReady({}), false);
    assert.equal(Policy.revealReady(), false);
});

test('LAYOUT_STABILITY_MS est plafonné à 150 ms (stabilité de mise en page, BRIEF-COMMUN.md)', () => {
    const Policy = load();
    assert.equal(typeof Policy.LAYOUT_STABILITY_MS, 'number');
    assert.ok(Policy.LAYOUT_STABILITY_MS > 0 && Policy.LAYOUT_STABILITY_MS <= 150,
        'LAYOUT_STABILITY_MS doit rester dans la fenêtre de stabilité imposée (<=150ms)');
});

test('LOADING_OFF_MIN_MS (lot 3, MESURES.md « page saison » run 2) : plancher anti-clignotement ramené à 0, ShellPage tient déjà son propre rideau', () => {
    const Policy = load();
    assert.equal(typeof Policy.LOADING_OFF_MIN_MS, 'number');
    assert.equal(Policy.LOADING_OFF_MIN_MS, 0);
});
