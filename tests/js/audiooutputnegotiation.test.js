'use strict';

/*
 * Application du réglage « Sortie audio » à la négociation de lecture.
 *
 * La négociation complète est jouée ici de bout en bout : le transport HTTP de
 * jellyfinBridge.js est remplacé par une réponse PlaybackInfo figée, ce qui
 * permet d'observer à la fois le CORPS envoyé à /PlaybackInfo (profil
 * d'appareil compris) et l'URL finale réellement donnée à QtMultimedia, pour
 * les deux policies matérielles et le Core neutre.
 *
 * Deux contrats sont vérifiés :
 *
 *  1. NON-RÉGRESSION. En mode multicanal (défaut, réglage absent ou valeur
 *     inconnue), chaque scénario doit produire EXACTEMENT l'URL produite avant
 *     l'ajout du réglage. Les chaînes attendues ci-dessous ont été relevées sur
 *     l'arbre précédant ce commit.
 *
 *  2. MODE STÉRÉO. Le downmix n'est engagé que pour une piste de plus de
 *     2 canaux ; il interdit alors la copie audio, demande AAC 2.0 à
 *     192 kb/s et un plafond de 2 canaux, tout en laissant la vidéo copiée
 *     quand la branche choisie n'avait pas déjà besoin de la transcoder.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadQmlJs } = require('./qmljs');
const { SERVER, negotiate } = require('./negotiationharness');

/* ===== Sources de test ===== */

const VIDEO_H264 = { Type: 'Video', Index: 0, Codec: 'h264', Width: 1920, Height: 1080, BitDepth: 8, AverageFrameRate: 24 };
const VIDEO_AV1 = { Type: 'Video', Index: 0, Codec: 'av1', Width: 1920, Height: 1080, BitDepth: 8, AverageFrameRate: 24 };
const VIDEO_H264_INTERLACED = { Type: 'Video', Index: 0, Codec: 'h264', Width: 1920, Height: 1080, BitDepth: 8, AverageFrameRate: 25, IsInterlaced: true };

const AUDIO_AC3_51 = { Type: 'Audio', Index: 1, Codec: 'ac3', Channels: 6, Language: 'fra', IsDefault: true };
const AUDIO_AAC_20 = { Type: 'Audio', Index: 1, Codec: 'aac', Channels: 2, Language: 'fra', IsDefault: true };
const AUDIO_AAC_MONO = { Type: 'Audio', Index: 1, Codec: 'aac', Channels: 1, Language: 'fra', IsDefault: true };
const AUDIO_DTS_51 = { Type: 'Audio', Index: 1, Codec: 'dts', Channels: 6, Language: 'fra', IsDefault: true };
const AUDIO_AAC_20_ENG = { Type: 'Audio', Index: 2, Codec: 'aac', Channels: 2, Language: 'eng' };
const AUDIO_UNKNOWN_CHANNELS = { Type: 'Audio', Index: 1, Codec: 'aac', Language: 'fra', IsDefault: true };

function source(video, streams, extra) {
    return Object.assign({
        Id: 'MS1',
        Container: video === VIDEO_H264_INTERLACED ? 'ts' : 'mkv',
        Path: video === VIDEO_H264_INTERLACED ? '/m/tv.ts' : '/m/film.mkv',
        MediaStreams: [video].concat(streams),
    }, extra || {});
}

/* ===== Harnais de négociation ===== */
// negotiate() vient de tests/js/negotiationharness.js : un routeur neuf par
// négociation, transport HTTP remplacé par une réponse /PlaybackInfo figée.

// Le plafond stéréo doit être annoncé au serveur pour TOUTES les pistes, y
// compris celles qui ne seront pas mixées.
function assertStereoCeilingAnnounced(neg) {
    assert.equal(neg.body.MaxAudioChannels, 2);
    assert.equal(neg.body.DeviceProfile.MaxAudioChannels, 2);
    const conditions = [];
    for (const cp of neg.body.DeviceProfile.CodecProfiles || []) {
        for (const cond of cp.Conditions || []) {
            if (cond.Property === 'AudioChannels') conditions.push(cond.Condition + ':' + cond.Value);
        }
    }
    assert.deepEqual(conditions.slice(), ['LessThanEqual:2'],
        'exactement une contrainte AudioChannels <= 2 doit être annoncée');
}

// Contrat du downmix dans l'URL finale.
function assertStereoDownmixUrl(neg) {
    assert.equal(neg.stereoDownmix, true);
    assert.equal(neg.params.AudioCodec, 'aac');
    assert.equal(neg.params.TranscodingMaxAudioChannels, '2');
    assert.equal(neg.params.AllowAudioStreamCopy, 'false');
    assert.equal(neg.params.EnableAutoStreamCopy, 'false');
    assert.notEqual(neg.params.static, 'true', 'la lecture directe statique est exclue');
}

/* ===== 1. Non-régression : mode multicanal ===== */

// URL relevées AVANT l'ajout du réglage. Toute différence ici est une
// régression du comportement par défaut.
// Seule exception assumée : rev-mkv-51-dvdsub annonçait
// TranscodingMaxAudioChannels=8, une valeur écrite en dur qui dépassait le
// MaxAudioChannels=6 du profil Révolution (corrigé depuis).
const REFERENCE_MULTICHANNEL = {
    'rev-mkv-51': SERVER + '/Videos/IT1/stream.mkv?AllowAudioStreamCopy=true&AllowVideoStreamCopy=true&ApiKey=TOK&EnableAutoStreamCopy=true&MediaSourceId=MS1&SubtitleStreamIndex=-1&static=true',
    'rev-mkv-20': SERVER + '/Videos/IT1/stream.mkv?AllowAudioStreamCopy=true&AllowVideoStreamCopy=true&ApiKey=TOK&EnableAutoStreamCopy=true&MediaSourceId=MS1&SubtitleStreamIndex=-1&static=true',
    // Transcodage AUDIO SEUL depuis « Évite de réencoder la vidéo d'une source
    // dont seul l'audio est illisible » : la vidéo H.264 est copiée.
    'rev-mkv-dts51': SERVER + '/Videos/IT1/stream.mkv?AllowAudioStreamCopy=false&AllowVideoStreamCopy=true&ApiKey=TOK&AudioBitRate=640000&AudioChannels=6&AudioCodec=ac3&AudioStreamIndex=1&Container=mkv&Context=Streaming&CopyTimestamps=false&EnableAutoStreamCopy=false&MediaSourceId=MS1&PlaySessionId=PS1&SubtitleStreamIndex=-1&TranscodeReasons=AudioCodecNotSupported&TranscodingMaxAudioChannels=6&VideoCodec=h264',
    'rev-mkv-51-seek': SERVER + '/Videos/IT1/stream?AllowAudioStreamCopy=true&AllowVideoStreamCopy=true&ApiKey=TOK&AudioCodec=ac3&AudioStreamIndex=1&Container=mkv&EnableAutoStreamCopy=true&MediaSourceId=MS1&PlaySessionId=PS1&StartTimeTicks=6000000000&SubtitleStreamIndex=-1&VideoCodec=h264',
    'rev-av1-51': SERVER + '/Videos/IT1/master.m3u8?AllowAudioStreamCopy=true&AllowVideoStreamCopy=false&ApiKey=TOK&AudioCodec=ac3&AudioStreamIndex=1&EnableAutoStreamCopy=true&Level=41&MaxHeight=1080&MaxWidth=1920&MediaSourceId=MS1&MinSegments=1&PlaySessionId=PS1&Profile=high%2Cmain%2Cbaseline%2Cconstrainedbaseline&RequireAvc=true&SegmentContainer=ts&SubtitleStreamIndex=-1&TranscodeReasons=VideoCodecNotSupported&VideoCodec=h264&allowVideoStreamCopy=false',
    'rev-ts-51-interlaced': SERVER + '/Videos/IT1/stream.mkv?AllowAudioStreamCopy=false&AllowVideoStreamCopy=false&ApiKey=TOK&AudioBitRate=640000&AudioChannels=6&AudioCodec=ac3&AudioStreamIndex=1&Container=mkv&Context=Streaming&CopyTimestamps=false&DeInterlace=true&EnableAutoStreamCopy=false&Level=41&MaxFramerate=25&MaxHeight=1080&MaxVideoBitDepth=8&MaxWidth=1920&MediaSourceId=MS1&PlaySessionId=PS1&Profile=high&RequireAvc=true&RequireNonAnamorphic=true&SubtitleStreamIndex=-1&TranscodeReasons=VideoProfileNotSupported&TranscodingMaxAudioChannels=6&VideoCodec=h264',
    'rev-mkv-51-dvdsub': SERVER + '/Videos/IT1/stream.mkv?AllowAudioStreamCopy=true&AllowVideoStreamCopy=false&ApiKey=TOK&AudioCodec=ac3&AudioStreamIndex=1&Container=mkv&Context=Streaming&CopyTimestamps=false&EnableAutoStreamCopy=true&Level=41&MaxHeight=1080&MaxVideoBitDepth=8&MaxWidth=1920&MediaSourceId=MS1&PlaySessionId=PS1&Profile=high&RequireAvc=true&SubtitleStreamIndex=-1&TranscodeReasons=ContainerNotSupported&TranscodingMaxAudioChannels=6&VideoCodec=h264',
    'rev-mkv-51-sub-text': SERVER + '/Videos/IT1/stream?AllowAudioStreamCopy=true&AllowVideoStreamCopy=true&ApiKey=TOK&AudioCodec=ac3&AudioStreamIndex=1&Container=mkv&EnableAutoStreamCopy=true&MediaSourceId=MS1&PlaySessionId=PS1&SubtitleMethod=Embed&SubtitleStreamIndex=3&VideoCodec=h264',
    'dev-mkv-51': SERVER + '/Videos/IT1/stream.mkv?AllowAudioStreamCopy=true&AllowVideoStreamCopy=true&ApiKey=TOK&EnableAutoStreamCopy=true&MediaSourceId=MS1&SubtitleStreamIndex=-1&static=true',
    'dev-av1-51': SERVER + '/Videos/IT1/master.m3u8?AllowAudioStreamCopy=true&AllowVideoStreamCopy=false&ApiKey=TOK&AudioCodec=ac3&AudioStreamIndex=1&EnableAutoStreamCopy=true&Level=41&MaxHeight=1080&MaxWidth=1920&MediaSourceId=MS1&MinSegments=1&PlaySessionId=PS1&Profile=high%2Cmain%2Cbaseline%2Cconstrainedbaseline&RequireAvc=true&SegmentContainer=ts&SubtitleStreamIndex=-1&TranscodeReasons=VideoCodecNotSupported&VideoCodec=h264&allowVideoStreamCopy=false',
    'core-mkv-51': SERVER + '/Videos/IT1/stream.mkv?AllowAudioStreamCopy=true&AllowVideoStreamCopy=true&ApiKey=TOK&EnableAutoStreamCopy=true&MediaSourceId=MS1&SubtitleStreamIndex=-1&static=true',
};

const CASES = {
    'rev-mkv-51': ['revolution', source(VIDEO_H264, [AUDIO_AC3_51]), {}],
    'rev-mkv-20': ['revolution', source(VIDEO_H264, [AUDIO_AAC_20]), {}],
    'rev-mkv-dts51': ['revolution', source(VIDEO_H264, [AUDIO_DTS_51]), {}],
    'rev-mkv-51-seek': ['revolution', source(VIDEO_H264, [AUDIO_AC3_51]), { startMs: 600000, forceServerSeek: true, preferTicks: true }],
    'rev-av1-51': ['revolution', source(VIDEO_AV1, [AUDIO_AC3_51]), {}],
    'rev-ts-51-interlaced': ['revolution', source(VIDEO_H264_INTERLACED, [AUDIO_AC3_51]), {}],
    'rev-mkv-51-dvdsub': ['revolution', source(VIDEO_H264, [AUDIO_AC3_51, { Type: 'Subtitle', Index: 3, Codec: 'dvdsub', Language: 'fra' }]), {}],
    'rev-mkv-51-sub-text': ['revolution', source(VIDEO_H264, [AUDIO_AC3_51, { Type: 'Subtitle', Index: 3, Codec: 'subrip', Language: 'fra' }]), { selectedSubtitleStream: 3, selectedSubtitleIsText: true }],
    'dev-mkv-51': ['devialet', source(VIDEO_H264, [AUDIO_AC3_51]), {}],
    'dev-av1-51': ['devialet', source(VIDEO_AV1, [AUDIO_AC3_51]), {}],
    'core-mkv-51': ['core', source(VIDEO_H264, [AUDIO_AC3_51]), {}],
};

for (const name of Object.keys(REFERENCE_MULTICHANNEL)) {
    test('non-régression multicanal : ' + name, () => {
        const [backend, src, extra] = CASES[name];

        // Réglage absent (cas de tout utilisateur existant)...
        assert.equal(negotiate(backend, src, extra).url, REFERENCE_MULTICHANNEL[name]);
        // ...valeur explicite...
        assert.equal(negotiate(backend, src, extra, 'multichannel').url, REFERENCE_MULTICHANNEL[name]);
        // ...et valeur inconnue, qui retombe sur le défaut.
        assert.equal(negotiate(backend, src, extra, 'surround-42').url, REFERENCE_MULTICHANNEL[name]);
    });
}

test('non-régression multicanal : aucun plafond de canaux n\'est annoncé', () => {
    const neg = negotiate('revolution', source(VIDEO_H264, [AUDIO_AC3_51]), {}, 'multichannel');
    assert.equal(neg.body.MaxAudioChannels, undefined);
    assert.equal(neg.body.DeviceProfile.MaxAudioChannels, 6, 'profil Révolution inchangé');
    assert.equal(neg.stereoDownmix, false);

    const dev = negotiate('devialet', source(VIDEO_H264, [AUDIO_AC3_51]), {}, 'multichannel');
    assert.equal(dev.body.DeviceProfile.MaxAudioChannels, 8, 'profil Devialet inchangé');
});

/* ===== 2. Mode stéréo : pistes déjà ≤ 2 canaux ===== */

test('stéréo : une piste 2.0 garde exactement la lecture directe du mode multicanal', () => {
    const src = source(VIDEO_H264, [AUDIO_AAC_20]);
    const neg = negotiate('revolution', src, {}, 'stereo');

    assert.equal(neg.stereoDownmix, false);
    assert.equal(neg.url, REFERENCE_MULTICHANNEL['rev-mkv-20'],
        'aucun transcodage ne doit être engagé pour une piste déjà stéréo');
    assert.equal(neg.finalUrlKind, 'http-dp');
    // Le plafond reste néanmoins annoncé au serveur.
    assertStereoCeilingAnnounced(neg);
});

test('stéréo : une piste mono n\'est pas transcodée', () => {
    const neg = negotiate('revolution', source(VIDEO_H264, [AUDIO_AAC_MONO]), {}, 'stereo');
    assert.equal(neg.sourceChannels, 1);
    assert.equal(neg.stereoDownmix, false);
    assert.equal(neg.finalUrlKind, 'http-dp');
});

test('stéréo : un nombre de canaux inconnu ne déclenche pas de transcodage', () => {
    const neg = negotiate('revolution', source(VIDEO_H264, [AUDIO_UNKNOWN_CHANNELS]), {}, 'stereo');
    assert.equal(neg.sourceChannels, 0);
    assert.equal(neg.stereoDownmix, false);
    assert.equal(neg.finalUrlKind, 'http-dp');
    assertStereoCeilingAnnounced(neg);
});

/* ===== 3. Mode stéréo : downmix d'une piste multicanale ===== */

test('stéréo : une 5.1 est mixée par le serveur, vidéo copiée (Révolution, Intelligent)', () => {
    const neg = negotiate('revolution', source(VIDEO_H264, [AUDIO_AC3_51]), {}, 'stereo');

    assertStereoCeilingAnnounced(neg);
    assertStereoDownmixUrl(neg);
    assert.equal(neg.sourceChannels, 6);
    assert.equal(neg.params.AudioChannels, '2');
    assert.equal(neg.params.AudioBitRate, '192000');
    assert.equal(neg.params.AllowVideoStreamCopy, 'true', 'la vidéo compatible reste copiée');
    assert.equal(neg.params.VideoCodec, 'h264', 'codec vidéo source conservé');
    assert.equal(neg.params.AudioStreamIndex, '1', 'la piste mixée est explicitement désignée');
    assert.equal(neg.params.TranscodeReasons, 'AudioCodecNotSupported');
});

test('stéréo : le mode Original est concerné lui aussi', () => {
    const src = source(VIDEO_H264, [AUDIO_AC3_51]);
    // Le mode se règle sur le routeur (options), pas dans le contexte : le
    // routeur écrase ctx.playbackRuleMode avec son propre état.
    const original = { playbackRuleMode: 'directplay' };
    const neg = negotiate('revolution', src, {}, 'stereo', original);

    assertStereoDownmixUrl(neg);
    assert.equal(neg.params.AllowVideoStreamCopy, 'true');

    // Le même contenu en Original + multicanal reste en lecture directe.
    const multi = negotiate('revolution', src, {}, 'multichannel', original);
    assert.equal(multi.finalUrlKind, 'http-dp');
});

test('stéréo : downmix aussi sur Devialet et sur le Core neutre', () => {
    for (const backend of ['devialet', 'core']) {
        const neg = negotiate(backend, source(VIDEO_H264, [AUDIO_AC3_51]), {}, 'stereo');
        assertStereoCeilingAnnounced(neg);
        assertStereoDownmixUrl(neg);
        assert.equal(neg.params.AllowVideoStreamCopy, 'true', backend + ' : vidéo copiée');
    }
});

test('stéréo : reprise serveur, la position est conservée', () => {
    const neg = negotiate('revolution', source(VIDEO_H264, [AUDIO_AC3_51]),
        { startMs: 600000, forceServerSeek: true, preferTicks: true }, 'stereo');

    assertStereoDownmixUrl(neg);
    assert.equal(neg.params.StartTimeTicks, '6000000000');
    assert.equal(neg.params.AllowVideoStreamCopy, 'true');
});

test('stéréo : un sous-titre texte reste embarqué par le serveur', () => {
    const src = source(VIDEO_H264, [AUDIO_AC3_51, { Type: 'Subtitle', Index: 3, Codec: 'subrip', Language: 'fra' }]);
    const neg = negotiate('revolution', src, { selectedSubtitleStream: 3, selectedSubtitleIsText: true }, 'stereo');

    assertStereoDownmixUrl(neg);
    assert.equal(neg.params.SubtitleStreamIndex, '3');
    assert.equal(neg.params.SubtitleMethod, 'Embed');
    assert.equal(neg.params.AllowVideoStreamCopy, 'true');
});

/* ===== 4. Mode stéréo : chemins qui transcodaient déjà ===== */

test('stéréo + AV1 : le transcodage HLS existant est plafonné à 2 canaux en AAC', () => {
    for (const backend of ['revolution', 'devialet']) {
        const neg = negotiate(backend, source(VIDEO_AV1, [AUDIO_AC3_51]), {}, 'stereo');
        assert.equal(neg.finalUrlKind, 'hls');
        assert.equal(neg.params.AudioCodec, 'aac', backend);
        assert.equal(neg.params.TranscodingMaxAudioChannels, '2', backend);
        assert.equal(neg.params.AudioBitRate, '192000', backend);
        assert.equal(neg.params.AllowAudioStreamCopy, 'false', backend);
        // La vidéo AV1 était déjà transcodée par la policy matérielle.
        assert.equal(neg.params.AllowVideoStreamCopy, 'false', backend);
    }
});

test('stéréo + DTS 5.1 : la cible AC3 de la policy Révolution devient AAC 2.0', () => {
    const neg = negotiate('revolution', source(VIDEO_H264, [AUDIO_DTS_51]), {}, 'stereo');
    assert.equal(neg.params.AudioCodec, 'aac');
    assert.equal(neg.params.AudioChannels, '2');
    assert.equal(neg.params.AudioBitRate, '192000');
    assert.equal(neg.params.TranscodingMaxAudioChannels, '2');
});

test('stéréo + TS entrelacé : le transcodage complet respecte le plafond de 2 canaux', () => {
    const neg = negotiate('revolution', source(VIDEO_H264_INTERLACED, [AUDIO_AC3_51]), {}, 'stereo');
    assert.equal(neg.params.AudioChannels, '2');
    assert.equal(neg.params.TranscodingMaxAudioChannels, '2');
    assert.equal(neg.params.AudioBitRate, '192000');
    assert.equal(neg.params.DeInterlace, 'true', 'le désentrelacement reste demandé');
});

test('stéréo + DVDSub dormant : le transcodage haute qualité respecte le plafond', () => {
    const src = source(VIDEO_H264, [AUDIO_AC3_51, { Type: 'Subtitle', Index: 3, Codec: 'dvdsub', Language: 'fra' }]);
    const neg = negotiate('revolution', src, {}, 'stereo');
    assert.equal(neg.params.AudioChannels, '2');
    assert.equal(neg.params.TranscodingMaxAudioChannels, '2');
    assert.equal(neg.params.AllowAudioStreamCopy, 'false');
});

/* ===== 5. Changement de piste ===== */

test('stéréo : passer d\'une 5.1 à une 2.0 réautorise la copie, et inversement', () => {
    const src = source(VIDEO_H264, [AUDIO_AC3_51, AUDIO_AAC_20_ENG]);

    const onStereoTrack = negotiate('revolution', src, { selectedAudioStream: 2 }, 'stereo');
    assert.equal(onStereoTrack.stereoDownmix, false, 'la piste 2.0 choisie ne doit pas être transcodée');
    assert.equal(onStereoTrack.params.AllowAudioStreamCopy, 'true');
    assert.equal(onStereoTrack.params.AudioStreamIndex, '2');

    const onSurroundTrack = negotiate('revolution', src, { selectedAudioStream: 1 }, 'stereo');
    assertStereoDownmixUrl(onSurroundTrack);
    assert.equal(onSurroundTrack.params.AudioStreamIndex, '1');
});

/* ===== 6. TranscodingUrl Jellyfin conservée ===== */

test('stéréo : une TranscodingUrl Jellyfin conservée s\'appuie sur le profil annoncé', () => {
    const src = source(VIDEO_AV1, [AUDIO_AC3_51], {
        TranscodingUrl: '/videos/IT1/master.m3u8?PlaySessionId=PS1&AudioCodec=aac&VideoCodec=h264&TranscodingMaxAudioChannels=2',
        TranscodingSubProtocol: 'hls',
    });
    const neg = negotiate('devialet', src, {}, 'stereo');

    // L'URL de Jellyfin n'est pas réécrite : c'est le profil MaxAudioChannels=2
    // envoyé dans PlaybackInfo qui a déjà fait décider le mixage au serveur.
    assertStereoCeilingAnnounced(neg);
    assert.equal(neg.params.TranscodingMaxAudioChannels, '2');
    assert.equal(neg.params.AudioCodec, 'aac');
});

/* ===== 7. Propagation par le routeur ===== */

test('routeur : setAudioOutputMode sert de repli, le contexte du call-site reste prioritaire', () => {
    const Router = loadQmlJs('qml/js/JellyfinPlaybackRouter.js');
    const bridge = Router.JFCore.CoreUrl.JellyfinBridge;
    const src = source(VIDEO_H264, [AUDIO_AC3_51]);
    bridge.sendRequestNoCache = (method, url, headers, payload, onSuccess) => {
        onSuccess({ json: { PlaySessionId: 'PS1', MediaSources: [src] } });
        return null;
    };
    Router.setDeviceMode('revolution');

    assert.equal(Router.normalizeAudioOutputMode('STEREO'), 'stereo');
    assert.equal(Router.normalizeAudioOutputMode('bidon'), 'multichannel');
    assert.equal(Router.setAudioOutputMode('stereo'), 'stereo');

    // Contexte sans réglage : l'état du routeur s'applique.
    const base = { serverUrl: SERVER, accessToken: 'TOK', itemId: 'IT1', userId: 'U1', startMs: 0 };
    let res = null;
    Router.negotiatePlayback(Object.assign({}, base), (r) => { res = r; }, () => {});
    assert.equal(res.audioOutputStereoDownmix, true);

    // Contexte explicite : il gagne (PlayerOverlay porte la préférence de
    // l'instance courante), et un forceRetry évite le cache de négociation.
    res = null;
    Router.negotiatePlayback(Object.assign({}, base, { audioOutputMode: 'multichannel', forceRetry: true }),
        (r) => { res = r; }, () => {});
    assert.equal(res.audioOutputStereoDownmix, false);
});

/* ===== 8. Trace développeur T17 ===== */

test('T17 : le plan audio arrêté est tracé, sans URL ni secret', () => {
    const lines = [];
    const Router = loadQmlJs('qml/js/JellyfinPlaybackRouter.js', {
        stubs: { console: { log: (m) => lines.push(String(m)) } },
    });
    const Core = Router.JFCore;
    const src = source(VIDEO_H264, [AUDIO_AC3_51]);
    Core.CoreUrl.JellyfinBridge.sendRequestNoCache = (method, url, headers, payload, onSuccess) => {
        onSuccess({ json: { PlaySessionId: 'PS1', MediaSources: [src] } });
        return null;
    };
    Router.setDeviceMode('revolution');

    // Drapeau du dépôt : muet.
    Core.negotiatePlayback({ serverUrl: SERVER, accessToken: 'TOK', itemId: 'IT1', userId: 'U1',
        startMs: 0, audioOutputMode: 'stereo' }, () => {}, () => {});
    assert.equal(lines.filter((l) => l.indexOf('T17') >= 0).length, 0,
        'sans mode développeur, aucune trace ne doit être produite');

    // Drapeau basculé par tools/fbx-run.py à la volée.
    Core.DevLog.ENABLED = true;
    Core.negotiatePlayback({ serverUrl: SERVER, accessToken: 'TOK', itemId: 'IT1', userId: 'U1',
        startMs: 0, audioOutputMode: 'stereo', forceRetry: true }, () => {}, () => {});
    Core.DevLog.ENABLED = false;

    const traces = lines.filter((l) => l.indexOf('T17') >= 0);
    assert.equal(traces.length, 1);
    const trace = traces[0];
    assert.match(trace, /^\[RDF\] T17 audio-out mode=stereo srcCh=6 downmix=1 codec=aac ch=2 br=192000 maxCh=2 idx=1 path=audio-only hls=0 keepJfUrl=0 audioCopy=0 videoCopy=1$/);
    assert.equal(trace.indexOf('ApiKey'), -1, 'aucune URL ni jeton dans la trace');
    assert.equal(trace.indexOf('TOK'), -1);
});

/* ===== 9. Clé de cache de négociation ===== */

test('le mode de sortie audio fait partie de la clé de négociation', () => {
    const Core = loadQmlJs('qml/js/JellyfinPlaybackCore.js');
    const base = { serverUrl: SERVER, accessToken: 'TOK', itemId: 'IT1', userId: 'U1', startMs: 0 };

    const multi = Core._makeNegKey(Object.assign({}, base, { audioOutputMode: 'multichannel' }));
    const stereo = Core._makeNegKey(Object.assign({}, base, { audioOutputMode: 'stereo' }));
    const absent = Core._makeNegKey(Object.assign({}, base));

    assert.notEqual(multi, stereo, 'changer de sortie audio doit invalider le cache');
    assert.equal(multi, absent, 'réglage absent == multicanal');
});
