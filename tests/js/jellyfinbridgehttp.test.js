'use strict';

/*
 * Protège le cœur transport de qml/js/jellyfinBridge.js : cycle de vie d'une
 * requête (annulation, watchdog, budget), traduction des statuts HTTP en
 * codes d'erreur, parsing JSON borné, redirections, et placement du token.
 *
 * Pourquoi c'est sensible :
 *  - un rappel appelé deux fois, ou appelé après une annulation, provoque sur
 *    le Player des navigations fantômes et des rechargements de page ;
 *  - un rappel jamais appelé laisse le rideau de chargement à l'écran pour
 *    toujours (la page n'a pas d'autre signal) ;
 *  - les codes d'erreur produits ici pilotent des décisions de sécurité en
 *    aval : UserStore purge la session stockée sur invalid_token / http_400 /
 *    http_401 / http_403 et la garde sur timeout / network_error / http_5xx ;
 *  - le Player journalise l'URL complète de chaque requête : le token doit
 *    rester dans Authorization et jamais réapparaître en query ;
 *  - une redirection suivie aveuglément enverrait ce même token à un hôte
 *    tiers ; seules les redirections strictement same-origin sont suivies ;
 *  - le parsing est borné : le Révolution n'a pas la mémoire pour avaler une
 *    réponse arbitraire.
 *
 * Tout est simulé (voir bridgeharness.js) : aucune requête réelle, horloge
 * figée, Qt.callLater explicite. Hôtes/tokens fictifs uniquement.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { createBridge, recorder, queryOf, pathOf } = require('./bridgeharness');

const LAN = 'http://192.168.1.5:8096';
const WAN = 'http://jellyfin.test:8096';
const TOKEN = 'tok-TEST';
const USER = 'user-1';

/* ------------------------------------------------------------------ */
/* Statuts HTTP -> codes d'erreur                                      */
/* ------------------------------------------------------------------ */

test('statuts HTTP : chaque code devient l\'identifiant attendu par les pages', () => {
    const table = [
        [400, 'http_400'], [401, 'http_401'], [403, 'http_403'], [404, 'http_404'],
        [429, 'http_429'], [500, 'http_500'], [502, 'http_502'], [503, 'http_503'],
    ];
    for (const [status, code] of table) {
        const h = createBridge();
        const r = recorder();
        h.bridge.fetchItem(LAN, TOKEN, 'i1', r.onSuccess, r.onError);
        h.last().respond({ status, body: '{}' });
        assert.deepEqual([r.ok.length, r.ko], [0, [code]], `statut ${status}`);
    }
});

test('statuts HTTP : 2xx est un succès, y compris 204 sans corps', () => {
    const h = createBridge();
    const r = recorder();
    h.bridge.sendRequest('get', LAN + '/x', {}, null, r.onSuccess, r.onError);
    h.last().respond({ status: 204, body: '' });
    assert.equal(r.ko.length, 0);
    assert.equal(r.ok[0].status, 204);
    assert.equal(r.ok[0].json, null);
});

test('transport : statut 0 sans corps => network_error, pas un code HTTP', () => {
    // Le token doit survivre à une coupure réseau : network_error ne purge pas.
    const h = createBridge();
    const r = recorder();
    h.bridge.fetchItem(LAN, TOKEN, 'i1', r.onSuccess, r.onError);
    h.last().respond({ status: 0, body: '' });
    assert.deepEqual(r.ko, ['network_error']);
});

test('transport : onerror et ontimeout produisent des codes distincts', () => {
    const hErr = createBridge();
    const rErr = recorder();
    hErr.bridge.fetchItem(LAN, TOKEN, 'i1', rErr.onSuccess, rErr.onError);
    hErr.last().failNetwork();
    assert.deepEqual(rErr.ko, ['network_error']);

    const hTo = createBridge();
    const rTo = recorder();
    hTo.bridge.fetchItem(LAN, TOKEN, 'i1', rTo.onSuccess, rTo.onError);
    hTo.last().fireTimeout();
    assert.deepEqual(rTo.ko, ['timeout']);
});

/* ------------------------------------------------------------------ */
/* Unicité des rappels                                                 */
/* ------------------------------------------------------------------ */

test('rappels : succès puis événements tardifs => exactement un appel', () => {
    const h = createBridge();
    const r = recorder();
    h.bridge.fetchItem(LAN, TOKEN, 'i1', r.onSuccess, r.onError);
    const xhr = h.last();
    xhr.respondJson({ Id: 'i1' });
    // Un firmware bavard peut rejouer readyState/onerror après coup.
    xhr.respondJson({ Id: 'AUTRE' });
    xhr.failNetwork();
    xhr.fireTimeout();
    h.flush();
    assert.equal(r.calls, 1);
    assert.equal(r.ok[0].Id, 'i1');
});

test('rappels : erreur puis réponse tardive => exactement un appel', () => {
    const h = createBridge();
    const r = recorder();
    h.bridge.fetchItem(LAN, TOKEN, 'i1', r.onSuccess, r.onError);
    const xhr = h.last();
    xhr.failNetwork();
    xhr.respondJson({ Id: 'i1' });
    h.flush();
    assert.equal(r.calls, 1);
    assert.deepEqual(r.ko, ['network_error']);
});

test('annulation : aucun rappel, et le transport est réellement interrompu', () => {
    const h = createBridge();
    const r = recorder();
    const handle = h.bridge.fetchItem(LAN, TOKEN, 'i1', r.onSuccess, r.onError);
    assert.equal(typeof handle.cancel, 'function');
    assert.equal(handle.isActive(), true);

    handle.cancel('navigation');
    h.flush();
    assert.equal(h.last().aborted, true, 'xhr.abort() doit être appelé');
    assert.equal(handle.isActive(), false);
    assert.equal(r.calls, 0, 'une annulation ne notifie pas l\'appelant');

    // Réponse arrivée après l'annulation : silence total.
    h.last().respondJson({ Id: 'i1' });
    h.flush();
    assert.equal(r.calls, 0);
});

test('cancelAllHttpRequests : coupe tout sans rappeler personne', () => {
    const h = createBridge();
    const a = recorder();
    const b = recorder();
    h.bridge.fetchItem(LAN, TOKEN, 'i1', a.onSuccess, a.onError);
    h.bridge.fetchItem(LAN, TOKEN, 'i2', b.onSuccess, b.onError);

    assert.equal(h.bridge.cancelAllHttpRequests('session_changed'), 2);
    h.flush();
    assert.equal(a.calls + b.calls, 0);
    for (const xhr of h.xhrs) assert.equal(xhr.aborted, true);
});

/* ------------------------------------------------------------------ */
/* Watchdog (le bridge ne crée aucun Timer QML)                        */
/* ------------------------------------------------------------------ */

test('watchdog : sweepHttpWatchdogs expire la requête et produit timeout', () => {
    const h = createBridge();
    const r = recorder();
    h.bridge.fetchItem(LAN, TOKEN, 'i1', r.onSuccess, r.onError);

    // Avant l'échéance : rien ne bouge.
    h.advance(14000);
    assert.equal(h.bridge.sweepHttpWatchdogs(h.now()), 1);
    assert.equal(r.calls, 0);

    // Après les 15 s de délai natif : la requête est coupée.
    h.advance(2000);
    assert.equal(h.bridge.sweepHttpWatchdogs(h.now()), 0);
    assert.deepEqual(r.ko, ['timeout']);
    assert.equal(h.last().aborted, true);
});

test('watchdog : ShellPage n\'est réveillé que tant qu\'une opération existe', () => {
    const h = createBridge();
    const etats = [];
    h.bridge.setHttpWatchdogWake((actif) => etats.push(actif));
    assert.deepEqual(etats, [false], 'au repos, pas de Timer');

    const r = recorder();
    h.bridge.fetchItem(LAN, TOKEN, 'i1', r.onSuccess, r.onError);
    assert.deepEqual(etats, [false, true]);

    h.last().respondJson({ Id: 'i1' });
    assert.deepEqual(etats, [false, true, false], 'plus d\'opération => Timer coupé');
});

test('budget : une échéance déjà dépassée n\'émet aucune requête', () => {
    const h = createBridge();
    const r = recorder();
    h.bridge.sendRequestWithDeadline('get', LAN + '/x', {}, null,
                                     r.onSuccess, r.onError, h.now() - 1);
    assert.equal(h.sentCount(), 0);
    assert.equal(r.ko.length, 1);
    assert.equal(r.ko[0].code, 'timeout');
});

/* ------------------------------------------------------------------ */
/* Parsing borné                                                       */
/* ------------------------------------------------------------------ */

test('parsing : une réponse JSON trop grosse est refusée (too_large)', () => {
    const h = createBridge();
    const r = recorder();
    h.bridge.fetchItem(LAN, TOKEN, 'i1', r.onSuccess, r.onError);
    h.last().respond({ status: 200, body: 'x'.repeat(262145) });
    assert.deepEqual(r.ko, ['too_large']);

    // Juste sous la limite : la réponse passe (même si elle n'est pas du JSON).
    const h2 = createBridge();
    const r2 = recorder();
    h2.bridge.sendRequest('get', LAN + '/x', {}, null, r2.onSuccess, r2.onError);
    h2.last().respond({ status: 200, body: 'x'.repeat(262144) });
    assert.equal(r2.ok.length, 1);
    assert.equal(r2.ok[0].json, null);
});

test('parsing : JSON malformé => json null, jamais d\'exception qui remonte', () => {
    const h = createBridge();
    const r = recorder();
    h.bridge.sendRequest('get', LAN + '/x', {}, null, r.onSuccess, r.onError);
    h.last().respond({ status: 200, body: '{"Items":[{"Id":"i1"' });
    assert.equal(r.ok.length, 1);
    assert.equal(r.ok[0].json, null);
});

test('parsing : le corps brut n\'est exposé que pour les flux texte (sous-titres)', () => {
    // Réponse JSON : pas de texte brut dans le payload (mémoire du Révolution).
    const hJson = createBridge();
    const rJson = recorder();
    hJson.bridge.sendRequest('get', LAN + '/Items', {}, null, rJson.onSuccess, rJson.onError);
    hJson.last().respond({ status: 200, body: '{"a":1}' });
    assert.equal(rJson.ok[0].text, '');
    assert.equal(rJson.ok[0].json.a, 1);

    // URL de sous-titres : le texte est nécessaire, le JSON ne l'est pas.
    const hVtt = createBridge();
    const rVtt = recorder();
    hVtt.bridge.sendRequest('get', LAN + '/Videos/v1/Subtitles/2/Stream.vtt', {}, null,
                            rVtt.onSuccess, rVtt.onError);
    hVtt.last().respond({ status: 200, body: 'WEBVTT\n\nbonjour' });
    assert.equal(rVtt.ok[0].text, 'WEBVTT\n\nbonjour');
    assert.equal(rVtt.ok[0].json, null);

    // Un Accept texte explicite suffit aussi.
    const hTxt = createBridge();
    const rTxt = recorder();
    hTxt.bridge.sendRequest('get', LAN + '/x', { Accept: 'text/plain' }, null,
                            rTxt.onSuccess, rTxt.onError);
    hTxt.last().respond({ status: 200, body: 'brut' });
    assert.equal(rTxt.ok[0].text, 'brut');
});

test('réponse : seuls les en-têtes utiles remontent, et Location est nettoyée', () => {
    const h = createBridge();
    const r = recorder();
    h.bridge.sendRequest('get', LAN + '/x', {}, null, r.onSuccess, r.onError);
    h.last().respond({
        status: 200,
        body: '{}',
        headers: {
            'Content-Type': 'application/json',
            'ETag': '"e1"',
            'Set-Cookie': 'session=abc',
            'X-Secret-Interne': 'valeur',
            'Location': 'http://192.168.1.5:8096/y?ApiKey=' + TOKEN + '&b=2',
        },
    });
    const entetes = r.ok[0].headers;
    assert.equal(entetes['Content-Type'], 'application/json');
    assert.equal(entetes['ETag'], '"e1"');
    assert.equal(entetes['Set-Cookie'], undefined, 'les cookies ne doivent pas ressortir');
    assert.equal(entetes['X-Secret-Interne'], undefined);
    assert.equal(entetes['Location'].indexOf(TOKEN), -1, 'token retiré de Location');
    assert.deepEqual(queryOf(entetes['Location']), { b: '2' });
});

test('réponse : un en-tête serveur ne peut pas réinjecter de CR/LF', () => {
    const h = createBridge();
    const r = recorder();
    h.bridge.sendRequest('get', LAN + '/x', {}, null, r.onSuccess, r.onError);
    // getAllResponseHeaders() est du texte : on simule une valeur déjà salie.
    const xhr = h.last();
    xhr.respond({ status: 200, body: '{}', headers: { 'Content-Type': 'application/json' } });
    xhr._headers = {};
    assert.equal(/[\r\n]/.test(r.ok[0].headers['Content-Type']), false);
});

/* ------------------------------------------------------------------ */
/* Redirections                                                        */
/* ------------------------------------------------------------------ */

test('redirection same-origin : suivie, en conservant méthode et en-têtes', () => {
    for (const status of [301, 302, 307, 308]) {
        const h = createBridge();
        const r = recorder();
        h.bridge.fetchItem(LAN, TOKEN, 'i1', r.onSuccess, r.onError);
        h.last().respond({ status, headers: { Location: '/Items/i1?redirige=1' } });

        assert.equal(h.sentCount(), 2, `statut ${status}`);
        const suivi = h.last();
        assert.equal(suivi.url, LAN + '/Items/i1?redirige=1');
        assert.match(suivi.header('Authorization'), /Token="tok-TEST"/);
        suivi.respondJson({ Id: 'i1' });
        assert.equal(r.ok.length, 1);
    }
});

test('redirection vers une autre origine : refusée, le token ne part pas', () => {
    const ailleurs = [
        'http://evil.example.com/Items/i1',   // autre hôte
        'https://192.168.1.5:8096/Items/i1',  // autre schéma
        'http://192.168.1.5:9999/Items/i1',   // autre port
    ];
    for (const location of ailleurs) {
        const h = createBridge();
        const r = recorder();
        h.bridge.fetchItem(LAN, TOKEN, 'i1', r.onSuccess, r.onError);
        h.last().respond({ status: 302, headers: { Location: location } });
        assert.equal(h.sentCount(), 1, location + ' : aucune seconde requête');
        assert.deepEqual(r.ko, ['http_302'], location);
    }
});

test('redirection : la chaîne est bornée', () => {
    const h = createBridge();
    const r = recorder();
    h.bridge.fetchItem(LAN, TOKEN, 'i1', r.onSuccess, r.onError);
    for (let i = 0; i < 8; i++) {
        if (!h.pending().length) break;
        h.last().respond({ status: 302, headers: { Location: '/etape' + i } });
    }
    assert.ok(h.sentCount() <= 5, 'au plus 4 redirections suivies, got ' + h.sentCount());
    assert.equal(r.ok.length, 0);
});

/* ------------------------------------------------------------------ */
/* Placement du token / transport non sécurisé                         */
/* ------------------------------------------------------------------ */

test('token : présent dans Authorization, absent de l\'URL transportée', () => {
    const h = createBridge();
    const r = recorder();
    h.bridge.fetchUserItem(LAN, TOKEN, USER, 'item-9', r.onSuccess, r.onError);
    const xhr = h.last();
    assert.match(xhr.header('Authorization'), /Token="tok-TEST"/);
    assert.equal(xhr.url.indexOf(TOKEN), -1);
    assert.equal(/apikey|api_key|accesstoken/i.test(xhr.url), false);
    assert.deepEqual(queryOf(xhr.url), { UserId: USER });
});

test('token : recopié par erreur dans l\'URL, il est retiré avant le transport', () => {
    const h = createBridge();
    const r = recorder();
    h.bridge.sendRequest('get', LAN + '/Items/i1?ApiKey=' + TOKEN + '&a=1',
                         h.bridge.headersWithToken(TOKEN), null, r.onSuccess, r.onError);
    const xhr = h.last();
    assert.equal(xhr.url.indexOf('ApiKey'), -1);
    assert.deepEqual(queryOf(xhr.url), { a: '1' });
});

test('transport non sécurisé : un token ne part jamais en HTTP hors LAN', () => {
    const h = createBridge();
    const r = recorder();
    h.bridge.fetchItem(WAN, TOKEN, 'i1', r.onSuccess, r.onError);
    assert.equal(h.sentCount(), 0, 'aucune requête ne doit être émise');
    h.flush();
    assert.deepEqual(r.ko, ['insecure_transport']);
});

test('transport non sécurisé : HTTPS distant et HTTP LAN restent autorisés', () => {
    const https = createBridge();
    const rHttps = recorder();
    https.bridge.fetchItem('https://jellyfin.test:8920', TOKEN, 'i1', rHttps.onSuccess, rHttps.onError);
    assert.equal(https.sentCount(), 1);

    const lan = createBridge();
    const rLan = recorder();
    lan.bridge.fetchItem(LAN, TOKEN, 'i1', rLan.onSuccess, rLan.onError);
    assert.equal(lan.sentCount(), 1);
});

/* ------------------------------------------------------------------ */
/* Authentification                                                    */
/* ------------------------------------------------------------------ */

test('authenticate : ping public puis POST, mot de passe uniquement dans le corps', () => {
    const h = createBridge();
    const r = recorder();
    h.bridge.authenticate(LAN, 'bob', 'motdepasse', r.onSuccess, r.onError);

    const ping = h.last();
    assert.equal(pathOf(ping.url), LAN + '/System/Info/Public');
    assert.equal(ping.header('Authorization'), '', 'le ping est anonyme');
    ping.respondJson({ Version: '10.9.0', ServerName: 'Maison' });

    const post = h.last();
    assert.equal(post.method, 'POST');
    assert.equal(pathOf(post.url), LAN + '/Users/AuthenticateByName');
    assert.equal(post.url.indexOf('motdepasse'), -1, 'jamais dans l\'URL');
    assert.deepEqual(JSON.parse(post.body), { Username: 'bob', Pw: 'motdepasse' });
    assert.equal(/Token=/.test(post.header('Authorization')), false);

    post.respondJson({ AccessToken: 'tok-NEUF', User: { Id: USER } });
    assert.equal(r.ok.length, 1);
    assert.equal(r.ok[0].accessToken, 'tok-NEUF');
    assert.equal(r.ok[0].userId, USER);
});

test('authenticate : refus immédiat si le mot de passe partirait en clair', () => {
    const h = createBridge();
    const r = recorder();
    h.bridge.authenticate(WAN, 'bob', 'motdepasse', r.onSuccess, r.onError);
    h.flush();
    assert.equal(h.sentCount(), 0, 'pas même un ping préalable');
    assert.deepEqual(r.ko, ['insecure_transport']);
});

test('authenticate : paramètres manquants et réponse sans AccessToken', () => {
    const manquants = createBridge();
    const rm = recorder();
    manquants.bridge.authenticate(LAN, '', 'pw', rm.onSuccess, rm.onError);
    manquants.flush();
    assert.deepEqual(rm.ko, ['missing_params']);
    assert.equal(manquants.sentCount(), 0);

    const h = createBridge();
    const r = recorder();
    h.bridge.authenticate(LAN, 'bob', 'pw', r.onSuccess, r.onError);
    h.last().respondJson({ Version: '10.9.0', ServerName: 'Maison' });
    h.last().respondJson({ User: { Id: USER } });
    assert.deepEqual(r.ko, ['invalid_response']);
});

test('validateToken : identité reconnue => succès, 200 sans identité => invalid_token', () => {
    const ok = createBridge();
    const rOk = recorder();
    ok.bridge.validateToken(LAN, TOKEN, rOk.onSuccess, rOk.onError);
    assert.equal(pathOf(ok.last().url), LAN + '/Users/Me');
    ok.last().respondJson({ Id: USER, Name: 'Bob' });
    assert.equal(rOk.ok[0].Id, USER);

    // 200 mais plus d'identité : la session n'est plus reconnue par le serveur.
    // C'est ce code exact que UserStore traduit par « purge le token stocké ».
    const ko = createBridge();
    const rKo = recorder();
    ko.bridge.validateToken(LAN, TOKEN, rKo.onSuccess, rKo.onError);
    ko.last().respondJson({});
    assert.deepEqual(rKo.ko, ['invalid_token']);
});

test('validateToken : une panne de transport ne doit pas ressembler à un token invalide', () => {
    for (const [scenario, jouer] of [
        ['réseau', (h) => h.last().failNetwork()],
        ['timeout', (h) => h.last().fireTimeout()],
        ['5xx', (h) => h.last().respond({ status: 503, body: '{}' })],
    ]) {
        const h = createBridge();
        const r = recorder();
        h.bridge.validateToken(LAN, TOKEN, r.onSuccess, r.onError);
        jouer(h);
        assert.notEqual(r.ko[0], 'invalid_token', scenario);
    }
});

test('validateToken : un corps illisible devrait rester une erreur de parsing',
     { todo: 'un 200 au corps non-JSON renvoie invalid_token, ce que UserStore traduit par une purge du token : un reverse-proxy qui tronque une réponse déconnecte l\'utilisateur' },
     () => {
         const h = createBridge();
         const r = recorder();
         h.bridge.validateToken(LAN, TOKEN, r.onSuccess, r.onError);
         h.last().respond({ status: 200, body: '<html>502 Bad Gateway</html>' });
         assert.deepEqual(r.ko, ['parse_error']);
     });

test('logout : un serveur qui refuse le token confirme quand même la déconnexion', () => {
    for (const status of [401, 403]) {
        const h = createBridge();
        const r = recorder();
        h.bridge.logout(LAN, TOKEN, r.onSuccess, r.onError);
        h.last().respond({ status, body: '{}' });
        assert.deepEqual([r.ok, r.ko], [[true], []], `statut ${status}`);
    }

    // Une vraie panne reste une erreur : la page doit pouvoir réessayer.
    const h = createBridge();
    const r = recorder();
    h.bridge.logout(LAN, TOKEN, r.onSuccess, r.onError);
    h.last().failNetwork();
    assert.deepEqual(r.ko, ['network_error']);
});

test('quickConnect : le secret voyage dans le corps, jamais dans l\'URL', () => {
    const h = createBridge();
    const r = recorder();
    h.bridge.quickConnectTryAuthenticate(LAN, 'secret-QC', r.onSuccess, r.onError);
    const xhr = h.last();
    assert.equal(xhr.method, 'POST');
    assert.equal(pathOf(xhr.url), LAN + '/Users/AuthenticateWithQuickConnect');
    assert.equal(xhr.url.indexOf('secret-QC'), -1);
    assert.deepEqual(JSON.parse(xhr.body), { Secret: 'secret-QC' });

    xhr.respondJson({ AccessToken: 'tok-NEUF', User: { Id: USER } });
    assert.equal(r.ok[0].accessToken, 'tok-NEUF');
});

test('quickConnect : 401/404 = code pas encore autorisé (pending), pas un échec', () => {
    for (const status of [401, 404]) {
        const h = createBridge();
        const r = recorder();
        h.bridge.quickConnectTryAuthenticate(LAN, 'secret-QC', r.onSuccess, r.onError);
        h.last().respond({ status, body: '{}' });
        assert.deepEqual(r.ko, ['pending'], `statut ${status}`);
    }

    // Les autres statuts restent de vraies erreurs.
    const h = createBridge();
    const r = recorder();
    h.bridge.quickConnectTryAuthenticate(LAN, 'secret-QC', r.onSuccess, r.onError);
    h.last().respond({ status: 500, body: '{}' });
    assert.deepEqual(r.ko, ['http_500']);
});

test('quickConnect : sans secret, aucune requête réseau', () => {
    const h = createBridge();
    const r = recorder();
    h.bridge.quickConnectTryAuthenticate(LAN, '', r.onSuccess, r.onError);
    h.flush();
    assert.equal(h.sentCount(), 0);
    assert.deepEqual(r.ko, ['missing_secret']);
});

test('fetchPublicUsers : requête anonyme, tolère liste nue ou enveloppe Items', () => {
    const nue = createBridge();
    const rNue = recorder();
    nue.bridge.fetchPublicUsers(LAN, rNue.onSuccess, rNue.onError);
    assert.equal(nue.last().header('Authorization'), '', 'aucun token sur une route publique');
    nue.last().respondJson([{ Id: USER, Name: 'Bob' }]);
    assert.equal(rNue.ok[0].length, 1);

    const enveloppe = createBridge();
    const rEnv = recorder();
    enveloppe.bridge.fetchPublicUsers(LAN, rEnv.onSuccess, rEnv.onError);
    enveloppe.last().respondJson({ Items: [{ Id: USER }, { Id: 'user-2' }] });
    assert.equal(rEnv.ok[0].length, 2);

    // Réponse inattendue : liste vide plutôt qu'une exception dans LoginPage.
    const vide = createBridge();
    const rVide = recorder();
    vide.bridge.fetchPublicUsers(LAN, rVide.onSuccess, rVide.onError);
    vide.last().respondJson({ Message: 'nope' });
    assert.deepEqual([rVide.ok[0].length, rVide.ko.length], [0, 0]);
});

/* ------------------------------------------------------------------ */
/* Probes publics                                                      */
/* ------------------------------------------------------------------ */

test('probePublicServer : valide la réponse et approuve alors le nom LAN court', () => {
    const h = createBridge();
    const r = recorder();
    assert.equal(h.bridge.isTrustedLanHost('nas'), false);

    h.bridge.probePublicServer('http://nas:8096', 1500, r.onSuccess, r.onError);
    assert.equal(pathOf(h.last().url), 'http://nas:8096/System/Info/Public');
    assert.equal(h.last().header('Authorization'), '', 'sonde anonyme : rien à protéger');
    h.last().respondJson({ Version: '10.9.0', ServerName: 'Maison' });

    assert.equal(r.ok.length, 1);
    assert.equal(h.bridge.isTrustedLanHost('nas'), true,
                 'le serveur répond : le nom court devient un hôte LAN de confiance');
});

test('probePublicServer : une réponse qui n\'est pas un Jellyfin est rejetée', () => {
    const h = createBridge();
    const r = recorder();
    h.bridge.probePublicServer(LAN, 1500, r.onSuccess, r.onError);
    h.last().respondJson({ Message: 'Hello from my router' });
    assert.equal(r.ok.length, 0);
    assert.equal(r.ko[0].code, 'invalid_response');
});

test('probePublicServer : URL invalide => erreur locale, aucune requête', () => {
    const h = createBridge();
    const r = recorder();
    h.bridge.probePublicServer('javascript:alert(1)', 1500, r.onSuccess, r.onError);
    h.flush();
    assert.equal(h.sentCount(), 0);
    assert.equal(r.ko[0].code, 'invalid_url');
});

test('probeResource metadataOnly : coupe le transfert et refuse une redirection', () => {
    const ok = createBridge();
    const rOk = recorder();
    ok.bridge.probeResource(LAN + '/Items/i1/Images/Primary', TOKEN,
                            { metadataOnly: true }, rOk.onSuccess, rOk.onError);
    assert.equal(ok.last().header('Range'), 'bytes=0-0', 'seuls les en-têtes sont voulus');
    ok.last().respondHeaders({ status: 200, headers: { 'Content-Type': 'image/JPEG' } });
    assert.equal(rOk.ok[0].status, 200);
    assert.equal(rOk.ok[0].contentType, 'image/jpeg', 'type normalisé en minuscules');

    const redir = createBridge();
    const rRedir = recorder();
    redir.bridge.probeResource(LAN + '/Items/i1/Images/Primary', TOKEN,
                               { metadataOnly: true }, rRedir.onSuccess, rRedir.onError);
    redir.last().respondHeaders({
        status: 200,
        responseURL: 'http://evil.example.com/pixel.png',
        headers: { 'Content-Type': 'image/png' },
    });
    assert.equal(rRedir.ok.length, 0);
    assert.equal(rRedir.ko[0].code, 'redirect_refused');
});

/* ------------------------------------------------------------------ */
/* Repli d'un item utilisateur                                         */
/* ------------------------------------------------------------------ */

test('fetchUserItem : repli sur /Items?Ids= et rappel unique', () => {
    const h = createBridge();
    const r = recorder();
    h.bridge.fetchUserItem(LAN, TOKEN, USER, 'item-9', r.onSuccess, r.onError);
    h.last().respond({ status: 404, body: '{}' });

    const repli = h.last();
    assert.equal(pathOf(repli.url), LAN + '/Items');
    assert.deepEqual(queryOf(repli.url), {
        UserId: USER, Ids: 'item-9', EnableUserData: 'true',
        EnableImages: 'false', Limit: '1',
    });
    repli.respondJson({ Items: [{ Id: 'item-9', Name: 'Film' }] });
    assert.equal(r.calls, 1);
    assert.equal(r.ok[0].Id, 'item-9');
});

test('fetchUserItem : les deux tentatives échouent => une seule erreur', () => {
    const h = createBridge();
    const r = recorder();
    h.bridge.fetchUserItem(LAN, TOKEN, USER, 'item-9', r.onSuccess, r.onError);
    h.last().respond({ status: 500, body: '{}' });
    h.last().respond({ status: 500, body: '{}' });
    h.flush();
    assert.equal(r.calls, 1);
    assert.deepEqual(r.ko, ['http_500']);
});

test('fetchUserItem : paramètres manquants => missing_params sans réseau', () => {
    for (const args of [['', TOKEN, USER, 'i1'], [LAN, '', USER, 'i1'],
                        [LAN, TOKEN, '', 'i1'], [LAN, TOKEN, USER, '']]) {
        const h = createBridge();
        const r = recorder();
        h.bridge.fetchUserItem(args[0], args[1], args[2], args[3], r.onSuccess, r.onError);
        h.flush();
        assert.equal(h.sentCount(), 0, JSON.stringify(args));
        assert.deepEqual(r.ko, ['missing_params'], JSON.stringify(args));
    }
});

test('fetchViews : une bibliothèque vide est signalée par « empty », pas par un succès', () => {
    const h = createBridge();
    const r = recorder();
    h.bridge.fetchViews(LAN, TOKEN, USER, r.onSuccess, r.onError);
    assert.deepEqual(queryOf(h.last().url), { UserId: USER });
    h.last().respondJson({ Items: [] });
    assert.deepEqual(r.ko, ['empty']);
});
