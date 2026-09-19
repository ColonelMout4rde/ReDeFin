'use strict';

/*
 * moviepage.qml — GridView : un seul pilote de contentY.
 *
 * Constat (audit-grilles.md F3) : la GridView ne désactivait pas
 * highlightFollowsCurrentItem. Par défaut GridView crée un highlight invisible
 * qui suit currentItem en 150 ms, donc écrit contentY à chaque image en
 * concurrence avec glideY (la propre animation de contentY de la page,
 * pilotée par ensureVisible()). SearchPage neutralise déjà ce suivi sur son
 * ListView de résultats.
 *
 * Test de contrat (lecture de source) : la page ne s'instancie pas telle
 * quelle en Qt Quick Test (voir tests/README.md, coût d'un composant de
 * ~2 800 lignes). On vérifie que highlightFollowsCurrentItem: false et
 * highlightMoveDuration: 0 sont bien déclarés sur la GridView "grid" (avant sa
 * NumberAnimation glideY, donc dans le même bloc), et qu'aucun "highlight:"
 * n'est défini nulle part dans le fichier — condition posée par le brief
 * avant d'appliquer ce correctif : neutraliser un highlight qui n'existe pas
 * ne changerait rien.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const SOURCE = path.join(__dirname, '..', '..', 'qml', 'pages', 'moviepage.qml');
const src = fs.readFileSync(SOURCE, 'utf8');

const gridStart = src.indexOf('GridView {\n        id: grid');
const glideStart = src.indexOf('id: glideY');

test('la GridView "grid" et sa NumberAnimation glideY existent bien dans cet ordre', () => {
    assert.notEqual(gridStart, -1);
    assert.notEqual(glideStart, -1);
    assert.ok(gridStart < glideStart);
});

const gridBlock = src.slice(gridStart, glideStart);

test('highlightFollowsCurrentItem: false est déclaré sur la GridView', () => {
    assert.match(gridBlock, /highlightFollowsCurrentItem:\s*false/);
});

test('highlightMoveDuration: 0 est déclaré sur la GridView', () => {
    assert.match(gridBlock, /highlightMoveDuration:\s*0/);
});

test('aucun "highlight:" (composant personnalisé) n\'est défini dans moviepage.qml', () => {
    // Toute occurrence de "highlight" suivie de ":" doit être l'une des deux
    // propriétés ajoutées par ce correctif : pas de redéfinition du
    // composant highlight lui-même (qui n'existait pas avant, condition
    // posée par le brief avant d'appliquer F3).
    const re = /\bhighlight(\w*)\s*:/g;
    const suffixes = [];
    let m;
    while ((m = re.exec(src)) !== null) suffixes.push(m[1]);
    assert.deepEqual(suffixes.sort(), ['FollowsCurrentItem', 'MoveDuration']);
});

test('la page pilote elle-même contentY (glideY / ensureVisible), pas de currentIndex-driven highlight requis', () => {
    assert.match(src, /property:\s*"contentY"/);
    assert.match(src, /function ensureVisible\(idx, immediate\)/);
});
