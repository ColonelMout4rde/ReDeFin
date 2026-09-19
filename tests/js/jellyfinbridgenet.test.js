'use strict';

/*
 * Vérifie l'instrumentation NET1 de qml/js/jellyfinBridge.js (audit réseau,
 * point 1) : pour chaque GET mémoïsable, une trace DevLog identifie
 * l'origine (cache / réseau / dé-dupliquée) et, pour l'origine réseau, le
 * statut, la taille du corps et les délais réseau/parse.
 *
 * Pourquoi c'est sensible :
 *  - DevLog.ENABLED vaut false dans le dépôt et dans tout paquet : la trace
 *    (et le calcul de taille qui l'accompagne) ne doit jamais coûter quoi
 *    que ce soit tant que le drapeau est bas ;
 *  - une URL journalisée doit toujours passer par DevLog.maskUrl(), même si
 *    stripAuthQueryFromUrl a déjà retiré les clés d'authentification connues
 *    de la query avant que sendRequest ne l'utilise ;
 *  - une trace ne doit jamais faire échouer ou dupliquer la réponse réelle.
 *
 * Harnais dédié (pas bridgeharness.js, partagé par des tests non liés au
 * réseau) : XHR fictif minimal + horloge figée + capture de console.log.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadQmlJs } = require('./qmljs');

const LAN = 'http://192.168.1.5:8096';
const TOKEN = 'tok-SECRET';
const USER = 'user-1';

/** Charge le bridge avec un transport XHR fictif et une horloge figée. */
function makeBridge() {
    const sentXhrs = [];
    const lines = [];
    const state = { now: 1700000000000 };
    const later = [];

    class FakeXhr {
        constructor() {
            this.readyState = 0;
            this.requestHeaders = {};
            this.sent = false;
            sentXhrs.push(this);
        }
        open(method, url) { this.method = String(method || ''); this.url = String(url || ''); this.readyState = 1; }
        setRequestHeader(k, v) { this.requestHeaders[String(k)] = String(v); }
        send() { this.sent = true; }
        getAllResponseHeaders() { return ''; }
        respond(status, bodyObj) {
            this.status = status;
            this.responseText = JSON.stringify(bodyObj);
            this.readyState = 4;
            if (this.onreadystatechange) this.onreadystatechange();
            flush();
        }
    }
    FakeXhr.DONE = 4;

    function flush() {
        let guard = 0;
        while (later.length) {
            if (++guard > 1000) throw new Error('jellyfinbridgenet: boucle Qt.callLater');
            later.shift()();
        }
    }

    const DateStub = Object.assign(
        function (...args) { return new Date(...args); },
        { now: () => state.now }
    );

    const bridge = loadQmlJs('qml/js/jellyfinBridge.js', {
        stubs: {
            XMLHttpRequest: FakeXhr,
            Qt: { callLater: (fn) => { later.push(fn); } },
            Date: DateStub,
            console: { log: (m) => lines.push(String(m)) },
        },
    });

    return {
        bridge,
        lines,
        sentXhrs,
        flush,
        advance: (ms) => { state.now += ms; },
        netLines: () => lines.filter((l) => l.indexOf('NET1') >= 0),
    };
}

function recorder() {
    const rec = { ok: [], ko: [] };
    rec.onSuccess = (...a) => rec.ok.push(a[0]);
    rec.onError = (...a) => rec.ko.push(a[0]);
    return rec;
}

test('drapeau bas (comportement du dépôt) : ni réseau, ni cache, ni dédup ne tracent quoi que ce soit', () => {
    const h = makeBridge();
    const a = recorder(); const b = recorder();
    // Deux abonnés simultanés (dédup), puis une deuxième lecture après coup
    // (cache) : trois origines distinctes, aucune trace ne doit sortir.
    h.bridge.fetchViews(LAN, TOKEN, USER, a.onSuccess, a.onError);
    h.bridge.fetchViews(LAN, TOKEN, USER, b.onSuccess, b.onError);
    h.sentXhrs[0].respond(200, { Items: [{ Id: 'v1' }] });
    const c = recorder();
    h.bridge.fetchViews(LAN, TOKEN, USER, c.onSuccess, c.onError);
    h.flush();
    assert.equal(h.sentXhrs.length, 1);
    assert.equal(c.ok.length, 1);
    assert.equal(h.lines.length, 0);
});

test('réseau : origine, statut, taille et délais sont tracés une fois le drapeau levé', () => {
    const h = makeBridge();
    h.bridge.DevLog.ENABLED = true;
    const r = recorder();
    h.bridge.fetchViews(LAN, TOKEN, USER, r.onSuccess, r.onError);
    assert.equal(h.sentXhrs.length, 1);
    h.sentXhrs[0].respond(200, { Items: [{ Id: 'v1' }] });
    h.bridge.DevLog.ENABLED = false;

    assert.equal(r.ok.length, 1, 'la trace ne doit pas casser la réponse normale');
    const net = h.netLines();
    assert.equal(net.length, 1);
    assert.match(net[0], /^\[RDF\] NET1 reseau url=.*UserViews.* statut=200 taille=\d+ dtReseau=\d+ dtParse=\d+$/);
    assert.equal(net[0].indexOf(TOKEN), -1, 'jamais de jeton dans une trace réseau');
});

test('cache : un second GET sous le TTL est tracé "cache", sans repartir sur le réseau', () => {
    const h = makeBridge();
    h.bridge.DevLog.ENABLED = true;
    const first = recorder();
    h.bridge.fetchViews(LAN, TOKEN, USER, first.onSuccess, first.onError);
    h.sentXhrs[0].respond(200, { Items: [{ Id: 'v1' }] });
    h.advance(500); // bien avant le TTL de 90 s des /UserViews
    h.lines.length = 0; // on ne garde que la trace du second appel

    const second = recorder();
    h.bridge.fetchViews(LAN, TOKEN, USER, second.onSuccess, second.onError);
    h.flush();
    h.bridge.DevLog.ENABLED = false;

    assert.equal(h.sentXhrs.length, 1, 'la deuxième lecture ne doit pas repartir sur le réseau');
    assert.equal(second.ok.length, 1);
    const net = h.netLines();
    assert.equal(net.length, 1);
    assert.match(net[0], /^\[RDF\] NET1 cache url=.*UserViews.* statut=200 taille=\d+ ageMs=500 ttlMs=90000$/);
});

test('dédup : deux GET identiques en vol ne partent qu\'une fois, le second est tracé "dedup"', () => {
    const h = makeBridge();
    h.bridge.DevLog.ENABLED = true;
    const a = recorder(); const b = recorder();
    h.bridge.fetchViews(LAN, TOKEN, USER, a.onSuccess, a.onError);
    h.bridge.fetchViews(LAN, TOKEN, USER, b.onSuccess, b.onError);
    assert.equal(h.sentXhrs.length, 1, 'un seul GET part réellement');
    h.sentXhrs[0].respond(200, { Items: [{ Id: 'v1' }] });
    h.bridge.DevLog.ENABLED = false;

    assert.equal(a.ok.length, 1);
    assert.equal(b.ok.length, 1);
    const dedup = h.lines.filter((l) => l.indexOf('NET1 dedup') >= 0);
    assert.equal(dedup.length, 1);
    assert.match(dedup[0], /^\[RDF\] NET1 dedup url=.*UserViews.* attente=2$/);
});
