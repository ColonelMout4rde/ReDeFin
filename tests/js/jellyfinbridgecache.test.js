'use strict';

/*
 * Protège la couche de mémoïsation GET de qml/js/jellyfinBridge.js :
 * dé-duplication des requêtes en vol, cache à TTL, cooldowns d'échec,
 * isolation par session et invalidations ciblées.
 *
 * Pourquoi c'est sensible :
 *  - cette couche existe pour le Révolution (Intel CE4100) : HomePage lance
 *    plusieurs blocs qui demandent les mêmes listes au même instant. Perdre
 *    la coalescence, c'est multiplier les requêtes et les parsings JSON sur
 *    un appareil qui n'en a pas les moyens ;
 *  - à l'inverse, cacher ce qui ne doit pas l'être (PlaybackInfo, Sessions,
 *    UserData, images) sert une décision de lecture ou un état de visionnage
 *    périmé ;
 *  - la clé de cache inclut origine + userId + token : une réponse du profil
 *    A ne doit jamais être servie au profil B, ni survivre à un changement
 *    de session (clearApiCaches) ;
 *  - un abonné coalescé qui annule ne doit pas couper la réponse attendue par
 *    les autres, mais le dernier abonné doit bien libérer le transport ;
 *  - les cooldowns évitent de marteler un serveur en panne, et le code
 *    qu'ils renvoient (http_500) ne doit surtout pas ressembler à une
 *    révocation de session, sans quoi UserStore purgerait le token.
 *
 * Horloge figée, réseau simulé (voir bridgeharness.js).
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { createBridge, recorder } = require('./bridgeharness');

const LAN = 'http://192.168.1.5:8096';
const TOKEN = 'tok-TEST';
const USER = 'user-1';

/** Deux GET identiques émis coup sur coup : combien partent vraiment ? */
function requetesEmises(url, method, body) {
    const h = createBridge();
    const headers = h.bridge.headersWithToken(TOKEN);
    const a = recorder();
    const b = recorder();
    h.bridge.sendRequest(method || 'get', url, headers, body || null, a.onSuccess, a.onError);
    h.bridge.sendRequest(method || 'get', url, headers, body || null, b.onSuccess, b.onError);
    return h.sentCount();
}

/* ------------------------------------------------------------------ */
/* Périmètre de la mémoïsation                                         */
/* ------------------------------------------------------------------ */

test('mémoïsation : seules les listes de navigation sont coalescées', () => {
    const memoisables = [
        '/UserViews?UserId=user-1',
        '/UserItems/Resume?UserId=user-1',
        '/Items/Latest?UserId=user-1&ParentId=p1',
        '/Shows/NextUp?UserId=user-1',
        '/Items/item-9?UserId=user-1',            // fiche détaillée d'un item
    ];
    for (const chemin of memoisables)
        assert.equal(requetesEmises(LAN + chemin), 1, chemin);
});

test('mémoïsation : jamais pour la lecture, les sessions, les états ni les images', () => {
    const jamais = [
        '/Items/item-9/PlaybackInfo?UserId=user-1',  // négociation de lecture
        '/Sessions/Playing',                          // rapport de progression
        '/Items/item-9/UserData?UserId=user-1',       // état vu / favori
        '/Items/item-9/Images/Primary?UserId=user-1',
        '/Items?UserId=user-1&Ids=item-9',            // liste filtrée générique
        '/Items/item-9',                              // sans UserId : route publique
        '/Search/Hints?searchTerm=x',
    ];
    for (const chemin of jamais)
        assert.equal(requetesEmises(LAN + chemin), 2, chemin);

    // Ni pour une autre méthode, ni pour un GET avec corps.
    assert.equal(requetesEmises(LAN + '/UserViews?UserId=user-1', 'post'), 2);
    assert.equal(requetesEmises(LAN + '/UserViews?UserId=user-1', 'get', '{}'), 2);
});

/* ------------------------------------------------------------------ */
/* Coalescence                                                         */
/* ------------------------------------------------------------------ */

test('coalescence : une seule requête, tous les abonnés servis', () => {
    const h = createBridge();
    const abonnes = [recorder(), recorder(), recorder()];
    for (const r of abonnes) h.bridge.fetchViews(LAN, TOKEN, USER, r.onSuccess, r.onError);
    assert.equal(h.sentCount(), 1);

    h.last().respondJson({ Items: [{ Id: 'v1', Name: 'Films' }] });
    for (const r of abonnes) {
        assert.equal(r.calls, 1);
        assert.equal(r.ok[0][0].Id, 'v1');
    }
});

test('coalescence : l\'échec du leader est propagé à tous, une seule fois', () => {
    const h = createBridge();
    const a = recorder();
    const b = recorder();
    h.bridge.fetchViews(LAN, TOKEN, USER, a.onSuccess, a.onError);
    h.bridge.fetchViews(LAN, TOKEN, USER, b.onSuccess, b.onError);
    h.last().respond({ status: 500, body: '{}' });
    assert.deepEqual([a.ko, b.ko], [['http_500'], ['http_500']]);
    assert.equal(a.calls + b.calls, 2);
});

test('coalescence : annuler un abonné ne coupe pas la réponse des autres', () => {
    const h = createBridge();
    const a = recorder();
    const b = recorder();
    const ha = h.bridge.fetchViews(LAN, TOKEN, USER, a.onSuccess, a.onError);
    h.bridge.fetchViews(LAN, TOKEN, USER, b.onSuccess, b.onError);

    ha.cancel('page_quittee');
    h.flush();
    assert.equal(h.last().aborted, false, 'le transport reste vivant pour b');
    assert.equal(ha.isActive(), false);

    h.last().respondJson({ Items: [{ Id: 'v1' }] });
    assert.equal(a.calls, 0, 'l\'abonné annulé n\'est jamais rappelé');
    assert.equal(b.calls, 1);
});

test('coalescence : le dernier abonné qui part libère le transport', () => {
    const h = createBridge();
    const a = recorder();
    const b = recorder();
    const ha = h.bridge.fetchViews(LAN, TOKEN, USER, a.onSuccess, a.onError);
    const hb = h.bridge.fetchViews(LAN, TOKEN, USER, b.onSuccess, b.onError);

    ha.cancel();
    hb.cancel();
    h.flush();
    assert.equal(h.last().aborted, true, 'plus personne n\'attend : on coupe');
    assert.equal(a.calls + b.calls, 0);
});

/* ------------------------------------------------------------------ */
/* TTL                                                                 */
/* ------------------------------------------------------------------ */

test('cache : une réponse récente est resservie sans requête', () => {
    const h = createBridge();
    const premier = recorder();
    h.bridge.fetchViews(LAN, TOKEN, USER, premier.onSuccess, premier.onError);
    h.last().respondJson({ Items: [{ Id: 'v1' }] });

    h.advance(1000);
    const second = recorder();
    h.bridge.fetchViews(LAN, TOKEN, USER, second.onSuccess, second.onError);
    h.flush();
    assert.equal(h.sentCount(), 1, 'aucune requête supplémentaire');
    assert.equal(second.ok[0][0].Id, 'v1');
});

/** Vérifie qu'une route est servie par le cache pendant exactement `ttl` ms. */
function verifieTtl(appel, ttl, nom) {
    const h = createBridge();
    appel(h.bridge, recorder());
    h.last().respondJson({ Id: 'item-9', Items: [{ Id: 'x' }] });

    // Juste avant l'expiration : toujours servi par le cache.
    h.advance(ttl - 1);
    appel(h.bridge, recorder());
    h.flush();
    assert.equal(h.sentCount(), 1, `${nom} : encore valide à ${ttl - 1} ms`);

    // Juste après : la requête repart.
    h.advance(2);
    appel(h.bridge, recorder());
    h.flush();
    assert.equal(h.sentCount(), 2, `${nom} : expiré à ${ttl + 1} ms`);
}

test('cache : chaque route a sa durée de vie', () => {
    verifieTtl((b, r) => b.fetchViews(LAN, TOKEN, USER, r.onSuccess, r.onError),
               90000, 'UserViews');
    verifieTtl((b, r) => b.fetchHomeNextUpItems(LAN, TOKEN, USER, 10, r.onSuccess, r.onError),
               15000, 'Shows/NextUp');
    verifieTtl((b, r) => b.fetchHomeResumeItems(LAN, TOKEN, USER, 10, r.onSuccess, r.onError),
               12000, 'UserItems/Resume');
    verifieTtl((b, r) => b.fetchUserItem(LAN, TOKEN, USER, 'item-9', r.onSuccess, r.onError),
               2500, 'fiche item');
});

test('cache : « Derniers ajouts » tient les 120 s annoncées par _apiGetTtlMs', () => {
    // /Items/Latest?UserId=... ressemble à une fiche d'item : s'il est pris
    // pour tel, la rangée retombe au TTL de 2,5 s et chaque retour sur
    // HomePage la recharge, ce qui est coûteux sur Révolution.
    verifieTtl((b, r) => b.fetchHomeLatestItemsForParent(LAN, TOKEN, USER, 'p1', 10,
                                                         r.onSuccess, r.onError),
               120000, 'Items/Latest');
});

test('cache : « Derniers ajouts » ne s\'invalide que par son ParentId', () => {
    const h = createBridge();
    h.bridge.fetchHomeLatestItemsForParent(LAN, TOKEN, USER, 'p1', 10,
                                           recorder().onSuccess, recorder().onError);
    h.last().respondJson({ Items: [{ Id: 'a' }] });

    // « Latest » n'est pas un identifiant d'item : aucune invalidation de
    // fiche ne doit atteindre la rangée.
    assert.equal(h.bridge.evictUserItemApiCache('Latest'), false);
    h.bridge.fetchHomeLatestItemsForParent(LAN, TOKEN, USER, 'p1', 10,
                                           recorder().onSuccess, recorder().onError);
    h.flush();
    assert.equal(h.sentCount(), 1, 'la rangée doit rester en cache');

    // La voie prévue, elle, fonctionne toujours.
    assert.equal(h.bridge.evictLatestParentApiCache('p1'), true);
    h.bridge.fetchHomeLatestItemsForParent(LAN, TOKEN, USER, 'p1', 10,
                                           recorder().onSuccess, recorder().onError);
    h.flush();
    assert.equal(h.sentCount(), 2);
});

test('cache : une erreur n\'est jamais mémorisée comme une réponse', () => {
    const h = createBridge();
    const a = recorder();
    h.bridge.fetchViews(LAN, TOKEN, USER, a.onSuccess, a.onError);
    h.last().respond({ status: 404, body: '{}' });

    const b = recorder();
    h.bridge.fetchViews(LAN, TOKEN, USER, b.onSuccess, b.onError);
    h.flush();
    assert.equal(h.sentCount(), 2, 'la requête doit être retentée');
});

/* ------------------------------------------------------------------ */
/* Isolation des sessions                                              */
/* ------------------------------------------------------------------ */

test('cache : jamais de partage entre deux tokens, deux profils ou deux serveurs', () => {
    const variantes = [
        ['token différent', (b, r) => b.fetchViews(LAN, 'tok-AUTRE', USER, r.onSuccess, r.onError)],
        ['profil différent', (b, r) => b.fetchViews(LAN, TOKEN, 'user-2', r.onSuccess, r.onError)],
        ['serveur différent', (b, r) => b.fetchViews('http://192.168.1.9:8096', TOKEN, USER, r.onSuccess, r.onError)],
    ];
    for (const [nom, appel] of variantes) {
        const h = createBridge();
        h.bridge.fetchViews(LAN, TOKEN, USER, recorder().onSuccess, recorder().onError);
        h.last().respondJson({ Items: [{ Id: 'v1' }] });

        const r = recorder();
        appel(h.bridge, r);
        h.flush();
        assert.equal(h.sentCount(), 2, nom + ' : le cache ne doit pas être partagé');
    }
});

test('clearApiCaches : les abonnés en attente sont libérés avec cache_cleared', () => {
    const h = createBridge();
    const r = recorder();
    h.bridge.fetchViews(LAN, TOKEN, USER, r.onSuccess, r.onError);

    assert.equal(h.bridge.clearApiCaches(true), true);
    h.flush();
    // fetchViews normalise l'erreur en code public via SafeLog.
    assert.deepEqual(r.ko, ['cache_cleared']);
    assert.equal(h.last().aborted, true, 'le leader est coupé quand on le demande');
});

test('clearApiCaches : une réponse de l\'ancienne session ne réhydrate pas le cache', () => {
    const h = createBridge();
    const r = recorder();
    h.bridge.fetchViews(LAN, TOKEN, USER, r.onSuccess, r.onError);

    // Changement de profil : on vide, sans couper le transport en vol.
    h.bridge.clearApiCaches(false);
    h.flush();
    h.last().respondJson({ Items: [{ Id: 'ANCIEN' }] });

    const apres = recorder();
    h.bridge.fetchViews(LAN, TOKEN, USER, apres.onSuccess, apres.onError);
    h.flush();
    assert.equal(h.sentCount(), 2, 'la réponse de l\'ancien epoch est ignorée');
    h.last().respondJson({ Items: [{ Id: 'NOUVEAU' }] });
    assert.equal(apres.ok[0][0].Id, 'NOUVEAU');
});

/* ------------------------------------------------------------------ */
/* Invalidations ciblées                                               */
/* ------------------------------------------------------------------ */

test('evictUserItemApiCache : invalide la fiche d\'un item après un changement d\'état', () => {
    const h = createBridge();
    h.bridge.fetchUserItem(LAN, TOKEN, USER, 'item-9', recorder().onSuccess, recorder().onError);
    h.last().respondJson({ Id: 'item-9', UserData: { Played: false } });

    // Sans invalidation, la fiche reste en cache 2,5 s.
    h.bridge.fetchUserItem(LAN, TOKEN, USER, 'item-9', recorder().onSuccess, recorder().onError);
    h.flush();
    assert.equal(h.sentCount(), 1);

    // « Marquer comme vu » doit rendre la fiche périmée immédiatement.
    assert.equal(h.bridge.evictUserItemApiCache('item-9'), true);
    const r = recorder();
    h.bridge.fetchUserItem(LAN, TOKEN, USER, 'item-9', r.onSuccess, r.onError);
    h.flush();
    assert.equal(h.sentCount(), 2);
    h.last().respondJson({ Id: 'item-9', UserData: { Played: true } });
    assert.equal(r.ok[0].UserData.Played, true);
});

test('evictUserItemApiCache : ne touche pas les autres items ni les autres listes', () => {
    const h = createBridge();
    h.bridge.fetchUserItem(LAN, TOKEN, USER, 'item-9', recorder().onSuccess, recorder().onError);
    h.last().respondJson({ Id: 'item-9' });
    h.bridge.fetchViews(LAN, TOKEN, USER, recorder().onSuccess, recorder().onError);
    h.last().respondJson({ Items: [{ Id: 'v1' }] });
    assert.equal(h.sentCount(), 2);

    assert.equal(h.bridge.evictUserItemApiCache('item-AUTRE'), false);
    h.bridge.fetchUserItem(LAN, TOKEN, USER, 'item-9', recorder().onSuccess, recorder().onError);
    h.bridge.fetchViews(LAN, TOKEN, USER, recorder().onSuccess, recorder().onError);
    h.flush();
    assert.equal(h.sentCount(), 2, 'rien ne devait être invalidé');
});

test('evictLatestParentApiCache : invalide la rangée « Derniers ajouts » d\'une bibliothèque', () => {
    const h = createBridge();
    const derniers = (parent, r) =>
        h.bridge.fetchHomeLatestItemsForParent(LAN, TOKEN, USER, parent, 10, r.onSuccess, r.onError);

    derniers('p1', recorder());
    h.last().respondJson({ Items: [{ Id: 'a' }] });
    derniers('p2', recorder());
    h.last().respondJson({ Items: [{ Id: 'b' }] });
    assert.equal(h.sentCount(), 2);

    assert.equal(h.bridge.evictLatestParentApiCache('p1'), true);
    derniers('p1', recorder());
    h.flush();
    assert.equal(h.sentCount(), 3, 'p1 doit être rechargée');
    h.last().respondJson({ Items: [{ Id: 'a2' }] });

    derniers('p2', recorder());
    h.flush();
    assert.equal(h.sentCount(), 3, 'p2 reste en cache');
});

/* ------------------------------------------------------------------ */
/* Cooldowns d'échec                                                   */
/* ------------------------------------------------------------------ */

test('cooldown : un 5xx sur « Derniers ajouts » met la bibliothèque au repos 10 min', () => {
    const h = createBridge();
    const derniers = (r) =>
        h.bridge.fetchHomeLatestItemsForParent(LAN, TOKEN, USER, 'p1', 10, r.onSuccess, r.onError);

    const premier = recorder();
    derniers(premier);
    h.last().respond({ status: 503, body: '{}' });
    assert.deepEqual(premier.ko, ['http_503']);

    const pendant = recorder();
    derniers(pendant);
    h.flush();
    assert.equal(h.sentCount(), 1, 'aucune nouvelle requête pendant le cooldown');
    assert.deepEqual(pendant.ko, ['http_500']);

    h.advance(600001);
    derniers(recorder());
    h.flush();
    assert.equal(h.sentCount(), 2, 'le cooldown expire');
});

test('cooldown : une panne réseau ne met au repos qu\'une minute', () => {
    const h = createBridge();
    const derniers = (r) =>
        h.bridge.fetchHomeLatestItemsForParent(LAN, TOKEN, USER, 'p1', 10, r.onSuccess, r.onError);

    derniers(recorder());
    h.last().failNetwork();

    h.advance(59000);
    derniers(recorder());
    h.flush();
    assert.equal(h.sentCount(), 1);

    h.advance(2000);
    derniers(recorder());
    h.flush();
    assert.equal(h.sentCount(), 2);
});

test('cooldown : il est limité à la bibliothèque fautive', () => {
    const h = createBridge();
    h.bridge.fetchHomeLatestItemsForParent(LAN, TOKEN, USER, 'p1', 10,
                                           recorder().onSuccess, recorder().onError);
    h.last().respond({ status: 503, body: '{}' });

    h.bridge.fetchHomeLatestItemsForParent(LAN, TOKEN, USER, 'p2', 10,
                                           recorder().onSuccess, recorder().onError);
    h.flush();
    assert.equal(h.sentCount(), 2, 'p2 n\'a rien à voir avec la panne de p1');
});

test('cooldown : le code renvoyé ne doit jamais déclencher la purge de session', () => {
    // UserStore purge le token stocké sur invalid_token / http_400 / 401 / 403.
    // Un cooldown local doit rester un 5xx neutre.
    const h = createBridge();
    h.bridge.fetchHomeLatestItemsForParent(LAN, TOKEN, USER, 'p1', 10,
                                           recorder().onSuccess, recorder().onError);
    h.last().respond({ status: 503, body: '{}' });

    const r = recorder();
    h.bridge.fetchHomeLatestItemsForParent(LAN, TOKEN, USER, 'p1', 10, r.onSuccess, r.onError);
    h.flush();
    const Store = require('./qmljs').loadQmlJs('qml/js/UserStore.js');
    assert.equal(Store.shouldDropStoredToken(r.ko[0]), false);
});

test('cooldown : une réponse correcte efface le cooldown de la bibliothèque', () => {
    const h = createBridge();
    const derniers = (r) =>
        h.bridge.fetchHomeLatestItemsForParent(LAN, TOKEN, USER, 'p1', 10, r.onSuccess, r.onError);

    derniers(recorder());
    h.last().failNetwork();
    h.advance(60001);

    derniers(recorder());
    h.last().respondJson({ Items: [{ Id: 'a' }] });
    assert.equal(h.sentCount(), 2);

    // Au-delà de tout TTL : plus aucun cooldown ne doit traîner.
    h.advance(600001);
    derniers(recorder());
    h.flush();
    assert.equal(h.sentCount(), 3);
});
