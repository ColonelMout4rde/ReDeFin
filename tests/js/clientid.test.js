'use strict';

/*
 * Identité Jellyfin de l'installation (qml/js/clientId.js).
 *
 * Deux contrats sensibles se croisent ici. D'abord le DeviceId : il doit être
 * unique par installation ReDeFin et stable ensuite, parce que Jellyfin y
 * attache les sessions et que l'ancien identifiant partagé
 * « redefin-freebox » faisait se marcher dessus toutes les Freebox ; il sert
 * en plus de graine au coffre de session de UserStore.js. Ensuite le header
 * Authorization MediaBrowser : il est construit par concaténation de valeurs
 * guillemetées, donc toute valeur non assainie (nom d'application, libellé
 * d'appareil, token) devient une injection d'en-tête HTTP.
 *
 * clientId.js garde son état au niveau module (JF_CLIENT) : chaque test qui
 * modifie l'identité recharge donc une instance neuve.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { loadQmlJs, REPO_ROOT } = require('./qmljs');

const DEVICE_ID_RE = /^rdf-[a-z0-9]+(?:-[a-z0-9]+){2,5}$/;
const LEGACY_SHARED_ID = 'redefin-freebox';

/** Instance neuve du module (équivalent d'un lancement de l'application). */
function fresh() {
    return loadQmlJs('qml/js/clientId.js');
}

/** Découpe `Clef="valeur"` en objet, dans l'ordre d'apparition. */
function parseHeader(value) {
    const out = {};
    const order = [];
    const re = /([A-Za-z]+)="([^"]*)"/g;
    let m;
    while ((m = re.exec(String(value))) !== null) {
        out[m[1]] = m[2];
        order.push(m[1]);
    }
    out.__order = order.join(',');
    return out;
}

// ---------------------------------------------------------------------------
// DeviceId : unicité, format, migration
// ---------------------------------------------------------------------------

test('le DeviceId de démarrage respecte le format ReDeFin', () => {
    const id = fresh().clientId();
    assert.match(id, DEVICE_ID_RE);
    assert.ok(id.length >= 20 && id.length <= 96, 'longueur ' + id.length);
    assert.notEqual(id, LEGACY_SHARED_ID);
});

test('deux installations obtiennent des DeviceId différents', () => {
    const ids = {};
    for (let i = 0; i < 8; i++) ids[fresh().clientId()] = true;
    assert.equal(Object.keys(ids).length, 8,
                 'le DeviceId ne doit jamais être une constante partagée');
});

test('le DeviceId reste stable pendant toute la durée de vie du module', () => {
    const C = fresh();
    const first = C.clientId();
    for (let i = 0; i < 5; i++) assert.equal(C.clientId(), first);
    assert.equal(C.info().deviceId, first);
    assert.equal(parseHeader(C.embyAuthHeader()).DeviceId, first);
});

test('isInstallDeviceId : ce qui est accepté et ce qui ne l\'est pas', () => {
    const C = fresh();
    const valid = [
        'rdf-mu8dk426-03s9phc-0wkksxd-1wuoum9',
        'rdf-aaaaaaaa-bbbbbbb-ccccccc',                 // 3 groupes = minimum
        '  RDF-MU8DK426-03S9PHC-0WKKSXD-1WUOUM9  ',     // normalisé (casse, espaces)
    ];
    const invalid = [
        '', null, undefined, {}, 0,
        LEGACY_SHARED_ID,                                // identifiant partagé historique
        'REDEFIN-FREEBOX',
        'rdf-aaaa-bbbb',                                 // pas assez de groupes
        'rdf-court',
        'fbx6hd-0123456789abcdef',                       // identifiant matériel Freebox
        'rdf-aaaaaaaa-bbbbbbb-cccc_ccc',                 // caractère interdit
        'rdf-' + 'a'.repeat(200),                        // trop long
        'rdf-a-b-c',                                     // trop court (< 20)
    ];

    valid.forEach((v) => assert.equal(C.isInstallDeviceId(v), true, JSON.stringify(v)));
    invalid.forEach((v) => assert.equal(C.isInstallDeviceId(v), false, JSON.stringify(v)));
});

test('ensurePersistentDeviceId persiste l\'identifiant du premier lancement', () => {
    const C = fresh();
    const runtimeId = C.clientId();
    const settings = { jellyfinDeviceId: '' };

    const returned = C.ensurePersistentDeviceId(settings);
    assert.equal(returned, runtimeId, 'l\'identité du lancement courant est conservée');
    assert.equal(settings.jellyfinDeviceId, runtimeId);
    assert.equal(C.clientId(), runtimeId);

    // Idempotent : un second appel ne régénère rien.
    assert.equal(C.ensurePersistentDeviceId(settings), runtimeId);
});

test('ensurePersistentDeviceId recharge un identifiant déjà mémorisé', () => {
    const C = fresh();
    const stored = 'rdf-stored01-aaaaaaa-bbbbbbb-ccccccc';
    const settings = { jellyfinDeviceId: stored };

    assert.equal(C.ensurePersistentDeviceId(settings), stored);
    assert.equal(C.clientId(), stored, 'le DeviceId de runtime est remplacé');
    assert.equal(settings.jellyfinDeviceId, stored, 'aucune réécriture inutile');
});

test('l\'ancien DeviceId partagé n\'est jamais réutilisé', () => {
    [LEGACY_SHARED_ID, 'REDEFIN-FREEBOX', ' redefin-freebox '].forEach((legacy) => {
        const C = fresh();
        const settings = { jellyfinDeviceId: legacy };
        const id = C.ensurePersistentDeviceId(settings);

        assert.match(id, DEVICE_ID_RE, legacy);
        assert.notEqual(id.toLowerCase(), LEGACY_SHARED_ID, legacy);
        assert.equal(settings.jellyfinDeviceId, id, 'la migration est écrite');
        assert.equal(C.clientId(), id, legacy);
    });
});

test('un identifiant mémorisé corrompu est remplacé par un identifiant valide', () => {
    ['', '   ', 'n\'importe quoi', 'rdf-court', 'fbx7hd-serial-0001'].forEach((bad) => {
        const C = fresh();
        const settings = { jellyfinDeviceId: bad };
        const id = C.ensurePersistentDeviceId(settings);
        assert.match(id, DEVICE_ID_RE, JSON.stringify(bad));
        assert.equal(settings.jellyfinDeviceId, id, JSON.stringify(bad));
    });
});

test('ensurePersistentDeviceId reste utilisable sans objet Settings', () => {
    const C = fresh();
    const runtimeId = C.clientId();
    [null, undefined, 0, {}].forEach((obj) => {
        const id = C.ensurePersistentDeviceId(obj);
        assert.match(id, DEVICE_ID_RE);
        assert.equal(id, runtimeId, 'l\'identité du lancement ne change pas');
    });
    // Un objet nu (sans propriété déclarée) n'est pas enrichi : sur le Player,
    // fbx.application.Settings déclare toujours jellyfinDeviceId.
    const bare = {};
    C.ensurePersistentDeviceId(bare);
    assert.equal(bare.jellyfinDeviceId, undefined);
});

test('clientId() régénère un identifiant si l\'état devient invalide', () => {
    const C = fresh();
    C.JF_CLIENT.deviceId = LEGACY_SHARED_ID;
    const repaired = C.clientId();
    assert.match(repaired, DEVICE_ID_RE);
    assert.notEqual(repaired, LEGACY_SHARED_ID);
    assert.equal(C.clientId(), repaired, 'puis il se stabilise');
});

test('initFromQmlDevice ne laisse pas un identifiant matériel écraser le DeviceId', () => {
    const C = fresh();
    const before = C.clientId();

    // Un champ homonyme exposé par fbx.system.Device (série, MAC, modèle…).
    [{ deviceId: 'fbx6hd-0123456789' },
     { deviceId: LEGACY_SHARED_ID },
     { deviceId: '00:24:d4:aa:bb:cc' },
     { deviceId: 12345 }].forEach((dev) => {
        C.initFromQmlDevice(dev);
        assert.equal(C.clientId(), before, JSON.stringify(dev));
    });

    // Seul un identifiant au format ReDeFin est accepté.
    const valid = 'rdf-abcdef01-2345678-9abcdef-0123456';
    C.initFromQmlDevice({ deviceId: valid });
    assert.equal(C.clientId(), valid);
});

// ---------------------------------------------------------------------------
// Header Authorization MediaBrowser
// ---------------------------------------------------------------------------

test('embyAuthHeader expose exactement l\'identité attendue', () => {
    const C = fresh();
    const h = C.embyAuthHeader();
    assert.ok(h.indexOf('MediaBrowser ') === 0);

    const parsed = parseHeader(h);
    assert.equal(parsed.__order, 'Client,Device,DeviceId,Version');
    assert.equal(parsed.Client, 'ReDeFin');
    assert.equal(parsed.Device, 'ReDeFin (Freebox)');
    assert.equal(parsed.DeviceId, C.clientId());
    assert.equal(parsed.Version, C.applicationVersion());
    assert.equal(h.indexOf('Token'), -1, 'sans token, aucun champ Token');
});

test('authorizationHeader ajoute le token en dernier champ', () => {
    const C = fresh();
    const withToken = parseHeader(C.authorizationHeader('tok-TEST'));
    assert.equal(withToken.__order, 'Client,Device,DeviceId,Version,Token');
    assert.equal(withToken.Token, 'tok-TEST');

    // Un token vide ne produit jamais un champ Token vide.
    ['', null, undefined, '   ', ' '].forEach((tok) => {
        const h = C.authorizationHeader(tok);
        assert.equal(h.indexOf('Token'), -1, JSON.stringify(tok));
        assert.equal(h, C.embyAuthHeader(), JSON.stringify(tok));
    });
});

test('aucune valeur ne peut casser la structure du header', () => {
    const attacks = [
        'Evil", Token="vole',
        'a\r\nX-Injected: 1',
        'a\nb',
        'virgule, deux',
        'anti\\slash',
        ' ',
        'é'.repeat(300),
    ];

    // 1) Injection par les champs d'identité (appName / device / version).
    attacks.forEach((payload) => {
        const C = fresh();
        C.initFromQmlDevice({ appName: payload, device: payload, version: payload });
        const header = C.authorizationHeader('tok-TEST');

        assert.equal(header.indexOf('\r'), -1, payload);
        assert.equal(header.indexOf('\n'), -1, payload);
        assert.ok(!/[ -]/.test(header), payload);

        // La structure reste exactement 5 champs, et le token réel ne peut pas
        // être remplacé par une valeur injectée depuis le nom de l'application.
        const parsed = parseHeader(header);
        assert.equal(parsed.__order, 'Client,Device,DeviceId,Version,Token', payload);
        assert.equal(parsed.DeviceId, C.clientId(), payload);
        assert.equal(parsed.Token, 'tok-TEST', payload);
    });

    // 2) Injection par le token lui-même.
    const C = fresh();
    attacks.forEach((payload) => {
        const header = C.authorizationHeader('tok-' + payload);

        assert.equal(header.indexOf('\r'), -1, payload);
        assert.equal(header.indexOf('\n'), -1, payload);
        assert.ok(!/[ -]/.test(header), payload);

        const parsed = parseHeader(header);
        assert.equal(parsed.__order, 'Client,Device,DeviceId,Version,Token', payload);
        assert.equal(parsed.Client, 'ReDeFin', payload);
        assert.equal(parsed.DeviceId, C.clientId(), payload);
    });
});

test('les valeurs d\'identité sont bornées en longueur', () => {
    const C = fresh();
    C.initFromQmlDevice({
        appName: 'A'.repeat(500),
        device: 'D'.repeat(500),
        version: 'V'.repeat(500),
    });
    assert.equal(C.clientName().length, 48);
    assert.equal(C.deviceLabel().length, 64);
    assert.equal(C.clientVersion().length, 32);
    assert.ok(C.clientId().length <= 96);
});

test('un token trop long est tronqué plutôt que de faire grossir le header', () => {
    const C = fresh();
    const parsed = parseHeader(C.authorizationHeader('t'.repeat(1000)));
    assert.equal(parsed.Token.length, 256);
});

// ---------------------------------------------------------------------------
// Modèle Freebox et libellé d'appareil
// ---------------------------------------------------------------------------

test('freeboxPlayerModeFromModel reconnaît les deux familles de Player', () => {
    const C = fresh();
    const cases = [
        ['fbx6hd', 'revolution'],
        ['FBX6HD', 'revolution'],
        ['fbx6', 'revolution'],
        ['Freebox Revolution', 'revolution'],
        ['Freebox Révolution', 'revolution'],
        ['v6', 'revolution'],
        ['Freebox v6', 'revolution'],
        ['fbx7hd', 'devialet'],
        ['fbx7hd-delta', 'devialet'],
        ['Freebox Player Devialet', 'devialet'],
        ['delta', 'devialet'],
        ['Freebox Delta', 'devialet'],
        ['', ''],
        [null, ''],
        [undefined, ''],
        ['Delta S', ''],
        ['fbx8hd', ''],
        ['un modèle inconnu', ''],
    ];
    cases.forEach(([input, expected]) => {
        assert.equal(C.freeboxPlayerModeFromModel(input), expected, JSON.stringify(input));
    });
});

test('initFromQmlDevice choisit le libellé Jellyfin d\'après le modèle', () => {
    const cases = [
        [{ model: 'fbx6hd' }, 'Freebox Revolution'],
        [{ modelId: 'fbx7hd-delta' }, 'Freebox Devialet'],
        [{ deviceName: 'Freebox Player Devialet' }, 'Freebox Devialet'],
        [{ name: 'Freebox Révolution' }, 'Freebox Revolution'],
        [{ productName: 'fbx6hd' }, 'Freebox Revolution'],
        [{ modelCode: 'fbx7hd' }, 'Freebox Devialet'],
        [{ model: 'modele-inconnu' }, 'ReDeFin (Freebox)'],
        [{}, 'ReDeFin (Freebox)'],
    ];
    cases.forEach(([dev, expected]) => {
        const C = fresh();
        C.initFromQmlDevice(dev);
        assert.equal(C.deviceLabel(), expected, JSON.stringify(dev));
        assert.equal(parseHeader(C.embyAuthHeader()).Device, expected, JSON.stringify(dev));
    });
});

test('deviceModel conserve le code brut borné', () => {
    const C = fresh();
    C.initFromQmlDevice({ model: 'fbx7hd-delta' });
    assert.equal(C.deviceModel(), 'fbx7hd-delta');

    C.initFromQmlDevice({ model: 'x'.repeat(400) });
    assert.equal(C.deviceModel().length, 96);
});

test('initFromQmlDevice sans argument ne modifie rien', () => {
    const C = fresh();
    const before = JSON.stringify(C.info());
    [null, undefined, 0, false, ''].forEach((v) => C.initFromQmlDevice(v));
    assert.equal(JSON.stringify(C.info()), before);
});

// ---------------------------------------------------------------------------
// Hôte alternatif IPv4 (sert à réécrire l'hôte des requêtes)
// ---------------------------------------------------------------------------

test('ipv4AlternateHost n\'accepte qu\'une autorité propre', () => {
    const cases = [
        ['v4.jellyfin.example.fr', 'v4.jellyfin.example.fr'],
        ['192.168.51.10:8096', '192.168.51.10:8096'],
        ['https://v4.example.fr:8920/chemin?q=1', 'v4.example.fr:8920'],
        ['[fd00::1]:8096', '[fd00::1]:8096'],
        ['evil@example.fr', ''],                       // userinfo interdit
        ['https://evil@example.fr/x', ''],
        ['example.fr:99999', ''],                      // port hors bornes
        ['exa mple.fr', ''],
        ['example.fr\r\nHost: evil', ''],
        ['x'.repeat(200), ''],
    ];
    cases.forEach(([input, expected]) => {
        const C = fresh();
        C.initFromQmlDevice({ ipv4AlternateHost: input });
        assert.equal(C.ipv4AltHost(), expected, JSON.stringify(input));
        assert.equal(C.info().ipv4AlternateHost, expected, JSON.stringify(input));
    });
});

// ---------------------------------------------------------------------------
// Version applicative
// ---------------------------------------------------------------------------

test('APP_VERSION reste aligné sur manifest.json', () => {
    const C = fresh();
    const manifest = JSON.parse(
        fs.readFileSync(path.join(REPO_ROOT, 'manifest.json'), 'utf8'));
    assert.equal(C.applicationVersion(), manifest.version,
                 'clientId.APP_VERSION et manifest.json doivent être synchrones');
    assert.match(C.applicationVersion(), /^\d+\.\d+\.\d+$/);
    assert.equal(C.clientVersion(), manifest.version);
});

test('info() ne rend que les champs assainis attendus', () => {
    const C = fresh();
    C.initFromQmlDevice({ model: 'fbx6hd' });
    const info = C.info();

    assert.equal(Object.keys(info).sort().join(','),
                 'appName,device,deviceId,deviceModel,ipv4AlternateHost,version');
    assert.equal(info.appName, C.clientName());
    assert.equal(info.device, C.deviceLabel());
    assert.equal(info.deviceId, C.clientId());
    assert.equal(info.version, C.clientVersion());
    assert.equal(info.deviceModel, 'fbx6hd');
    // Aucun secret ne transite par ce snapshot.
    assert.equal(JSON.stringify(info).indexOf('Token'), -1);
});
