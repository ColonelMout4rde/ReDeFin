'use strict';

/*
 * bridgeharness.js — harnais de test pour qml/js/jellyfinBridge.js.
 *
 * Le bridge est la seule porte HTTP de l'application : il crée des
 * XMLHttpRequest, mesure des délais avec Date.now() et diffère certains
 * rappels via Qt.callLater(). Aucune de ces trois globales n'existe sous
 * Node, et aucune ne doit être remplacée par du vrai réseau / du vrai temps
 * dans un test. Ce harnais les remplace par des doubles pilotables :
 *
 *   - XMLHttpRequest : chaque instance est enregistrée ; le test décide
 *     quand (et si) elle répond, échoue ou expire ;
 *   - Date.now      : horloge figée, avançable à la milliseconde
 *                     (TTL de cache, cooldowns, deadlines) ;
 *   - Qt.callLater  : file explicite, vidée par h.flush().
 *
 * IMPORTANT — état de module : jellyfinBridge.js garde au niveau module son
 * cache GET, ses requêtes en vol et son registre d'opérations HTTP, et
 * SafeLog.js son registre d'hôtes LAN approuvés. createBridge() recharge
 * donc TOUT l'arbre de modules : chaque test part d'un état vierge.
 *
 * Convention de flush : xhr.respond()/failNetwork()/fireTimeout() vident
 * automatiquement la file Qt.callLater. Les chemins qui répondent SANS
 * requête réseau (hit de cache, cooldown, transport non sécurisé) exigent un
 * h.flush() explicite — à défaut le rappel n'est jamais appelé et le test
 * échoue bruyamment, ce qui est le bon sens d'erreur.
 */

const { loadQmlJs } = require('./qmljs');

const DEFAULT_NOW = 1700000000000;

/** Sérialise un dictionnaire d'en-têtes au format getAllResponseHeaders(). */
function rawHeaders(headers) {
    return Object.keys(headers || {})
        .map((k) => `${k}: ${headers[k]}\r\n`)
        .join('');
}

function createBridge(options) {
    const opts = options || {};
    const state = {
        now: typeof opts.now === 'number' ? opts.now : DEFAULT_NOW,
        later: [],
        xhrs: [],
    };

    function flush() {
        // Un rappel différé peut en programmer un autre (leader -> abonnés).
        let guard = 0;
        while (state.later.length) {
            if (++guard > 1000) throw new Error('bridgeharness: boucle Qt.callLater');
            const fn = state.later.shift();
            fn();
        }
        return guard;
    }

    class FakeXhr {
        constructor() {
            this.readyState = 0;
            this.status = 0;
            this.responseText = '';
            this.responseURL = '';
            this.timeout = 0;
            this.method = '';
            this.url = '';
            this.requestHeaders = {};
            this.body = undefined;
            this.sent = false;
            this.aborted = false;
            this.settled = false;
            this._rawHeaders = '';
            this._headers = {};
            this.onreadystatechange = null;
            this.onerror = null;
            this.ontimeout = null;
            state.xhrs.push(this);
        }

        open(method, url) {
            this.method = String(method || '');
            this.url = String(url || '');
            this.readyState = 1;
        }

        setRequestHeader(name, value) {
            this.requestHeaders[String(name)] = String(value);
        }

        send(body) {
            this.body = body;
            this.sent = true;
        }

        abort() {
            this.aborted = true;
        }

        getAllResponseHeaders() {
            return this._rawHeaders;
        }

        getResponseHeader(name) {
            const wanted = String(name).toLowerCase();
            const key = Object.keys(this._headers).find((k) => k.toLowerCase() === wanted);
            return key === undefined ? null : this._headers[key];
        }

        /** Valeur d'un en-tête de requête, quelle que soit sa casse. */
        header(name) {
            const wanted = String(name).toLowerCase();
            const key = Object.keys(this.requestHeaders).find((k) => k.toLowerCase() === wanted);
            return key === undefined ? '' : this.requestHeaders[key];
        }

        /** Réponse complète (readyState 4) puis vidage de la file différée. */
        respond(res) {
            const r = res || {};
            this.settled = true;
            this.status = r.status === undefined ? 200 : r.status;
            this.responseText = r.body === undefined ? '' : String(r.body);
            this._headers = Object.assign({}, r.headers);
            this._rawHeaders = rawHeaders(this._headers);
            if (r.responseURL !== undefined) this.responseURL = String(r.responseURL);
            this.readyState = 4;
            if (this.onreadystatechange) this.onreadystatechange();
            flush();
            return this;
        }

        respondJson(json, status) {
            return this.respond({
                status: status === undefined ? 200 : status,
                body: JSON.stringify(json),
                headers: { 'Content-Type': 'application/json' },
            });
        }

        /** Seuls les en-têtes sont arrivés (readyState 2) : probe métadonnées. */
        respondHeaders(res) {
            const r = res || {};
            this.status = r.status === undefined ? 200 : r.status;
            this._headers = Object.assign({}, r.headers);
            this._rawHeaders = rawHeaders(this._headers);
            if (r.responseURL !== undefined) this.responseURL = String(r.responseURL);
            this.readyState = 2;
            if (this.onreadystatechange) this.onreadystatechange();
            flush();
            return this;
        }

        failNetwork() {
            this.settled = true;
            if (this.onerror) this.onerror();
            flush();
            return this;
        }

        fireTimeout() {
            this.settled = true;
            if (this.ontimeout) this.ontimeout();
            flush();
            return this;
        }
    }
    FakeXhr.DONE = 4;

    const DateStub = Object.assign(
        function (...args) { return new Date(...args); },
        { now: () => state.now, parse: Date.parse, UTC: Date.UTC }
    );

    const bridge = loadQmlJs('qml/js/jellyfinBridge.js', {
        stubs: {
            XMLHttpRequest: FakeXhr,
            Qt: { callLater: (fn) => { state.later.push(fn); } },
            Date: DateStub,
        },
    });

    return {
        bridge,
        /** Toutes les XHR construites depuis le début du test. */
        xhrs: state.xhrs,
        /** XHR effectivement envoyées et pas encore réglées. */
        pending() { return state.xhrs.filter((x) => x.sent && !x.settled && !x.aborted); },
        /** Dernière XHR envoyée (erreur explicite s'il n'y en a aucune). */
        last() {
            const sent = state.xhrs.filter((x) => x.sent);
            if (!sent.length) throw new Error('bridgeharness: aucune requête envoyée');
            return sent[sent.length - 1];
        },
        /** Nombre total de requêtes réellement parties sur le réseau. */
        sentCount() { return state.xhrs.filter((x) => x.sent).length; },
        flush,
        now() { return state.now; },
        setNow(ms) { state.now = ms; },
        advance(ms) { state.now += ms; return state.now; },
    };
}

/** Enregistreur de rappels : compte les appels succès/erreur séparément. */
function recorder() {
    const rec = {
        ok: [],
        ko: [],
        onSuccess: (...a) => { rec.ok.push(a.length > 1 ? a : a[0]); },
        onError: (...a) => { rec.ko.push(a.length > 1 ? a : a[0]); },
        get calls() { return rec.ok.length + rec.ko.length; },
    };
    return rec;
}

/** Query string -> objet {clé: valeur}, pour ne jamais dépendre de l'ordre. */
function queryOf(url) {
    const s = String(url || '');
    const q = s.indexOf('?');
    if (q < 0) return {};
    const out = {};
    for (const part of s.substring(q + 1).split('&')) {
        if (!part) continue;
        const eq = part.indexOf('=');
        const k = eq < 0 ? part : part.substring(0, eq);
        const v = eq < 0 ? '' : part.substring(eq + 1);
        out[decodeURIComponent(k)] = decodeURIComponent(v.replace(/\+/g, '%20'));
    }
    return out;
}

/** Partie de l'URL sans query ni fragment. */
function pathOf(url) {
    const s = String(url || '');
    const cut = s.search(/[?#]/);
    return cut < 0 ? s : s.substring(0, cut);
}

module.exports = { createBridge, recorder, queryOf, pathOf, DEFAULT_NOW };
