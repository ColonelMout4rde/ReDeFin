'use strict';

/*
 * Réinjection du sous-titre FORCÉ français dans un flux serveur.
 *
 * Bug corrigé : la règle héritée de l'upstream ne s'appliquait que si le
 * drapeau forceServerRemux était vrai. Sur un même fichier (audio FR 5.1
 * piste 1, audio EN piste 2, sous-titres forcés FR texte piste 3, sous-titres
 * complets FR piste 4), la Freebox Révolution affichait donc :
 *
 *   - lecture initiale transcodée par la policy : « -map -0:s », aucun
 *     sous-titre forcé ;
 *   - après un changement de piste audio, ou en « Sortie audio : Stéréo » :
 *     « -map 0:3 ... -codec:s:0 copy », sous-titres forcés injectés.
 *
 * Le comportement dépendait du chemin technique, pas du contenu ni du choix de
 * l'utilisateur. La décision porte désormais sur le fait que le flux final est
 * un flux SERVEUR capable d'embarquer du texte.
 *
 * Deux niveaux de test : la fonction pure (ForcedSubtitlePolicy.js) et la
 * négociation complète rejouée en Node (negotiationharness.js).
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadQmlJs } = require('./qmljs');
const { SERVER, negotiate, loadRouter } = require('./negotiationharness');

/* ===== Source de test commune ===== */

// 1080p H.264 : la Révolution sait la lire directement.
const VIDEO_H264 = { Type: 'Video', Index: 0, Codec: 'h264', Width: 1920, Height: 1080, BitDepth: 8, AverageFrameRate: 24 };
// HEVC 4K : incompatibilité vidéo dure, la policy Révolution transcode en
// HTTP/MKV progressif. C'est le cas « lecture initiale » du bug.
const VIDEO_HEVC_4K = { Type: 'Video', Index: 0, Codec: 'hevc', Width: 3840, Height: 2160, BitDepth: 8, AverageFrameRate: 24 };
// AV1 : la policy Révolution transcode en HLS/TS.
const VIDEO_AV1 = { Type: 'Video', Index: 0, Codec: 'av1', Width: 1920, Height: 1080, BitDepth: 8, AverageFrameRate: 24 };

const AUDIO_FR_51 = { Type: 'Audio', Index: 1, Codec: 'ac3', Channels: 6, Language: 'fra', IsDefault: true };
const AUDIO_EN_20 = { Type: 'Audio', Index: 2, Codec: 'aac', Channels: 2, Language: 'eng' };

const SUB_FR_FORCED_TEXT = { Type: 'Subtitle', Index: 3, Codec: 'subrip', Language: 'fra', IsForced: true, IsTextSubtitleStream: true };
const SUB_FR_FORCED_PGS = { Type: 'Subtitle', Index: 3, Codec: 'pgssub', Language: 'fra', IsForced: true };
const SUB_FR_FULL = { Type: 'Subtitle', Index: 4, Codec: 'subrip', Language: 'fra', Title: 'Complet', IsTextSubtitleStream: true };

function source(video, subtitles, extra) {
    return Object.assign({
        Id: 'MS1', Container: 'mkv', Path: '/m/film.mkv',
        MediaStreams: [video, AUDIO_FR_51, AUDIO_EN_20].concat(subtitles),
    }, extra || {});
}

function film(video, extra) {
    return source(video, [SUB_FR_FORCED_TEXT, SUB_FR_FULL], extra);
}

/* Le contrat observable d'une injection réussie. */
function assertForcedSubtitleInjected(neg, label) {
    assert.equal(neg.params.SubtitleStreamIndex, '3', label + ' : piste forcée demandée');
    assert.equal(neg.params.SubtitleMethod, 'Embed', label + ' : embarquée par le serveur');
    assert.equal(neg.result.carrySafeFrenchForcedSubtitle, true, label);
    assert.equal(neg.result.effectiveSubtitleStreamIndex, 3, label + ' : coche du menu');
    assert.equal(neg.result.effectiveSubtitleMode, 'embed', label);
}

/* Aucune injection : le serveur reçoit explicitement « pas de sous-titre ». */
function assertNoForcedSubtitle(neg, label) {
    assert.notEqual(neg.params.SubtitleStreamIndex, '3', label + ' : aucune piste forcée demandée');
    assert.equal(neg.result.carrySafeFrenchForcedSubtitle, false, label);
}

/* ===== 1. Fonction pure : le flux peut-il embarquer du texte ? ===== */

const Policy = loadQmlJs('qml/js/ForcedSubtitlePolicy.js');

test('pur : remux, transcodage de politique et sélection serveur portent du texte', () => {
    assert.equal(Policy.isEmbeddableServerStream({ serverRemux: true }), true);
    assert.equal(Policy.isEmbeddableServerStream({ policyTranscode: true }), true);
    assert.equal(Policy.isEmbeddableServerStream({ serverSelect: true }), true);
    assert.equal(Policy.isEmbeddableServerStream({}), false, 'lecture directe');
    assert.equal(Policy.isEmbeddableServerStream(null), false);
});

test('pur : HLS, URL Jellyfin conservée et transcodage DVDSub sont exclus', () => {
    assert.equal(Policy.isEmbeddableServerStream({ serverRemux: true, mustHls: true }), false);
    assert.equal(Policy.isEmbeddableServerStream({ serverRemux: true, hlsUrl: true }), false);
    assert.equal(Policy.isEmbeddableServerStream({ policyTranscode: true, policyTranscodeHls: true }), false);
    assert.equal(Policy.isEmbeddableServerStream({ policyTranscode: true, preserveTranscodingUrl: true }), false);
    // Le transcodage « DVDSub dormant » choisit lui-même sa piste : il ne suit
    // la règle que si un remux serveur l'accompagnait déjà (comportement
    // historique strictement conservé).
    assert.equal(Policy.isEmbeddableServerStream({ policyTranscode: true, dvdSubtitleTranscode: true }), false);
    assert.equal(Policy.isEmbeddableServerStream({ serverRemux: true, dvdSubtitleTranscode: true }), true);
});

/* ===== 2. Fonction pure : décision de réinjection ===== */

function carryInput(over) {
    return Object.assign({
        smartRules: true, serverStream: true,
        forcedIndex: 3, forcedIsText: true,
        useLocalSubs: false, explicitSubtitleIndex: -1, explicitSubtitlesOff: false,
        imageBurnIn: false, imageRemux: false, textSubtitleSelected: false,
        serverExternalSubtitle: false, internalSubtitleRisk: false,
    }, over || {});
}

test('pur : la piste forcée texte est réinjectée en Embed sur un flux serveur', () => {
    const d = Policy.decideCarry(carryInput());
    assert.equal(d.carry, true);
    assert.equal(d.index, 3);
    assert.equal(d.method, 'Embed');
    assert.equal(d.reason, 'serverStream');
});

test('pur : chaque garde-fou refuse avec sa propre raison', () => {
    const cases = [
        [{ smartRules: false }, 'originalMode'],
        [{ explicitSubtitlesOff: true }, 'explicitOff'],
        [{ explicitSubtitleIndex: 4 }, 'explicitSubtitle'],
        [{ useLocalSubs: true }, 'localSubtitles'],
        [{ forcedIndex: -1 }, 'noForcedSubtitle'],
        [{ forcedIsText: false }, 'forcedSubtitleNotText'],
        [{ imageBurnIn: true }, 'imageBurnIn'],
        [{ imageRemux: true }, 'imageRemux'],
        [{ textSubtitleSelected: true }, 'textSubtitleSelected'],
        [{ serverExternalSubtitle: true }, 'serverExternalSubtitle'],
        [{ internalSubtitleRisk: true }, 'internalSubtitleRisk'],
        [{ serverStream: false }, 'notServerStream'],
    ];
    for (const [over, reason] of cases) {
        const d = Policy.decideCarry(carryInput(over));
        assert.equal(d.carry, false, reason);
        assert.equal(d.reason, reason);
        assert.equal(d.index, -1, reason);
        assert.equal(d.method, null, reason);
    }
});

test('pur : un « Aucun » explicite prime sur la raison technique', () => {
    // La trace doit nommer le choix de l'utilisateur, pas le chemin.
    assert.equal(Policy.decideCarry(carryInput({ explicitSubtitlesOff: true, serverStream: false })).reason,
        'explicitOff');
});

/* ===== 3. Négociation : l'injection devient cohérente ===== */

test('lecture initiale transcodée par la policy : les forcés sont injectés', () => {
    // C'est le cas KO avant ce correctif : path=policy-transcode,
    // forceServerRemux=false, donc « -map -0:s » côté ffmpeg.
    const neg = negotiate('revolution', film(VIDEO_HEVC_4K), {});
    assert.equal(neg.finalUrlKind, 'http-transcode');
    assertForcedSubtitleInjected(neg, 'transcodage de politique');
});

test('changement de piste audio : les forcés restent injectés', () => {
    const neg = negotiate('revolution', film(VIDEO_H264), { selectedAudioStream: 2, forceServerRemux: true });
    assert.equal(neg.params.AudioStreamIndex, '2');
    assertForcedSubtitleInjected(neg, 'remux après changement audio');

    // Même chose quand la vidéo était déjà transcodée.
    const onTranscode = negotiate('revolution', film(VIDEO_HEVC_4K), { selectedAudioStream: 2, forceServerRemux: true });
    assertForcedSubtitleInjected(onTranscode, 'transcodage après changement audio');
});

test('sortie audio stéréo : les forcés sont injectés', () => {
    const neg = negotiate('revolution', film(VIDEO_H264), {}, 'stereo');
    assert.equal(neg.stereoDownmix, true);
    assertForcedSubtitleInjected(neg, 'downmix stéréo');
});

test('seek réseau : les forcés survivent à la reprise serveur', () => {
    const neg = negotiate('revolution', film(VIDEO_H264),
        { startMs: 600000, forceServerSeek: true, preferTicks: true });
    assert.equal(neg.params.StartTimeTicks, '6000000000');
    assertForcedSubtitleInjected(neg, 'remux positionné');

    const onTranscode = negotiate('revolution', film(VIDEO_HEVC_4K),
        { startMs: 600000, forceServerSeek: true, preferTicks: true });
    assertForcedSubtitleInjected(onTranscode, 'transcodage positionné');
});

test('Devialet suit la même règle que la Révolution', () => {
    // Les deux policies déclarent bien un SubtitleProfile srt/subrip Embed.
    const neg = negotiate('devialet', film(VIDEO_H264), { selectedAudioStream: 2, forceServerRemux: true });
    assertForcedSubtitleInjected(neg, 'Devialet');
});

/* ===== 4. Négociation : cas où l'injection reste interdite ===== */

test('lecture directe pure : rien n\'est demandé au serveur', () => {
    const neg = negotiate('revolution', film(VIDEO_H264), {});
    assert.equal(neg.finalUrlKind, 'http-dp');
    assertNoForcedSubtitle(neg, 'lecture directe');
    assert.equal(neg.params.SubtitleStreamIndex, '-1');
    // Le fichier d'origine porte sa piste forcée : QtMultimedia l'affiche
    // nativement, et le menu la coche.
    assert.equal(neg.result.effectiveSubtitleStreamIndex, 3);
    assert.equal(neg.result.effectiveSubtitleMode, 'directplay');
});

test('sous-titre choisi explicitement : c\'est lui qui part au serveur', () => {
    const neg = negotiate('revolution', film(VIDEO_H264),
        { selectedSubtitleStream: 4, selectedSubtitleIsText: true });
    assertNoForcedSubtitle(neg, 'choix explicite');
    assert.equal(neg.params.SubtitleStreamIndex, '4');
    assert.equal(neg.result.effectiveSubtitleStreamIndex, 4);
});

test('« Aucun » explicite n\'est jamais écrasé, sur aucun chemin', () => {
    // handleSubsOff() pose disableAutoVoFrenchFullSubtitle et renégocie ; le
    // drapeau survit ensuite aux seeks et aux changements de piste.
    const off = { selectedSubtitleStream: -1, disableAutoVoFrenchFullSubtitle: true };
    const cases = [
        ['remux', VIDEO_H264, Object.assign({ forceServerRemux: true }, off)],
        ['transcodage', VIDEO_HEVC_4K, Object.assign({}, off)],
        ['changement audio', VIDEO_H264, Object.assign({ selectedAudioStream: 2, forceServerRemux: true }, off)],
        ['seek réseau', VIDEO_H264, Object.assign({ startMs: 600000, forceServerSeek: true, preferTicks: true }, off)],
    ];
    for (const [label, video, extra] of cases) {
        const neg = negotiate('revolution', film(video), extra);
        assertNoForcedSubtitle(neg, label);
        assert.equal(neg.params.SubtitleStreamIndex, '-1', label);
        // Et le menu doit afficher « Aucun », pas la piste forcée.
        assert.equal(neg.result.effectiveSubtitleStreamIndex, -1, label + ' : coche du menu');
    }

    // Le downmix stéréo n'est pas une porte dérobée non plus.
    const stereo = negotiate('revolution', film(VIDEO_H264), off, 'stereo');
    assertNoForcedSubtitle(stereo, 'stéréo');
    assert.equal(stereo.params.SubtitleStreamIndex, '-1');
});

test('mode Original : la règle reste inactive', () => {
    const neg = negotiate('revolution', film(VIDEO_HEVC_4K), {}, undefined,
        { playbackRuleMode: 'directplay' });
    // La vidéo HEVC 4K reste transcodée (incompatibilité matérielle réelle),
    // mais aucune règle de confort ReDeFin ne s'applique.
    assert.equal(neg.finalUrlKind, 'http-transcode');
    assertNoForcedSubtitle(neg, 'mode Original');
    assert.equal(neg.params.SubtitleStreamIndex, '-1');
});

test('aucune piste forcée : rien n\'est inventé', () => {
    const neg = negotiate('revolution', source(VIDEO_HEVC_4K, [SUB_FR_FULL]), {});
    assertNoForcedSubtitle(neg, 'piste complète seule');
    assert.equal(neg.params.SubtitleStreamIndex, '-1');
    assert.equal(neg.result.safeFrenchForcedSubtitleIndex, -1);
});

test('piste forcée image (PGS) : pas d\'Embed texte', () => {
    const neg = negotiate('revolution', source(VIDEO_HEVC_4K, [SUB_FR_FORCED_PGS]), {});
    assertNoForcedSubtitle(neg, 'PGS forcé');
    assert.equal(neg.params.SubtitleStreamIndex, '-1');
    assert.equal(neg.result.safeFrenchForcedSubtitleIndex, 3, 'la piste est bien repérée, mais elle est image');
});

test('transcodage HLS : aucun texte embarqué dans les segments TS', () => {
    const neg = negotiate('revolution', film(VIDEO_AV1), {});
    assert.equal(neg.finalUrlKind, 'hls');
    assertNoForcedSubtitle(neg, 'HLS');
    assert.equal(neg.params.SubtitleStreamIndex, '-1');
    assert.equal(neg.result.effectiveSubtitleStreamIndex, -1, 'le menu ne coche pas une piste absente');
});

test('TranscodingUrl Jellyfin conservée : elle n\'est pas réécrite', () => {
    const neg = negotiate('revolution', film(VIDEO_HEVC_4K, {
        TranscodingUrl: '/videos/IT1/stream.mkv?PlaySessionId=PS1&VideoCodec=h264',
    }), {});
    assertNoForcedSubtitle(neg, 'URL Jellyfin conservée');
    assert.equal(neg.params.SubtitleStreamIndex, undefined,
        'aucun paramètre de piste n\'est ajouté à l\'URL de Jellyfin');
    assert.equal(neg.result.effectiveSubtitleStreamIndex, -1);
});

/* ===== 5. Trace développeur T18 ===== */

test('T18 : la décision de réinjection est tracée, sans URL ni secret', () => {
    const lines = [];
    const { Router } = loadRouter(film(VIDEO_HEVC_4K), {
        stubs: { console: { log: (m) => lines.push(String(m)) } },
    });
    const Core = Router.JFCore;
    Router.setDeviceMode('revolution');
    const base = { serverUrl: SERVER, accessToken: 'TOK', itemId: 'IT1', userId: 'U1', startMs: 0 };

    // Drapeau du dépôt : muet.
    Router.negotiatePlayback(Object.assign({}, base), () => {}, () => {});
    assert.equal(lines.filter((l) => l.indexOf('T18') >= 0).length, 0);

    Core.DevLog.ENABLED = true;
    Router.negotiatePlayback(Object.assign({}, base, { forceRetry: true }), () => {}, () => {});
    Router.negotiatePlayback(Object.assign({}, base, {
        forceRetry: true, selectedSubtitleStream: -1, disableAutoVoFrenchFullSubtitle: true,
    }), () => {}, () => {});
    Core.DevLog.ENABLED = false;

    const traces = lines.filter((l) => l.indexOf('T18') >= 0);
    assert.equal(traces.length, 2);
    assert.match(traces[0], /^\[RDF\] T18 forced-sub carry=1 idx=3 method=Embed reason=serverStream safeIdx=3 text=1$/);
    assert.match(traces[1], /^\[RDF\] T18 forced-sub carry=0 idx=-1 method=none reason=explicitOff safeIdx=3 text=1$/);
    for (const trace of traces) {
        assert.equal(trace.indexOf('ApiKey'), -1, 'aucune URL ni jeton dans la trace');
        assert.equal(trace.indexOf('TOK'), -1);
    }
});
