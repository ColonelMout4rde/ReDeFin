'use strict';

/*
 * userstoreharness.js — harnais commun aux tests de qml/js/UserStore.js.
 *
 * UserStore.js garde tout son état au niveau module (_parent, _settingsAnchor,
 * _sessionTokens, _backend, overrides de politique). Un test qui veut simuler
 * un NOUVEAU lancement de l'application doit donc repartir d'une instance de
 * module neuve : c'est exactement ce que fait `makeStore()`, qui recharge le
 * module via loadQmlJs() (cache neuf) puis le rebranche sur le MÊME objet
 * Settings. La paire (Settings persistant, module neuf) est le seul moyen de
 * vérifier ce qui survit réellement à un redémarrage du Player.
 *
 * `makeSettings()` imite l'objet `Settings` de main.qml : les mêmes propriétés
 * déclarées (dont `usersSessionVaultJson` et `jellyfinDeviceId`, sans lesquelles
 * le coffre est inopérant), et un compteur d'écritures par propriété pour
 * vérifier qu'une resynchronisation n'écrit pas inutilement dans Settings.
 */

const { loadQmlJs } = require('./qmljs');

// Hôtes LAN : hors LAN, UserStore refuse tout transport de token sur HTTP.
const SRV_A = 'http://192.168.51.10:8096';
const SRV_B = 'http://192.168.51.11:8096';
const SRV_WAN_HTTP = 'http://jellyfin.example.com';

// Identifiants d'installation valides au sens de clientId.js (`rdf-…`).
const DEVICE_ID = 'rdf-test0001-aaaaaaa-bbbbbbb-ccccccc';
const DEVICE_ID_OTHER = 'rdf-test0002-ddddddd-eeeeeee-fffffff';

const DEFAULT_SETTINGS = {
    jellyfinDeviceId: DEVICE_ID,
    usersJson: '[]',
    usersServersJson: '[]',
    usersActiveKey: '',
    usersSessionVaultJson: '{}',
    rememberJellyfinSession: true,
    maximumSessionSecurity: false,
};

/**
 * Objet Settings factice, calqué sur celui de main.qml.
 * `settings.writes[prop]` compte les écritures effectives.
 */
function makeSettings(overrides) {
    const data = Object.assign({}, DEFAULT_SETTINGS, overrides || {});
    const settings = {};
    const writes = {};

    Object.keys(data).forEach((key) => {
        let value = data[key];
        writes[key] = 0;
        Object.defineProperty(settings, key, {
            enumerable: true,
            configurable: true,
            get: () => value,
            set: (next) => { writes[key] += 1; value = next; },
        });
    });

    Object.defineProperty(settings, 'writes', {
        enumerable: false, configurable: true, value: writes,
    });
    return settings;
}

/**
 * Charge une instance NEUVE de UserStore.js branchée sur `settings`
 * (équivalent d'un lancement de l'application), avec une horloge figée qui
 * avance d'une seconde par appel : l'ordre « profil le plus récent d'abord »
 * devient déterministe sans dépendre de l'horloge réelle.
 *
 * options.remember          -> booléen legacy `rememberJellyfinSession` (défaut true)
 * options.maximumSecurity   -> mode sécurité maximale (défaut false)
 * options.configure = false -> ne pas appeler configureSecurityPolicy()
 */
function makeStore(settings, options) {
    const opts = options || {};
    let clock = 1700000000000;

    const Store = loadQmlJs('qml/js/UserStore.js', {
        stubs: {
            Date: Object.assign(
                function () { return new Date(); },
                { now: () => (clock += 1000), parse: Date.parse, UTC: Date.UTC },
            ),
        },
    });

    Store.init({ settingsRef: settings });
    if (opts.configure !== false) {
        Store.configureSecurityPolicy(
            opts.remember !== false,
            opts.maximumSecurity === true,
        );
    }
    return Store;
}

/** Raccourci : Settings neuf + store neuf. */
function freshStore(settingsOverrides, options) {
    const settings = makeSettings(settingsOverrides);
    return { settings, Store: makeStore(settings, options) };
}

/** Entrées du coffre persistant, telles qu'elles sont réellement stockées. */
function vaultMap(settings) {
    try { return JSON.parse(String(settings.usersSessionVaultJson || '{}')); }
    catch (e) { return {}; }
}

/** Profils tels qu'écrits dans Settings (donc sans l'overlay des tokens RAM). */
function storedUsers(settings) {
    try { return JSON.parse(String(settings.usersJson || '[]')); }
    catch (e) { return []; }
}

/** Projection lisible d'une liste de profils. */
function pick(list, fields) {
    return (list || []).map((u) => {
        const out = {};
        fields.forEach((f) => { out[f] = u[f]; });
        return out;
    });
}

module.exports = {
    SRV_A,
    SRV_B,
    SRV_WAN_HTTP,
    DEVICE_ID,
    DEVICE_ID_OTHER,
    makeSettings,
    makeStore,
    freshStore,
    vaultMap,
    storedUsers,
    pick,
};
