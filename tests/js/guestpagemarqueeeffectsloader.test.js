'use strict';

/*
 * guestpage.qml — effets de marquee (ShaderEffectSource + OpacityMask) sous
 * Loader (F10, audit-grilles.md).
 *
 * Constat : chaque carte d'invité instanciait deux jeux
 * ShaderEffectSource + OpacityMask + masque de dégradé (nom d'acteur, nom de
 * personnage), inactifs hors focus (le marquee ne joue que sur la carte
 * focalisée dont le texte déborde, guestPage.runGate && card.activeFocus &&
 * overflow > 6, soit la condition "marqueeOn" déjà existante).
 *
 * Correctif : chaque jeu passe derrière un Loader dont "active" reprend
 * exactement cette même condition marqueeOn, si bien qu'aucun de ces objets
 * n'existe pour les cartes non focalisées.
 *
 * guestpage.qml (rail avec modèle de données, glide, chargement d'images) a
 * un coût d'instanciation disproportionné pour ce changement purement
 * déclaratif ; test de contrat sur le source, comme pour les autres pages de
 * cette zone (voir tests/README.md).
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const SOURCE = path.join(__dirname, '..', '..', 'qml', 'pages', 'guestpage.qml');
const src = fs.readFileSync(SOURCE, 'utf8');

test('les deux jeux ShaderEffectSource/OpacityMask existent toujours (1 par viewport)', () => {
    assert.equal((src.match(/ShaderEffectSource\s*\{/g) || []).length, 2);
    assert.equal((src.match(/OpacityMask\s*\{/g) || []).length, 2);
});

function loaderBlock(loaderId) {
    const start = src.indexOf('id: ' + loaderId);
    assert.notEqual(start, -1, loaderId + ' introuvable');
    const braceStart = src.indexOf('{', src.lastIndexOf('Loader', start));
    // Bloc suffisamment large pour couvrir sourceComponent en entier, sans
    // dépendre d'un comptage d'accolades.
    return src.slice(braceStart, src.indexOf('SequentialAnimation', start));
}

test('actorNameEffectsLoader : Loader actif sur actorNameViewport.marqueeOn, contenant le ShaderEffectSource et l\'OpacityMask du nom d\'acteur', () => {
    const block = loaderBlock('actorNameEffectsLoader');
    assert.match(block, /active:\s*actorNameViewport\.marqueeOn/);
    assert.match(block, /ShaderEffectSource\s*\{[\s\S]*?id:\s*actorNameTexture/);
    assert.match(block, /OpacityMask\s*\{[\s\S]*?id:\s*actorNameMasked/);
});

test('characterNameEffectsLoader : Loader actif sur characterNameViewport.marqueeOn, contenant le ShaderEffectSource et l\'OpacityMask du nom de personnage', () => {
    const block = loaderBlock('characterNameEffectsLoader');
    assert.match(block, /active:\s*characterNameViewport\.marqueeOn/);
    assert.match(block, /ShaderEffectSource\s*\{[\s\S]*?id:\s*characterNameTexture/);
    assert.match(block, /OpacityMask\s*\{[\s\S]*?id:\s*characterNameMasked/);
});
