'use strict';

/*
 * Profils, serveurs mémorisés et préférences de qml/js/UserStore.js.
 *
 * Ce sont les données que l'écran « Qui regarde ? » lit à chaque démarrage.
 * Les régressions sensibles visées ici : une URL de serveur normalisée
 * différemment qui dédouble un profil (et donc sa session), un profil
 * supprimé qui réapparaît, un stockage abîmé qui fait lever une exception
 * pendant le boot, un garde-fou de taille qui saute, et surtout une
 * préférence par profil qui se met à transporter un secret — puisque les
 * prefs, elles, sont bien écrites en clair dans fbx.application.Settings.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const {
    SRV_A, SRV_B, makeStore, freshStore, storedUsers,
} = require('./userstoreharness');

function ids(list) {
    return (list || []).map((u) => String(u.userId)).join('|');
}

// ---------------------------------------------------------------------------
// Normalisation de l'URL serveur : clé de tout le stockage
// ---------------------------------------------------------------------------

test('les écritures d\'une même URL serveur convergent vers un seul profil', () => {
    const variants = [
        SRV_A,                                   // forme canonique
        SRV_A + '/',                             // slash final
        SRV_A + '/web/index.html',               // URL copiée depuis le navigateur
        SRV_A + '/web',
        SRV_A + '?token=tok-TEST',               // query parasite
        '192.168.51.10:8096',                    // sans schéma, hôte LAN
    ];
    const { Store } = freshStore();
    variants.forEach((url) => Store.addOrUpdateUser({ serverUrl: url, userId: 'u1' }));

    assert.equal((Store.listUsers() || []).length, 1);
    assert.equal(Store.listUsers()[0].serverUrl, SRV_A);
    assert.equal((Store.listServers() || []).length, 1);
});

test({ todo: 'BUG : jellyfinBridge.normalizeServerUrl() ne met pas l\'autorité '
           + 'en minuscules (jellyfinBridge.js:835), donc « HTTP://Host » et '
           + '« http://host » créent deux profils et deux sessions.' },
'la casse du schéma et de l\'hôte ne dédouble pas un serveur', () => {
    const { Store } = freshStore();
    Store.addOrUpdateUser({ serverUrl: 'http://192.168.51.10:8096', userId: 'u1' });
    Store.addOrUpdateUser({ serverUrl: 'HTTP://192.168.51.10:8096', userId: 'u1' });

    assert.equal((Store.listUsers() || []).length, 1);
    assert.equal((Store.listServers() || []).length, 1);
});

test('une URL inexploitable n\'entre jamais dans le stockage', () => {
    const { settings, Store } = freshStore();
    ['', null, undefined, '   ', 'ftp://192.168.51.10', 'http://user@192.168.51.10:8096',
     'http://192.168.51.10:8096\r\nX: 1', 'x'.repeat(600)].forEach((url) => {
        Store.addOrUpdateUser({ serverUrl: url, userId: 'u1', userName: 'X' });
        Store.addOrUpdateServer({ serverUrl: url, name: 'X' });
    });
    assert.equal(settings.usersJson, '[]');
    assert.equal(settings.usersServersJson, '[]');
});

test('un profil sans userId est refusé', () => {
    const { settings, Store } = freshStore();
    [undefined, null, ''].forEach((uid) => {
        Store.addOrUpdateUser({ serverUrl: SRV_A, userId: uid });
    });
    assert.equal(settings.usersJson, '[]');
});

// ---------------------------------------------------------------------------
// Ordre, mise à jour et garde-fous de taille
// ---------------------------------------------------------------------------

test('les profils sont listés du plus récemment utilisé au plus ancien', () => {
    const { Store } = freshStore();
    Store.addOrUpdateUser({ serverUrl: SRV_A, userId: 'u1' });
    Store.addOrUpdateUser({ serverUrl: SRV_A, userId: 'u2' });
    Store.addOrUpdateUser({ serverUrl: SRV_A, userId: 'u3' });
    assert.equal(ids(Store.listUsers()), 'u3|u2|u1');

    Store.setActive(SRV_A, 'u1');
    assert.equal(ids(Store.listUsers()), 'u1|u3|u2');
    assert.equal(Store.getActive().userId, 'u1');
});

test('listUsers(serverUrl) ne montre que les profils du serveur demandé', () => {
    const { Store } = freshStore();
    Store.addOrUpdateUser({ serverUrl: SRV_A, userId: 'a1' });
    Store.addOrUpdateUser({ serverUrl: SRV_B, userId: 'b1' });
    Store.addOrUpdateUser({ serverUrl: SRV_A, userId: 'a2' });

    assert.equal(ids(Store.listUsers(SRV_A)), 'a2|a1');
    assert.equal(ids(Store.listUsers(SRV_B)), 'b1');
    assert.equal(ids(Store.listUsers(SRV_A + '/')), 'a2|a1', 'même filtre après normalisation');
    assert.equal((Store.listUsers() || []).length, 3);
});

test('mettre à jour un profil existant ne le duplique pas', () => {
    const { Store } = freshStore();
    Store.addOrUpdateUser({ serverUrl: SRV_A, userId: 'u1', userName: 'Alice' });
    Store.addOrUpdateUser({ serverUrl: SRV_A, userId: 'u1' });

    const list = Store.listUsers();
    assert.equal(list.length, 1);
    // Sans userName fourni, l'ancien est conservé.
    assert.equal(list[0].userName, 'Alice');
});

test('le nombre de profils et de serveurs est borné', () => {
    const { Store } = freshStore();
    for (let i = 0; i < 30; i++) Store.addOrUpdateUser({ serverUrl: SRV_A, userId: 'u' + i });
    const list = Store.listUsers();
    assert.equal(list.length, 24, 'MAX_USERS');
    assert.equal(list[0].userId, 'u29', 'les plus récents sont conservés');

    for (let i = 0; i < 30; i++)
        Store.addOrUpdateServer({ serverUrl: 'http://192.168.51.' + i + ':8096' });
    assert.equal((Store.listServers() || []).length, 24, 'MAX_SERVERS');
});

test('les champs texte trop longs sont tronqués avant stockage', () => {
    const { settings, Store } = freshStore();
    Store.addOrUpdateUser({
        serverUrl: SRV_A,
        userId: 'u'.repeat(400),
        userName: 'n'.repeat(400),
        imageTag: 't'.repeat(400),
    });
    const stored = storedUsers(settings)[0];
    assert.equal(stored.userId.length, 160);
    assert.equal(stored.userName.length, 192);
    assert.equal(stored.imageTag.length, 256);
});

// ---------------------------------------------------------------------------
// Profil actif
// ---------------------------------------------------------------------------

test('la clé du profil actif est un condensat, pas l\'URL et l\'identifiant', () => {
    const { settings, Store } = freshStore();
    Store.addOrUpdateUser({ serverUrl: SRV_A, userId: 'utilisateur-lisible' });

    assert.match(settings.usersActiveKey, /^active#[0-9a-f]{8}$/);
    assert.equal(settings.usersActiveKey.indexOf('utilisateur-lisible'), -1);
    assert.equal(settings.usersActiveKey.indexOf('192.168.51.10'), -1);
});

test('une ancienne clé active « serveur|utilisateur » est acceptée puis migrée', () => {
    const { settings, Store } = freshStore();
    Store.addOrUpdateUser({ serverUrl: SRV_A, userId: 'u1' });
    Store.addOrUpdateUser({ serverUrl: SRV_A, userId: 'u2' });
    settings.usersActiveKey = SRV_A + '|u1';

    const restarted = makeStore(settings);
    assert.equal(restarted.getActive().userId, 'u1');
    assert.match(settings.usersActiveKey, /^active#[0-9a-f]{8}$/);
    // La migration est stable : la clé réécrite désigne toujours le même profil.
    assert.equal(makeStore(settings).getActive().userId, 'u1');
});

test('une clé active orpheline retombe sur le profil le plus récent', () => {
    const { settings, Store } = freshStore();
    Store.addOrUpdateUser({ serverUrl: SRV_A, userId: 'u1' });
    Store.addOrUpdateUser({ serverUrl: SRV_A, userId: 'u2' });
    settings.usersActiveKey = 'active#deadbeef';

    const restarted = makeStore(settings);
    assert.equal(restarted.getActive().userId, 'u2');
    assert.equal(settings.usersActiveKey, '', 'la clé orpheline est purgée');
});

test('setActive refuse une cible incomplète et ne casse pas la clé existante', () => {
    const { settings, Store } = freshStore();
    Store.addOrUpdateUser({ serverUrl: SRV_A, userId: 'u1' });
    const key = settings.usersActiveKey;

    Store.setActive(SRV_A, '');
    Store.setActive('', 'u1');
    Store.setActive(null, null);

    assert.equal(settings.usersActiveKey, key);
    assert.equal(Store.getActive().userId, 'u1');
});

test('supprimer le profil actif remet la clé active à vide', () => {
    const { settings, Store } = freshStore();
    Store.addOrUpdateUser({ serverUrl: SRV_A, userId: 'u1' });
    Store.removeUser(SRV_A, 'u1');

    assert.equal(settings.usersActiveKey, '');
    assert.equal(Store.getActive(), null);
});

// ---------------------------------------------------------------------------
// Serveurs mémorisés
// ---------------------------------------------------------------------------

test('les serveurs sont dédoublonnés et triés par dernier usage', () => {
    const { Store } = freshStore();
    Store.addOrUpdateServer({ serverUrl: SRV_A, name: 'Maison' });
    Store.addOrUpdateServer({ serverUrl: SRV_B, name: 'Bureau' });
    Store.addOrUpdateServer({ serverUrl: SRV_A + '/', name: 'Maison' });

    const list = Store.listServers();
    assert.equal(list.length, 2);
    assert.equal(list[0].serverUrl, SRV_A, 'le plus récemment vu passe en tête');
    assert.equal(list[1].serverUrl, SRV_B);
});

test('un serveur sans nom prend son hôte comme libellé', () => {
    const { Store } = freshStore();
    Store.addOrUpdateServer({ serverUrl: SRV_A });
    assert.equal(Store.listServers()[0].name, '192.168.51.10:8096');
});

test({ todo: 'BUG : addOrUpdateServer() remplace le nom mémorisé par le repli '
           + '« hôte:port » dès qu\'un appel omet le nom (UserStore.js:715 avec '
           + '_sanitizeServerEntry qui pré-remplit toujours name). Or '
           + 'ShellPage._persistSession() et LoginPage._rememberServerUrl(url, null) '
           + 'appellent justement sans nom : le libellé Jellyfin est perdu.' },
'le nom d\'un serveur déjà connu survit à une mise à jour sans nom', () => {
    const { Store } = freshStore();
    Store.addOrUpdateServer({ serverUrl: SRV_A, name: 'Maison' });
    Store.addOrUpdateServer({ serverUrl: SRV_A });
    assert.equal(Store.listServers()[0].name, 'Maison');
});

test('removeServer n\'efface que la fiche serveur, pas les profils', () => {
    const { Store } = freshStore();
    Store.addOrUpdateUser({ serverUrl: SRV_A, userId: 'u1' });
    Store.removeServer(SRV_A);

    assert.equal((Store.listServers() || []).length, 0);
    assert.equal(ids(Store.listUsers()), 'u1');
});

// ---------------------------------------------------------------------------
// Données stockées abîmées
// ---------------------------------------------------------------------------

test('un usersJson illisible ne fait pas échouer le démarrage', () => {
    const cases = [
        'pas du json',
        '{"a":1}',
        'null',
        '[null,3,"x",[],{}]',
        '[{"userId":"sans-serveur"}]',
        '[{"serverUrl":"' + SRV_A + '"}]',
    ];
    cases.forEach((raw) => {
        const { Store } = freshStore({ usersJson: raw });
        assert.equal((Store.listUsers() || []).length, 0, raw);
        assert.equal(Store.getActive(), null, raw);
        // Le store reste écrivable.
        Store.addOrUpdateUser({ serverUrl: SRV_A, userId: 'u1' });
        assert.equal(ids(Store.listUsers()), 'u1', raw);
    });
});

test('un usersJson plus gros que la limite est remis à zéro', () => {
    const fat = [];
    for (let i = 0; i < 24; i++)
        fat.push({ serverUrl: SRV_A, userId: 'u' + i, userName: 'n'.repeat(20000) });
    const raw = JSON.stringify(fat);
    assert.ok(raw.length > 262144, 'le fixture doit dépasser MAX_USERS_JSON_LEN');

    const { settings, Store } = freshStore({ usersJson: raw });
    assert.equal((Store.listUsers() || []).length, 0);
    assert.equal(settings.usersJson, '[]');
});

test('un usersServersJson illisible donne une liste vide', () => {
    ['pas du json', '{"a":1}', '[null,2]', '[{"name":"sans url"}]'].forEach((raw) => {
        const { Store } = freshStore({ usersServersJson: raw });
        assert.equal((Store.listServers() || []).length, 0, raw);
    });
});

test('un profil supprimé ne ressuscite pas au redémarrage', () => {
    const { settings, Store } = freshStore();
    Store.addOrUpdateUser({ serverUrl: SRV_A, userId: 'u1' });
    Store.addOrUpdateUser({ serverUrl: SRV_A, userId: 'u2' });
    Store.removeUser(SRV_A, 'u1');

    assert.equal(ids(makeStore(settings).listUsers()), 'u2');
});

// ---------------------------------------------------------------------------
// Assainissement appelé par main.qml (onReady / saveSettings)
// ---------------------------------------------------------------------------

test('sanitizeUsersJsonForStorage retire les tokens et les entrées invalides', () => {
    const { Store } = freshStore();
    const raw = JSON.stringify([
        { serverUrl: SRV_A, userId: 'u1', accessToken: 'tok-TEST', remember: true },
        { userId: 'sans-serveur' },
        { serverUrl: SRV_A },
        null,
        { serverUrl: SRV_A, userId: 'u2' },
    ]);

    const safe = Store.sanitizeUsersJsonForStorage(raw, false);
    assert.equal(safe.indexOf('tok-TEST'), -1, 'aucun token en clair');

    const parsed = JSON.parse(safe);
    assert.equal(parsed.length, 2);
    assert.equal(parsed.map((u) => u.userId).join('|'), 'u1|u2');
    assert.equal(parsed[0].accessToken, '');
    assert.equal(parsed[0].remember, true, 'la métadonnée non secrète est conservée');
});

test('sanitizeUsersJsonForStorage force remember=false en sécurité maximale', () => {
    const { Store } = freshStore();
    const raw = JSON.stringify([
        { serverUrl: SRV_A, userId: 'u1', accessToken: 'tok-TEST', remember: true },
    ]);
    const parsed = JSON.parse(Store.sanitizeUsersJsonForStorage(raw, true));
    assert.equal(parsed[0].remember, false);
    assert.equal(parsed[0].accessToken, '');
});

test('sanitizeUsersJsonForStorage rend toujours un JSON de tableau valide', () => {
    const { Store } = freshStore();
    ['', null, undefined, 'pas du json', '{"a":1}', '"x"', '[', 'x'.repeat(300000)]
        .forEach((raw) => {
            const safe = Store.sanitizeUsersJsonForStorage(raw, false);
            assert.ok(Array.isArray(JSON.parse(safe)), String(raw).slice(0, 20));
        });
});

test('sanitizeServersJsonForStorage dédoublonne et rend un tableau valide', () => {
    const { Store } = freshStore();
    const raw = JSON.stringify([
        { serverUrl: SRV_A, name: 'Maison' },
        { url: SRV_A + '/', name: 'doublon' },
        { name: 'sans url' },
        { serverUrl: SRV_B, name: 'Bureau' },
    ]);
    const parsed = JSON.parse(Store.sanitizeServersJsonForStorage(raw));
    assert.equal(parsed.map((s) => s.serverUrl).join('|'), SRV_A + '|' + SRV_B);

    ['', null, 'pas du json', '{"a":1}'].forEach((bad) => {
        assert.ok(Array.isArray(JSON.parse(Store.sanitizeServersJsonForStorage(bad))), String(bad));
    });
});

// ---------------------------------------------------------------------------
// Préférences par profil (écrites en clair dans Settings)
// ---------------------------------------------------------------------------

test('aucune clé de préférence sensible n\'est stockée', () => {
    const { settings, Store } = freshStore();
    Store.addOrUpdateUser({ serverUrl: SRV_A, userId: 'u1' });

    const out = Store.saveUserPrefs(SRV_A, 'u1', {
        accessToken: 'tok-TEST',
        'Access-Token': 'tok-TEST',
        api_key: 'tok-TEST',
        X_Emby_Token: 'tok-TEST',
        authorization: 'tok-TEST',
        password: 'tok-TEST',
        playSessionId: 'tok-TEST',
        cookie: 'tok-TEST',
        lang: 'fr',
        nested: { secret: 'tok-TEST', keep: 1 },
    });

    assert.equal(out.lang, 'fr');
    assert.equal(out.nested.keep, 1);
    assert.equal(out.nested.secret, undefined);
    assert.equal(JSON.stringify(out).indexOf('tok-TEST'), -1);
    assert.equal(settings.usersJson.indexOf('tok-TEST'), -1);
});

test('les préférences sont fusionnées et bornées', () => {
    const { Store } = freshStore();
    Store.addOrUpdateUser({ serverUrl: SRV_A, userId: 'u1' });

    Store.saveUserPrefs(SRV_A, 'u1', { a: 1, b: 'x' });
    const merged = Store.saveUserPrefs(SRV_A, 'u1', { b: 'y', c: true });
    assert.equal(merged.a, 1);
    assert.equal(merged.b, 'y');
    assert.equal(merged.c, true);

    const bounded = Store.saveUserPrefs(SRV_A, 'u1', {
        longue: 'x'.repeat(2000),
        tableau: new Array(100).fill(1),
        profond: { a: { b: { c: { d: { e: 'trop loin' } } } } },
    });
    assert.equal(bounded.longue.length, 512, 'chaîne bornée');
    assert.equal(bounded.tableau.length, 24, 'tableau borné');
    assert.equal(bounded.profond.a.b.c, undefined, 'profondeur bornée');
});

test('les préférences suivent le couple serveur+profil et survivent au redémarrage', () => {
    const { settings, Store } = freshStore();
    Store.addOrUpdateUser({ serverUrl: SRV_A, userId: 'u1' });
    Store.addOrUpdateUser({ serverUrl: SRV_B, userId: 'u1' });

    Store.setUserPref(SRV_A, 'u1', 'lang', 'fr');
    assert.equal(Store.getUserPref(SRV_A, 'u1', 'lang', 'defaut'), 'fr');
    assert.equal(Store.getUserPref(SRV_B, 'u1', 'lang', 'defaut'), 'defaut');
    assert.equal(Store.getUserPref(SRV_A, 'inconnu', 'lang', 'defaut'), 'defaut');

    assert.equal(makeStore(settings).getUserPref(SRV_A, 'u1', 'lang', 'defaut'), 'fr');
});

test('saveUserPrefs sur un profil inconnu n\'en crée pas un', () => {
    const { settings, Store } = freshStore();
    const out = Store.saveUserPrefs(SRV_A, 'fantome', { lang: 'fr' });
    assert.equal(Object.keys(out).length, 0);
    assert.equal(settings.usersJson, '[]');

    // ensureUserPrefsContext() est la voie explicite pour créer le contexte.
    assert.equal(Store.ensureUserPrefsContext(SRV_A, 'fantome'), true);
    assert.equal(Store.saveUserPrefs(SRV_A, 'fantome', { lang: 'fr' }).lang, 'fr');
    assert.equal(Store.ensureUserPrefsContext(SRV_A, ''), false);
    assert.equal(Store.ensureUserPrefsContext('', 'u1'), false);
});

// ---------------------------------------------------------------------------
// Avatars
// ---------------------------------------------------------------------------

test('les URL d\'avatar sont encodées et sans token', () => {
    const { Store } = freshStore();
    const animated = Store.animatedAvatarUrl(SRV_A, 'u 1', 'tag&x');
    assert.equal(animated, SRV_A + '/UserImage?UserId=u%201&tag=tag%26x');
    assert.equal(animated.indexOf('format=jpg'), -1, 'jamais de format=jpg sur le GIF animé');
    assert.equal(Store.staticAvatarUrl(SRV_A, 'u1', 't'),
                 SRV_A + '/UserImage?UserId=u1&tag=t&format=jpg');

    // Un paramètre manquant ne produit jamais d'URL partielle.
    [['', 'u1', 't'], [SRV_A, '', 't'], [SRV_A, 'u1', '']].forEach((args) => {
        assert.equal(Store.animatedAvatarUrl(args[0], args[1], args[2]), '');
        assert.equal(Store.staticAvatarUrl(args[0], args[1], args[2]), '');
    });
});

test('un tag d\'avatar n\'est fiable qu\'avec le propriétaire correspondant', () => {
    const { settings, Store } = freshStore();
    // Ancien store : tag sans propriétaire => marqué non validé.
    Store.addOrUpdateUser({ serverUrl: SRV_A, userId: 'u1', imageTag: 'TAG1' });
    assert.equal(storedUsers(settings)[0].imageTagOwnerId, '');

    // Tag revendiqué par un autre profil => propriétaire refusé.
    Store.addOrUpdateUser({
        serverUrl: SRV_A, userId: 'u1', imageTag: 'TAG1', imageTagOwnerId: 'u2',
    });
    assert.equal(storedUsers(settings)[0].imageTagOwnerId, '');

    // Validation par LoginPage après réponse serveur.
    assert.equal(Store.updateUserAvatarMetadata(SRV_A, 'u1', 'Alice', 'TAG1'), true);
    const stored = storedUsers(settings)[0];
    assert.equal(stored.imageTagOwnerId, 'u1');
    assert.equal(stored.userName, 'Alice');
});

test('updateUserAvatarMetadata ne crée pas de profil et ne réordonne pas la liste', () => {
    const { Store } = freshStore();
    Store.addOrUpdateUser({ serverUrl: SRV_A, userId: 'u1' });
    Store.addOrUpdateUser({ serverUrl: SRV_A, userId: 'u2' });

    assert.equal(Store.updateUserAvatarMetadata(SRV_A, 'inconnu', 'X', 'T'), false);
    assert.equal(Store.updateUserAvatarMetadata(SRV_A, 'u1', 'Alice', 'TAG1'), true);
    assert.equal(ids(Store.listUsers()), 'u2|u1', 'l\'ordre d\'usage est préservé');
});
