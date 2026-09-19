'use strict';

/*
 * Sous-titres texte locaux : routage, chargement, découpage en cues et
 * horloge d'affichage.
 *
 * Contrat ReDeFin : l'overlay QML local n'est utilisé que sur un DirectPlay
 * PUR. Dès que le flux est reconstruit par le serveur (remux, transcodage,
 * HLS, base temporelle), les sous-titres redeviennent l'affaire de Jellyfin,
 * sinon une horloge locale se superpose à un flux déjà resynchronisé et les
 * cues dérivent de plusieurs minutes.
 *
 * Le parseur SRT/VTT est le seul code du dépôt qui transforme du texte
 * serveur arbitraire en millisecondes : il doit ignorer ce qu'il ne comprend
 * pas plutôt que produire des cues faussées, et ne jamais planter le lecteur.
 */

const test = require('node:test');
const assert = require('node:assert');

const { H, makeRoot } = require('./playerharness');

/* ===================== routage local / serveur ===================== */

test('routage : seul un DirectPlay pur autorise l\'overlay local', () => {
    assert.strictEqual(H.isPureDirectPlay({}), true);
    assert.strictEqual(H.isPureDirectPlay({ isHls: true }), false);
    assert.strictEqual(H.isPureDirectPlay({ lastUsedTranscoding: true }), false);
    assert.strictEqual(H.isPureDirectPlay({ lastUsedDirectStream: true }), false);
    assert.strictEqual(H.isPureDirectPlay({ lastUsedServerRemux: true }), false);
    assert.strictEqual(H.isPureDirectPlay({ serverTimedStream: true }), false);
    assert.strictEqual(H.isPureDirectPlay({ timeShifted: true }), false);
});

test('routage : une base temporelle serveur interdit l\'overlay local', () => {
    // Même sans aucun drapeau de mode, un offset non nul signifie que le flux
    // ne commence pas au début du fichier : l'horloge locale serait fausse.
    assert.strictEqual(H.isPureDirectPlay({ baseOffsetMs: 1 }), false);
    assert.strictEqual(H.isPureDirectPlay({ baseOffsetMs: 0 }), true);
});

test('routage : le choix d\'une piste audio serveur ne suffit pas à quitter le DirectPlay', () => {
    // isDsLike() en tient compte, isPureDirectPlay() volontairement pas :
    // c'est le mode réellement appliqué qui décide.
    assert.strictEqual(H.isPureDirectPlay({ selectedAudioStream: 2 }), true);
    assert.strictEqual(H.isDsLike({ selectedAudioStream: 2 }), true);
});

/* ===================== parsing SRT ===================== */

test('SRT : numéro, horodatage à la virgule et texte multi-lignes', () => {
    const cues = H.parseSrt(
        '1\r\n00:00:01,500 --> 00:00:03,250\r\nBonjour\r\nle monde\r\n\r\n' +
        '2\r\n00:01:00,000 --> 00:01:02,000\r\nSuite\r\n');

    assert.strictEqual(cues.length, 2);
    assert.strictEqual(cues[0].s, 1500);
    assert.strictEqual(cues[0].e, 3250);
    assert.strictEqual(cues[0].t, 'Bonjour\nle monde');
    assert.strictEqual(cues[1].s, 60000);
});

test('SRT : les blocs mal formés sont ignorés, pas le fichier entier', () => {
    const cues = H.parseSrt(
        '1\n00:00:01,000 --> 00:00:02,000\nOk\n\n' +
        '2\nhorodatage cassé\nPerdu\n\n' +
        '3\n00:00:05,000 --> 00:00:06,000\nOk2\n');

    // Le bloc cassé disparaît entièrement ; les cues valides qui l'entourent
    // restent lisibles et correctement datées.
    assert.strictEqual(cues.length, 2);
    assert.strictEqual(cues[0].t + '@' + cues[0].s, 'Ok@1000');
    assert.strictEqual(cues[1].t + '@' + cues[1].s, 'Ok2@5000');
});

test('SRT : une fin antérieure au début est rejetée', () => {
    assert.strictEqual(H.parseSrt('1\n00:00:05,000 --> 00:00:01,000\nInverse\n').length, 0);
});

test('SRT : entrées vides et unicode', () => {
    assert.strictEqual(H.parseSrt('').length, 0);
    assert.strictEqual(H.parseSrt(null).length, 0);
    assert.strictEqual(H.parseSrt(undefined).length, 0);

    const cues = H.parseSrt('1\n00:00:01,000 --> 00:00:02,000\n— Où ça ? « Là-bas » 😀\n');
    assert.strictEqual(cues[0].t, '— Où ça ? « Là-bas » 😀');
});

/* ===================== parsing VTT ===================== */

test('VTT : en-tête, BOM, blocs NOTE et identifiants de cue', () => {
    const cues = H.parseVtt(
        '﻿WEBVTT - test\n\n' +
        'NOTE ceci est un commentaire\n\n' +
        'cue-1\n00:00:01.500 --> 00:00:03.000\nBonjour\n\n' +
        '00:00:04.000 --> 00:00:05.000\nSans identifiant\n');

    assert.strictEqual(cues.length, 2);
    assert.strictEqual(cues[0].s, 1500);
    assert.strictEqual(cues[0].t, 'Bonjour');
    assert.strictEqual(cues[1].t, 'Sans identifiant');
});

test('VTT : horodatage sans heures et réglages de position ignorés', () => {
    const cues = H.parseVtt('WEBVTT\n\n01:02.250 --> 01:03.500 line:90% align:middle\nTexte\n');
    assert.strictEqual(cues.length, 1);
    assert.strictEqual(cues[0].s, 62250);
    assert.strictEqual(cues[0].e, 63500);
});

test('VTT : fractions courtes ou longues normalisées en millisecondes', () => {
    const cues = H.parseVtt('WEBVTT\n\n00:00:01.5 --> 00:00:02.1234\nX\n');
    assert.strictEqual(cues[0].s, 1500, '.5 = 500 ms');
    assert.strictEqual(cues[0].e, 2123, 'tronqué à la milliseconde');
});

test('VTT : un contenu sans aucune cue exploitable renvoie une liste vide', () => {
    assert.strictEqual(H.parseVtt('WEBVTT\n\nNOTE rien\n\nSTYLE\n::cue { color: red }\n').length, 0);
    assert.strictEqual(H.parseVtt('<html>404</html>').length, 0);
});

/* ===================== URL de sous-titre ===================== */

function parseUrl(url) {
    const q = url.indexOf('?');
    const out = { path: q < 0 ? url : url.substring(0, q), params: {} };
    if (q >= 0) {
        for (const part of url.substring(q + 1).split('&')) {
            const eq = part.indexOf('=');
            out.params[decodeURIComponent(part.substring(0, eq))] = decodeURIComponent(part.substring(eq + 1));
        }
    }
    return out;
}

test('URL : route canonique Jellyfin avec StartPositionTicks, même à zéro', () => {
    const u = parseUrl(H.buildSubtitleFileUrl('http://jellyfin.test:8096/', 'item 1', 'src/1', 3, 'vtt', {}));
    assert.strictEqual(u.path, 'http://jellyfin.test:8096/Videos/item%201/src%2F1/Subtitles/3/0/Stream.vtt');
    assert.deepStrictEqual(u.params, {}, 'aucun paramètre superflu à la position zéro');
});

test('URL : une position de départ ajoute les options de timestamps', () => {
    const u = parseUrl(H.buildSubtitleFileUrl('http://jellyfin.test:8096', 'it', 'src', 2, 'srt', {
        startPositionTicks: 600000000,     // 60 s
        copyTimestamps: true,
    }));
    assert.ok(u.path.endsWith('/Subtitles/2/600000000/Stream.srt'), u.path);
    assert.strictEqual(u.params.copyTimestamps, 'true');
    assert.strictEqual(u.params.addVttTimeMap, 'false');
});

test('URL : le jeton n\'est jamais placé dans la query', () => {
    const url = H.buildSubtitleFileUrl('http://jellyfin.test:8096', 'it', 'src', 1, 'vtt',
                                       { accessToken: 'tok-TEST', startPositionTicks: 10000000 });
    assert.strictEqual(/api_key|ApiKey|Token/i.test(url), false, url);
});

/* ===================== chargement d'une piste ===================== */

function loader(responses, options) {
    const requests = [];
    const opts = Object.assign({
        // Contrat de loadLocalSubtitleByStreamIndex() : le jeton doit AUSSI
        // être présent dans les options, l'argument accessToken ne sert qu'à
        // valider le contexte.
        accessToken: 'tok-TEST',
        headersWithTokenFn: (token) => ({ Authorization: 'MediaBrowser Token="' + token + '"' }),
        requestFn(method, url, headers, payload, onSuccess, onError) {
            requests.push({ url, headers });
            const answer = responses.shift();
            if (!answer) { onError({ code: 'http_404' }); return { cancel() { return true; } }; }
            if (answer.error) onError(answer.error);
            else onSuccess({ status: 200, text: answer.text });
            return { cancel() { return true; } };
        },
    }, options || {});
    return { requests, opts };
}

test('chargement : VTT réussi -> cues et format renvoyés', () => {
    const { requests, opts } = loader([{ text: 'WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nSalut\n' }]);
    const seen = [];
    H.loadLocalSubtitleByStreamIndex('http://jellyfin.test:8096', 'tok-TEST', 'it', 'src', 4,
                                     (ok, payload) => seen.push([ok, payload]), opts);

    assert.strictEqual(seen.length, 1);
    assert.strictEqual(seen[0][0], true);
    assert.strictEqual(seen[0][1].format, 'vtt');
    assert.strictEqual(seen[0][1].cues.length, 1);
    assert.strictEqual(requests.length, 1);
    assert.ok(/MediaBrowser Token="tok-TEST"/.test(requests[0].headers.Authorization));
});

test('chargement : un VTT vide ou en erreur bascule sur le SRT', () => {
    const empty = loader([{ text: 'WEBVTT\n\n' },
                          { text: '1\n00:00:01,000 --> 00:00:02,000\nSalut\n' }]);
    const seen = [];
    H.loadLocalSubtitleByStreamIndex('http://jellyfin.test:8096', 'tok-TEST', 'it', 'src', 4,
                                     (ok, payload) => seen.push([ok, payload]), empty.opts);

    assert.strictEqual(seen[0][0], true);
    assert.strictEqual(seen[0][1].format, 'srt');
    assert.strictEqual(empty.requests.length, 2);
    assert.ok(empty.requests[0].url.endsWith('.vtt'));
    assert.ok(empty.requests[1].url.endsWith('.srt'));
});

test('chargement : les deux formats en échec -> code d\'erreur, jamais d\'exception', () => {
    const { opts } = loader([{ error: { code: 'http_404' } }, { error: { code: 'http_404' } }]);
    const seen = [];
    H.loadLocalSubtitleByStreamIndex('http://jellyfin.test:8096', 'tok-TEST', 'it', 'src', 4,
                                     (ok, payload) => seen.push([ok, payload]), opts);
    assert.strictEqual(seen[0][0], false);
    assert.strictEqual(typeof seen[0][1], 'string');
});

test('chargement : contexte incomplet -> échec immédiat « ctx », sans requête', () => {
    const { requests, opts } = loader([]);
    const seen = [];
    H.loadLocalSubtitleByStreamIndex('', 'tok-TEST', 'it', 'src', 4, (ok, p) => seen.push([ok, p]), opts);
    H.loadLocalSubtitleByStreamIndex('http://jellyfin.test:8096', '', 'it', 'src', 4, (ok, p) => seen.push([ok, p]), opts);

    assert.deepStrictEqual(seen, [[false, 'ctx'], [false, 'ctx']]);
    assert.strictEqual(requests.length, 0);
});

test('chargement : sans en-tête d\'autorisation, le jeton ne part jamais en query', () => {
    const { requests, opts } = loader([{ text: 'WEBVTT\n' }], { headersWithTokenFn: null });
    const seen = [];
    H.loadLocalSubtitleByStreamIndex('http://jellyfin.test:8096', 'tok-TEST', 'it', 'src', 4,
                                     (ok, p) => seen.push([ok, p]), opts);

    assert.strictEqual(requests.length, 0, 'aucune requête non authentifiée');
    assert.strictEqual(seen[0][0], false);
});

test('chargement : annuler avant la réponse empêche tout rappel', () => {
    let deliver = null;
    const controller = H.loadLocalSubtitleByStreamIndex(
        'http://jellyfin.test:8096', 'tok-TEST', 'it', 'src', 4,
        () => { throw new Error('ne doit pas être appelé'); },
        {
            headersWithTokenFn: () => ({ Authorization: 'x' }),
            requestFn(m, u, h, p, onSuccess) {
                deliver = () => onSuccess({ status: 200, text: 'WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nX\n' });
                return { cancel() { return true; } };
            },
        });

    assert.strictEqual(controller.isActive(), true);
    assert.strictEqual(controller.cancel('test'), true);
    assert.strictEqual(controller.isActive(), false);
    deliver();                       // réponse tardive : ignorée
    assert.strictEqual(controller.cancel('test'), false, 'annulation idempotente');
});

/* ===================== horloge de l'overlay ===================== */

test('horloge : sans cues locales, seul un push forcé met l\'horloge à jour', () => {
    const item = { uiMs: -1 };
    const root = makeRoot({ useLocalSubs: false, localCues: [], _lastSubsUiPushMs: -1 });

    H.pushLocalSubsUiMs(root, item, 5000, false);
    assert.strictEqual(item.uiMs, -1);

    H.pushLocalSubsUiMs(root, item, 5000, true);
    assert.strictEqual(item.uiMs, 5000);
});

test('horloge : les petites variations sont filtrées, les sauts passent', () => {
    const item = { uiMs: 0 };
    const root = makeRoot({
        useLocalSubs: true,
        localCues: [{ s: 0, e: 1000, t: 'x' }],
        _lastSubsUiPushMs: -1,
        subsUiPushMinDeltaMs: 120,
    });

    H.pushLocalSubsUiMs(root, item, 1000, false);
    assert.strictEqual(item.uiMs, 1000, 'premier push toujours accepté');

    H.pushLocalSubsUiMs(root, item, 1050, false);
    assert.strictEqual(item.uiMs, 1000, 'variation sous le seuil ignorée');

    H.pushLocalSubsUiMs(root, item, 1200, false);
    assert.strictEqual(item.uiMs, 1200);

    H.pushLocalSubsUiMs(root, item, 1210, true);
    assert.strictEqual(item.uiMs, 1210, 'un push forcé passe toujours');
});

test('horloge : une position négative est ramenée à zéro', () => {
    const item = { uiMs: -1 };
    const root = makeRoot({ useLocalSubs: true, localCues: [{ s: 0, e: 1, t: 'x' }], _lastSubsUiPushMs: -1 });
    H.pushLocalSubsUiMs(root, item, -500, true);
    assert.strictEqual(item.uiMs, 0);
});

test('désactivation : cues vidées, requête annulée, overlay éteint', () => {
    let cancelled = false;
    const item = { cues: [{ s: 0, e: 1, t: 'x' }], enabled: true };
    const root = makeRoot({
        useLocalSubs: true,
        localCues: [{ s: 0, e: 1, t: 'x' }],
        localSubStreamIndex: 3,
        _localSubtitleRequestHandle: { cancel() { cancelled = true; return true; } },
    });

    H.disableLocalSubsOverlay(root, item, null, null);

    assert.strictEqual(root.useLocalSubs, false);
    assert.strictEqual(root.localCues.length, 0);
    assert.strictEqual(root.localSubStreamIndex, -1);
    assert.strictEqual(root._lastSubsUiPushMs, -1);
    assert.strictEqual(item.cues.length, 0);
    assert.strictEqual(item.enabled, false);
    assert.strictEqual(cancelled, true);
    assert.strictEqual(root._localSubtitleRequestHandle, null);
});
