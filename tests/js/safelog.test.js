'use strict';

/*
 * Protège qml/js/SafeLog.js, socle de sécurité du client.
 *
 * Pourquoi c'est sensible :
 *  - safeErrorCode() produit les chaînes de code d'erreur sur lesquelles
 *    d'AUTRES modules prennent des décisions de sécurité. UserStore décide
 *    par exemple de purger une session stockée sur invalid_token / http_400 /
 *    http_401 / http_403 seulement : renommer ou reclasser un code, c'est
 *    soit garder un token révoqué, soit déconnecter l'utilisateur à chaque
 *    coupure réseau ;
 *  - isLocalHost()/isWanHttpUrl() décident si un secret Jellyfin a le droit
 *    de partir en clair. Un faux positif LAN expose le token sur Internet ;
 *  - shortHash() sert à construire des clés de cache qui incluent le TOKEN
 *    (ShellPage). Il ne doit jamais laisser transparaître son entrée ;
 *  - le module ne doit RIEN journaliser dans le build public.
 *
 * Le registre d'hôtes LAN approuvés est un état de module : les tests qui y
 * touchent rechargent SafeLog pour partir d'un registre vierge.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadQmlJs } = require('./qmljs');

const SafeLog = loadQmlJs('qml/js/SafeLog.js');

function freshSafeLog(stubs) {
    return loadQmlJs('qml/js/SafeLog.js', stubs ? { stubs } : undefined);
}

/* ------------------------------------------------------------------ */
/* safeErrorCode : contrat public des codes d'erreur                   */
/* ------------------------------------------------------------------ */

test('safeErrorCode : codes de transport et de protocole conservés tels quels', () => {
    const table = [
        ['timeout', 'timeout'],
        ['cancelled', 'cancelled'],
        ['parse_error', 'parse_error'],
        ['parse', 'parse_error'],
        ['network', 'network_error'],
        ['network_error', 'network_error'],
        ['too_large', 'too_large'],
        ['insecure_transport', 'insecure_transport'],
        ['budget_exhausted', 'budget_exhausted'],
        ['cache_cleared', 'cache_cleared'],
        ['empty', 'empty'],
        ['pending', 'pending'],
        ['ctx', 'ctx'],
        ['missing_params', 'missing_params'],
        ['missing_secret', 'missing_secret'],
        ['invalid_response', 'invalid_response'],
        ['invalid_token', 'invalid_token'],
        ['bad_response', 'bad_response'],
    ];
    for (const [input, expected] of table)
        assert.equal(SafeLog.safeErrorCode(input), expected, `entrée ${input}`);
});

test('safeErrorCode : codes dont dépendent les décisions de sécurité de UserStore', () => {
    // Ces quatre valeurs exactes déclenchent la purge du token stocké.
    assert.equal(SafeLog.safeErrorCode('invalid_token'), 'invalid_token');
    assert.equal(SafeLog.safeErrorCode(400), 'http_400');
    assert.equal(SafeLog.safeErrorCode(401), 'http_401');
    assert.equal(SafeLog.safeErrorCode(403), 'http_403');
    // Et celles-ci ne doivent surtout pas y ressembler.
    assert.equal(SafeLog.safeErrorCode(404), 'http_404');
    assert.equal(SafeLog.safeErrorCode(500), 'http_500');
});

test('safeErrorCode : statuts HTTP, quelle que soit leur forme', () => {
    const table = [
        [401, 'http_401'],
        ['401', 'http_401'],
        ['403', 'http_403'],
        ['404', 'http_404'],
        ['http_503', 'http_503'],
        ['http500', 'http_500'],
        ['HTTP_404', 'http_404'],
        [{ status: 401 }, 'http_401'],
        [{ status: '401' }, 'http_401'],
        [{ code: 'http_401' }, 'http_401'],
        [{ code: null, status: 403 }, 'http_403'],
        [{ ErrorCode: 'timeout' }, 'timeout'],
        [{ errorCode: 'cancelled' }, 'cancelled'],
    ];
    for (const [input, expected] of table)
        assert.equal(SafeLog.safeErrorCode(input), expected, `entrée ${JSON.stringify(input)}`);
});

test('safeErrorCode : la casse ne change pas le code produit', () => {
    assert.equal(SafeLog.safeErrorCode('TIMEOUT'), 'timeout');
    assert.equal(SafeLog.safeErrorCode('Invalid_Token'), 'invalid_token');
    assert.equal(SafeLog.safeErrorCode('Cancelled'), 'cancelled');
});

test('safeErrorCode : entrées absentes, vides ou inconnues => repli', () => {
    for (const input of [undefined, null, '', 'quelque-chose', true, [], {}, { message: 'x' }])
        assert.equal(SafeLog.safeErrorCode(input), 'network_error', `entrée ${JSON.stringify(input)}`);
    // Le repli est paramétrable et n'est appliqué qu'aux entrées non reconnues.
    assert.equal(SafeLog.safeErrorCode('zzz', 'http_500'), 'http_500');
    assert.equal(SafeLog.safeErrorCode(undefined, 'ctx'), 'ctx');
    assert.equal(SafeLog.safeErrorCode('timeout', 'ctx'), 'timeout');
});

test('safeErrorCode : param_missing reconnu même noyé dans un message', () => {
    assert.equal(SafeLog.safeErrorCode('param_missing'), 'param_missing');
    assert.equal(SafeLog.safeErrorCode('userid_param_missing_here'), 'param_missing');
});

test('safeErrorCode : ne renvoie jamais autre chose qu\'un identifiant court et sûr', () => {
    // Un message serveur arbitraire ne doit pas ressortir dans le code public.
    const hostile = [
        'Erreur: token=abcdef échoué',
        '<script>alert(1)</script>',
        { code: 'Bearer eyJhbGciOiJIUzI1NiJ9' },
        { code: 'x'.repeat(5000) },
        { ErrorCode: 'http://jellyfin.test:8096/?ApiKey=tok-TEST' },
    ];
    for (const input of hostile) {
        const code = SafeLog.safeErrorCode(input);
        assert.match(code, /^[a-z0-9_]{1,32}$/, `entrée ${JSON.stringify(input)} -> ${code}`);
        assert.equal(code, 'network_error');
    }
});

test('safeErrorCode : un objet qui explose à la lecture ne casse pas l\'appelant', () => {
    const piege = { get code() { throw new Error('boom'); } };
    assert.equal(SafeLog.safeErrorCode(piege), 'network_error');
});

/* ------------------------------------------------------------------ */
/* Littéraux IP : base de la décision « ce secret peut partir en clair » */
/* ------------------------------------------------------------------ */

test('isPrivateIpv4Literal : plages RFC1918 + loopback + link-local', () => {
    const prives = ['10.0.0.1', '10.255.255.255', '127.0.0.1', '169.254.1.1',
                    '172.16.0.1', '172.31.255.254', '192.168.0.1', '192.168.255.1'];
    for (const h of prives)
        assert.equal(SafeLog.isPrivateIpv4Literal(h), true, h);

    const publics = ['8.8.8.8', '1.1.1.1', '172.15.0.1', '172.32.0.1', '192.169.0.1',
                     '11.0.0.1', '126.0.0.1', '128.0.0.1'];
    for (const h of publics)
        assert.equal(SafeLog.isPrivateIpv4Literal(h), false, h);
});

test('isPrivateIpv4Literal : formes ambiguës refusées (zéros de tête, octets hors bornes)', () => {
    // « 010.0.0.1 » est lu en octal par certaines piles réseau : refus net.
    const refus = ['010.0.0.1', '192.168.01.1', '256.1.1.1', '192.168.1', '192.168.1.1.1',
                   '192.168.1.-1', '192.168.1.1 ', '', null, undefined, '127.0.0.2'];
    for (const h of refus)
        assert.equal(SafeLog.isPrivateIpv4Literal(h), false, String(h));
});

test('isValidIpv6Literal : comptage des groupes et compression unique', () => {
    assert.equal(SafeLog.isValidIpv6Literal('1:2:3:4:5:6:7:8'), true);
    assert.equal(SafeLog.isValidIpv6Literal('::1'), true);
    assert.equal(SafeLog.isValidIpv6Literal('fe80::1'), true);
    assert.equal(SafeLog.isValidIpv6Literal('1:2:3:4:5:6:7'), false);
    assert.equal(SafeLog.isValidIpv6Literal('1:2:3:4:5:6:7:8:9'), false);
    assert.equal(SafeLog.isValidIpv6Literal('1::2::3'), false);
    assert.equal(SafeLog.isValidIpv6Literal(':::'), false);
    assert.equal(SafeLog.isValidIpv6Literal('12345::1'), false);
    assert.equal(SafeLog.isValidIpv6Literal('192.168.1.1'), false);
    assert.equal(SafeLog.isValidIpv6Literal(''), false);
});

test('isLocalIpv6Literal : uniquement ::1, fc00::/7 et fe80::/10', () => {
    for (const h of ['::1', 'fc00::1', 'fd12:3456::1', 'fe80::1', 'FE80::1', 'fe80::1%eth0'])
        assert.equal(SafeLog.isLocalIpv6Literal(h), true, h);
    for (const h of ['2001:db8::1', 'fb00::1', 'fec0::1', '::2', '2a01:e0a::1'])
        assert.equal(SafeLog.isLocalIpv6Literal(h), false, h);
});

/* ------------------------------------------------------------------ */
/* isLocalHost / isLanHostLike                                         */
/* ------------------------------------------------------------------ */

test('isLocalHost : noms et IP locaux acceptés, port et casse ignorés', () => {
    const locaux = ['localhost', 'LOCALHOST', 'localhost.', '127.0.0.1', '::1',
                    '192.168.1.5:8096', '[fe80::1]:8096', 'jellyfin.local',
                    'JELLYFIN.LOCAL', 'nas.home.arpa', '10.0.0.4:8920'];
    for (const h of locaux)
        assert.equal(SafeLog.isLocalHost(h), true, h);
});

test('isLocalHost : tout le reste est considéré distant', () => {
    const distants = ['example.com', 'jellyfin.example.com', '8.8.8.8', '', null,
                      'evil.local.example.com', 'localhost.example.com', 'nas'];
    for (const h of distants)
        assert.equal(SafeLog.isLocalHost(h), false, String(h));
});

test('isLanHostLike : accepte une URL complète là où isLocalHost attend un hôte', () => {
    assert.equal(SafeLog.isLanHostLike('http://192.168.1.5:8096/web/'), true);
    assert.equal(SafeLog.isLanHostLike('http://[fe80::1]:8096'), true);
    assert.equal(SafeLog.isLanHostLike('localhost'), true);
    assert.equal(SafeLog.isLanHostLike('https://jellyfin.example.com'), false);
    assert.equal(SafeLog.isLanHostLike(''), false);
    // Un userinfo pourrait masquer le vrai hôte : refus.
    assert.equal(SafeLog.isLanHostLike('http://192.168.1.5@evil.example.com/'), false);
});

/* ------------------------------------------------------------------ */
/* extractHost / normalizeHostLike                                     */
/* ------------------------------------------------------------------ */

test('extractHost : isole l\'hôte et refuse ce qui peut tromper la lecture', () => {
    assert.equal(SafeLog.extractHost('http://JELLY.local:8096/web/'), 'jelly.local');
    assert.equal(SafeLog.extractHost('https://[fe80::1]:8096/'), 'fe80::1');
    assert.equal(SafeLog.extractHost('https://jellyfin.test./'), 'jellyfin.test');
    // userinfo : « http://192.168.1.5@evil.com » pointe en réalité sur evil.com.
    assert.equal(SafeLog.extractHost('http://192.168.1.5@evil.com/x'), '');
    assert.equal(SafeLog.extractHost('/chemin/relatif'), '');
    assert.equal(SafeLog.extractHost(''), '');
});

test('normalizeHostLike : borne la taille et refuse les caractères de contrôle', () => {
    assert.equal(SafeLog.normalizeHostLike('HTTP://NAS:8096/web/index.html'), 'nas');
    assert.equal(SafeLog.normalizeHostLike('[fe80::1]:80'), 'fe80::1');
    assert.equal(SafeLog.normalizeHostLike('jellyfin.test.'), 'jellyfin.test');
    assert.equal(SafeLog.normalizeHostLike('nas\r\nHost: evil.com'), '');
    assert.equal(SafeLog.normalizeHostLike('x'.repeat(20), 8), '');
    assert.equal(SafeLog.normalizeHostLike('user@host'), '');
});

/* ------------------------------------------------------------------ */
/* isHttpUrl / isWanHttpUrl : autorisation d'envoi d'un secret          */
/* ------------------------------------------------------------------ */

test('isWanHttpUrl : HTTP en clair hors LAN = vrai, tout le reste = faux', () => {
    assert.equal(SafeLog.isWanHttpUrl('http://jellyfin.example.com:8096'), true);
    assert.equal(SafeLog.isWanHttpUrl('HTTP://Jellyfin.Example.COM'), true);
    assert.equal(SafeLog.isWanHttpUrl('http://8.8.8.8'), true);

    assert.equal(SafeLog.isWanHttpUrl('https://jellyfin.example.com'), false);
    assert.equal(SafeLog.isWanHttpUrl('http://192.168.1.5:8096'), false);
    assert.equal(SafeLog.isWanHttpUrl('http://localhost:8096'), false);
    assert.equal(SafeLog.isWanHttpUrl('http://jellyfin.local'), false);
    assert.equal(SafeLog.isWanHttpUrl(''), false);
});

test('isHttpUrl : seul le schéma http:// compte, https exclu', () => {
    assert.equal(SafeLog.isHttpUrl('http://x'), true);
    assert.equal(SafeLog.isHttpUrl('HTTP://x'), true);
    assert.equal(SafeLog.isHttpUrl('https://x'), false);
    assert.equal(SafeLog.isHttpUrl('ftp://x'), false);
});

/* ------------------------------------------------------------------ */
/* Registre des noms LAN courts approuvés                              */
/* ------------------------------------------------------------------ */

test('trustLanHost : un nom court n\'est local qu\'une fois explicitement approuvé', () => {
    const S = freshSafeLog();
    assert.equal(S.isLocalHost('nas'), false);
    assert.equal(S.isWanHttpUrl('http://nas'), true);

    assert.equal(S.trustLanHost('http://nas:8096/'), true);
    assert.equal(S.isTrustedLanHost('nas'), true);
    assert.equal(S.isLocalHost('nas'), true);
    assert.equal(S.isWanHttpUrl('http://nas'), false);
});

test('trustLanHost : refuse ce qui n\'est pas un nom LAN court', () => {
    const S = freshSafeLog();
    for (const v of ['192.168.1.5', 'nas.lan', 'jellyfin.example.com', 'fe80::1',
                     '', '-nas', 'n'.repeat(64), 'na_s'])
        assert.equal(S.trustLanHost(v), false, String(v));
    assert.equal(S.isTrustedLanHost('192.168.1.5'), false);
});

test('isShortLanHostName : forme acceptable pour une approbation ultérieure', () => {
    assert.equal(SafeLog.isShortLanHostName('nas'), true);
    assert.equal(SafeLog.isShortLanHostName('http://jellyfin:8096/'), true);
    assert.equal(SafeLog.isShortLanHostName('nas.lan'), false);
    assert.equal(SafeLog.isShortLanHostName('192.168.1.5'), false);
    assert.equal(SafeLog.isShortLanHostName(''), false);
});

test('forgetTrustedLanHost / clearTrustedLanHosts : révocation effective', () => {
    const S = freshSafeLog();
    S.trustLanHost('nas');
    assert.equal(S.forgetTrustedLanHost('nas'), true);
    assert.equal(S.isTrustedLanHost('nas'), false);
    assert.equal(S.isLocalHost('nas'), false);
    // Deuxième oubli : plus rien à retirer.
    assert.equal(S.forgetTrustedLanHost('nas'), false);

    S.trustLanHost('nas');
    S.trustLanHost('jellyfin');
    S.clearTrustedLanHosts();
    assert.equal(S.isTrustedLanHost('nas'), false);
    assert.equal(S.isTrustedLanHost('jellyfin'), false);
});

test('trustLanHost : le registre est borné (64) et se vide au lieu de croître', () => {
    const S = freshSafeLog();
    for (let i = 0; i < 64; i++) assert.equal(S.trustLanHost('h' + i), true);
    assert.equal(S.isTrustedLanHost('h0'), true);
    assert.equal(S.isTrustedLanHost('h63'), true);

    // Le 65e dépasse le quota : le registre repart de zéro plutôt que de
    // laisser un attaquant faire grossir la mémoire indéfiniment.
    assert.equal(S.trustLanHost('h64'), true);
    assert.equal(S.isTrustedLanHost('h64'), true);
    assert.equal(S.isTrustedLanHost('h0'), false);
    assert.equal(S.isTrustedLanHost('h63'), false);
});

test('trustLanHost : approuver deux fois le même hôte ne consomme pas deux places', () => {
    const S = freshSafeLog();
    for (let i = 0; i < 63; i++) S.trustLanHost('h' + i);
    for (let i = 0; i < 20; i++) assert.equal(S.trustLanHost('h0'), true);
    // 63 places occupées : la 64e approbation ne doit pas purger le registre.
    assert.equal(S.trustLanHost('dernier'), true);
    assert.equal(S.isTrustedLanHost('h0'), true);
    assert.equal(S.isTrustedLanHost('dernier'), true);
});

/* ------------------------------------------------------------------ */
/* shortHash                                                           */
/* ------------------------------------------------------------------ */

test('shortHash : 8 caractères hexadécimaux, déterministe', () => {
    for (const v of ['', 'tok-TEST', 'http://jellyfin.test:8096', 'é😀', null, undefined, 12345]) {
        const h = SafeLog.shortHash(v);
        assert.match(h, /^[0-9a-f]{8}$/, `entrée ${String(v)} -> ${h}`);
        assert.equal(h, SafeLog.shortHash(v), 'même entrée => même empreinte');
    }
    // null/undefined/"" sont la même entrée vide.
    assert.equal(SafeLog.shortHash(null), SafeLog.shortHash(''));
});

test('shortHash : ne laisse rien transparaître du secret haché', () => {
    const token = 'tok-TEST-0123456789abcdef';
    const h = SafeLog.shortHash(token);
    assert.equal(h.indexOf('tok'), -1);
    assert.equal(token.toLowerCase().indexOf(h), -1);
    // Deux secrets voisins ne doivent pas produire la même clé de cache.
    assert.notEqual(SafeLog.shortHash('tok-TESTA'), SafeLog.shortHash('tok-TESTB'));
    assert.notEqual(SafeLog.shortHash('user-1'), SafeLog.shortHash('user-2'));
});

/* ------------------------------------------------------------------ */
/* Le module ne journalise rien                                        */
/* ------------------------------------------------------------------ */

test('SafeLog ne journalise rien : aucune sortie console, aucune API de log', () => {
    const vus = [];
    const consoleEspion = new Proxy({}, {
        get: (_, prop) => (...args) => { vus.push([String(prop), args]); },
    });
    const S = freshSafeLog({ console: consoleEspion });

    // Toute fonction exportée, appelée avec une entrée « intéressante ».
    const echantillons = ['http://jellyfin.test:8096/?ApiKey=tok-TEST', 'tok-TEST',
                          '192.168.1.5', 'fe80::1', 'nas', 'timeout', 42, null];
    for (const name of Object.keys(S)) {
        if (typeof S[name] !== 'function' || name === 'console') continue;
        for (const v of echantillons) {
            try { S[name](v); } catch (e) { /* signature différente : sans importance ici */ }
        }
    }
    assert.deepEqual(vus, [], 'SafeLog doit rester silencieux dans le build public');

    // Et il n'expose aucune primitive de journalisation réutilisable.
    for (const name of Object.keys(S)) {
        assert.equal(/^(log|warn|error|info|debug|trace)$/.test(name), false,
                     `SafeLog ne doit plus exposer ${name}()`);
    }
});
