'use strict';

/*
 * Protège les fonctions PURES de qml/js/jellyfinBridge.js : construction
 * d'URL, en-têtes d'authentification, politique « ce secret a-t-il le droit
 * de partir », mémoire bornée.
 *
 * Pourquoi c'est sensible :
 *  - normalizeServerUrl() est le seul endroit qui transforme la saisie de
 *    l'utilisateur en base d'API. Accepter un userinfo (« http://192.168.1.5@
 *    evil.example.com ») ou un schéma exotique enverrait le token ailleurs ;
 *  - headersWithToken() place le token dans Authorization: MediaBrowser et
 *    NULLE PART ailleurs. Le Player journalise toutes les URL : un token en
 *    query fuiterait dans les logs du boîtier ;
 *  - stripAuthQueryFromUrl() est le filet qui retire un secret recopié dans
 *    une URL, y compris avant un cache ou une redirection ;
 *  - itemImageUrl() alimente des dizaines de délégués : une régression de
 *    quota/format casse toutes les affiches d'un coup ;
 *  - putBoundedMemory() borne les caches des pages sur un Révolution à
 *    mémoire très limitée.
 *
 * Toutes les valeurs sont fictives (jellyfin.test, 192.168.1.5, tok-TEST).
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { createBridge, queryOf, pathOf } = require('./bridgeharness');

const B = createBridge().bridge;
const LAN = 'http://192.168.1.5:8096';

/* ------------------------------------------------------------------ */
/* normalizeServerUrl                                                  */
/* ------------------------------------------------------------------ */

test('normalizeServerUrl : formes usuelles saisies par l\'utilisateur', () => {
    const table = [
        ['http://192.168.1.5:8096', 'http://192.168.1.5:8096'],
        ['http://192.168.1.5:8096/', 'http://192.168.1.5:8096'],
        ['http://192.168.1.5:8096///', 'http://192.168.1.5:8096'],
        ['  http://192.168.1.5:8096  ', 'http://192.168.1.5:8096'],
        // Adresse copiée depuis le navigateur : /web et son fragment sautent.
        ['http://192.168.1.5:8096/web/index.html#!/home.html', 'http://192.168.1.5:8096'],
        ['http://192.168.1.5:8096/web/', 'http://192.168.1.5:8096'],
        ['http://192.168.1.5:8096/web', 'http://192.168.1.5:8096'],
        ['http://192.168.1.5:8096/?x=1', 'http://192.168.1.5:8096'],
        // Un reverse-proxy avec sous-chemin doit être conservé.
        ['http://192.168.1.5:8096/jellyfin/', 'http://192.168.1.5:8096/jellyfin'],
        ['https://jellyfin.test:8920', 'https://jellyfin.test:8920'],
    ];
    for (const [input, expected] of table)
        assert.equal(B.normalizeServerUrl(input, false), expected, JSON.stringify(input));
});

test('normalizeServerUrl : sans schéma, LAN => http, reste => https', () => {
    const fresh = createBridge().bridge;
    assert.equal(fresh.normalizeServerUrl('192.168.1.5:8096', false), 'http://192.168.1.5:8096');
    assert.equal(fresh.normalizeServerUrl('localhost:8096', false), 'http://localhost:8096');
    assert.equal(fresh.normalizeServerUrl('jellyfin.local', false), 'http://jellyfin.local');
    assert.equal(fresh.normalizeServerUrl('jellyfin.test', false), 'https://jellyfin.test');

    // Un nom court inconnu part en HTTPS tant qu'il n'a pas été validé en LAN.
    assert.equal(fresh.normalizeServerUrl('nas', false), 'https://nas');
    fresh.trustLanHost('nas');
    assert.equal(fresh.normalizeServerUrl('nas', false), 'http://nas');
});

test('normalizeServerUrl : schéma et autorité en minuscules, chemin intact', () => {
    // Schéma et autorité sont insensibles à la casse : deux graphies d'un même
    // serveur doivent donner la même clé de stockage côté UserStore.
    assert.equal(B.normalizeServerUrl('HTTP://192.168.1.5:8096', false),
                 'http://192.168.1.5:8096');
    assert.equal(B.normalizeServerUrl('HtTpS://Jellyfin.Test:8920', false),
                 'https://jellyfin.test:8920');
    assert.equal(B.normalizeServerUrl('NAS.local:8096', false),
                 'http://nas.local:8096');

    // Le chemin d'un reverse-proxy peut être sensible à la casse : il ne bouge
    // pas, pas plus que /web ou le slash final qui sont retirés comme avant.
    assert.equal(B.normalizeServerUrl('HTTP://NAS.local:8096/Jellyfin/', false),
                 'http://nas.local:8096/Jellyfin');
    assert.equal(B.normalizeServerUrl('HTTP://NAS.local:8096/Web/index.html', false),
                 'http://nas.local:8096');
});

test('normalizeServerUrl : entrées refusées', () => {
    const refus = [
        '',
        null,
        undefined,
        'http://user:pw@evil.example.com/',     // userinfo : masque l'hôte réel
        'http://192.168.1.5@evil.example.com/',
        'ftp://jellyfin.test',
        'javascript:alert(1)',
        'file:///etc/passwd',
        'http://192.168.1.5:8096\nX-Injection: 1',
        'http://jellyfin .test',
        'x'.repeat(600),
        '\\\\192.168.1.5:8096',
    ];
    for (const input of refus)
        assert.equal(B.normalizeServerUrl(input, false), '', JSON.stringify(input));
});

test('normalizeServerUrl : le drapeau preferHttps n\'a aucun effet observable', () => {
    // Il reste dans la signature pour compatibilité, mais le choix du schéma
    // dépend uniquement du caractère LAN de l'hôte. Ce test verrouille le fait
    // que _normalizeBase(url, true) et les appels des pages (…, false) sont
    // bien équivalents : une réactivation silencieuse changerait toutes les
    // bases d'API du client.
    for (const input of ['jellyfin.test', '192.168.1.5:8096', 'http://jellyfin.test', 'nas'])
        assert.equal(B.normalizeServerUrl(input, true), B.normalizeServerUrl(input, false), input);
});

/* ------------------------------------------------------------------ */
/* En-têtes et placement du token                                      */
/* ------------------------------------------------------------------ */

test('headersWithToken : le token vit dans Authorization MediaBrowser, nulle part ailleurs', () => {
    const h = B.headersWithToken('tok-TEST');
    assert.equal(h['Content-Type'], 'application/json');
    assert.equal(h['Accept'], 'application/json');
    assert.match(h['Authorization'], /^MediaBrowser /);
    assert.match(h['Authorization'], /Token="tok-TEST"/);
    // Les en-têtes legacy Emby ne doivent plus être émis.
    assert.equal(h['X-Emby-Token'], undefined);
    assert.equal(h['X-MediaBrowser-Token'], undefined);
    assert.equal(h['X-Emby-Authorization'], undefined);
    // Le header porte aussi l'identité cliente attendue par Jellyfin.
    for (const champ of ['Client=', 'Device=', 'DeviceId=', 'Version='])
        assert.ok(h['Authorization'].indexOf(champ) >= 0, `champ ${champ} manquant`);
});

test('headersWithToken : sans token, aucun Authorization porteur de secret', () => {
    for (const vide of ['', null, undefined]) {
        const h = B.headersWithToken(vide);
        assert.equal(/Token=/.test(h['Authorization'] || ''), false, JSON.stringify(vide));
    }
});

test('headersWithToken : un token hostile ne peut pas casser la structure du header', () => {
    const auth = B.headersWithToken('abc", Evil="1\r\nX-Injection: 1')['Authorization'];
    // Guillemets, virgules, CR/LF et contrôles sont retirés de la valeur : le
    // header reste une liste de paires clé="valeur" et ne peut pas en injecter
    // une sixième ni couper l'en-tête.
    assert.match(auth, /Token="[^"]*"$/);
    assert.equal((auth.match(/="/g) || []).length, 5, 'Client, Device, DeviceId, Version, Token');
    assert.equal(/[\r\n]/.test(auth), false);
    const valeur = /Token="([^"]*)"$/.exec(auth)[1];
    assert.equal(/["\\,\r\n]/.test(valeur), false, 'valeur de token nettoyée');
});

/* ------------------------------------------------------------------ */
/* stripAuthQueryFromUrl                                               */
/* ------------------------------------------------------------------ */

test('stripAuthQueryFromUrl : retire tout porteur de secret et le fragment', () => {
    const url = 'http://jellyfin.test:8096/Items/i1'
        + '?ApiKey=tok-TEST&api_key=tok-TEST&Token=tok-TEST&accessToken=tok-TEST'
        + '&X-Emby-Token=tok-TEST&a=1&b=2#frag';
    const out = B.stripAuthQueryFromUrl(url);
    assert.equal(out.indexOf('tok-TEST'), -1, 'aucun secret ne doit subsister');
    assert.equal(out.indexOf('#'), -1, 'le fragment est supprimé');
    assert.deepEqual(queryOf(out), { a: '1', b: '2' });
    assert.equal(pathOf(out), 'http://jellyfin.test:8096/Items/i1');
});

test('stripAuthQueryFromUrl : clés encodées ou à ponctuation variable', () => {
    // api%5Fkey == api_key ; le filtre normalise avant comparaison.
    assert.deepEqual(queryOf(B.stripAuthQueryFromUrl('http://h/x?api%5Fkey=tok-TEST&ok=1')), { ok: '1' });
    assert.deepEqual(queryOf(B.stripAuthQueryFromUrl('http://h/x?API-KEY=tok-TEST&ok=1')), { ok: '1' });
    assert.deepEqual(queryOf(B.stripAuthQueryFromUrl('http://h/x?x-emby-token=tok-TEST&ok=1')), { ok: '1' });
});

test('stripAuthQueryFromUrl : une URL propre traverse sans dommage', () => {
    assert.equal(B.stripAuthQueryFromUrl('http://h/x'), 'http://h/x');
    assert.equal(B.stripAuthQueryFromUrl('http://h/x?a=1&b=2'), 'http://h/x?a=1&b=2');
    // Plus aucun paramètre utile : pas de « ? » orphelin.
    assert.equal(B.stripAuthQueryFromUrl('http://h/x?ApiKey=tok-TEST'), 'http://h/x');
    assert.equal(B.stripAuthQueryFromUrl(''), '');
});

/* ------------------------------------------------------------------ */
/* Politique « un secret peut-il partir sur ce transport »             */
/* ------------------------------------------------------------------ */

test('requestContainsAuthSecret : reconnaît toutes les façons de porter un secret', () => {
    const avecSecret = [
        ['http://h/x', { Authorization: 'MediaBrowser Client="a", Token="tok-TEST"' }, null],
        ['http://h/x', { 'X-Emby-Token': 'tok-TEST' }, null],
        ['http://h/x', { 'X-MediaBrowser-Token': 'tok-TEST' }, null],
        ['http://h/x', { 'X-Emby-Authorization': 'MediaBrowser Token=tok-TEST' }, null],
        ['http://h/x?ApiKey=tok-TEST', {}, null],
        ['http://h/x?api_key=tok-TEST', {}, null],
        // Le mot de passe / le secret QuickConnect voyagent dans le corps.
        ['http://h/Users/AuthenticateByName', {}, '{"Username":"bob"}'],
        ['http://h/Users/AuthenticateWithQuickConnect', {}, '{"Secret":"s"}'],
    ];
    for (const [url, headers, body] of avecSecret)
        assert.equal(B.requestContainsAuthSecret(url, headers, body), true, url + ' ' + JSON.stringify(headers));

    const sansSecret = [
        ['http://h/x', { Accept: 'application/json' }, null],
        // Identité cliente sans token : ce n'est pas un secret.
        ['http://h/x', { Authorization: 'MediaBrowser Client="ReDeFin", DeviceId="rdf-1"' }, null],
        ['http://h/x?tagged=1&a=2', {}, null],
        ['http://h/Users/AuthenticateByName', {}, null],
        ['http://h/Items', {}, '{"Ids":"i1"}'],
    ];
    for (const [url, headers, body] of sansSecret)
        assert.equal(B.requestContainsAuthSecret(url, headers, body), false, url + ' ' + JSON.stringify(headers));
});

test('isSensitiveRequestAllowed : jamais de secret en HTTP clair hors LAN', () => {
    const tokenHeaders = { Authorization: 'MediaBrowser Token="tok-TEST"' };

    assert.equal(B.isSensitiveRequestAllowed('http://jellyfin.test:8096/x', tokenHeaders, null), false);
    assert.equal(B.isSensitiveRequestAllowed('http://8.8.8.8/x', tokenHeaders, null), false);
    // URL relative ou schéma inattendu : refus, on ne sait pas où ça part.
    assert.equal(B.isSensitiveRequestAllowed('/Items/i1', tokenHeaders, null), false);
    assert.equal(B.isSensitiveRequestAllowed('ftp://jellyfin.test/x', tokenHeaders, null), false);

    assert.equal(B.isSensitiveRequestAllowed('https://jellyfin.test:8920/x', tokenHeaders, null), true);
    assert.equal(B.isSensitiveRequestAllowed('http://192.168.1.5:8096/x', tokenHeaders, null), true);
    assert.equal(B.isSensitiveRequestAllowed('http://localhost:8096/x', tokenHeaders, null), true);
    // Sans secret, un HTTP WAN reste autorisé (ping public, branding…).
    assert.equal(B.isSensitiveRequestAllowed('http://jellyfin.test:8096/System/Info/Public', {}, null), true);
});

test('isValidPublicSystemInfo : exige version + identité, bornées', () => {
    assert.equal(B.isValidPublicSystemInfo({ Version: '10.9.0', ServerName: 'Maison' }), true);
    assert.equal(B.isValidPublicSystemInfo({ version: '10.9.0', id: 'abc' }), true);
    assert.equal(B.isValidPublicSystemInfo({ Version: '10.9.0', ProductName: 'Jellyfin Server' }), true);

    assert.equal(B.isValidPublicSystemInfo({ Version: '10.9.0' }), false);
    assert.equal(B.isValidPublicSystemInfo({ ServerName: 'Maison' }), false);
    assert.equal(B.isValidPublicSystemInfo({}), false);
    assert.equal(B.isValidPublicSystemInfo(null), false);
    assert.equal(B.isValidPublicSystemInfo('10.9.0'), false);
    // Réponse d'un équipement qui n'est pas un Jellyfin : bornes de taille.
    assert.equal(B.isValidPublicSystemInfo({ Version: 'v'.repeat(65), Id: 'abc' }), false);
    assert.equal(B.isValidPublicSystemInfo({ Version: '10.9.0', Id: 'x'.repeat(257) }), false);
});

/* ------------------------------------------------------------------ */
/* URL d'images                                                        */
/* ------------------------------------------------------------------ */

test('itemImageUrl : chemin encodé et options de redimensionnement', () => {
    const url = B.itemImageUrl(LAN + '/', 'abc 123', 'Primary', 'tag&x', {
        fillHeight: 300, fillWidth: '200.7', quality: 90, format: 'Webp',
    });
    assert.equal(pathOf(url), LAN + '/Items/abc%20123/Images/Primary');
    assert.deepEqual(queryOf(url), {
        tag: 'tag&x', fillHeight: '300', fillWidth: '200', quality: '90', format: 'Webp',
    });
});

test('itemImageUrl : le flou est borné à 1..50', () => {
    assert.equal(queryOf(B.itemImageUrl(LAN, 'i1', 'Backdrop', 't', { blur: 100 })).blur, '50');
    assert.equal(queryOf(B.itemImageUrl(LAN, 'i1', 'Backdrop', 't', { blur: 0.2 })).blur, '1');
    assert.equal(queryOf(B.itemImageUrl(LAN, 'i1', 'Backdrop', 't', { blur: 20 })).blur, '20');
});

test('itemImageUrl : sans tag ni options, URL minimale et sans « ? »', () => {
    assert.equal(B.itemImageUrl(LAN, 'i1', 'Primary'), LAN + '/Items/i1/Images/Primary');
    assert.equal(B.itemImageUrl(LAN, 'i1', 'Primary', ''), LAN + '/Items/i1/Images/Primary');
});

test('itemImageUrl : paramètres manquants ou serveur invalide => chaîne vide', () => {
    assert.equal(B.itemImageUrl('', 'i1', 'Primary', 't'), '');
    assert.equal(B.itemImageUrl(LAN, '', 'Primary', 't'), '');
    assert.equal(B.itemImageUrl(LAN, 'i1', '', 't'), '');
    assert.equal(B.itemImageUrl('http://user:pw@evil.example.com', 'i1', 'Primary', 't'), '');
});

test('itemImageUrl : un token recopié dans l\'URL du serveur ne ressort jamais', () => {
    // La base est nettoyée par normalizeServerUrl, et le résultat repasse par
    // stripAuthQueryFromUrl : les URL d'images finissent dans les logs du Player.
    const url = B.itemImageUrl(LAN + '/?ApiKey=tok-TEST', 'i1', 'Primary', 't');
    assert.equal(url.indexOf('tok-TEST'), -1);
    assert.equal(url.indexOf('ApiKey'), -1);
});

/*
 * itemImageUrl mémoïse la base normalisée sur son dernier appel (une seule
 * entrée) pour éviter de refaire normalizeServerUrl 2 à 3 fois par carte de
 * grille avec un serveur inchangé (audit réseau, M1). Les tests ci-dessous
 * vérifient que le résultat reste identique à ce que produirait un calcul
 * non mémoïsé (comparaison indépendante via normalizeServerUrl) sur une
 * matrice de formes de serveur, et que la mémoïsation ne fait fuir aucun
 * résultat d'un serveur vers l'appel suivant lorsqu'il change.
 */
test('itemImageUrl : la mémoïsation de la base ne change aucune sortie (matrice de serveurs)', () => {
    const table = [
        [LAN, 'i1', 'Primary', 't'],
        [LAN + '/', 'i1', 'Primary', 't'],
        [LAN + '///', 'i1', 'Primary', 't'],
        ['HTTP://192.168.1.5:8096', 'i1', 'Primary', 't'],
        [LAN + '/jellyfin', 'i1', 'Primary', 't'],
        [LAN + '/Jellyfin', 'i1', 'Primary', 't'],
        [LAN, 'i2', 'Backdrop', ''],
        [LAN, 'i3', 'Logo', 'tag&x'],
    ];
    for (const [server, id, type, tag] of table) {
        const url = B.itemImageUrl(server, id, type, tag);
        const expectedBase = B.normalizeServerUrl(server, true);
        assert.equal(pathOf(url), expectedBase + '/Items/' + encodeURIComponent(id) + '/Images/' + encodeURIComponent(type),
            JSON.stringify([server, id, type, tag]));
        if (tag) assert.equal(queryOf(url).tag, tag);
    }
});

test('itemImageUrl : recalcule la base dès que le serveur change, sans fuite entre appels alternés', () => {
    const other = 'http://autre.exemple.test:9000/sub';
    const a1 = B.itemImageUrl(LAN, 'i1', 'Primary', 't1');
    const b1 = B.itemImageUrl(other, 'i2', 'Backdrop', 't2');
    const a2 = B.itemImageUrl(LAN, 'i1', 'Primary', 't1');
    const b2 = B.itemImageUrl(other, 'i2', 'Backdrop', 't2');
    assert.equal(a2, a1);
    assert.equal(b2, b1);
    assert.equal(pathOf(a1), B.normalizeServerUrl(LAN, true) + '/Items/i1/Images/Primary');
    assert.equal(pathOf(b1), B.normalizeServerUrl(other, true) + '/Items/i2/Images/Backdrop');
});

test('itemBackdropOrPrimaryUrl : backdrop prioritaire, repli sur Primary', () => {
    const avecBackdrop = { Id: 'i1', BackdropImageTags: ['bd1'], ImageTags: { Primary: 'p1' } };
    assert.equal(pathOf(B.itemBackdropOrPrimaryUrl(LAN, avecBackdrop)),
                 LAN + '/Items/i1/Images/Backdrop');
    assert.equal(queryOf(B.itemBackdropOrPrimaryUrl(LAN, avecBackdrop)).tag, 'bd1');

    const primaireSeul = { Id: 'i1', ImageTags: { Primary: 'p1' } };
    assert.equal(pathOf(B.itemBackdropOrPrimaryUrl(LAN, primaireSeul)),
                 LAN + '/Items/i1/Images/Primary');

    // PrimaryImageTag est la forme renvoyée par certains endpoints.
    assert.equal(pathOf(B.itemBackdropOrPrimaryUrl(LAN, { Id: 'i1', PrimaryImageTag: 'p2' })),
                 LAN + '/Items/i1/Images/Primary');

    assert.equal(B.itemBackdropOrPrimaryUrl(LAN, { Id: 'i1' }), '');
    assert.equal(B.itemBackdropOrPrimaryUrl(LAN, { BackdropImageTags: ['bd1'] }), '');
    assert.equal(B.itemBackdropOrPrimaryUrl(LAN, null), '');
});

/* ------------------------------------------------------------------ */
/* URL de recherche                                                    */
/* ------------------------------------------------------------------ */

test('searchHintsUrl / searchItemsUrl : query déjà encodée par SearchPage, UserId encodé ici', () => {
    assert.equal(B.searchHintsUrl(LAN, 'searchTerm=a%20b&limit=5'),
                 LAN + '/Search/Hints?searchTerm=a%20b&limit=5');
    assert.equal(B.searchHintsUrl(LAN, ''), LAN + '/Search/Hints');

    const items = B.searchItemsUrl(LAN, 'user 1', 'searchTerm=%C3%A9t%C3%A9');
    assert.equal(pathOf(items), LAN + '/Items');
    assert.deepEqual(queryOf(items), { UserId: 'user 1', searchTerm: 'été' });

    // Un serveur invalide ne doit pas produire une URL relative exploitable.
    assert.equal(B.searchHintsUrl('', 'searchTerm=x'), '');
    assert.equal(B.searchItemsUrl('javascript:alert(1)', 'u', 'searchTerm=x'), '');
});

/* ------------------------------------------------------------------ */
/* putBoundedMemory                                                    */
/* ------------------------------------------------------------------ */

test('putBoundedMemory : quota respecté, les plus anciennes entrées partent', () => {
    const bucket = {};
    for (let i = 0; i < 12; i++) B.putBoundedMemory(bucket, 'k' + i, i, 8);
    const cles = Object.keys(bucket).filter((k) => k !== '__redefinOrder');
    assert.equal(cles.length, 8);
    assert.deepEqual(cles.sort(), ['k10', 'k11', 'k4', 'k5', 'k6', 'k7', 'k8', 'k9'].sort());
    assert.equal(bucket.k0, undefined);
    assert.equal(bucket.k11, 11);
});

test('putBoundedMemory : réécrire une clé la rafraîchit sans consommer de place', () => {
    const bucket = {};
    for (let i = 0; i < 8; i++) B.putBoundedMemory(bucket, 'k' + i, i, 8);
    B.putBoundedMemory(bucket, 'k0', 'neuf', 8);
    assert.equal(bucket.k0, 'neuf');
    assert.equal(Object.keys(bucket).filter((k) => k !== '__redefinOrder').length, 8);

    // k0 vient d'être rafraîchie : c'est k1 qui saute ensuite.
    B.putBoundedMemory(bucket, 'k8', 8, 8);
    assert.equal(bucket.k0, 'neuf');
    assert.equal(bucket.k1, undefined);
});

test('putBoundedMemory : entrées héritées reprises dans le quota', () => {
    // Entrées posées avant l'introduction du bornage : elles doivent être
    // réintégrées à l'ordre, sinon elles resteraient hors quota à vie.
    const bucket = { vieux1: 1, vieux2: 2 };
    B.putBoundedMemory(bucket, 'neuf', 3, 8);
    // L'ordre vient d'un autre realm (contexte vm) : on compare son contenu.
    assert.equal(Array.prototype.join.call(bucket.__redefinOrder, ','), 'vieux1,vieux2,neuf');
});

test('putBoundedMemory : quota borné à [8..128] et entrées invalides refusées', () => {
    const petit = {};
    B.putBoundedMemory(petit, 'a', 1, 1);
    B.putBoundedMemory(petit, 'b', 2, 1);
    // Le plancher est 8 : demander 1 ne doit pas rendre le cache inutilisable.
    assert.equal(petit.a, 1);
    assert.equal(petit.b, 2);

    assert.equal(B.putBoundedMemory(null, 'a', 1, 8), false);
    assert.equal(B.putBoundedMemory({}, '', 1, 8), false);
    assert.equal(B.putBoundedMemory('pas-un-objet', 'a', 1, 8), false);
});
