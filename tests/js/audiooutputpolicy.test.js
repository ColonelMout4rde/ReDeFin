'use strict';

/*
 * Politique pure de sortie audio (qml/js/AudioOutputPolicy.js).
 *
 * Contrat produit vérifié ici :
 *   - le défaut est "multichannel" : AUCUN changement de comportement ;
 *   - le downmix est engagé si et seulement si le mode est "stereo" ET que la
 *     piste effectivement envoyée au serveur a plus de 2 canaux ;
 *   - une piste mono/stéréo n'est jamais transcodée, même en mode stéréo ;
 *   - un nombre de canaux inconnu ne déclenche pas de transcodage, mais le
 *     plafond MaxAudioChannels=2 reste annoncé au serveur ;
 *   - la cible du mixage est AAC 2.0 à 192 kb/s (constante nommée).
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadQmlJs } = require('./qmljs');

const AOP = loadQmlJs('qml/js/AudioOutputPolicy.js');

const MULTI = 'multichannel';
const STEREO = 'stereo';

function stream(channels) {
    return { Type: 'Audio', Codec: 'ac3', Channels: channels };
}

/* ===== normalizeMode / isStereo ===== */

test('normalizeMode : seules les valeurs stéréo connues basculent, le reste retombe sur le défaut', () => {
    assert.equal(AOP.MODE_MULTICHANNEL, MULTI);
    assert.equal(AOP.MODE_STEREO, STEREO);

    assert.equal(AOP.normalizeMode('stereo'), STEREO);
    assert.equal(AOP.normalizeMode('  STEREO  '), STEREO);
    assert.equal(AOP.normalizeMode('Stereo'), STEREO);
    assert.equal(AOP.normalizeMode('2.0'), STEREO);
    assert.equal(AOP.normalizeMode('downmix'), STEREO);

    assert.equal(AOP.normalizeMode('multichannel'), MULTI);
    assert.equal(AOP.normalizeMode(''), MULTI);
    assert.equal(AOP.normalizeMode(undefined), MULTI);
    assert.equal(AOP.normalizeMode(null), MULTI);
    assert.equal(AOP.normalizeMode(0), MULTI);
    assert.equal(AOP.normalizeMode('surround'), MULTI);
    assert.equal(AOP.normalizeMode('5.1'), MULTI);
    assert.equal(AOP.normalizeMode({}), MULTI);
    assert.equal(AOP.normalizeMode([]), MULTI);

    assert.equal(AOP.isStereo('stereo'), true);
    assert.equal(AOP.isStereo('multichannel'), false);
    assert.equal(AOP.isStereo('n-importe-quoi'), false);
});

/* ===== channelsOf ===== */

test('channelsOf : lecture défensive du nombre de canaux', () => {
    assert.equal(AOP.channelsOf(stream(6)), 6);
    assert.equal(AOP.channelsOf(stream('8')), 8);
    assert.equal(AOP.channelsOf({ channels: 2 }), 2);
    assert.equal(AOP.channelsOf(6), 6);
    assert.equal(AOP.channelsOf('2'), 2);

    // Inconnu / inexploitable => 0.
    assert.equal(AOP.channelsOf(null), 0);
    assert.equal(AOP.channelsOf(undefined), 0);
    assert.equal(AOP.channelsOf({}), 0);
    assert.equal(AOP.channelsOf(stream(0)), 0);
    assert.equal(AOP.channelsOf(stream(null)), 0);
    assert.equal(AOP.channelsOf(stream('')), 0);
    assert.equal(AOP.channelsOf(stream('inconnu')), 0);
    assert.equal(AOP.channelsOf(stream(NaN)), 0);
    assert.equal(AOP.channelsOf(stream(-2)), 0);
});

/* ===== plan() ===== */

test('mode multicanal : jamais de downmix, jamais de plafond, quelle que soit la piste', () => {
    [undefined, null, stream(0), stream(1), stream(2), stream(6), stream(8)].forEach((st) => {
        const p = AOP.plan(MULTI, st);
        assert.equal(p.mode, MULTI);
        assert.equal(p.downmix, false);
        assert.equal(p.channels, 0);
        assert.equal(p.codec, '');
        assert.equal(p.bitrate, 0);
        assert.equal(p.maxChannels, 0);
    });
});

test('mode invalide : traité comme multicanal (aucun changement de comportement)', () => {
    const p = AOP.plan('bidon', stream(6));
    assert.equal(p.mode, MULTI);
    assert.equal(p.downmix, false);
    assert.equal(p.maxChannels, 0);
});

test('stéréo + piste 5.1 : downmix AAC 2.0 à 192 kb/s', () => {
    const p = AOP.plan(STEREO, stream(6));
    assert.equal(p.mode, STEREO);
    assert.equal(p.sourceChannels, 6);
    assert.equal(p.downmix, true);
    assert.equal(p.channels, 2);
    assert.equal(p.codec, 'aac');
    assert.equal(p.bitrate, 192000);
    assert.equal(p.maxChannels, 2);

    // Les constantes exposées sont bien celles utilisées par le plan.
    assert.equal(AOP.STEREO_CHANNELS, 2);
    assert.equal(AOP.STEREO_CODEC, 'aac');
    assert.equal(AOP.STEREO_BITRATE, 192000);
});

test('stéréo + piste 7.1 : downmix également', () => {
    const p = AOP.plan(STEREO, stream(8));
    assert.equal(p.sourceChannels, 8);
    assert.equal(p.downmix, true);
    assert.equal(p.channels, 2);
});

test('stéréo + piste déjà stéréo : aucun transcodage, mais plafond annoncé', () => {
    const p = AOP.plan(STEREO, stream(2));
    assert.equal(p.sourceChannels, 2);
    assert.equal(p.downmix, false);
    assert.equal(p.channels, 0);
    assert.equal(p.codec, '');
    assert.equal(p.bitrate, 0);
    assert.equal(p.maxChannels, 2);
});

test('stéréo + piste mono : aucun transcodage', () => {
    const p = AOP.plan(STEREO, stream(1));
    assert.equal(p.sourceChannels, 1);
    assert.equal(p.downmix, false);
    assert.equal(p.maxChannels, 2);
});

test('stéréo + canaux inconnus ou piste absente : pas de transcodage, plafond conservé', () => {
    [undefined, null, {}, stream(0), stream(null), stream('inconnu'), stream(NaN)].forEach((st) => {
        const p = AOP.plan(STEREO, st);
        assert.equal(p.sourceChannels, 0);
        assert.equal(p.downmix, false, 'canaux inconnus ne doivent jamais forcer un transcodage');
        assert.equal(p.channels, 0);
        assert.equal(p.maxChannels, 2, 'le plafond stéréo reste annoncé au serveur');
    });
});

/* ===== maxChannels / capChannels ===== */

test('maxChannels : 2 en stéréo, aucun plafond sinon', () => {
    assert.equal(AOP.maxChannels(STEREO), 2);
    assert.equal(AOP.maxChannels(MULTI), 0);
    assert.equal(AOP.maxChannels('bidon'), 0);
});

test('capChannels : abaisse un plan existant au plafond sans inventer de valeur', () => {
    assert.equal(AOP.capChannels(STEREO, 6), 2);
    assert.equal(AOP.capChannels(STEREO, 8), 2);
    assert.equal(AOP.capChannels(STEREO, 2), 2);
    assert.equal(AOP.capChannels(STEREO, 1), 1);

    assert.equal(AOP.capChannels(MULTI, 6), 6);
    assert.equal(AOP.capChannels(MULTI, 2), 2);

    // Valeur inconnue : rendue telle quelle, le chemin appelant garde sa logique.
    assert.equal(AOP.capChannels(STEREO, null), null);
    assert.equal(AOP.capChannels(STEREO, 0), 0);
    assert.equal(AOP.capChannels(MULTI, null), null);
});

/* ===== describe() ===== */

test('describe : résumé compact, sans URL ni secret', () => {
    const line = AOP.describe(AOP.plan(STEREO, stream(6)));
    assert.equal(line, 'mode=stereo srcCh=6 downmix=1 codec=aac ch=2 br=192000 maxCh=2');
    assert.equal(AOP.describe(null), 'audio-plan=none');
    assert.match(AOP.describe(AOP.plan(MULTI, stream(6))), /^mode=multichannel .*downmix=0/);
});
