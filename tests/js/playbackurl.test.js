'use strict';

/*
 * Construction et réécriture des URL de lecture (JellyfinPlaybackCoreUrl.js).
 *
 * Ce qui est protégé : c'est le DERNIER maillon avant QtMultimedia. Toute la
 * chaîne de décision du Core finit par `_forceQuery()`, qui efface puis
 * réécrit les paramètres qui comptent. Une clé oubliée dans la liste de
 * nettoyage, une casse dupliquée (VideoBitrate / VideoBitRate) ou un jeton
 * laissé en place produisent une URL que le serveur interprète autrement — et
 * les symptômes (transcodage reparti de 00:00, piste audio ignorée, fichier
 * brut renvoyé) n'apparaissent que sur le boîtier.
 *
 * Deux garde-fous de sécurité sont aussi couverts ici : aucun jeton ne doit
 * sortir en HTTP hors LAN, et une URL de lecture doit avoir exactement la même
 * origine que le serveur validé.
 *
 * On assère des PARAMÈTRES DÉCODÉS, jamais une chaîne complète ni un ordre.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadQmlJs } = require('./qmljs');

/* ===== Chargement ===== */

// Le module URL est configuré par le Core (injection des dépendances de
// politique). On passe donc par le Core, comme le fait l'application.
function loadCoreUrl() {
    const Core = loadQmlJs('qml/js/JellyfinPlaybackCore.js');
    Core.buildDeviceProfile('auto');   // déclenche _ensureCoreUrlConfigured()
    return Core.CoreUrl;
}

const U = loadCoreUrl();

// Hôtes fictifs. Le LAN est obligatoire pour du HTTP portant un jeton.
const LAN = 'http://192.168.10.20:8096';
const WAN = 'http://jellyfin.example.net:8096';
const TOKEN = 'tok-TEST';

/** Query décodée sous forme d'objet ; l'ordre des paramètres est ignoré. */
function query(url) {
    const out = {};
    const q = String(url).indexOf('?');
    if (q < 0) return out;
    for (const part of String(url).substring(q + 1).split('&')) {
        if (!part) continue;
        const eq = part.indexOf('=');
        const key = decodeURIComponent(eq < 0 ? part : part.substring(0, eq));
        out[key] = eq < 0 ? '' : decodeURIComponent(part.substring(eq + 1));
    }
    return out;
}

/** Nombre d'occurrences brutes d'une clé (casse comprise) dans la query. */
function countKey(url, key) {
    const q = String(url).indexOf('?');
    if (q < 0) return 0;
    let n = 0;
    for (const part of String(url).substring(q + 1).split('&')) {
        if (part.split('=')[0] === key) n++;
    }
    return n;
}

function base(url) {
    return String(url).split('?')[0];
}

/* ===== 1. Base serveur et ajout de paramètres ===== */

test('_u : normalise la base, refuse le HTTP hors LAN et les schémas exotiques', () => {
    assert.equal(U._u(LAN + '/', '/Videos/IT1/stream'), LAN + '/Videos/IT1/stream');
    assert.equal(U._u(LAN + '///', 'Videos/IT1'), LAN + '/Videos/IT1',
        'un chemin sans barre oblique initiale est recollé proprement');
    assert.equal(U._u(LAN, ''), LAN, 'chemin vide : la base seule');
    assert.equal(U._u(LAN + '/jf#ancre', '/x'), LAN + '/jf/x', 'le fragment est retiré');

    assert.equal(U._u(WAN, '/x'), '', 'HTTP hors LAN : refusé');
    assert.equal(U._u('https://jellyfin.example.net:8096', '/x'),
        'https://jellyfin.example.net:8096/x', 'HTTPS reste accepté hors LAN');
    assert.equal(U._u('ftp://192.168.10.20', '/x'), '');
    assert.equal(U._u('192.168.10.20:8096', '/x'), '', 'schéma obligatoire');
    assert.equal(U._u('http://user@192.168.10.20', '/x'), '', 'userinfo refusé');
    assert.equal(U._u('http://192.168.10.20\n/x', '/y'), '', 'injection CRLF refusée');
});

test('_appendParam : encode, ignore le vide et ne laisse jamais fuir un jeton en HTTP WAN', () => {
    assert.equal(query(U._appendParam(LAN + '/a', 'Profile', 'high,main baseline')).Profile,
        'high,main baseline');
    assert.match(U._appendParam(LAN + '/a', 'Profile', 'high,main'), /Profile=high%2Cmain/,
        'la virgule est bien encodée dans l\'URL');
    assert.equal(U._appendParam(LAN + '/a', 'Container', ''), LAN + '/a', 'valeur vide : ignorée');
    assert.equal(U._appendParam(LAN + '/a', 'Container', null), LAN + '/a');
    assert.equal(U._appendParam('', 'Container', 'mkv'), '');
    assert.equal(U._appendParam(LAN + '/a?x=1', 'y', '2'), LAN + '/a?x=1&y=2',
        'le séparateur suit la présence d\'une query');

    for (const tokenKey of ['ApiKey', 'api_key', 'AccessToken', 'X-Emby-Token', 'token']) {
        assert.equal(U._appendParam(WAN + '/a', tokenKey, TOKEN), '',
            tokenKey + ' ne doit jamais partir en HTTP hors LAN');
    }
    assert.notEqual(U._appendParam(WAN + '/a', 'Container', 'mkv'), '',
        'un paramètre non sensible reste autorisé');
});

test('_splitUrl / _joinUrl : aller-retour stable, valeurs vides supprimées', () => {
    const sp = U._splitUrl(LAN + '/a?B=2&A=1&Empty=&Encoded=a%20b');
    assert.equal(sp.base, LAN + '/a');
    assert.deepEqual(Object.assign({}, sp.params), { B: '2', A: '1', Empty: '', Encoded: 'a b' });

    const joined = U._joinUrl(sp.base, sp.params);
    assert.deepEqual(query(joined), { A: '1', B: '2', Encoded: 'a b' },
        'les paramètres vides disparaissent');
    assert.equal(U._joinUrl(sp.base, {}), sp.base, 'aucun « ? » orphelin');
    assert.equal(U._joinUrl('', { A: '1' }), '');

    assert.equal(U._joinUrl(WAN + '/a', { ApiKey: TOKEN }), '',
        'jamais de jeton reconstruit sur une URL HTTP hors LAN');
    assert.equal(U._joinUrl(WAN + '/a', { ApiKey: '' }), WAN + '/a',
        'un jeton vide ne déclenche pas le refus');
});

/* ===== 2. Constructeurs d'URL ===== */

test('getVideoStreamUrl : suffixe de conteneur normalisé et lecture statique', () => {
    const cases = {
        mkv: 'stream.mkv', matroska: 'stream.mkv',
        mp4: 'stream.mp4', m2ts: 'stream.ts', mpegts: 'stream.ts', mts: 'stream.ts',
        '.MKV': 'stream.mkv',
        'weird$ext': 'stream', 'x': 'stream', '': 'stream',
    };
    for (const container of Object.keys(cases)) {
        const url = U.getVideoStreamUrl(LAN, TOKEN, 'IT1', { container: container });
        assert.equal(base(url).split('/').pop(), cases[container], 'container=' + container);
    }

    const q = query(U.getVideoStreamUrl(LAN, TOKEN, 'IT1', { mediaSourceId: 'MS1', container: 'mkv' }));
    assert.equal(q.ApiKey, TOKEN);
    assert.equal(q.static, 'true');
    assert.equal(q.SubtitleStreamIndex, '-1', 'aucun sous-titre serveur en lecture directe');
    assert.equal(q.MediaSourceId, 'MS1');
    assert.equal(q.AllowVideoStreamCopy, 'true');
});

test('buildProgressiveUrl : pistes, conteneur, ticks et verrou de codec audio', () => {
    const q = query(U.buildProgressiveUrl(LAN, TOKEN, 'IT1', {
        audioStreamIndex: 2, subtitleStreamIndex: 3, subtitleMethod: 'Embed',
        mediaSourceId: 'MS1', container: 'mkv', playSessionId: 'PS1',
        videoCodec: 'h264', startTimeTicks: 6000000000,
        audioCodec: 'ac3', forceAudioCodecHint: true,
    }));
    assert.deepEqual(q, {
        ApiKey: TOKEN, AudioStreamIndex: '2', SubtitleStreamIndex: '3', SubtitleMethod: 'Embed',
        MediaSourceId: 'MS1', Container: 'mkv', PlaySessionId: 'PS1', VideoCodec: 'h264',
        StartTimeTicks: '6000000000', AllowAudioStreamCopy: 'true', AllowVideoStreamCopy: 'true',
        EnableAutoStreamCopy: 'true', AudioCodec: 'ac3',
    });

    const noSub = query(U.buildProgressiveUrl(LAN, TOKEN, 'IT1', { forceNoSubtitle: true }));
    assert.equal(noSub.SubtitleStreamIndex, '-1');
    assert.equal(noSub.SubtitleMethod, undefined);

    const noHint = query(U.buildProgressiveUrl(LAN, TOKEN, 'IT1', { audioCodec: 'ac3' }));
    assert.equal(noHint.AudioCodec, undefined,
        'sans forceAudioCodecHint, le codec audio n\'est pas imposé');

    const noTicks = query(U.buildProgressiveUrl(LAN, TOKEN, 'IT1', { startTimeTicks: 0 }));
    assert.equal(noTicks.StartTimeTicks, undefined, 'une position nulle n\'est pas écrite');
});

test('buildServerSeekProgressiveUrl : conteneur dans le chemin ET dans la query', () => {
    const url = U.buildServerSeekProgressiveUrl(LAN, TOKEN, 'IT1', {
        audioStreamIndex: 1, container: 'MKV', startTimeTicks: 6000000000,
        videoCodec: 'h264', audioCodec: 'aac', allowAudioStreamCopy: false,
        copyTimestamps: true, transcodeReasons: 'AudioCodecNotSupported',
    });
    assert.equal(base(url), LAN + '/Videos/IT1/stream.mkv');
    const q = query(url);
    assert.equal(q.Container, 'mkv');
    assert.equal(q.StartTimeTicks, '6000000000');
    assert.equal(q.AudioCodec, 'aac');
    assert.equal(q.AllowAudioStreamCopy, 'false');
    assert.equal(q.AllowVideoStreamCopy, 'true', 'la vidéo reste copiée par défaut');
    assert.equal(q.CopyTimestamps, 'true');
    assert.equal(q.Context, 'Streaming');
    assert.equal(q.TranscodeReasons, 'AudioCodecNotSupported');

    // Un conteneur fantaisiste est réduit à des caractères sûrs.
    assert.equal(base(U.buildServerSeekProgressiveUrl(LAN, TOKEN, 'IT1', { container: 'm-k/v' })),
        LAN + '/Videos/IT1/stream.mkv');
});

test('buildHighQualityProgressiveTranscodeUrl : aucune copie vidéo possible', () => {
    const q = query(U.buildHighQualityProgressiveTranscodeUrl(LAN, TOKEN, 'IT1', {
        container: 'mkv', videoCodec: 'h264', audioCodec: 'ac3',
        videoBitrate: 4000000, maxWidth: 1920, maxHeight: 1080, maxVideoBitDepth: 8,
        audioChannels: 6, audioBitrate: 640000, transcodingMaxAudioChannels: 6,
        h264Profile: 'high', h264Level: '41', requireAvc: true, deInterlace: true,
        allowAudioStreamCopy: true, allowVideoStreamCopy: true,
    }));
    assert.equal(q.AllowVideoStreamCopy, 'false', 'imposé, même si l\'appelant demande true');
    assert.equal(q.EnableAutoStreamCopy, 'false');
    assert.equal(q.AllowAudioStreamCopy, 'true', 'la copie audio, elle, reste pilotable');
    assert.equal(q.VideoBitrate, '4000000');
    assert.equal(q.MaxWidth, '1920');
    assert.equal(q.MaxVideoBitDepth, '8');
    assert.equal(q.AudioChannels, '6');
    assert.equal(q.AudioBitRate, '640000');
    assert.equal(q.TranscodingMaxAudioChannels, '6');
    assert.equal(q.Profile, 'high');
    assert.equal(q.Level, '41');
    assert.equal(q.RequireAvc, 'true');
    assert.equal(q.DeInterlace, 'true');
});

test('buildHlsUrl : master.m3u8, paramètres HLS et repli de débit manuel', () => {
    const url = U.buildHlsUrl(LAN, TOKEN, 'IT1', {
        audioStreamIndex: 1, subtitleStreamIndex: 3, subtitleMethod: 'Encode',
        playSessionId: 'PS1', startTimeTicks: 6000000000,
        videoCodec: 'h264', audioCodec: 'ac3', segmentContainer: 'ts',
        minSegments: 1, h264Profile: 'high', h264Level: '41',
        maxWidth: 1920, maxHeight: 1080, requireAvc: true,
        forcePolicyTranscodeVideoBitrate: 4000000,
    });
    assert.equal(base(url), LAN + '/Videos/IT1/master.m3u8');
    const q = query(url);
    assert.equal(q.SegmentContainer, 'ts');
    assert.equal(q.MinSegments, '1');
    assert.equal(q.StartTimeTicks, '6000000000');
    assert.equal(q.VideoBitrate, '4000000',
        'à défaut de videoBitrate, le débit manuel est repris');
    assert.equal(q.SubtitleMethod, 'Encode');
    assert.equal(q.RequireAvc, 'true');
});

test('_subtitleResultUrl : chemin encodé, jeton en query', () => {
    const url = U._subtitleResultUrl(LAN, TOKEN, 'IT 1', 'MS/1', 3, 'srt');
    assert.equal(base(url), LAN + '/Videos/IT%201/MS%2F1/Subtitles/3/Stream.srt');
    assert.equal(query(url).ApiKey, TOKEN);
});

/* ===== 3. _forceQuery : réécriture canonique ===== */

const CTX = {
    serverUrl: LAN, accessToken: TOKEN, itemId: 'IT1',
    selectedAudioStream: -1, selectedSubtitleStream: -1,
    useLocalSubs: false, startMs: 0,
};

function ctx(extra) {
    return Object.assign({}, CTX, extra || {});
}

test('_forceQuery : lecture directe, forme canonique et idempotence', () => {
    const dp = U.getVideoStreamUrl(LAN, TOKEN, 'IT1', { mediaSourceId: 'MS1', container: 'mkv' });
    const once = U._forceQuery(dp, ctx(), null, false);
    assert.deepEqual(query(once), {
        ApiKey: TOKEN, MediaSourceId: 'MS1', SubtitleStreamIndex: '-1',
        AllowAudioStreamCopy: 'true', AllowVideoStreamCopy: 'true',
        EnableAutoStreamCopy: 'true', static: 'true',
    });
    assert.equal(U._forceQuery(once, ctx(), null, false), once,
        'réécrire une URL déjà réécrite ne la change pas');
});

test('_forceQuery : remux serveur complet, puis idempotence', () => {
    const remux = ctx({
        selectedAudioStream: 2, selectedSubtitleStream: 3, forceServerRemux: true,
        preferredContainer: 'mkv', videoCodecHint: 'h264',
        audioCodecHint: 'ac3', allowRemuxAudioCodecLock: true,
        playSessionId: 'PS1', startMs: 600000,
    });
    const url = U._forceQuery(U.getVideoStreamUrl(LAN, TOKEN, 'IT1', { container: 'mkv' }),
        remux, 'Embed', true);
    const q = query(url);
    assert.equal(q.AudioStreamIndex, '2');
    assert.equal(q.SubtitleStreamIndex, '3');
    assert.equal(q.SubtitleMethod, 'Embed');
    assert.equal(q.Container, 'mkv');
    assert.equal(q.VideoCodec, 'h264');
    assert.equal(q.AudioCodec, 'ac3');
    assert.equal(q.StartTimeTicks, '6000000000');
    assert.equal(q.PlaySessionId, 'PS1');
    assert.equal(q.static, undefined, 'un remux n\'est jamais servi en statique');
    assert.equal(U._forceQuery(url, remux, 'Embed', true), url);
});

test('_forceQuery : le jeton canonique est remplacé, jamais dupliqué', () => {
    const stale = LAN + '/Videos/IT1/stream.mkv?ApiKey=ANCIEN&Container=avi&AudioStreamIndex=9';
    const url = U._forceQuery(stale, ctx(), null, false);
    const q = query(url);
    assert.equal(q.ApiKey, TOKEN);
    assert.equal(countKey(url, 'ApiKey'), 1);
    assert.equal(url.indexOf('ANCIEN'), -1, 'aucune trace de l\'ancien jeton');
    assert.equal(q.Container, undefined,
        'le conteneur hérité est effacé faute de préférence explicite');
    assert.equal(q.AudioStreamIndex, undefined,
        'une piste héritée est effacée si le contexte n\'en demande plus');
});

test('_forceQuery : la clé héritée api_key d\'une TranscodingUrl est aussi effacée', () => {
    // Chemin réel : playerOverlayHelper.js pose
    // forceJellyfinTranscodingUrlCopyRemux, le Core reprend alors
    // src.TranscodingUrl (qui contient api_key=...) SANS passer par
    // _preserveJellyfinTranscodingQuery, lequel supprime bien la clé.
    for (const stale of ['api_key', 'apikey']) {
        const url = U._forceQuery(
            LAN + '/videos/IT1/stream.mkv?' + stale + '=JETON_JELLYFIN&VideoCodec=h264',
            ctx({ forceServerRemux: true }), null, false);
        const q = query(url);
        assert.equal(q[stale], undefined,
            stale + ' : deux paramètres d\'authentification différents dans une même URL');
        assert.equal(url.indexOf('JETON_JELLYFIN'), -1, stale + ' : jeton Jellyfin résiduel');
        assert.equal(q.ApiKey, TOKEN, stale + ' : le jeton canonique de l\'application');
        assert.equal(countKey(url, 'ApiKey'), 1, stale);
    }
});

test('_forceQuery : sous-titres locaux ou absents => SubtitleStreamIndex=-1', () => {
    for (const c of [ctx({ useLocalSubs: true, selectedSubtitleStream: 3 }),
                     ctx({ selectedSubtitleStream: -1 })]) {
        const q = query(U._forceQuery(LAN + '/Videos/IT1/stream.mkv', c, 'Embed', false));
        assert.equal(q.SubtitleStreamIndex, '-1');
        assert.equal(q.SubtitleMethod, undefined, 'aucune méthode sans piste serveur');
    }
});

test('_forceQuery : PlaySessionId seulement sur un pipeline serveur', () => {
    const withSession = { playSessionId: 'PS1' };
    assert.equal(query(U._forceQuery(LAN + '/Videos/IT1/stream.mkv',
        ctx(withSession), null, false)).PlaySessionId, undefined,
        'lecture directe : pas de session de transcodage');

    for (const flag of ['forceServerRemux', 'forceServerSeek', 'forcePolicyTranscode',
                        'forceServerTranscode', 'lastUsedTranscoding']) {
        const c = ctx(Object.assign({}, withSession));
        c[flag] = true;
        assert.equal(query(U._forceQuery(LAN + '/Videos/IT1/stream.mkv', c, null, false)).PlaySessionId,
            'PS1', flag);
    }
    assert.equal(query(U._forceQuery(LAN + '/Videos/IT1/master.m3u8',
        ctx(withSession), null, false)).PlaySessionId, 'PS1', 'HLS : toujours');
});

test('_forceQuery : débit vidéo demandé > valeur Jellyfin, et une seule casse de clé', () => {
    const jellyfin = LAN + '/Videos/IT1/stream.mkv?VideoBitRate=9000000';
    const transcode = { forceServerTranscode: true };

    const kept = U._forceQuery(jellyfin, ctx(transcode), null, false);
    assert.equal(query(kept).VideoBitrate, '9000000', 'la valeur calculée par Jellyfin est conservée');

    const core = U._forceQuery(jellyfin,
        ctx(Object.assign({ videoBitrate: 5000000 }, transcode)), null, false);
    assert.equal(query(core).VideoBitrate, '5000000', 'le débit décidé par le Core l\'emporte');

    // forcePolicyTranscodeVideoBitrate n'est qu'un REPLI de ctx.videoBitrate.
    // Le Core garde les deux alignés, mais l'ordre compte si un jour ils
    // divergent : c'est videoBitrate qui gagne ici.
    const manual = U._forceQuery(jellyfin,
        ctx(Object.assign({ forcePolicyTranscodeVideoBitrate: 4000000 }, transcode)), null, false);
    assert.equal(query(manual).VideoBitrate, '4000000');

    for (const url of [kept, core, manual]) {
        assert.equal(countKey(url, 'VideoBitRate'), 0, 'une seule casse est émise');
        assert.equal(countKey(url, 'VideoBitrate'), 1);
    }

    // Bornes : plancher 420 kb/s, plafond ReDeFin 200 Mb/s.
    assert.equal(query(U._forceQuery(jellyfin,
        ctx(Object.assign({ videoBitrate: 1000 }, transcode)), null, false)).VideoBitrate, '420000');
    assert.equal(query(U._forceQuery(jellyfin,
        ctx(Object.assign({ videoBitrate: 999000000 }, transcode)), null, false)).VideoBitrate,
        '200000000');
});

test('_forceQuery : les contraintes de transcodage progressif sont réécrites', () => {
    const q = query(U._forceQuery(LAN + '/Videos/IT1/stream.mkv', ctx({
        selectedAudioStream: 1, forceServerTranscode: true, forcePolicyTranscode: true,
        videoCodecHint: 'h264', audioCodecHint: 'ac3', forceAudioCodecHint: true,
        allowVideoStreamCopy: false, allowAudioStreamCopy: false, enableAutoStreamCopy: false,
        maxWidth: 1920, maxHeight: 1080, maxVideoBitDepth: 8, maxFramerate: 25,
        audioChannels: 6, audioBitrate: 640000, transcodingMaxAudioChannels: 6,
        h264Profile: 'high', h264Level: '41', requireAvc: true, deInterlace: true,
        requireNonAnamorphic: true, transcodeReasons: 'VideoProfileNotSupported',
        copyTimestamps: false, context: 'Streaming', preferredContainer: 'mkv',
    }), null, false));
    assert.equal(q.AllowVideoStreamCopy, 'false');
    assert.equal(q.AllowAudioStreamCopy, 'false');
    assert.equal(q.EnableAutoStreamCopy, 'false');
    assert.equal(q.VideoCodec, 'h264');
    assert.equal(q.AudioCodec, 'ac3');
    assert.equal(q.MaxWidth, '1920');
    assert.equal(q.MaxFramerate, '25');
    assert.equal(q.AudioChannels, '6');
    assert.equal(q.Profile, 'high');
    assert.equal(q.DeInterlace, 'true');
    assert.equal(q.RequireNonAnamorphic, 'true');
    assert.equal(q.TranscodeReasons, 'VideoProfileNotSupported');
    assert.equal(q.CopyTimestamps, 'false');
    assert.equal(q.static, undefined);
});

test('_forceQuery : sur une URL HLS, les options de segmentation sont posées', () => {
    const q = query(U._forceQuery(LAN + '/Videos/IT1/master.m3u8', ctx({
        selectedAudioStream: 1, forcePolicyTranscode: true, lastUsedTranscoding: true,
        videoCodecHint: 'h264', audioCodecHint: 'aac', segmentContainer: 'ts',
        transcodeReasons: 'VideoCodecNotSupported', minSegments: 1, requireAvc: true,
        h264Profile: 'high,main', h264Level: '41', maxWidth: 1920, maxHeight: 1080,
        transcodingMaxAudioChannels: 2, audioBitrate: 192000,
        allowVideoStreamCopy: false, playSessionId: 'PS1',
    }), 'Hls', false));
    assert.equal(q.SegmentContainer, 'ts');
    assert.equal(q.MinSegments, '1');
    assert.equal(q.TranscodeReasons, 'VideoCodecNotSupported');
    assert.equal(q.TranscodingMaxAudioChannels, '2');
    assert.equal(q.AudioBitRate, '192000');
    assert.equal(q.AudioCodec, 'aac', 'le codec audio est toujours imposé en HLS');
    assert.equal(q.Container, undefined, 'aucun Container sur un master HLS');
    assert.equal(q.static, undefined);
});

test('_forceQuery : refus d\'une URL vide ou HTTP hors LAN', () => {
    assert.equal(U._forceQuery('', ctx(), null, false), '');
    assert.equal(U._forceQuery(WAN + '/Videos/IT1/stream.mkv?ApiKey=x', ctx(), null, false), '',
        'jamais de jeton réécrit sur une URL HTTP hors LAN');
    assert.equal(U._forceQuery(WAN + '/videos/IT1/stream.mkv?api_key=x',
        ctx({ forceServerRemux: true }), null, false), '',
        'le refus prime aussi sur le nettoyage de la clé héritée');
});

/* ===== 4. TranscodingUrl fournie par Jellyfin ===== */

const JF_URL = LAN + '/videos/IT1/master.m3u8'
    + '?api_key=ANCIEN&VideoBitrate=3000000&VideoCodec=h264&AudioCodec=aac'
    + '&TranscodeReasons=VideoCodecNotSupported&Profile=high&Level=41'
    + '&SegmentContainer=ts&MaxWidth=1920&PlaySessionId=';

test('TranscodingUrl conservée : les décisions de Jellyfin ne sont pas réécrites', () => {
    const keep = ctx({ preserveJellyfinTranscodingUrl: true, playSessionId: 'PS1',
        selectedAudioStream: 5, selectedSubtitleStream: 7,
        videoCodecHint: 'hevc', maxWidth: 640, forcePolicyTranscodeVideoBitrate: 4000000 });
    const url = U._forceQuery(JF_URL, keep, 'Embed', false);
    const q = query(url);

    // Tout ce que Jellyfin a calculé reste intact...
    assert.equal(q.VideoBitrate, '3000000', 'le débit calculé par Jellyfin est respecté');
    assert.equal(q.VideoCodec, 'h264');
    assert.equal(q.AudioCodec, 'aac');
    assert.equal(q.Profile, 'high');
    assert.equal(q.Level, '41');
    assert.equal(q.MaxWidth, '1920');
    assert.equal(q.TranscodeReasons, 'VideoCodecNotSupported');
    assert.equal(q.SegmentContainer, 'ts');
    // ...et le Core n'y injecte NI piste NI méthode de sous-titre.
    assert.equal(q.AudioStreamIndex, undefined);
    assert.equal(q.SubtitleStreamIndex, undefined);
    assert.equal(q.SubtitleMethod, undefined);

    // Seuls l'authentification canonique et la session manquante sont corrigées.
    assert.equal(q.ApiKey, TOKEN);
    assert.equal(q.api_key, undefined, 'la clé héritée est supprimée');
    assert.equal(url.indexOf('ANCIEN'), -1);
    assert.equal(q.PlaySessionId, 'PS1');

    assert.equal(U._forceQuery(url, keep, 'Embed', false), url, 'idempotent');
});

test('TranscodingUrl conservée : StartTimeTicks n\'est matérialisé que pour un seek serveur', () => {
    const keep = ctx({ preserveJellyfinTranscodingUrl: true, startMs: 600000 });

    assert.equal(query(U._forceQuery(JF_URL, keep, null, true)).StartTimeTicks, undefined,
        'sans forceServerSeek, la TranscodingUrl reste telle quelle');

    const seek = Object.assign({}, keep, { forceServerSeek: true });
    assert.equal(query(U._forceQuery(JF_URL, seek, null, true)).StartTimeTicks, '6000000000');
    assert.equal(query(U._forceQuery(JF_URL, seek, null, false)).StartTimeTicks, undefined,
        'includeTicks=false : la position n\'est pas écrite');

    // Une valeur déjà présente est remplacée, pas dupliquée.
    const already = U._forceQuery(JF_URL + '&StartTimeTicks=1', seek, null, true);
    assert.equal(countKey(already, 'StartTimeTicks'), 1);
    assert.equal(query(already).StartTimeTicks, '6000000000');
});

test('TranscodingUrl conservée : un débit n\'est ajouté que si Jellyfin n\'en donne aucun', () => {
    const noRate = LAN + '/videos/IT1/master.m3u8?api_key=A&VideoCodec=h264';
    const keep = ctx({ preserveJellyfinTranscodingUrl: true, forcePolicyTranscodeVideoBitrate: 4000000 });
    assert.equal(query(U._forceQuery(noRate, keep, null, false)).VideoBitrate, '4000000');

    const neutral = ctx({ preserveJellyfinTranscodingUrl: true });
    assert.equal(query(U._forceQuery(noRate, neutral, null, false)).VideoBitrate, undefined);
});

test('TranscodingUrl conservée : refus en HTTP hors LAN', () => {
    const keep = ctx({ preserveJellyfinTranscodingUrl: true });
    assert.equal(U._forceQuery(WAN + '/videos/IT1/master.m3u8?api_key=A', keep, null, false), '');
});

/* ===== 5. Validations de transport ===== */

test('validation serveur : HTTPS partout, HTTP seulement sur le LAN', () => {
    assert.equal(U._transportValidateServerUrlStrict(LAN, false), true);
    assert.equal(U._transportValidateServerUrlStrict('http://127.0.0.1:8096', false), true);
    assert.equal(U._transportValidateServerUrlStrict(WAN, false), false);
    assert.equal(U._transportValidateServerUrlStrict('https://jellyfin.example.net', false), true);
    assert.equal(U._transportValidateServerUrlStrict('', false), false);
    assert.equal(U._transportValidateServerUrlStrict(LAN + '/a\r\nb', false), false);
    assert.equal(U._transportValidateServerUrlStrict('x'.repeat(600), false), false);
});

test('validation lecture : même origine exacte que le serveur, aucun fragment', () => {
    assert.equal(U._transportValidatePlaybackUrlStrict(LAN + '/Videos/IT1/stream?ApiKey=' + TOKEN, LAN), true);
    assert.equal(U._transportValidatePlaybackUrlStrict(LAN + '/Videos/IT1/stream?x=' + 'y'.repeat(2000), LAN),
        true, 'une URL média longue reste acceptée');

    const rejected = {
        'hôte différent': 'http://192.168.10.21:8096/Videos/IT1/stream',
        'port différent': 'http://192.168.10.20:8920/Videos/IT1/stream',
        'schéma différent': 'https://192.168.10.20:8096/Videos/IT1/stream',
        'fragment': LAN + '/Videos/IT1/stream#a',
        'CRLF': LAN + '/Videos/IT1/\r\nstream',
        'relative': '/Videos/IT1/stream',
    };
    for (const label of Object.keys(rejected)) {
        assert.equal(U._transportValidatePlaybackUrlStrict(rejected[label], LAN), false, label);
    }
    assert.equal(U._transportValidatePlaybackUrlStrict(WAN + '/Videos/IT1/stream', WAN), false,
        'un serveur HTTP hors LAN est refusé en amont');
});

/* ===== 6. Petits utilitaires de décision ===== */

test('_extFrom et _isProblematicForSeek', () => {
    assert.equal(U._extFrom('/m/film.MKV'), 'mkv');
    assert.equal(U._extFrom('/m/film.mkv?x=1'), 'mkv');
    assert.equal(U._extFrom('/m/sans-extension'), '');
    assert.equal(U._extFrom(''), '');
    assert.equal(U._extFrom(null), '');

    for (const fragile of ['avi', 'ts', 'mpeg', 'mpg', 'm2ts', 'vob', '/m/film.m2ts'])
        assert.equal(U._isProblematicForSeek(fragile), true, fragile);
    for (const ok of ['mkv', 'mp4', 'webm', ''])
        assert.equal(U._isProblematicForSeek(ok), false, ok);
});

test('_normalizeAudioCodecHint : alias DTS, E-AC3, TrueHD et AAC', () => {
    const cases = {
        DTS: 'dts,dca', dca: 'dts,dca', a_dts: 'dts,dca',
        eac3: 'eac3', DDP: 'eac3', dolby_digital_plus: 'eac3',
        truehd: 'truehd', mlp: 'truehd',
        mp4a: 'aac', AAC: 'aac', ac3: 'ac3',
        'ac3,eac3,aac,mp3': 'ac3,eac3,aac,mp3',
        inconnu: 'inconnu',
    };
    for (const input of Object.keys(cases))
        assert.equal(U._normalizeAudioCodecHint(input), cases[input], input);
    assert.equal(U._normalizeAudioCodecHint(''), null);
    assert.equal(U._normalizeAudioCodecHint(null), null);
});

test('_needsServerTrackSelection_ctx : ce qui oblige à passer par le serveur', () => {
    assert.equal(U._needsServerTrackSelection_ctx(null), false);
    assert.equal(U._needsServerTrackSelection_ctx(ctx()), false);
    assert.equal(U._needsServerTrackSelection_ctx(ctx({ selectedAudioStream: 0 })), true);
    assert.equal(U._needsServerTrackSelection_ctx(ctx({ selectedSubtitleStream: 3 })), true);
    assert.equal(U._needsServerTrackSelection_ctx(
        ctx({ selectedSubtitleStream: 3, useLocalSubs: true })), false,
        'un sous-titre rendu localement n\'exige rien du serveur');
    for (const flag of ['forceServerSeek', 'forceServerRemux', 'forceHevcMain10Remux'])
        assert.equal(U._needsServerTrackSelection_ctx(ctx({ [flag]: true })), true, flag);
});

test('_isTx3gSelected : uniquement les sous-titres texte MP4', () => {
    const src = { MediaStreams: [
        { Type: 'Subtitle', Index: 3, Codec: 'mov_text' },
        { Type: 'Subtitle', Index: 4, Codec: 'subrip' },
        { Type: 'Subtitle', Index: 5, Codec: 'other', CodecTag: 'tx3g' },
    ] };
    assert.equal(U._isTx3gSelected(src, 3), true);
    assert.equal(U._isTx3gSelected(src, 4), false);
    assert.equal(U._isTx3gSelected(src, 5), true);
    assert.equal(U._isTx3gSelected(src, -1), false);
    assert.equal(U._isTx3gSelected(null, 3), false);
});
