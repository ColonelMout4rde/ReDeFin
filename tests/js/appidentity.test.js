'use strict';
// L'identifiant FreeStore du paquet est recopié en dur à quatre endroits.
// S'ils divergent, la vérification de mise à jour échoue en silence
// (appId refusé) ou le bouton « Ouvrir le Free Store » ouvre la fiche d'une
// autre application. Ce test verrouille leur cohérence, quelle que soit
// l'identité portée par la branche (upstream ou fork).

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..');

function read(rel) {
    return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

function capture(rel, re) {
    const m = re.exec(read(rel));
    assert.ok(m, rel + ' : motif introuvable ' + re);
    return m[1];
}

const identifier = JSON.parse(read('manifest.json')).identifier;

test("l'identifiant du manifeste est bien formé", () => {
    assert.match(identifier, /^\w+(\.\w+)+$/);
});

test('UpdateManager attend le même identifiant que le manifeste', () => {
    const appId = capture('qml/components/UpdateManager.qml',
        /property string applicationId:\s*"([^"]+)"/);
    assert.strictEqual(appId, identifier);
});

test('le manifeste de mises à jour du dépôt déclare le même identifiant', () => {
    assert.strictEqual(JSON.parse(read('updates/manifest.json')).appId, identifier);
});

test('le bouton Free Store ouvre la fiche de ce paquet', () => {
    const pkg = capture('qml/components/UpdateDialog.qml',
        /app:fr\.freebox\.freestore\?package=([^"&]+)"/);
    assert.strictEqual(pkg, identifier);
});

test("un fork ne lit pas le manifeste de mises à jour d'upstream", () => {
    const url = capture('qml/components/UpdateManager.qml',
        /property string manifestUrl:\s*"([^"]+)"/);
    const upstream = /\/laborantine\/ReDeFin\//i.test(url);
    assert.strictEqual(upstream, identifier === 'com.lab.redefin',
        'manifestUrl (' + url + ') ne correspond pas au paquet ' + identifier);
});

test("un fork privé n'annonce jamais de canal stable", () => {
    // ReDeFin-CM n'existe sur le FreeStore qu'en bêta privée (bêta-testeurs
    // déclarés sur le Free Factory). Un canal stable publié enverrait les
    // installations bêta vers une version qui n'existe pas sur le FreeStore.
    if (identifier === 'com.lab.redefin')
        return;
    const channels = JSON.parse(read('updates/manifest.json')).channels || {};
    assert.ok(!channels.stable || channels.stable.published !== true,
        'canal stable publié dans updates/manifest.json');
});

test('la version affichée par le client est celle du manifeste', () => {
    // APP_VERSION alimente le panneau À propos et l'en-tête envoyé à
    // Jellyfin ; le manifeste alimente la fiche du paquet.
    const appVersion = capture('qml/js/clientId.js',
        /^var APP_VERSION = "([^"]+)";/m);
    assert.strictEqual(appVersion, JSON.parse(read('manifest.json')).version);
});
