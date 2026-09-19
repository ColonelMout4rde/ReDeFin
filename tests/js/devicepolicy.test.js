'use strict';

/*
 * Policies matérielles et routage par modèle de Player.
 *
 * Ce qui est protégé :
 *  1. le DeviceProfile réellement envoyé à Jellyfin dans /PlaybackInfo pour
 *     chaque matériel (conteneurs, codecs, plafond de canaux, profils et
 *     méthodes de sous-titres, profil de transcodage, plafond de débit) ;
 *  2. le choix de la policy par JellyfinPlaybackRouter selon Device.model,
 *     avec un repli SÛR — le Core neutre, jamais la Révolution — sur un
 *     modèle inconnu.
 *
 * Pourquoi c'est sensible : le DeviceProfile est le seul contrat que le
 * serveur connaît. Y ajouter un codec que le CE4100 ne décode pas, ou router
 * une Delta vers la policy Révolution, se traduit par un écran noir sur le
 * boîtier — jamais par une erreur visible côté client.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadQmlJs } = require('./qmljs');
const { SERVER, loadRouter, V, A, source } = require('./negotiationmatrixfixtures');

const MEDIA = source('mkv', '/m/film.mkv', [V.h264, A.ac351]);

/* ===== Accès aux profils ===== */

/**
 * Profil construit par la policy du matériel demandé.
 * Un routeur NEUF par appel : le Core garde la dernière policy installée.
 */
function profileFor(device, mode) {
    const { Router } = loadRouter(MEDIA);
    Router.setDeviceMode(device);
    Router.setFbx(null);            // installe la policy du backend sélectionné
    return Router.JFCore.buildDeviceProfile(mode || 'auto');
}

/** Profil réellement transporté par le POST /PlaybackInfo. */
function sentProfile(device) {
    const { Router, bodies } = loadRouter(MEDIA);
    Router.setDeviceMode(device);
    Router.negotiatePlayback(
        { serverUrl: SERVER, accessToken: 'TOK', itemId: 'IT1', userId: 'U1', startMs: 0 },
        () => {}, () => {});
    return bodies[bodies.length - 1];
}

/** { "mkv": "h264,hevc", ... } à partir d'une liste de profils Jellyfin. */
function byContainer(list) {
    const out = {};
    for (const entry of list || []) out[entry.Container] = entry;
    return out;
}

/** { "srt": ["External","Embed"], ... } */
function subtitleMethods(profile) {
    const out = {};
    for (const entry of profile.SubtitleProfiles || []) {
        if (!out[entry.Format]) out[entry.Format] = [];
        out[entry.Format].push(entry.Method);
    }
    return out;
}

function codecs(value) {
    return String(value || '').split(',').filter(Boolean);
}

/**
 * Recopie une valeur issue du contexte vm dans le realm des tests : sans cela,
 * assert.deepEqual échoue sur des objets pourtant identiques.
 */
function plain(value) {
    return JSON.parse(JSON.stringify(value));
}

/* ===== 1. Profil Freebox Révolution (CE4100) ===== */

test('profil Révolution : identité, plafonds et conteneurs de lecture directe', () => {
    const p = profileFor('revolution');
    assert.equal(p.Name, 'Freebox-Revolution');
    assert.equal(p.MaxAudioChannels, 6, 'le CE4100 ne sort pas plus de 5.1');
    assert.equal(p.MaxStreamingBitrate, 200000000, 'plafond ReDeFin');
    assert.equal(p.MaxStaticBitrate, 200000000);

    const dp = byContainer(p.DirectPlayProfiles);
    assert.deepEqual(Object.keys(dp).sort(), ['avi', 'mp4,m4v,mov', 'ts,m2ts,mpg,mpeg']);
    assert.equal(dp.mkv, undefined,
        'MKV reste volontairement hors DirectPlay : c\'est le conteneur de remux');

    for (const entry of p.DirectPlayProfiles) {
        for (const codec of codecs(entry.VideoCodec)) {
            assert.ok(['h264', 'mpeg4', 'mpeg2video', 'msmpeg4v3'].indexOf(codec) >= 0,
                'codec vidéo non décodable annoncé en DirectPlay : ' + codec);
        }
        for (const codec of codecs(entry.AudioCodec)) {
            assert.ok(['aac', 'ac3', 'mp3', 'mp2'].indexOf(codec) >= 0,
                'codec audio non décodable annoncé en DirectPlay : ' + codec);
        }
    }
    // Aucun codec « risqué » ne doit apparaître, quel que soit le conteneur.
    const all = JSON.stringify(p.DirectPlayProfiles) + JSON.stringify(p.DirectStreamProfiles);
    for (const risky of ['hevc', 'h265', 'av1', 'vp9', 'vc1', 'dts', 'dca', 'truehd', 'eac3', 'flac', 'opus'])
        assert.equal(all.indexOf(risky), -1, risky + ' ne doit jamais être annoncé à Jellyfin');
});

test('profil Révolution : DirectStream ajoute MKV, sans élargir les codecs', () => {
    const ds = byContainer(profileFor('revolution').DirectStreamProfiles);
    assert.deepEqual(Object.keys(ds).sort(), ['mkv', 'mp4', 'ts']);
    assert.deepEqual(codecs(ds.mkv.VideoCodec).sort(),
        ['h264', 'mpeg2video', 'mpeg4', 'msmpeg4v3']);
    assert.deepEqual(codecs(ds.mkv.AudioCodec).sort(), ['aac', 'ac3', 'mp2', 'mp3']);
});

test('profil Révolution : les contraintes CE4100 sont posées en CodecProfiles', () => {
    const p = profileFor('revolution');
    const h264 = (p.CodecProfiles || []).filter((c) => c.Type === 'Video' && c.Codec === 'h264')[0];
    assert.ok(h264, 'une contrainte H.264 doit être annoncée');
    const limits = {};
    for (const cond of h264.Conditions) {
        assert.equal(cond.Condition, 'LessThanEqual');
        limits[cond.Property] = cond.Value;
    }
    assert.deepEqual(limits, {
        Width: '1920', Height: '1080', VideoBitDepth: '8',
        VideoFramerate: '60', VideoLevel: '41',
    });

    const audio = (p.CodecProfiles || []).filter((c) => c.Type === 'VideoAudio')[0];
    assert.ok(audio);
    assert.deepEqual(plain(audio.Conditions).map((c) => c.Property + c.Condition + c.Value),
        ['AudioChannelsLessThanEqual6']);
});

test('profil Révolution : sous-titres texte externes ou embarqués, PGS embarqué', () => {
    const methods = subtitleMethods(profileFor('revolution'));
    for (const format of ['srt', 'subrip', 'vtt', 'webvtt'])
        assert.deepEqual(methods[format], ['External', 'Embed'], format);
    for (const format of ['pgssub', 'pgs'])
        assert.deepEqual(methods[format], ['Embed'], format);
    // Les bitmaps DVD ne sont jamais remuxés : ils passent par l'incrustation.
    assert.equal(methods.dvdsub, undefined);
    assert.equal(methods.vobsub, undefined);
});

test('profil Révolution : HLS/TS en négociation initiale, HTTP/MKV sinon', () => {
    for (const mode of ['auto', 'hls']) {
        assert.deepEqual(plain(profileFor('revolution', mode).TranscodingProfiles), [{
            Container: 'ts', Type: 'Video', Protocol: 'hls',
            VideoCodec: 'h264', AudioCodec: 'ac3,aac',
        }], mode);
    }
    for (const mode of ['http', 'mp4', 'encode']) {
        assert.deepEqual(plain(profileFor('revolution', mode).TranscodingProfiles), [{
            Container: 'mkv', Type: 'Video', Protocol: 'http',
            VideoCodec: 'h264', AudioCodec: 'ac3,aac',
        }], mode);
    }
});

/* ===== 2. Profil Freebox Delta / Devialet ===== */

test('profil Devialet : identité, 8 canaux et conteneurs de lecture directe', () => {
    const p = profileFor('devialet');
    assert.equal(p.Name, 'Freebox-Devialet');
    assert.equal(p.MaxAudioChannels, 8);
    assert.equal(p.MaxStreamingBitrate, 200000000);

    const dp = byContainer(p.DirectPlayProfiles);
    assert.deepEqual(Object.keys(dp).sort(),
        ['avi', 'mkv', 'mp4,m4v,mov', 'ts,m2ts,mpg,mpeg', 'webm']);
    assert.ok(codecs(dp.mkv.VideoCodec).indexOf('hevc') >= 0, 'HEVC est décodé');
    for (const codec of ['dts', 'dca', 'truehd', 'eac3', 'flac', 'opus'])
        assert.ok(codecs(dp.mkv.AudioCodec).indexOf(codec) >= 0, codec + ' doit être accepté');

    // AV1 ne doit apparaître NULLE PART : Jellyfin tenterait un DirectPlay
    // impossible pour la Freebox.
    const all = JSON.stringify(p.DirectPlayProfiles) + JSON.stringify(p.DirectStreamProfiles);
    assert.equal(all.indexOf('av1'), -1);
    assert.equal(all.indexOf('vvc'), -1);
});

test('profil Devialet : sous-titres texte ET bitmap embarqués', () => {
    const methods = subtitleMethods(profileFor('devialet'));
    for (const format of ['srt', 'subrip', 'vtt', 'webvtt'])
        assert.deepEqual(methods[format], ['External', 'Embed'], format);
    for (const format of ['ass', 'ssa', 'mov_text', 'tx3g', 'pgssub', 'dvdsub', 'vobsub'])
        assert.deepEqual(methods[format], ['Embed'], format);
});

test('profil Devialet : transcodage H.264, HLS/TS avec un audio restreint', () => {
    const hls = plain(profileFor('devialet', 'auto').TranscodingProfiles);
    assert.deepEqual(hls, [{
        Container: 'ts', Type: 'Video', Protocol: 'hls',
        VideoCodec: 'h264', AudioCodec: 'aac,ac3,eac3,mp3,mp2',
    }], 'jamais HEVC en sortie : le chemin AV1 -> HEVC est instable');

    const http = profileFor('devialet', 'http').TranscodingProfiles;
    assert.equal(http.length, 1);
    assert.equal(http[0].Protocol, 'http');
    assert.equal(http[0].Container, 'mkv');
    assert.equal(http[0].VideoCodec, 'h264');
});

/* ===== 3. Profil neutre (matériel inconnu) ===== */

test('profil neutre : générique Qt5, jamais la policy d\'un matériel connu', () => {
    const p = profileFor('core');
    assert.equal(p.Name, 'Freebox-Qt5');
    assert.equal(p.MaxAudioChannels, 8);
    assert.equal(p.MaxStreamingBitrate, 200000000);
    assert.equal(p.CodecProfiles, undefined, 'aucune contrainte matérielle inventée');

    // Contrairement aux policies matérielles, « auto » reste progressif.
    assert.equal(profileFor('core', 'auto').TranscodingProfiles[0].Protocol, 'http');
    assert.equal(profileFor('core', 'hls').TranscodingProfiles[0].Protocol, 'hls');
});

test('profil neutre : l\'incrustation n\'est proposée que dans les modes Encode', () => {
    const embed = subtitleMethods(profileFor('core', 'auto'));
    assert.deepEqual(embed.srt, ['External', 'Embed']);
    assert.deepEqual(embed.pgssub, ['Embed']);

    for (const mode of ['encode', 'hls-encode']) {
        const methods = subtitleMethods(profileFor('core', mode));
        assert.deepEqual(methods.srt, ['External', 'Embed', 'Encode'], mode);
        assert.deepEqual(methods.pgssub, ['Encode'], mode);
    }
});

/* ===== 4. Le profil envoyé est bien celui de la policy ===== */

test('le profil transporté par /PlaybackInfo est celui du matériel routé', () => {
    assert.equal(sentProfile('revolution').DeviceProfile.Name, 'Freebox-Revolution');
    assert.equal(sentProfile('devialet').DeviceProfile.Name, 'Freebox-Devialet');
    assert.equal(sentProfile('fbx6hd').DeviceProfile.Name, 'Freebox-Revolution');
    assert.equal(sentProfile('fbx7hd').DeviceProfile.Name, 'Freebox-Devialet');
    assert.equal(sentProfile('modele-inconnu').DeviceProfile.Name, 'Freebox-Qt5');
});

test('le plafond de débit ReDeFin est imposé à tous les profils', () => {
    for (const device of ['revolution', 'devialet', 'core']) {
        const body = sentProfile(device);
        assert.equal(body.MaxStreamingBitrate, 200000000, device);
        assert.equal(body.DeviceProfile.MaxStreamingBitrate, 200000000, device);
        assert.equal(body.DeviceProfile.MaxStaticBitrate, 200000000, device);
    }
});

/* ===== 5. Routage par Device.model ===== */

test('setDeviceMode : chaque modèle connu choisit sa policy', () => {
    const { Router } = loadRouter(MEDIA);
    const expected = {
        // Codes matériels réellement exposés par fbx.system.Device.
        fbx6hd: 'revolution', fbx7hd: 'devialet', 'fbx7hd-delta': 'devialet',
        // Libellés commerciaux.
        'Freebox Revolution': 'revolution', 'Freebox Player Devialet': 'devialet',
        'Freebox Player Delta': 'devialet', delta: 'devialet',
        // Alias acceptés par le réglage manuel.
        rev: 'revolution', v6: 'revolution', fbx6: 'revolution',
        revolution: 'revolution', devialet: 'devialet',
        // Casse et accents ne doivent pas compter.
        DEVIALET: 'devialet', 'freebox révolution': 'revolution',
    };
    for (const model of Object.keys(expected))
        assert.equal(Router.setDeviceMode(model), expected[model], model);
});

test('setDeviceMode : tout modèle inconnu retombe sur le Core neutre', () => {
    const { Router } = loadRouter(MEDIA);
    // Repli SÛR : appliquer la policy Révolution à une Delta brimerait le
    // matériel ; lui appliquer la policy Devialet enverrait du HEVC à un CE4100.
    for (const model of ['fbx8hd', 'inconnu', 'Freebox Server', '', null, undefined, 0, 42, {}, []])
        assert.equal(Router.setDeviceMode(model), 'core', JSON.stringify(model));
    for (const explicit of ['core', 'generic', 'fallback-core', 'auto', 'detect', 'default'])
        assert.equal(Router.setDeviceMode(explicit), 'core', explicit);
});

test('setFbx : le modèle est retrouvé dans l\'objet fbx quand le mode est automatique', () => {
    const { Router } = loadRouter(MEDIA);
    assert.equal(Router.setFbx({ model: 'fbx7hd-delta' }), 'devialet');
    assert.equal(Router.setFbx({ deviceModel: 'fbx6hd' }), 'revolution');
    assert.equal(Router.setFbx({ device: { productName: 'Freebox Player Devialet' } }), 'devialet',
        'un sous-objet est inspecté sur un niveau');
    assert.equal(Router.setFbx({ getModel: () => 'Freebox Revolution' }), 'revolution',
        'une méthode est appelée en dernier recours');
    assert.equal(Router.setFbx({ model: 'modele-martien' }), 'core');
    assert.equal(Router.setFbx(null), 'core');
});

test('setFbx : un mode explicite n\'est jamais écrasé par l\'introspection', () => {
    const { Router } = loadRouter(MEDIA);
    Router.setDeviceMode('revolution');
    assert.equal(Router.setFbx({ model: 'fbx7hd-delta' }), 'revolution',
        'le mode demandé par ShellPage reste prioritaire');
    // resetDeviceMode() rend la main à la détection.
    assert.equal(Router.resetDeviceMode(), 'devialet');
    assert.equal(Router.currentDeviceMode(), 'devialet');
});

test('un objet fbx cyclique ou hostile ne fait pas boucler la détection', () => {
    const { Router } = loadRouter(MEDIA);
    const loop = { name: 'boucle' };
    loop.self = loop;
    loop.child = { parent: loop, model: 'fbx6hd' };
    assert.equal(Router.setFbx(loop), 'revolution');

    const hostile = {};
    Object.defineProperty(hostile, 'model', { get() { throw new Error('boum'); }, enumerable: true });
    assert.equal(Router.setFbx(hostile), 'core', 'une propriété qui lève ne doit pas casser le routeur');
});

test('normalizePlaybackRuleMode : seul « directplay » sort du mode Intelligent', () => {
    const { Router } = loadRouter(MEDIA);
    for (const value of ['directplay', 'DirectPlay', '  DIRECTPLAY  '])
        assert.equal(Router.normalizePlaybackRuleMode(value), 'directplay', JSON.stringify(value));
    for (const value of ['smart', 'original', 'auto', '', null, undefined, 42])
        assert.equal(Router.normalizePlaybackRuleMode(value), 'smart', JSON.stringify(value));
});

/* ===== 6. Changement de policy et cache ===== */

test('changer de policy matérielle vide le cache de négociation', () => {
    const { Router, bodies } = loadRouter(MEDIA);
    const ctx = () => ({ serverUrl: SERVER, accessToken: 'TOK', itemId: 'IT1', userId: 'U1', startMs: 0 });

    Router.setDeviceMode('revolution');
    Router.negotiatePlayback(ctx(), () => {}, () => {});
    Router.setDeviceMode('devialet');
    Router.negotiatePlayback(ctx(), () => {}, () => {});

    assert.equal(bodies.length, 2, 'la seconde négociation ne doit pas être servie par le cache');
    assert.equal(bodies[0].DeviceProfile.Name, 'Freebox-Revolution');
    assert.equal(bodies[1].DeviceProfile.Name, 'Freebox-Devialet');
});

test('revenir à un modèle inconnu désinstalle la policy matérielle précédente', () => {
    // Seul le Core peut retirer sa policy : Revolution et Devialet ne savent
    // qu'installer la leur. Sans désinstallation, un repli sur le Core neutre
    // continuerait d'envoyer le DeviceProfile du matériel précédent.
    const { Router, bodies } = loadRouter(MEDIA);
    const ctx = () => ({ serverUrl: SERVER, accessToken: 'TOK', itemId: 'IT1', userId: 'U1', startMs: 0 });

    Router.setDeviceMode('revolution');
    Router.negotiatePlayback(ctx(), () => {}, () => {});
    Router.setDeviceMode('modele-inconnu');
    Router.negotiatePlayback(ctx(), () => {}, () => {});

    assert.equal(bodies.length, 2, 'le changement de policy vide aussi le cache');
    assert.equal(bodies[0].DeviceProfile.Name, 'Freebox-Revolution');
    assert.equal(bodies[1].DeviceProfile.Name, 'Freebox-Qt5');

    // Et le chemin de câblage fbx donne le même résultat.
    Router.setDeviceMode('devialet');
    Router.setFbx({});
    Router.setDeviceMode('core');
    Router.negotiatePlayback(ctx(), () => {}, () => {});
    assert.equal(bodies[bodies.length - 1].DeviceProfile.Name, 'Freebox-Qt5');
});

/* ===== 7. Bugs suspectés (non figés) ===== */

test('la Révolution doit pouvoir recevoir un ASS/SSA embarqué par le serveur',
    { todo: 'ass/ssa manquent des SubtitleProfiles Révolution alors que le Core demande SubtitleMethod=Embed' }, () => {
        // Le Core construit SubtitleStreamIndex=<n>&SubtitleMethod=Embed pour
        // toute piste texte choisie, y compris ASS ; le profil envoyé à
        // Jellyfin ne déclare pourtant que srt/subrip/vtt/webvtt en Embed.
        const methods = subtitleMethods(profileFor('revolution'));
        assert.deepEqual(methods.ass, ['Embed']);
        assert.deepEqual(methods.ssa, ['Embed']);
    });
