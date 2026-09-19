'use strict';

/*
 * Coffre de session de qml/js/UserStore.js.
 *
 * C'est la partie la plus sensible du dépôt : elle décide où atterrit un
 * accessToken Jellyfin. Les contrats protégés ici sont ceux qu'une régression
 * (locale ou importée d'une nouvelle version amont) rendrait invisible mais
 * grave : un token en clair dans fbx.application.Settings, un token qui
 * survit à un « oublier ce profil », ou un token relu pour un autre profil,
 * un autre serveur ou une autre installation.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const {
    SRV_A, SRV_B, SRV_WAN_HTTP, DEVICE_ID_OTHER,
    makeStore, freshStore, vaultMap, storedUsers,
} = require('./userstoreharness');

const TOKEN_A = 'tok-TEST-aaaaaaaaaaaaaaaaaaaaaaaa';
const TOKEN_B = 'tok-TEST-bbbbbbbbbbbbbbbbbbbbbbbb';

function login(Store, serverUrl, userId, token, remember) {
    Store.addOrUpdateUser({
        serverUrl: serverUrl,
        serverName: 'Jellyfin de test',
        userId: userId,
        userName: 'Profil ' + userId,
        accessToken: token,
        remember: remember !== false,
    });
}

function tokenOf(Store, serverUrl, userId) {
    const list = Store.listUsers(serverUrl) || [];
    for (let i = 0; i < list.length; i++) {
        if (String(list[i].userId) === String(userId))
            return String(list[i].accessToken || '');
    }
    return null;
}

// ---------------------------------------------------------------------------
// Ce qui est persisté, et sous quelle forme
// ---------------------------------------------------------------------------

test('le token n\'est jamais écrit en clair dans Settings', () => {
    const { settings, Store } = freshStore();
    login(Store, SRV_A, 'u1', TOKEN_A);

    // usersJson / usersServersJson / usersActiveKey : aucune trace du secret.
    assert.equal(settings.usersJson.indexOf(TOKEN_A), -1);
    assert.equal(settings.usersServersJson.indexOf(TOKEN_A), -1);
    assert.equal(settings.usersActiveKey.indexOf(TOKEN_A), -1);
    // La propriété legacy lastAccessToken n'est même pas touchée.
    assert.equal(storedUsers(settings)[0].accessToken, '');

    // Le coffre contient bien quelque chose, mais pas le token lisible.
    const map = vaultMap(settings);
    assert.equal(Object.keys(map).length, 1);
    const encoded = map[Object.keys(map)[0]];
    assert.equal(encoded.indexOf(TOKEN_A), -1);
    assert.match(encoded, /^v3:[0-9a-f]{8}:[0-9a-f]{8}:[0-9a-f]+$/);
});

test('la clé du coffre ne révèle ni le serveur ni l\'identifiant du profil', () => {
    const { settings, Store } = freshStore();
    login(Store, SRV_A, 'utilisateur-lisible', TOKEN_A);

    const key = Object.keys(vaultMap(settings))[0];
    assert.equal(key.indexOf('utilisateur-lisible'), -1);
    assert.equal(key.indexOf('192.168.51.10'), -1);
});

test('la session mémorisée survit à un redémarrage de l\'application', () => {
    const { settings, Store } = freshStore();
    login(Store, SRV_A, 'u1', TOKEN_A);

    // Instance de module neuve (cache RAM vide) sur le même Settings.
    const restarted = makeStore(settings);
    const list = restarted.listUsers();
    assert.equal(list.length, 1);
    assert.equal(list[0].accessToken, TOKEN_A);
    assert.equal(list[0].remember, true);
});

test('un profil enregistré sans mémorisation ne laisse rien au redémarrage', () => {
    const { settings, Store } = freshStore();
    login(Store, SRV_A, 'u1', TOKEN_A, false);

    // Dans la session courante le token reste utilisable en RAM…
    assert.equal(tokenOf(Store, SRV_A, 'u1'), TOKEN_A);
    // …mais rien n'est persisté.
    assert.deepEqual(Object.keys(vaultMap(settings)), []);
    assert.equal(makeStore(settings).listUsers()[0].accessToken, '');
    assert.equal(makeStore(settings).listUsers()[0].remember, false);
});

// ---------------------------------------------------------------------------
// Cloisonnement : un token ne traverse ni profil, ni serveur, ni installation
// ---------------------------------------------------------------------------

test('chaque profil a son entrée de coffre, deux profils ne se mélangent pas', () => {
    const { settings, Store } = freshStore();
    login(Store, SRV_A, 'u1', TOKEN_A);
    login(Store, SRV_A, 'u2', TOKEN_B);

    assert.equal(Object.keys(vaultMap(settings)).length, 2);

    const restarted = makeStore(settings);
    assert.equal(tokenOf(restarted, SRV_A, 'u1'), TOKEN_A);
    assert.equal(tokenOf(restarted, SRV_A, 'u2'), TOKEN_B);
});

test('une entrée de coffre déplacée vers un autre profil ne se décode pas', () => {
    const { settings, Store } = freshStore();
    login(Store, SRV_A, 'u1', TOKEN_A);
    login(Store, SRV_A, 'u2', TOKEN_B);

    // Un attaquant (ou un Settings corrompu) permute les deux valeurs.
    const map = vaultMap(settings);
    const keys = Object.keys(map);
    const swapped = {};
    swapped[keys[0]] = map[keys[1]];
    swapped[keys[1]] = map[keys[0]];
    settings.usersSessionVaultJson = JSON.stringify(swapped);

    const restarted = makeStore(settings);
    assert.equal(tokenOf(restarted, SRV_A, 'u1'), '');
    assert.equal(tokenOf(restarted, SRV_A, 'u2'), '');
    // Aucun profil ne se retrouve marqué « mémorisé » à tort.
    (restarted.listUsers() || []).forEach((u) => assert.equal(u.remember, false));
});

test('le même userId sur deux serveurs donne deux sessions distinctes', () => {
    const { settings, Store } = freshStore();
    login(Store, SRV_A, 'meme-uid', TOKEN_A);
    login(Store, SRV_B, 'meme-uid', TOKEN_B);

    const restarted = makeStore(settings);
    assert.equal(tokenOf(restarted, SRV_A, 'meme-uid'), TOKEN_A);
    assert.equal(tokenOf(restarted, SRV_B, 'meme-uid'), TOKEN_B);
});

test('un coffre copié sur une autre installation ReDeFin est illisible', () => {
    const { settings, Store } = freshStore();
    login(Store, SRV_A, 'u1', TOKEN_A);
    const stolenVault = settings.usersSessionVaultJson;

    // Même coffre, mais l'identifiant d'installation (clientId.js) diffère.
    const other = freshStore({
        jellyfinDeviceId: DEVICE_ID_OTHER,
        usersJson: settings.usersJson,
        usersSessionVaultJson: stolenVault,
    });
    assert.equal(tokenOf(other.Store, SRV_A, 'u1'), '');

    // L'entrée n'est pas détruite pour autant : un contexte inattendu ne doit
    // pas faire perdre une session encore valable ailleurs.
    assert.equal(Object.keys(vaultMap(other.settings)).length, 1);
});

test('sans identifiant d\'installation, rien n\'est persisté', () => {
    const { settings, Store } = freshStore({ jellyfinDeviceId: '' });
    login(Store, SRV_A, 'u1', TOKEN_A);

    assert.equal(settings.usersSessionVaultJson, '{}');
    // Le token reste néanmoins utilisable pendant le lancement courant.
    assert.equal(tokenOf(Store, SRV_A, 'u1'), TOKEN_A);
});

test('un identifiant d\'installation invalide est traité comme absent', () => {
    ['redefin-freebox', 'rdf-court', 'FBX-SERIAL-1234567890'].forEach((bad) => {
        const { settings, Store } = freshStore({ jellyfinDeviceId: bad });
        login(Store, SRV_A, 'u1', TOKEN_A);
        assert.equal(settings.usersSessionVaultJson, '{}', 'deviceId=' + bad);
    });
});

// ---------------------------------------------------------------------------
// Politique de transport : aucun secret sur du HTTP hors LAN
// ---------------------------------------------------------------------------

test('un serveur HTTP hors LAN ne reçoit ni persistance ni mémorisation', () => {
    const { settings, Store } = freshStore();
    login(Store, SRV_WAN_HTTP, 'u1', TOKEN_A);

    assert.equal(settings.usersSessionVaultJson, '{}');
    const list = Store.listUsers(SRV_WAN_HTTP);
    assert.equal(list.length, 1, 'le profil lui-même reste listé');
    assert.equal(list[0].accessToken, '');
    assert.equal(list[0].remember, false);
    assert.equal(Store.isWanHttpUrl(SRV_WAN_HTTP), true);
    assert.equal(Store.isWanHttpUrl(SRV_A), false);
});

test('un token malformé n\'est jamais stocké', () => {
    const cases = [
        ['espace', 'tok avec espace'],
        ['retour-ligne', 'tok\navec-crlf'],
        ['controle', 'tok nul'],
        ['trop-long', 'x'.repeat(4097)],
        ['vide', '   '],
    ];
    cases.forEach(([label, token]) => {
        const { settings, Store } = freshStore();
        login(Store, SRV_A, 'u1', token);
        assert.equal(tokenOf(Store, SRV_A, 'u1'), '', label);
        assert.equal(settings.usersSessionVaultJson, '{}', label);
    });

    // Un token de 4096 caractères reste accepté (borne inclusive).
    const { Store } = freshStore();
    const long = 'a'.repeat(4096);
    login(Store, SRV_A, 'u1', long);
    assert.equal(tokenOf(Store, SRV_A, 'u1'), long);
});

// ---------------------------------------------------------------------------
// Effacement : oubli d'un profil, d'un serveur, de l'appareil
// ---------------------------------------------------------------------------

test('removeUser efface le profil et son secret, y compris après redémarrage', () => {
    const { settings, Store } = freshStore();
    login(Store, SRV_A, 'u1', TOKEN_A);
    login(Store, SRV_B, 'u2', TOKEN_B);

    Store.removeUser(SRV_A, 'u1');

    assert.equal(Object.keys(vaultMap(settings)).length, 1, 'seule l\'entrée visée part');
    const restarted = makeStore(settings);
    assert.equal(restarted.listUsers(SRV_A).length, 0);
    assert.equal(tokenOf(restarted, SRV_B, 'u2'), TOKEN_B, 'l\'autre profil est intact');
});

test('clearUserToken ne laisse ni copie RAM ni copie persistante', () => {
    const { settings, Store } = freshStore();
    login(Store, SRV_A, 'u1', TOKEN_A);

    Store.clearUserToken(SRV_A, 'u1');

    assert.equal(settings.usersSessionVaultJson, '{}');
    assert.equal(tokenOf(Store, SRV_A, 'u1'), '');
    assert.equal(Store.listUsers(SRV_A)[0].remember, false);
    assert.equal(tokenOf(makeStore(settings), SRV_A, 'u1'), '');
});

test('clearServer efface les profils et les tokens du seul serveur visé', () => {
    const { settings, Store } = freshStore();
    login(Store, SRV_A, 'u1', TOKEN_A);
    login(Store, SRV_B, 'u2', TOKEN_B);

    Store.clearServer(SRV_A);

    // (listes issues d'un autre realm : on compare des chaînes, pas les objets)
    assert.equal((Store.listUsers() || []).map((u) => u.userId).join('|'), 'u2');
    assert.equal((Store.listServers() || []).map((s) => s.serverUrl).join('|'), SRV_B);
    assert.equal(Object.keys(vaultMap(settings)).length, 1);
    assert.equal(tokenOf(makeStore(settings), SRV_A, 'u1'), null);
    assert.equal(tokenOf(makeStore(settings), SRV_B, 'u2'), TOKEN_B);
});

test('forgetThisDevice remet tout le stockage à zéro', () => {
    const { settings, Store } = freshStore();
    login(Store, SRV_A, 'u1', TOKEN_A);
    login(Store, SRV_B, 'u2', TOKEN_B);
    Store.saveUserPrefs(SRV_A, 'u1', { lang: 'fr' });

    Store.forgetThisDevice();

    assert.equal(settings.usersJson, '[]');
    assert.equal(settings.usersServersJson, '[]');
    assert.equal(settings.usersActiveKey, '');
    assert.equal(settings.usersSessionVaultJson, '{}');

    const restarted = makeStore(settings);
    assert.equal((restarted.listUsers() || []).length, 0);
    assert.equal((restarted.listServers() || []).length, 0);
    assert.equal(restarted.getActive(), null);
});

test('une déconnexion (accessToken vide) purge le coffre du profil', () => {
    // Chemin ShellPage._afterLogout() sans suppression du profil.
    const { settings, Store } = freshStore();
    login(Store, SRV_A, 'u1', TOKEN_A);

    Store.addOrUpdateUser({
        serverUrl: SRV_A, userId: 'u1', accessToken: '', remember: true,
    });

    assert.equal(settings.usersSessionVaultJson, '{}');
    assert.equal(tokenOf(makeStore(settings), SRV_A, 'u1'), '');
});

test('une déconnexion purge aussi la copie RAM du token', () => {
    // Sans attendre un redémarrage : la lecture des profils réinjecte le token
    // du coffre dans le cache RAM, la purge doit donc passer après elle.
    const { Store } = freshStore();
    login(Store, SRV_A, 'u1', TOKEN_A);

    Store.addOrUpdateUser({
        serverUrl: SRV_A, userId: 'u1', accessToken: '', remember: true,
    });

    assert.equal(tokenOf(Store, SRV_A, 'u1'), '');
    assert.equal(String((Store.getActive() || {}).accessToken || ''), '');
});

test('une connexion sans mémorisation garde la session de l\'instance courante', () => {
    // Voisin à ne pas casser : « ne pas mémoriser » n'est pas une déconnexion,
    // le token fourni doit rester servi tant que l'application tourne.
    const { settings, Store } = freshStore();
    login(Store, SRV_A, 'u1', TOKEN_A, false);

    assert.equal(tokenOf(Store, SRV_A, 'u1'), TOKEN_A);
    assert.equal(settings.usersSessionVaultJson, '{}');
    assert.equal(tokenOf(makeStore(settings), SRV_A, 'u1'), '');
});

test('décocher « mémoriser » vide le coffre sans couper la session en cours', () => {
    // Voisin à ne pas casser : l'appel ne porte pas de champ accessToken, il
    // ne doit donc toucher qu'à la persistance.
    const { settings, Store } = freshStore();
    login(Store, SRV_A, 'u1', TOKEN_A);

    Store.addOrUpdateUser({ serverUrl: SRV_A, userId: 'u1', remember: false });

    assert.equal(settings.usersSessionVaultJson, '{}');
    assert.equal(tokenOf(Store, SRV_A, 'u1'), TOKEN_A);
    assert.equal(tokenOf(makeStore(settings), SRV_A, 'u1'), '');
});

// ---------------------------------------------------------------------------
// Modes de sécurité
// ---------------------------------------------------------------------------

test('le mode sécurité maximale purge le coffre et interdit toute persistance', () => {
    const { settings, Store } = freshStore();
    login(Store, SRV_A, 'u1', TOKEN_A);
    assert.notEqual(settings.usersSessionVaultJson, '{}');

    Store.configureSecurityPolicy(false, true);

    assert.equal(settings.usersSessionVaultJson, '{}');
    assert.equal(Store.canPersistTokens(), false);
    assert.equal(storedUsers(settings)[0].remember, false);

    // Une nouvelle connexion ne réamorce rien tant que le mode est actif.
    login(Store, SRV_A, 'u1', TOKEN_A);
    assert.equal(settings.usersSessionVaultJson, '{}');
});

test('le mode sécurité maximale est aussi lu directement dans Settings', () => {
    const { settings, Store } = freshStore(
        { maximumSessionSecurity: true }, { configure: false });
    assert.equal(Store.maximumSecurityModeEnabled(), true);
    assert.equal(Store.canPersistTokens(), false);

    login(Store, SRV_A, 'u1', TOKEN_A);
    assert.equal(settings.usersSessionVaultJson, '{}');
});

test('le booléen legacy rememberJellyfinSession ne révoque pas une session mémorisée', () => {
    // Régression connue : décocher le réglage global ne doit pas invalider un
    // profil que l'utilisateur a explicitement demandé de mémoriser.
    const { settings, Store } = freshStore();
    login(Store, SRV_A, 'u1', TOKEN_A);

    settings.rememberJellyfinSession = false;
    const restarted = makeStore(settings, { remember: false });

    assert.equal(restarted.canPersistTokens(), true);
    assert.equal(tokenOf(restarted, SRV_A, 'u1'), TOKEN_A);
    assert.equal(restarted.listUsers(SRV_A)[0].remember, true);
});

test('configureSecurityPolicy est idempotent : aucune écriture Settings inutile', () => {
    const { settings, Store } = freshStore();
    login(Store, SRV_A, 'u1', TOKEN_A);

    const before = JSON.stringify(settings.writes);
    Store.configureSecurityPolicy(true, false);
    Store.configureSecurityPolicy(true, false);
    Store.configureSecurityPolicy(true, false);
    assert.equal(JSON.stringify(settings.writes), before);
});

test('lire les profils n\'écrit jamais dans Settings', () => {
    const { settings, Store } = freshStore();
    login(Store, SRV_A, 'u1', TOKEN_A);

    const before = JSON.stringify(settings.writes);
    Store.listUsers();
    Store.listUsers(SRV_A);
    Store.listServers();
    Store.getActive();
    Store.getUserPrefs(SRV_A, 'u1');
    assert.equal(JSON.stringify(settings.writes), before);
});

// ---------------------------------------------------------------------------
// Migration et tolérance aux données abîmées
// ---------------------------------------------------------------------------

test('un ancien usersJson contenant un token brut est migré vers le coffre', () => {
    const legacy = JSON.stringify([{
        serverUrl: SRV_A, userId: 'u1', userName: 'Alice',
        accessToken: 'tok-TEST-legacy', remember: true,
    }]);
    const { settings, Store } = freshStore({ usersJson: legacy });

    const list = Store.listUsers();
    assert.equal(list[0].accessToken, 'tok-TEST-legacy');
    // Le token brut a disparu du stockage de profils…
    assert.equal(settings.usersJson.indexOf('tok-TEST-legacy'), -1);
    assert.equal(storedUsers(settings)[0].accessToken, '');
    // …et se retrouve dans le coffre, donc encore disponible au redémarrage.
    assert.equal(Object.keys(vaultMap(settings)).length, 1);
    assert.equal(tokenOf(makeStore(settings), SRV_A, 'u1'), 'tok-TEST-legacy');
});

test('un ancien usersJson en mode sécurité maximale perd son token sans le migrer', () => {
    const legacy = JSON.stringify([{
        serverUrl: SRV_A, userId: 'u1',
        accessToken: 'tok-TEST-legacy', remember: true,
    }]);
    const { settings, Store } = freshStore(
        { usersJson: legacy }, { remember: false, maximumSecurity: true });

    assert.equal(settings.usersSessionVaultJson, '{}');
    assert.equal(Store.listUsers()[0].accessToken, '');
    assert.equal(settings.usersJson.indexOf('tok-TEST-legacy'), -1);
});

test('un coffre illisible est neutralisé sans exception ni perte de profils', () => {
    const cases = ['pas du json', '[]', 'null', '"x"', '{"u#abc":{"deep":1}}'];
    cases.forEach((raw) => {
        const users = JSON.stringify([{ serverUrl: SRV_A, userId: 'u1' }]);
        const { settings, Store } = freshStore({
            usersJson: users, usersSessionVaultJson: raw,
        });
        const list = Store.listUsers();
        assert.equal(list.length, 1, 'vault=' + raw);
        assert.equal(list[0].accessToken, '', 'vault=' + raw);
        // Le store reste utilisable : une nouvelle connexion repart proprement.
        login(Store, SRV_A, 'u1', TOKEN_A);
        assert.equal(tokenOf(makeStore(settings), SRV_A, 'u1'), TOKEN_A, 'vault=' + raw);
    });
});

test('une entrée de coffre corrompue n\'est pas servie comme token', () => {
    const { settings, Store } = freshStore();
    login(Store, SRV_A, 'u1', TOKEN_A);

    const map = vaultMap(settings);
    const key = Object.keys(map)[0];
    const corrupted = {};
    // Somme de contrôle cassée : le payload est déchiffré puis rejeté.
    corrupted[key] = map[key].replace(/^v3:([0-9a-f]{8}):[0-9a-f]{8}:/,
                                      'v3:$1:00000000:');
    settings.usersSessionVaultJson = JSON.stringify(corrupted);

    assert.equal(tokenOf(makeStore(settings), SRV_A, 'u1'), '');
});

test('un coffre plus gros que la limite est réinitialisé', () => {
    const huge = {};
    for (let i = 0; i < 4000; i++) huge['u#' + i] = 'v3:deadbeef:deadbeef:' + 'ab'.repeat(40);
    const raw = JSON.stringify(huge);
    assert.ok(raw.length > 131072, 'le fixture doit dépasser MAX_VAULT_JSON_LEN');

    const { settings, Store } = freshStore({ usersSessionVaultJson: raw });
    login(Store, SRV_A, 'u1', TOKEN_A);

    // Le coffre a été vidé puis réécrit avec la seule session valide.
    assert.equal(Object.keys(vaultMap(settings)).length, 1);
    assert.equal(tokenOf(makeStore(settings), SRV_A, 'u1'), TOKEN_A);
});

test('le coffre ne dépasse pas MAX_USERS entrées', () => {
    const { settings, Store } = freshStore();
    for (let i = 0; i < 30; i++)
        login(Store, SRV_A, 'u' + i, TOKEN_A + i);
    assert.ok(Object.keys(vaultMap(settings)).length <= 24,
              'MAX_USERS entrées de coffre au plus');
    // Le dernier profil connecté reste lisible au redémarrage.
    assert.equal(tokenOf(makeStore(settings), SRV_A, 'u29'), TOKEN_A + '29');
});

test('sans objet Settings, le store fonctionne en mémoire sans rien persister', () => {
    const Store = makeStore(null, { configure: false });
    Store.init({ nothing: true });
    assert.equal(Store.canPersistTokens(), false);
    Store.addOrUpdateUser({
        serverUrl: SRV_A, userId: 'u1', accessToken: TOKEN_A, remember: true,
    });
    // Repli RAM : le profil existe, mais la mémorisation est refusée.
    const list = Store.listUsers();
    assert.equal(list.length, 1);
    assert.equal(list[0].remember, false);
});
