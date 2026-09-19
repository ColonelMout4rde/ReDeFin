'use strict';

/*
 * Harnais de négociation de lecture partagé par les tests Node.
 *
 * Il rejoue une négociation COMPLÈTE (JellyfinPlaybackRouter -> policy
 * matérielle -> JellyfinPlaybackCore -> JellyfinPlaybackCoreUrl) en
 * remplaçant le seul transport HTTP de jellyfinBridge.js par une réponse
 * /PlaybackInfo figée. Cela permet d'observer à la fois le CORPS envoyé au
 * serveur (profil d'appareil compris) et l'URL finale réellement donnée à
 * QtMultimedia, sans réseau ni runtime Qt.
 *
 * Utilisé par audiooutputnegotiation.test.js et forcedsubtitlecarry.test.js.
 */

const assert = require('node:assert/strict');
const { loadQmlJs } = require('./qmljs');

const SERVER = 'http://192.168.51.42:8096';

/** Découpe la query d'une URL en objet { clé: valeur } décodé. */
function params(url) {
    const out = {};
    const q = url.indexOf('?');
    if (q < 0) return out;
    for (const part of url.substring(q + 1).split('&')) {
        const eq = part.indexOf('=');
        if (eq < 0) continue;
        out[decodeURIComponent(part.substring(0, eq))] = decodeURIComponent(part.substring(eq + 1));
    }
    return out;
}

/**
 * Charge un routeur NEUF, transport HTTP remplacé par la réponse figée.
 *
 * Un routeur neuf par négociation est indispensable : le Core garde un cache
 * de négociation (clé + résultat) au niveau module, qu'il ne faut pas partager
 * entre deux cas de test.
 *
 * @param {object} src MediaSource renvoyée par /PlaybackInfo.
 * @param {object} [options] stubs : globales injectées dans tous les modules
 *        (par exemple { console: { log } } pour capturer les traces DevLog).
 * @returns {{Router: object, bodies: object[]}} Le routeur et la liste des
 *          corps POST /PlaybackInfo observés, dans l'ordre.
 */
function loadRouter(src, options) {
    const opts = options || {};
    const Router = loadQmlJs('qml/js/JellyfinPlaybackRouter.js',
        opts.stubs ? { stubs: opts.stubs } : undefined);
    const bridge = Router.JFCore.CoreUrl.JellyfinBridge;
    const bodies = [];

    bridge.sendRequestNoCache = (method, url, headers, payload, onSuccess) => {
        bodies.push(JSON.parse(payload));
        onSuccess({ json: { PlaySessionId: 'PS1', MediaSources: [src] } });
        return null;
    };

    return { Router, bodies };
}

/**
 * Joue une négociation et retourne l'URL finale, ses paramètres, le corps
 * PlaybackInfo et le résultat brut du Core.
 *
 * @param {string} backend 'revolution' | 'devialet' | 'core'
 * @param {object} src MediaSource figée.
 * @param {object} [extra] Champs ajoutés au contexte de négociation.
 * @param {string} [audioOutputMode] Réglage « Sortie audio », absent si undefined.
 * @param {object} [options] stubs (voir loadRouter) et playbackRuleMode
 *        ('smart' | 'directplay'). Le routeur écrase ctx.playbackRuleMode
 *        avec son propre état : le mode « Original » se règle donc ici, pas
 *        dans extra.
 */
function negotiate(backend, src, extra, audioOutputMode, options) {
    const opts = options || {};
    const { Router, bodies } = loadRouter(src, opts);

    Router.setDeviceMode(backend);
    if (opts.playbackRuleMode !== undefined) Router.setPlaybackRuleMode(opts.playbackRuleMode);

    const ctx = Object.assign({
        serverUrl: SERVER, accessToken: 'TOK',
        itemId: 'IT1', userId: 'U1', startMs: 0,
    }, extra || {});
    if (audioOutputMode !== undefined) ctx.audioOutputMode = audioOutputMode;

    let result = null;
    let error = null;
    Router.negotiatePlayback(ctx, (res) => { result = res; }, (err) => { error = err; });
    assert.equal(error, null, 'la négociation ne doit pas échouer : ' + error);
    assert.ok(result && result.url, 'une URL de lecture est attendue');

    return {
        url: String(result.url),
        params: params(String(result.url)),
        body: bodies.length ? bodies[bodies.length - 1] : null,
        finalUrlKind: String(result.finalUrlKind),
        stereoDownmix: result.audioOutputStereoDownmix === true,
        sourceChannels: Number(result.audioOutputSourceChannels),
        mode: String(result.audioOutputMode),
        result,
    };
}

module.exports = { SERVER, params, negotiate, loadRouter };
