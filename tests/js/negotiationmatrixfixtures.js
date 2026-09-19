'use strict';

/*
 * Fixtures et outillage partagés par negotiationmatrix / playbackurl /
 * devicepolicy.
 *
 * Objectif : écrire un cas de la matrice de décision en quelques lignes, avec
 * des charges utiles /PlaybackInfo réalistes mais réduites au strict
 * nécessaire, et comparer la DÉCISION (méthode de lecture, conteneur, copie ou
 * transcodage vidéo/audio, piste et méthode de sous-titre, protocole, reprise)
 * plutôt que le texte d'une URL.
 *
 * La négociation elle-même est rejouée par tests/js/negotiationharness.js
 * (routeur neuf, transport HTTP remplacé par une réponse figée).
 */

const assert = require('node:assert/strict');
const { SERVER, params, negotiate, loadRouter } = require('./negotiationharness');

/* ===== Constructeurs de flux ===== */

/** Piste vidéo Jellyfin. `extra` surcharge n'importe quel champ. */
function video(codec, extra) {
    return Object.assign({
        Type: 'Video', Index: 0, Codec: codec,
        Width: 1920, Height: 1080, BitDepth: 8,
        Profile: 'High', Level: 41,
        AverageFrameRate: 23.976, RealFrameRate: 23.976,
    }, extra || {});
}

/** Piste audio Jellyfin. Par défaut : française, marquée Default, index 1. */
function audio(codec, channels, extra) {
    return Object.assign({
        Type: 'Audio', Index: 1, Codec: codec, Channels: channels,
        Language: 'fra', IsDefault: true,
    }, extra || {});
}

/** Piste de sous-titres Jellyfin. Par défaut : française, interne, index 3. */
function subtitle(codec, extra) {
    const st = Object.assign({
        Type: 'Subtitle', Index: 3, Codec: codec, Language: 'fra',
    }, extra || {});
    // Jellyfin renseigne IsTextSubtitleStream ; on le déduit pour éviter
    // d'avoir à le répéter dans chaque cas.
    if (st.IsTextSubtitleStream === undefined) {
        st.IsTextSubtitleStream = ['srt', 'subrip', 'ass', 'ssa', 'vtt', 'webvtt', 'mov_text']
            .indexOf(String(st.Codec).toLowerCase()) >= 0;
    }
    return st;
}

/**
 * MediaSource telle que /PlaybackInfo la renvoie.
 * @param {string} container  Container Jellyfin ("mkv", "mp4", "ts"…)
 * @param {string} path       Chemin serveur (fictif) ; sert aux heuristiques
 *                            d'extension et de dossier DVD.
 * @param {object[]} streams  Pistes, dans l'ordre physique du fichier.
 * @param {object} [extra]    Champs supplémentaires (TranscodingUrl, VideoType…)
 */
function source(container, path, streams, extra) {
    return Object.assign({
        Id: 'MS1', Container: container, Path: path,
        Name: path.split('/').pop(), MediaStreams: streams,
        RunTimeTicks: 72000000000,
    }, extra || {});
}

/* ===== Médias de référence ===== */

const V = {
    h264: video('h264'),
    h264Interlaced: video('h264', { IsInterlaced: true, AverageFrameRate: 25, RealFrameRate: 25 }),
    hevcMain10: video('hevc', { BitDepth: 10, Profile: 'Main 10', PixelFormat: 'yuv420p10le' }),
    hevc4k: video('hevc', { Width: 3840, Height: 2160 }),
    hevc4kMain10: video('hevc', { Width: 3840, Height: 2160, BitDepth: 10, Profile: 'Main 10' }),
    av1: video('av1'),
    mpeg2: video('mpeg2video', { Width: 720, Height: 576, Profile: 'Main', Level: 8 }),
};

const A = {
    aac20: audio('aac', 2),
    ac351: audio('ac3', 6),
    eac351: audio('eac3', 6),
    dts51: audio('dts', 6),
    dtsHd8: audio('dts', 8, { Profile: 'DTS-HD MA' }),
    trueHd51: audio('truehd', 6),
    aac8: audio('aac', 8),
};

/** Pistes audio VO (par défaut) + VFF, pour la sélection française automatique. */
const AUDIO_VO_THEN_FRENCH = [
    audio('ac3', 6, { Index: 1, Language: 'eng', IsDefault: true }),
    audio('ac3', 6, { Index: 2, Language: 'fra', Title: 'VFF' }),
];

const S = {
    frForcedText: subtitle('subrip', { IsForced: true, Title: 'Forced' }),
    frFullText: subtitle('subrip', { Index: 4, Title: 'Complet' }),
    frForcedPgs: subtitle('pgssub', { IsForced: true, Title: 'Forced' }),
    frDvdSub: subtitle('dvd_subtitle', { Title: 'Forced', IsForced: true }),
    frAss: subtitle('ass', { Title: 'Complet' }),
    frExternalSrt: subtitle('subrip', { IsExternal: true, Title: 'Complet' }),
};

/* ===== Modes de lecture ===== */

// Débit choisi dans le panneau Qualité. Le contexte reproduit celui que
// playerOverlayHelper.js construit réellement (applyManualQuality).
const MANUAL_QUALITY_BITRATE = 4000000;

function manualQualityCtx(rate) {
    rate = rate || MANUAL_QUALITY_BITRATE;
    return {
        manualQualityRequest: true, forceRetry: true,
        forceAllowTranscoding: true, forceVideoTranscodeCodec: 'h264',
        forcePlaybackInfoVideoCodec: 'h264',
        forceDirectPlayInPlaybackInfo: false, forceDirectStreamInPlaybackInfo: false,
        forceVideoStreamCopyInPlaybackInfo: false,
        forcePolicyTranscodeVideoBitrate: rate,
        forcePolicyTranscodeAllowAudioCopy: true,
    };
}

/**
 * Joue une négociation pour un couple (appareil, mode de lecture).
 *
 * @param {'revolution'|'devialet'|'core'} device
 * @param {'auto'|'original'|'quality'} mode
 * @param {object} src MediaSource figée.
 * @param {object} [extra] Champs ajoutés au contexte (piste choisie, reprise…).
 */
function play(device, mode, src, extra) {
    const ctx = Object.assign({}, mode === 'quality' ? manualQualityCtx() : {}, extra || {});
    const options = mode === 'original' ? { playbackRuleMode: 'directplay' } : {};
    return negotiate(device, src, ctx, undefined, options);
}

/* ===== Lecture de la décision ===== */

function _int(value, fallback) {
    if (value === undefined || value === null || value === '') return fallback;
    const n = Number(value);
    return isFinite(n) ? n : fallback;
}

/**
 * Décision observable, telle que le serveur et QtMultimedia la voient.
 * Toutes les valeurs viennent de l'URL finale (query décodée) ou du résultat
 * rendu à PlayerOverlay — jamais de l'ordre des paramètres.
 */
function decision(neg) {
    const p = neg.params;
    const base = neg.url.split('?')[0];
    return {
        // Méthode de lecture retenue par le Core.
        kind: neg.finalUrlKind,                       // http-dp|http-remux|http-transcode|hls
        endpoint: base.substring(base.lastIndexOf('/') + 1),
        protocol: neg.result.isHls ? 'hls' : 'progressive',
        static: p.static === 'true',
        container: p.Container || null,
        segmentContainer: p.SegmentContainer || null,
        // Vidéo.
        videoCopy: p.AllowVideoStreamCopy !== 'false',
        videoCodec: p.VideoCodec || null,
        maxWidth: _int(p.MaxWidth, 0),
        maxHeight: _int(p.MaxHeight, 0),
        maxVideoBitDepth: _int(p.MaxVideoBitDepth, 0),
        videoBitrate: _int(p.VideoBitrate, 0),
        h264Level: p.Level || null,
        // Audio.
        audioCopy: p.AllowAudioStreamCopy !== 'false',
        audioCodec: p.AudioCodec || null,
        audioChannels: _int(p.AudioChannels, 0),
        maxAudioChannels: _int(p.TranscodingMaxAudioChannels, 0),
        audioBitrate: _int(p.AudioBitRate, 0),
        audioIndex: _int(p.AudioStreamIndex, -1),
        // Sous-titres.
        subtitleIndex: _int(p.SubtitleStreamIndex, -1),
        subtitleMethod: p.SubtitleMethod || null,
        effectiveSubtitleIndex: neg.result.effectiveSubtitleStreamIndex,
        effectiveSubtitleMode: neg.result.effectiveSubtitleMode,
        effectiveSubtitleReason: neg.result.effectiveSubtitleReason,
        // Reprise.
        startTimeTicks: _int(p.StartTimeTicks, 0),
        serverTimed: neg.result.serverTimedStream === true,
        streamBaseMs: neg.result.streamBaseMs,
        initialLocalSeekMs: neg.result.initialLocalSeekMs,
    };
}

/**
 * Compare uniquement les champs déclarés dans `expected` : un cas reste lisible
 * et un champ non pertinent ne rend pas le test cassant.
 */
function assertDecision(neg, expected, label) {
    const actual = decision(neg);
    const prefix = label ? label + ' : ' : '';
    for (const key of Object.keys(expected)) {
        assert.ok(key in actual, prefix + 'champ inconnu dans la décision : ' + key);
        assert.equal(actual[key], expected[key], prefix + key);
    }
}

module.exports = {
    SERVER, params, negotiate, loadRouter,
    video, audio, subtitle, source,
    V, A, S, AUDIO_VO_THEN_FRENCH,
    MANUAL_QUALITY_BITRATE, manualQualityCtx, play,
    decision, assertDecision,
};
