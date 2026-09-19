'use strict';

/*
 * MATRICE DE DÉCISION de la négociation de lecture.
 *
 * Ce qui est protégé : pour un média représentatif, un appareil (Révolution ou
 * Delta/Devialet) et un mode de lecture (Automatique, « Original », débit de
 * transcodage choisi à la main), le Core doit toujours arrêter la MÊME
 * décision — méthode de lecture, conteneur, vidéo copiée ou réencodée (avec
 * ses plafonds), audio copié ou réencodé (codec/canaux), piste et méthode de
 * sous-titre, protocole progressif ou HLS, traitement de la reprise.
 *
 * Pourquoi c'est sensible : la pile de politiques (Router -> policy matérielle
 * -> Core -> CoreUrl) est la partie la plus réécrite par l'amont, et une seule
 * condition inversée suffit à envoyer un 4K HEVC brut à un CE4100, à perdre
 * les sous-titres forcés ou à relancer un transcodage depuis 00:00.
 *
 * Méthode : la négociation complète est rejouée en Node avec une réponse
 * /PlaybackInfo figée (tests/js/negotiationharness.js). On n'assère JAMAIS le
 * texte d'une URL ni l'ordre de ses paramètres : la query est décodée en
 * objet et comparée champ par champ (voir negotiationmatrixfixtures.js).
 *
 * Volontairement HORS de ce fichier : le downmix stéréo
 * (audiooutputnegotiation.test.js) et la réinjection du sous-titre forcé
 * français (forcedsubtitlecarry.test.js), déjà couverts ailleurs.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const {
    V, A, S, AUDIO_VO_THEN_FRENCH, audio, source,
    play, decision, assertDecision, MANUAL_QUALITY_BITRATE,
    SERVER, loadRouter, negotiate,
} = require('./negotiationmatrixfixtures');

const DEVICES = ['revolution', 'devialet'];

/* ===== Médias de la matrice ===== */

const MEDIA = {
    h264AacMp4: source('mp4', '/m/film.mp4', [V.h264, A.aac20]),
    h264Ac3Mkv: source('mkv', '/m/film.mkv', [V.h264, A.ac351]),
    hevcMain10: source('mkv', '/m/film.mkv', [V.hevcMain10, A.ac351]),
    hevc4k: source('mkv', '/m/film.mkv', [V.hevc4k, A.ac351]),
    hevc4kMain10: source('mkv', '/m/film.mkv', [V.hevc4kMain10, A.ac351]),
    av1: source('mkv', '/m/film.mkv', [V.av1, A.ac351]),
    trueHd51: source('mkv', '/m/film.mkv', [V.h264, A.trueHd51]),
    dts51: source('mkv', '/m/film.mkv', [V.h264, A.dts51]),
    dtsHd8: source('mkv', '/m/film.mkv', [V.h264, A.dtsHd8]),
    eac351: source('mkv', '/m/film.mkv', [V.h264, A.eac351]),
    aac8: source('mkv', '/m/film.mkv', [V.h264, A.aac8]),
    interlacedTs: source('ts', '/m/tv.ts', [V.h264Interlaced, A.ac351]),
    dvdFolder: source('mpeg', '/m/DVD/VIDEO_TS/VTS_01_1.VOB', [V.mpeg2, A.ac351], { VideoType: 1 }),
    vob: source('vob', '/m/film.vob', [V.mpeg2, A.ac351]),
    dvdSub: source('mkv', '/m/film.mkv', [V.h264, A.ac351, S.frDvdSub]),
    pgsForced: source('mkv', '/m/film.mkv', [V.h264, A.ac351, S.frForcedPgs]),
    srtForcedAndFull: source('mkv', '/m/film.mkv', [V.h264, A.ac351, S.frForcedText, S.frFullText]),
    assFull: source('mkv', '/m/film.mkv', [V.h264, A.ac351, S.frAss]),
    srtExternal: source('mkv', '/m/film.mkv', [V.h264, A.ac351, S.frExternalSrt]),
    voThenFrench: source('mkv', '/m/film.mkv', [V.h264].concat(AUDIO_VO_THEN_FRENCH, [S.frForcedText])),
    voOnlyFrenchFull: source('mkv', '/m/film.mkv',
        [V.h264, audio('ac3', 6, { Language: 'eng', IsDefault: true }), S.frFullText]),
};

/** Lecture directe du fichier d'origine, sans rien demander au serveur. */
const DIRECT_PLAY = {
    kind: 'http-dp', protocol: 'progressive', static: true,
    videoCopy: true, audioCopy: true,
    audioIndex: -1, subtitleIndex: -1,
};

/** Transcodage vidéo complet H.264 borné 1080p (enveloppe CE4100). */
const REVOLUTION_H264_CEILING = {
    kind: 'http-transcode', protocol: 'progressive', endpoint: 'stream.mkv',
    container: 'mkv', videoCopy: false, videoCodec: 'h264',
    maxWidth: 1920, maxHeight: 1080, h264Level: '41',
};

/* ===== 1. Lecture directe : H.264 8 bits + AAC/AC3, MKV et MP4 ===== */

for (const device of DEVICES) {
    test('lecture directe : H.264 8 bits + AAC en MP4 (' + device + ')', () => {
        for (const mode of ['auto', 'original']) {
            assertDecision(play(device, mode, MEDIA.h264AacMp4),
                Object.assign({ endpoint: 'stream.mp4' }, DIRECT_PLAY), mode);
        }
    });

    test('lecture directe : H.264 8 bits + AC3 5.1 en MKV (' + device + ')', () => {
        for (const mode of ['auto', 'original']) {
            assertDecision(play(device, mode, MEDIA.h264Ac3Mkv),
                Object.assign({ endpoint: 'stream.mkv' }, DIRECT_PLAY), mode);
        }
    });
}

test('lecture directe : le conteneur d\'origine est conservé dans l\'URL statique', () => {
    // C'est /Videos/<id>/stream.<ext>?static=true qui garantit l'octet à octet.
    assert.equal(decision(play('revolution', 'auto', MEDIA.h264AacMp4)).endpoint, 'stream.mp4');
    assert.equal(decision(play('revolution', 'auto', MEDIA.h264Ac3Mkv)).endpoint, 'stream.mkv');
    assert.equal(decision(play('revolution', 'auto', MEDIA.vob)).endpoint, 'stream.vob');
});

/* ===== 2. Incompatibilités vidéo matérielles ===== */

test('HEVC Main10 1080p : la Révolution transcode, la Devialet lit directement', () => {
    // Le CE4100 ne décode ni HEVC ni 10 bits : même le mode « Original » ne
    // peut pas neutraliser une incompatibilité vidéo RÉELLE.
    for (const mode of ['auto', 'original', 'quality']) {
        assertDecision(play('revolution', mode, MEDIA.hevcMain10), REVOLUTION_H264_CEILING, mode);
    }
    for (const mode of ['auto', 'original']) {
        assertDecision(play('devialet', mode, MEDIA.hevcMain10), DIRECT_PLAY, mode);
    }
});

test('HEVC 4K : la Révolution redescend à 1920x1080 8 bits H.264', () => {
    for (const media of [MEDIA.hevc4k, MEDIA.hevc4kMain10]) {
        for (const mode of ['auto', 'original', 'quality']) {
            const d = decision(play('revolution', mode, media));
            assertDecision(play('revolution', mode, media), REVOLUTION_H264_CEILING, mode);
            assert.equal(d.protocol, 'progressive',
                'le progressif est préféré au HLS pour garder StartTimeTicks');
            assert.ok(d.maxWidth <= 1920 && d.maxHeight <= 1080, 'enveloppe 1080p');
        }
    }
});

test('HEVC 4K : la Devialet lit directement, et reste en UHD si on force un débit', () => {
    assertDecision(play('devialet', 'auto', MEDIA.hevc4k), DIRECT_PLAY);
    assertDecision(play('devialet', 'quality', MEDIA.hevc4k), {
        kind: 'http-transcode', videoCopy: false, videoCodec: 'h264',
        maxWidth: 3840, maxHeight: 2160,
        // Un H.264 UHD exige un niveau supérieur à 4.1.
        h264Level: '51', videoBitrate: MANUAL_QUALITY_BITRATE,
    });
});

test('AV1 : transcodage H.264 par HLS/TS sur les deux appareils', () => {
    for (const device of DEVICES) {
        assertDecision(play(device, 'auto', MEDIA.av1), {
            kind: 'hls', protocol: 'hls', endpoint: 'master.m3u8',
            segmentContainer: 'ts', videoCopy: false, videoCodec: 'h264',
            maxWidth: 1920, maxHeight: 1080,
        }, device);
    }
});

test('AV1 : « Original » ne sauve pas la Révolution, mais rend la Devialet directe', () => {
    // La Révolution refuse AV1 par requiresHardVideoTranscode(), donc Original
    // ne peut pas l'annuler. La policy Devialet, elle, ne déclare AV1 que via
    // shouldForceTranscode(), neutralisé par le mode Original.
    assertDecision(play('revolution', 'original', MEDIA.av1), { kind: 'hls', videoCopy: false });
    assertDecision(play('devialet', 'original', MEDIA.av1), DIRECT_PLAY);
});

/* ===== 3. Audio ===== */

test('TrueHD 5.1 : la Devialet ne réencode QUE l\'audio, vidéo copiée', () => {
    for (const mode of ['auto', 'original']) {
        assertDecision(play('devialet', mode, MEDIA.trueHd51), {
            kind: 'http-transcode', protocol: 'progressive', container: 'mkv',
            videoCopy: true, videoCodec: 'h264',
            audioCopy: false, audioCodec: 'ac3', audioChannels: 6,
            maxAudioChannels: 6, audioBitrate: 640000,
            audioIndex: 1,
            // Aucune contrainte de mise à l'échelle : la vidéo n'est pas touchée.
            maxWidth: 0, maxHeight: 0,
        }, mode);
    }
});

/** Transcodage AUDIO SEUL : la vidéo est copiée telle quelle. */
const AUDIO_ONLY_AC3 = {
    kind: 'http-transcode', protocol: 'progressive', container: 'mkv',
    videoCopy: true, videoCodec: 'h264',
    audioCopy: false, audioCodec: 'ac3', audioChannels: 6,
    maxAudioChannels: 6, audioBitrate: 640000,
    // Aucune contrainte de mise à l'échelle : la vidéo n'est pas touchée.
    maxWidth: 0, maxHeight: 0,
};

test('TrueHD 5.1 : la Devialet ne réencode QUE l\'audio, vidéo copiée', () => {
    for (const mode of ['auto', 'original']) {
        assertDecision(play('devialet', mode, MEDIA.trueHd51),
            Object.assign({ audioIndex: 1 }, AUDIO_ONLY_AC3), mode);
    }
});

test('TrueHD / DTS / E-AC3 5.1 : la Révolution ne réencode QUE l\'audio', () => {
    // La vidéo H.264 8 bits 1080p est décodable par le CE4100 : seul le son
    // ne l'est pas, donc le serveur copie la vidéo et convertit l'audio en AC3.
    for (const media of [MEDIA.trueHd51, MEDIA.dts51, MEDIA.eac351]) {
        assertDecision(play('revolution', 'auto', media), AUDIO_ONLY_AC3);
        assert.equal(play('revolution', 'auto', media).params.TranscodeReasons,
            'AudioCodecNotSupported', 'le motif annoncé reste purement audio');
    }
});

test('audio non sûr + vidéo incompatible : la Révolution réencode aussi la vidéo', () => {
    // Le voisin à ne pas casser : dès qu'une raison VIDÉO existe (HEVC, 10
    // bits, 4K, AV1, débit manuel, plus de 6 canaux), le transcodage complet
    // borné 1080p reste dû.
    const hevcDts = source('mkv', '/m/film.mkv', [V.hevcMain10, A.dts51]);
    assertDecision(play('revolution', 'auto', hevcDts), Object.assign({
        audioCopy: false, audioCodec: 'ac3', audioChannels: 6,
    }, REVOLUTION_H264_CEILING));

    // DTS-HD 7.1 : plus de 6 canaux, la règle historique l'emporte.
    assertDecision(play('revolution', 'auto', MEDIA.dtsHd8), Object.assign({
        audioCopy: false, audioCodec: 'ac3', audioChannels: 6, maxAudioChannels: 6,
    }, REVOLUTION_H264_CEILING));

    // Un débit choisi à la main reste un transcodage vidéo explicite.
    assertDecision(play('revolution', 'quality', MEDIA.dts51), {
        kind: 'http-transcode', videoCopy: false, videoCodec: 'h264',
        videoBitrate: MANUAL_QUALITY_BITRATE, audioCodec: 'ac3',
    });
});

test('DTS / DTS-HD / E-AC3 : cible AC3 6 canaux sur Révolution, copie sur Devialet', () => {
    for (const media of [MEDIA.dts51, MEDIA.dtsHd8, MEDIA.eac351]) {
        assertDecision(play('revolution', 'auto', media), {
            kind: 'http-transcode', audioCopy: false, audioCodec: 'ac3',
            // Le Core plafonne à 6 canaux même pour une source 7.1.
            audioChannels: 6, maxAudioChannels: 6, audioBitrate: 640000,
        });
        // La Devialet accepte DTS et E-AC3 en lecture directe.
        assertDecision(play('devialet', 'auto', media), DIRECT_PLAY);
    }
});

test('audio non sûr : la piste choisie à la main décide, pas la première du fichier', () => {
    // Index 1 = AC3 5.1 copiable, index 2 = DTS 5.1 non décodable.
    const mixed = source('mkv', '/m/film.mkv', [
        V.h264,
        audio('ac3', 6, { Index: 1, Language: 'fra', IsDefault: true }),
        audio('dts', 6, { Index: 2, Language: 'eng' }),
    ]);
    assertDecision(play('revolution', 'auto', mixed, { selectedAudioStream: 2 }),
        Object.assign({ audioIndex: 2 }, AUDIO_ONLY_AC3), 'DTS choisi');
    assertDecision(play('revolution', 'auto', mixed, { selectedAudioStream: 1 }), {
        kind: 'http-remux', videoCopy: true, audioCopy: true, audioIndex: 1,
    }, 'AC3 choisi');
});

test('DTS / E-AC3 : « Original » rend la main à l\'utilisateur, même sur Révolution', () => {
    // Un codec audio « risqué » n'est PAS une incompatibilité vidéo : le mode
    // Original neutralise la règle de précaution et tente le fichier brut.
    for (const media of [MEDIA.dts51, MEDIA.dtsHd8, MEDIA.eac351]) {
        assertDecision(play('revolution', 'original', media), DIRECT_PLAY);
    }
});

test('plus de 6 canaux : AAC 7.1 transcodé sur Révolution, copié sur Devialet', () => {
    const rev = decision(play('revolution', 'auto', MEDIA.aac8));
    assert.equal(rev.kind, 'http-transcode');
    assert.equal(rev.audioCopy, false, 'la copie est refusée au-delà de 6 canaux');
    assert.equal(rev.audioCodec, 'aac', 'AAC déjà compatible : la cible reste AAC');

    assertDecision(play('devialet', 'auto', MEDIA.aac8), DIRECT_PLAY);
});

test('un débit manuel transcode toujours la vidéo, quel que soit le média', () => {
    for (const device of DEVICES) {
        for (const key of ['h264AacMp4', 'h264Ac3Mkv', 'dts51', 'srtExternal']) {
            const d = decision(play(device, 'quality', MEDIA[key]));
            assert.equal(d.kind, 'http-transcode', device + '/' + key);
            assert.equal(d.videoCopy, false, device + '/' + key + ' : vidéo réencodée');
            assert.equal(d.videoCodec, 'h264', device + '/' + key);
            assert.equal(d.videoBitrate, MANUAL_QUALITY_BITRATE, device + '/' + key);
            assert.equal(d.static, false, device + '/' + key + ' : jamais statique');
        }
    }
});

/* ===== 4. TS entrelacé, DVD, VOB ===== */

test('TS H.264 entrelacé : transcodage désentrelacé MKV/H.264/AC3 sur les deux appareils', () => {
    for (const device of DEVICES) {
        const neg = play(device, 'auto', MEDIA.interlacedTs);
        assertDecision(neg, {
            kind: 'http-transcode', protocol: 'progressive', endpoint: 'stream.mkv',
            container: 'mkv', videoCopy: false, videoCodec: 'h264',
            maxWidth: 1920, maxHeight: 1080, maxVideoBitDepth: 8, h264Level: '41',
            audioCopy: false, audioCodec: 'ac3', audioChannels: 6, audioBitrate: 640000,
        }, device);
        assert.equal(neg.params.DeInterlace, 'true', device + ' : désentrelacement demandé');
        assert.equal(neg.params.RequireNonAnamorphic, 'true', device);
        assert.equal(neg.params.MaxFramerate, '25', device + ' : cadence source conservée');
    }
});

test('TS H.264 entrelacé : « Original » lit le fichier brut', () => {
    for (const device of DEVICES) {
        assertDecision(play(device, 'original', MEDIA.interlacedTs),
            Object.assign({ endpoint: 'stream.ts' }, DIRECT_PLAY), device);
    }
});

test('dossier DVD : remux MPEG-2 copié, vidéo et audio intacts', () => {
    for (const device of DEVICES) {
        assertDecision(play(device, 'auto', MEDIA.dvdFolder), {
            kind: 'http-remux', protocol: 'progressive', endpoint: 'stream',
            static: false, videoCopy: true, videoCodec: 'mpeg2video',
            audioCopy: true, audioCodec: 'ac3', audioIndex: 1,
        }, device);
    }
    // Original : pas de remux de confort, le VOB part tel quel.
    assertDecision(play('revolution', 'original', MEDIA.dvdFolder),
        Object.assign({ endpoint: 'stream.mpeg' }, DIRECT_PLAY));
});

test('VOB isolé : ce n\'est pas un dossier DVD, la lecture reste directe', () => {
    for (const device of DEVICES) {
        assertDecision(play(device, 'auto', MEDIA.vob),
            Object.assign({ endpoint: 'stream.vob' }, DIRECT_PLAY), device);
    }
});

test('un débit manuel sur un DVD ne suréchantillonne pas la source 720x576', () => {
    for (const media of [MEDIA.dvdFolder, MEDIA.vob]) {
        assertDecision(play('revolution', 'quality', media), {
            kind: 'http-transcode', videoCodec: 'h264', maxWidth: 720, maxHeight: 576,
        });
    }
});

/* ===== 5. Sous-titres ===== */

test('DVDSub interne dormant : transcodage progressif et incrustation du forcé français', () => {
    for (const device of DEVICES) {
        assertDecision(play(device, 'auto', MEDIA.dvdSub), {
            kind: 'http-transcode', protocol: 'progressive', endpoint: 'stream.mkv',
            container: 'mkv', videoCopy: false, videoCodec: 'h264', maxVideoBitDepth: 8,
            subtitleIndex: 3, subtitleMethod: 'Encode',
            effectiveSubtitleIndex: 3, effectiveSubtitleMode: 'encode',
            effectiveSubtitleReason: 'safeFrenchForcedDvdSubAuto',
        }, device);
    }
});

test('DVDSub interne : « Original » lit le fichier brut et laisse la piste au Player', () => {
    assertDecision(play('revolution', 'original', MEDIA.dvdSub), Object.assign({
        effectiveSubtitleIndex: 3, effectiveSubtitleMode: 'directplay',
        effectiveSubtitleReason: 'safeFrenchForcedDefault',
    }, DIRECT_PLAY));
});

test('PGS forcé français seul : lecture directe, la piste est affichée par le Player', () => {
    for (const device of DEVICES) {
        for (const mode of ['auto', 'original']) {
            assertDecision(play(device, mode, MEDIA.pgsForced), Object.assign({
                effectiveSubtitleIndex: 3, effectiveSubtitleMode: 'directplay',
                effectiveSubtitleReason: 'safeFrenchForcedDefault',
            }, DIRECT_PLAY), device + '/' + mode);
        }
    }
});

test('PGS choisi explicitement : remux MKV avec Embed, vidéo et audio copiés', () => {
    const chosen = { selectedSubtitleStream: 3, selectedSubtitleIsImage: true };
    for (const device of DEVICES) {
        assertDecision(play(device, 'auto', MEDIA.pgsForced, chosen), {
            kind: 'http-remux', protocol: 'progressive', container: 'mkv',
            videoCopy: true, audioCopy: true,
            subtitleIndex: 3, subtitleMethod: 'Embed',
            effectiveSubtitleIndex: 3, effectiveSubtitleMode: 'embed',
            effectiveSubtitleReason: 'manual',
        }, device);
    }
});

test('PGS choisi + débit manuel : incrustation HLS, le bitmap ne peut plus être remuxé', () => {
    const neg = play('revolution', 'quality', MEDIA.pgsForced,
        { selectedSubtitleStream: 3, selectedSubtitleIsImage: true });
    assertDecision(neg, {
        kind: 'hls', protocol: 'hls', segmentContainer: 'ts',
        videoCopy: false, subtitleIndex: 3, subtitleMethod: 'Encode',
        effectiveSubtitleMode: 'encode',
    });
});

test('sous-titre texte choisi : remux MKV, Embed serveur, vidéo copiée', () => {
    const chosen = { selectedSubtitleStream: 3, selectedSubtitleIsText: true };
    for (const media of [MEDIA.srtForcedAndFull, MEDIA.assFull]) {
        for (const device of DEVICES) {
            assertDecision(play(device, 'auto', media, chosen), {
                kind: 'http-remux', container: 'mkv', videoCopy: true, audioCopy: true,
                subtitleIndex: 3, subtitleMethod: 'Embed',
                effectiveSubtitleMode: 'embed', effectiveSubtitleReason: 'manual',
            }, device);
        }
    }
});

test('sous-titre texte choisi en sidecar explicite : rien n\'est demandé au serveur', () => {
    const neg = play('revolution', 'auto', MEDIA.srtForcedAndFull, {
        selectedSubtitleStream: 3, selectedSubtitleIsText: true,
        preferExternalTextSubtitlesInRemux: true,
    });
    assertDecision(neg, {
        kind: 'http-remux', subtitleIndex: -1, subtitleMethod: null,
        effectiveSubtitleIndex: 3, effectiveSubtitleMode: 'external',
    });
    assert.ok(neg.result.externalSubtitle, 'une sidecar SRT/VTT est fournie');
    assert.match(neg.result.externalSubtitle.urlSrt, /\/Subtitles\/3\/Stream\.srt/);
    assert.equal(neg.result.forceServerExternalSubtitle, true);
});

test('sous-titre externe non choisi : il reste dormant, la lecture est directe', () => {
    for (const device of DEVICES) {
        assertDecision(play(device, 'auto', MEDIA.srtExternal), Object.assign({
            effectiveSubtitleIndex: -1, effectiveSubtitleMode: 'none',
        }, DIRECT_PLAY), device);
    }
});

/* ===== 6. Sélection automatique française ===== */

test('audio VO par défaut + VFF : le serveur épingle la piste française', () => {
    for (const device of DEVICES) {
        const neg = play(device, 'auto', MEDIA.voThenFrench);
        assertDecision(neg, {
            kind: 'http-remux', container: 'mkv', videoCopy: true, audioCopy: true,
            audioIndex: 2,
        }, device);
        assert.equal(neg.result.autoFrenchAudio, true, device);
        assert.equal(neg.result.autoFrenchAudioStreamIndex, 2, device);
        assert.equal(neg.result.effectiveAudioStreamIndex, 2, device);
    }
});

test('audio VO + VFF : « Original » ne choisit plus rien à la place de l\'utilisateur', () => {
    for (const device of DEVICES) {
        const neg = play(device, 'original', MEDIA.voThenFrench);
        assertDecision(neg, DIRECT_PLAY, device);
        assert.equal(neg.result.autoFrenchAudio, false, device);
    }
});

test('audio VO unique + sous-titres FR complets : remux avec la piste complète', () => {
    for (const device of DEVICES) {
        const neg = play(device, 'auto', MEDIA.voOnlyFrenchFull);
        assertDecision(neg, {
            kind: 'http-remux', videoCopy: true, audioCopy: true,
            subtitleIndex: 4, subtitleMethod: 'Embed',
            effectiveSubtitleIndex: 4, effectiveSubtitleMode: 'embed',
            effectiveSubtitleReason: 'voFrenchFullAutoRemux',
        }, device);
        assert.equal(neg.result.autoVoFrenchFullSubtitle, true, device);
    }
});

test('une piste audio choisie à la main gagne sur la sélection automatique', () => {
    const neg = play('revolution', 'auto', MEDIA.voThenFrench, { selectedAudioStream: 1 });
    assertDecision(neg, { kind: 'http-remux', audioIndex: 1 });
    assert.equal(neg.result.effectiveAudioStreamIndex, 1);
});

/* ===== 7. Reprise et StartTimeTicks ===== */

const RESUME_MS = 600000;
const RESUME_TICKS = RESUME_MS * 10000;

test('reprise en lecture directe : seek LOCAL, aucun StartTimeTicks', () => {
    assertDecision(play('revolution', 'auto', MEDIA.h264Ac3Mkv, { startMs: RESUME_MS, preferTicks: true }), {
        kind: 'http-dp', startTimeTicks: 0, serverTimed: false,
        streamBaseMs: 0, initialLocalSeekMs: RESUME_MS,
    });
});

test('reprise serveur explicite : StartTimeTicks dans l\'URL, aucun seek local', () => {
    const cases = {
        'remux H.264': ['auto', MEDIA.h264Ac3Mkv, 'http-remux'],
        'transcodage progressif HEVC 4K': ['auto', MEDIA.hevc4k, 'http-transcode'],
        'HLS AV1': ['auto', MEDIA.av1, 'hls'],
        'débit manuel': ['quality', MEDIA.h264Ac3Mkv, 'http-transcode'],
    };
    for (const label of Object.keys(cases)) {
        const [mode, media, kind] = cases[label];
        assertDecision(play('revolution', mode, media, { startMs: RESUME_MS, forceServerSeek: true }), {
            kind: kind, startTimeTicks: RESUME_TICKS, serverTimed: true,
            streamBaseMs: RESUME_MS, initialLocalSeekMs: 0,
        }, label);
    }
});

test('reprise sur un HLS non demandé au serveur : cold start + seek local', () => {
    // Jellyfin n'inclut pas StartTimeTicks dans ses URL HLS : sans
    // forceServerSeek, la position est rattrapée localement par QtMultimedia.
    assertDecision(play('revolution', 'auto', MEDIA.av1, { startMs: RESUME_MS, preferTicks: true }), {
        kind: 'hls', startTimeTicks: 0, serverTimed: false, initialLocalSeekMs: RESUME_MS,
    });
});

test('la reprise est transmise à /PlaybackInfo avant la construction de l\'URL', () => {
    const neg = play('revolution', 'auto', MEDIA.hevc4k, { startMs: RESUME_MS, forceServerSeek: true });
    assert.equal(neg.body.StartTimeTicks, RESUME_TICKS);
    assert.equal(neg.body.EnableDirectPlay, false, 'un seek serveur exclut le DirectPlay');
    assert.equal(neg.body.EnableDirectStream, false);
});

/* ===== 8. Cache de négociation ===== */

test('deux négociations identiques rapprochées ne font qu\'un seul POST PlaybackInfo', () => {
    const { Router, bodies } = loadRouter(MEDIA.h264Ac3Mkv);
    Router.setDeviceMode('revolution');
    const base = { serverUrl: SERVER, accessToken: 'TOK', itemId: 'IT1', userId: 'U1', startMs: 0 };

    let first = null; let second = null;
    Router.negotiatePlayback(Object.assign({}, base), (r) => { first = r; }, () => {});
    Router.negotiatePlayback(Object.assign({}, base), (r) => { second = r; }, () => {});
    assert.equal(bodies.length, 1, 'la seconde négociation est servie par le cache');
    assert.ok(second, 'le rappel est tout de même honoré');
    assert.equal(second.url, first.url);

    // forceRetry court-circuite le cache (changement de piste, seek réseau...).
    let third = null;
    Router.negotiatePlayback(Object.assign({}, base, { forceRetry: true }), (r) => { third = r; }, () => {});
    assert.equal(bodies.length, 2);
    assert.ok(third);
});

test('changer de média ou de piste invalide le cache', () => {
    const { Router, bodies } = loadRouter(MEDIA.voThenFrench);
    Router.setDeviceMode('revolution');
    const base = { serverUrl: SERVER, accessToken: 'TOK', itemId: 'IT1', userId: 'U1', startMs: 0 };

    Router.negotiatePlayback(Object.assign({}, base), () => {}, () => {});
    Router.negotiatePlayback(Object.assign({}, base, { selectedAudioStream: 1 }), () => {}, () => {});
    Router.negotiatePlayback(Object.assign({}, base, { startMs: 60000 }), () => {}, () => {});
    assert.equal(bodies.length, 3, 'piste et position font partie de la clé de cache');
});

/* ===== 9. Échec de /PlaybackInfo ===== */

test('échec de /PlaybackInfo : repli DirectPlay sur Révolution, erreur ferme sur Devialet', () => {
    const results = {};
    for (const device of ['revolution', 'devialet', 'core']) {
        const { Router } = loadRouter(null);
        Router.JFCore.CoreUrl.JellyfinBridge.sendRequestNoCache =
            (method, url, headers, payload, onSuccess, onError) => {
                onError({ code: 'timeout', status: 0 });
                return null;
            };
        Router.setDeviceMode(device);
        let res = null; let err = null;
        Router.negotiatePlayback({ serverUrl: SERVER, accessToken: 'TOK', itemId: 'IT1', userId: 'U1', startMs: 0 },
            (r) => { res = r; }, (e) => { err = e; });
        results[device] = { url: res && res.url, err: err };
    }

    // Révolution et Core neutre retombent sur le fichier brut.
    for (const device of ['revolution', 'core']) {
        assert.equal(results[device].err, null, device);
        assert.match(results[device].url, /\/Videos\/IT1\/stream\?/, device);
        assert.match(results[device].url, /static=true/, device);
    }
    // La policy Devialet force forceAllowTranscoding : le Core considère alors
    // qu'un pipeline serveur est obligatoire et refuse le repli statique.
    assert.ok(!results.devialet.url, 'aucune URL de repli n\'est construite');
    assert.equal(results.devialet.err, 'server_pipeline_required');
});

/* ===== 10. Garde-fous du pipeline serveur ===== */

test('un média sans piste audio ne doit pas recevoir static=true sur un transcodage', () => {
    // Sans piste audio, aucune sélection de piste n'est demandée au serveur :
    // seul l'état « pipeline serveur » distingue encore un transcodage d'une
    // lecture directe. static=true dirait au serveur de renvoyer le fichier
    // brut, ici un 4K HEVC, à un CE4100.
    const silent4k = source('mkv', '/m/clip.mkv', [V.hevc4k]);
    const d = decision(play('revolution', 'auto', silent4k));
    assert.equal(d.kind, 'http-transcode');
    assert.equal(d.videoCodec, 'h264');
    assert.equal(d.static, false);

    // Même piège sur le second chemin sans sélection de piste : le TS
    // entrelacé, désentrelacé et réencodé par le serveur.
    const silentTs = source('ts', '/m/tv.ts', [V.h264Interlaced]);
    const dts = decision(play('revolution', 'auto', silentTs));
    assert.equal(dts.kind, 'http-transcode');
    assert.equal(dts.static, false, 'TS entrelacé sans audio');
});

test('un média muet compatible reste en lecture directe statique', () => {
    // Contre-épreuve du cas précédent : sans pipeline serveur, static=true
    // reste indispensable (c'est lui qui évite le remux serveur inutile).
    for (const device of DEVICES) {
        assertDecision(play(device, 'auto', source('mp4', '/m/clip.mp4', [V.h264])),
            DIRECT_PLAY, device + ' muet');
    }
});

test('DVDSub : le plafond de canaux annoncé respecte le profil de l\'appareil', () => {
    // L'audio est copié : aucun plan ne fixe de nombre de canaux, c'est le
    // MaxAudioChannels du profil envoyé à Jellyfin qui fait foi.
    assert.equal(decision(play('revolution', 'auto', MEDIA.dvdSub)).maxAudioChannels, 6);
    assert.equal(decision(play('devialet', 'auto', MEDIA.dvdSub)).maxAudioChannels, 8);
    assert.equal(decision(play('core', 'auto', MEDIA.dvdSub)).maxAudioChannels, 8,
        'sans policy matérielle, le Core neutre garde sa valeur historique');
});

test('DVDSub : le plafond stéréo prime sur celui de l\'appareil', () => {
    // Réglage « Sortie audio » = Stéréo : 2 canaux, que la piste soit
    // mixée par le serveur (5.1) ou déjà stéréo (donc copiée).
    for (const device of DEVICES) {
        assert.equal(decision(negotiate(device, MEDIA.dvdSub, {}, 'stereo')).maxAudioChannels, 2,
            device + ' 5.1');
        const stereoSrc = source('mkv', '/m/film.mkv', [V.h264, A.aac20, S.frDvdSub]);
        assert.equal(decision(negotiate(device, stereoSrc, {}, 'stereo')).maxAudioChannels, 2,
            device + ' 2.0');
    }
});
