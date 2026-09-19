'use strict';

/*
 * Régressions ciblées sur qml/js/SkipIntro.js.
 *
 * Ce module détermine QUAND proposer "Passer l'intro" et sur QUELLE plage de
 * temps, à partir de trois sources serveur essayées dans l'ordre (Jellyfin
 * MediaSegments -> Intro Skipper legacy -> chapitres du DTO détail), chacune
 * avec ses propres unités (ticks .NET, millisecondes, secondes, "HH:MM:SS").
 * Une régression ici est silencieuse : le bouton apparaît au mauvais moment,
 * saute au mauvais endroit, ou réapparaît sans raison après un premier échec.
 *
 * Deux familles de tests :
 *  1. Fonctions pures (conversions de temps, parsing des payloads, garde-fous,
 *     décision d'affichage shouldShow()) : appelées directement.
 *  2. Orchestration réseau de fetchIntroSegment() : JellyfinBridge.sendRequestNoCache
 *     est remplacé par un stub à résolution manuelle (aucun timer réel), ce
 *     qui permet d'observer précisément QUELLES URLs sont appelées, dans quel
 *     ordre, et de vérifier le cache mémoire + la déduplication des requêtes
 *     concurrentes.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadQmlJs } = require('./qmljs');

const SERVER = 'http://192.168.50.20:8096'; // hôte LAN fictif : requis par isSensitiveRequestAllowed (pas de secret en HTTP WAN).
const TOKEN = 'tok-TEST';

function loadSkipIntro() {
    return loadQmlJs('qml/js/SkipIntro.js');
}

/* ===================== 1. Conversions de temps ============================ */

test('_clockMs : formats "HH:MM:SS(.ms)" / "MM:SS", rejette tout le reste', () => {
    const SkipIntro = loadSkipIntro();
    assert.equal(SkipIntro._clockMs('00:01:30'), 90000);
    assert.equal(SkipIntro._clockMs('1:02:03.500'), 3723500);
    assert.equal(SkipIntro._clockMs('1:02:03,500'), 3723500, 'virgule décimale acceptée');
    assert.equal(SkipIntro._clockMs('61:30'), 3690000, 'pas de normalisation heures, juste un calcul littéral');
    assert.equal(SkipIntro._clockMs(''), -1);
    assert.equal(SkipIntro._clockMs(null), -1);
    assert.equal(SkipIntro._clockMs('abc'), -1);
    assert.equal(SkipIntro._clockMs(123), -1, 'un nombre brut n\'est pas une horloge texte');
});

test('_numberTime : nombre positif accepté, négatif/vide/NaN rejetés (-1)', () => {
    const SkipIntro = loadSkipIntro();
    assert.equal(SkipIntro._numberTime(12.5), 12.5);
    assert.equal(SkipIntro._numberTime('42'), 42);
    assert.equal(SkipIntro._numberTime(-1), -1);
    assert.equal(SkipIntro._numberTime(''), -1);
    assert.equal(SkipIntro._numberTime(undefined), -1);
    assert.equal(SkipIntro._numberTime('abc'), -1);
});

test('_ticksMs / _millisecondsMs / _secondsMs : unité Jellyfin -> ms, horloge texte prioritaire', () => {
    const SkipIntro = loadSkipIntro();
    assert.equal(SkipIntro._ticksMs(10000000), 1000, '10 000 000 ticks (100ns) = 1 s = 1000 ms');
    assert.equal(SkipIntro._ticksMs('00:00:05'), 5000, 'une chaîne horloge est acceptée même dans un champ *Ticks');
    assert.equal(SkipIntro._ticksMs(-5), -1);
    assert.equal(SkipIntro._millisecondsMs(1500), 1500);
    assert.equal(SkipIntro._millisecondsMs(1500.9), 1500, 'floor');
    assert.equal(SkipIntro._secondsMs(90), 90000);
    assert.equal(SkipIntro._secondsMs(-1), -1);
});

test('_pickTimeMs : priorité Ticks > Ms > secondes, quelle que soit la clé présente', () => {
    const SkipIntro = loadSkipIntro();
    assert.equal(SkipIntro._pickTimeMs({ StartTicks: 10000000 }, ['StartTicks'], ['StartMs'], ['Start']), 1000);
    assert.equal(SkipIntro._pickTimeMs({ StartMs: 500 }, ['StartTicks'], ['StartMs'], ['Start']), 500);
    assert.equal(SkipIntro._pickTimeMs({ Start: 5 }, ['StartTicks'], ['StartMs'], ['Start']), 5000);
    assert.equal(SkipIntro._pickTimeMs({}, ['StartTicks'], ['StartMs'], ['Start']), -1);
    // Les trois clés présentes à la fois : Ticks doit gagner (ordre documenté dans _fromLegacy/_fromMediaSegments).
    assert.equal(SkipIntro._pickTimeMs({ StartTicks: 20000000, StartMs: 999, Start: 1 }, ['StartTicks'], ['StartMs'], ['Start']), 2000);
});

/* ===================== 2. Garde-fous de segment (_makeSeg) ================ */

test('_makeSeg : rejette début négatif, fin <= début, et les segments trop courts (< 3 s)', () => {
    const SkipIntro = loadSkipIntro();
    assert.equal(SkipIntro._makeSeg(-1, 5000, -1, -1), null, 'début négatif');
    assert.equal(SkipIntro._makeSeg(5000, 5000, -1, -1), null, 'fin == début');
    assert.equal(SkipIntro._makeSeg(5000, 3000, -1, -1), null, 'fin < début');
    assert.equal(SkipIntro._makeSeg(0, 2999, -1, -1), null, 'durée < 3000 ms : refusée (Jellyfin web évite les segments trop courts)');
    const seg = SkipIntro._makeSeg(0, 90000, -1, -1);
    assert.ok(seg, 'exactement 90 s : accepté');
    assert.equal(seg.startMs, 0);
    assert.equal(seg.endMs, 90000);
});

test('_makeSeg : prompt/hide par défaut (start-5s / end), source et type par défaut', () => {
    const SkipIntro = loadSkipIntro();
    const seg = SkipIntro._makeSeg(10000, 90000, -1, -1);
    assert.equal(seg.promptMs, 5000, 'max(0, start - 5000)');
    assert.equal(seg.hideMs, 90000, 'par défaut = endMs');
    assert.equal(seg.source, 'unknown');
    assert.equal(seg.type, 'Intro');

    const nearZero = SkipIntro._makeSeg(0, 90000, -1, -1);
    assert.equal(nearZero.promptMs, 0, 'jamais négatif même si start < 5000');

    const explicit = SkipIntro._makeSeg(0, 90000, 1234, 5678, 'media-segments', 'Outro');
    assert.equal(explicit.promptMs, 1234);
    assert.equal(explicit.hideMs, 5678);
    assert.equal(explicit.source, 'media-segments');
    assert.equal(explicit.type, 'Outro');
});

/* ===================== 3. Parsing des trois sources serveur =============== */

test('_listFromMediaSegments : reconnaît toutes les enveloppes JSON connues', () => {
    const SkipIntro = loadSkipIntro();
    assert.equal(SkipIntro._listFromMediaSegments({ Items: [1, 2] }).length, 2);
    assert.equal(SkipIntro._listFromMediaSegments({ Segments: [1] }).length, 1);
    assert.equal(SkipIntro._listFromMediaSegments({ MediaSegments: [1, 2, 3] }).length, 3);
    assert.equal(SkipIntro._listFromMediaSegments({ Results: [1] }).length, 1);
    assert.equal(SkipIntro._listFromMediaSegments([1, 2]).length, 2, 'tableau nu');
    assert.equal(SkipIntro._listFromMediaSegments({}).length, 0);
    assert.equal(SkipIntro._listFromMediaSegments(null).length, 0);
});

test('_fromMediaSegments : ne garde que le type Intro, tolère un type absent, ignore un segment garbage pour prendre le suivant', () => {
    const SkipIntro = loadSkipIntro();

    // Type absent : conservé (le filtre ne rejette que les types EXPLICITEMENT différents de "intro").
    const noType = SkipIntro._fromMediaSegments({ Items: [{ StartTicks: 0, EndTicks: 900000000 }] });
    assert.ok(noType);
    assert.equal(noType.type, 'Intro', 'type par défaut appliqué');

    // Uniquement des Outro : aucune Intro trouvée.
    assert.equal(SkipIntro._fromMediaSegments({ Items: [{ Type: 'Outro', StartTicks: 0, EndTicks: 900000000 }] }), null);

    // Premier segment garbage (trop court) : ignoré, le suivant (valide) est utilisé.
    const withGarbageFirst = SkipIntro._fromMediaSegments({
        Items: [
            { Type: 'Intro', StartTicks: 0, EndTicks: 10000000 }, // 1 s : trop court
            { Type: 'INTRO', StartTicks: 0, EndTicks: 900000000 }, // 90 s, casse différente
        ],
    });
    assert.ok(withGarbageFirst);
    assert.equal(withGarbageFirst.endMs, 90000);
    assert.equal(withGarbageFirst.source, 'media-segments');

    assert.equal(SkipIntro._fromMediaSegments(null), null);
});

test('_fromLegacy : Valid=false rejeté, unités multiples supportées (secondes par défaut)', () => {
    const SkipIntro = loadSkipIntro();
    assert.equal(SkipIntro._fromLegacy({ Valid: false, IntroStart: 0, IntroEnd: 90 }), null);
    assert.equal(SkipIntro._fromLegacy({ valid: false, IntroStart: 0, IntroEnd: 90 }), null, 'variante minuscule');

    const seconds = SkipIntro._fromLegacy({ Valid: true, IntroStart: 0, IntroEnd: 88, ShowSkipPromptAt: 0, HideSkipPromptAt: 85 });
    assert.ok(seconds);
    assert.equal(seconds.startMs, 0);
    assert.equal(seconds.endMs, 88000);
    assert.equal(seconds.promptMs, 0);
    assert.equal(seconds.hideMs, 85000);
    assert.equal(seconds.source, 'intro-skipper');

    const ticks = SkipIntro._fromLegacy({ StartTicks: 0, EndTicks: 900000000 });
    assert.equal(ticks.endMs, 90000);

    assert.equal(SkipIntro._fromLegacy(null), null);
    assert.equal(SkipIntro._fromLegacy({}), null, 'aucune borne exploitable');
});

test('_fromChapters : cherche un chapitre "Intro"/"Opening", fin = début du chapitre suivant, dernier chapitre => aucun segment', () => {
    const SkipIntro = loadSkipIntro();
    const withIntro = SkipIntro._fromChapters({
        Chapters: [{ Name: 'Intro', StartPositionTicks: 0 }, { Name: 'Episode', StartPositionTicks: 900000000 }],
    });
    assert.ok(withIntro);
    assert.equal(withIntro.endMs, 90000);
    assert.equal(withIntro.source, 'chapters');

    const openingCaseInsensitive = SkipIntro._fromChapters({
        Chapters: [{ Name: 'OPENING', StartPositionTicks: 0 }, { Name: 'Cold Open', StartPositionTicks: 900000000 }],
    });
    assert.ok(openingCaseInsensitive);

    // "Intro" est le DERNIER chapitre : pas de borne de fin => rejeté par _makeSeg.
    assert.equal(SkipIntro._fromChapters({ Chapters: [{ Name: 'Episode', StartPositionTicks: 0 }, { Name: 'Intro', StartPositionTicks: 900000000 }] }), null);

    assert.equal(SkipIntro._fromChapters({ Chapters: [] }), null);
    assert.equal(SkipIntro._fromChapters(null), null);
    assert.equal(SkipIntro._fromChapters({ Chapters: [{ Name: 'Cold Open', StartPositionTicks: 0 }] }), null, 'aucun nom ne matche');
});

/* ===================== 4. Horodatages exposés + décision d'affichage ====== */

test('startMs/endMs/promptMs/hideMs : clés multiples (interne, legacy Ms) avec valeur par défaut', () => {
    const SkipIntro = loadSkipIntro();
    assert.equal(SkipIntro.startMs({ startMs: 1000 }), 1000);
    assert.equal(SkipIntro.startMs({ IntroStartMs: 2000 }), 2000);
    assert.equal(SkipIntro.startMs({}), -1);
    assert.equal(SkipIntro.endMs({ StartMs: 1 }), -1, 'clé ne correspondant à aucun alias de endMs');
    assert.equal(SkipIntro.promptMs({ startMs: 10000 }, 5000), 5000, 'par défaut : start - lead');
    assert.equal(SkipIntro.promptMs({ startMs: 1000 }, 5000), 0, 'jamais négatif');
    assert.equal(SkipIntro.promptMs({ startMs: 1000, promptMs: 42 }, 5000), 42, 'valeur explicite prioritaire');
    assert.equal(SkipIntro.hideMs({ endMs: 90000 }), 90000, 'par défaut : endMs');
    assert.equal(SkipIntro.hideMs({ endMs: 90000, hideMs: 85000 }), 85000);
});

test('shouldShow : toutes les conditions bloquantes, puis la fenêtre [prompt, max(end,hide)[', () => {
    const SkipIntro = loadSkipIntro();
    const seg = { startMs: 10000, endMs: 90000 }; // prompt implicite = 5000 (lead 5000), hide implicite = 90000
    const lead = 5000;
    const ok = (pos) => SkipIntro.shouldShow(true, true, seg, false, false, false, false, false, pos, lead);

    assert.equal(ok(5000), true, 'borne basse incluse (>=)');
    assert.equal(ok(89999), true);
    assert.equal(ok(90000), false, 'borne haute exclue (<)');
    assert.equal(ok(4999), false, 'avant le prompt');

    assert.equal(SkipIntro.shouldShow(false, true, seg, false, false, false, false, false, 20000, lead), false, 'désactivé');
    assert.equal(SkipIntro.shouldShow(true, false, seg, false, false, false, false, false, 20000, lead), false, 'pas armé');
    assert.equal(SkipIntro.shouldShow(true, true, null, false, false, false, false, false, 20000, lead), false, 'pas de segment');
    assert.equal(SkipIntro.shouldShow(true, true, seg, true, false, false, false, false, 20000, lead), false, 'piste suivante verrouillée');
    assert.equal(SkipIntro.shouldShow(true, true, seg, false, true, false, false, false, 20000, lead), false, 'sélecteur audio ouvert');
    assert.equal(SkipIntro.shouldShow(true, true, seg, false, false, true, false, false, 20000, lead), false, 'sélecteur sous-titres ouvert');
    assert.equal(SkipIntro.shouldShow(true, true, seg, false, false, false, true, false, 20000, lead), false, 'déjà consommé (skip fait)');
    assert.equal(SkipIntro.shouldShow(true, true, seg, false, false, false, false, true, 20000, lead), false, 'fermé manuellement par l\'utilisateur');

    // Segment garbage (fin <= début) : jamais affiché, quelle que soit la position.
    assert.equal(SkipIntro.shouldShow(true, true, { startMs: 5000, endMs: 5000 }, false, false, false, false, false, 5000, lead), false);
});

/* ===================== 5. Orchestration réseau (fetchIntroSegment) ======== */

function makeBridgeStub() {
    const pending = [];
    function sendRequestNoCache(method, url, headers, body, onSuccess, onError) {
        pending.push({ url, onSuccess, onError });
        return { cancel() { return true; } };
    }
    return {
        sendRequestNoCache,
        urls: () => pending.map((p) => p.url),
        count: () => pending.length,
        resolve(matcher, json) {
            const idx = pending.findIndex((p) => matcher(p.url));
            if (idx < 0) throw new Error('aucune requête en attente ne correspond : ' + matcher);
            const [p] = pending.splice(idx, 1);
            p.onSuccess({ json, status: 200 });
        },
        reject(matcher, code) {
            const idx = pending.findIndex((p) => matcher(p.url));
            if (idx < 0) throw new Error('aucune requête en attente ne correspond : ' + matcher);
            const [p] = pending.splice(idx, 1);
            p.onError({ code });
        },
    };
}
const isMediaSegmentsUrl = (u) => u.indexOf('/MediaSegments/') >= 0;
const isLegacyUrl = (u) => u.indexOf('/IntroTimestamps') >= 0;
const isItemUrl = (u) => u.indexOf('/Items/') >= 0;

test('fetchIntroSegment : MediaSegments répond directement, la 1re variante suffit (pas de fallback appelé)', () => {
    const SkipIntro = loadSkipIntro();
    const stub = makeBridgeStub();
    SkipIntro.JellyfinBridge.sendRequestNoCache = stub.sendRequestNoCache;

    let result = null;
    SkipIntro.fetchIntroSegment(SERVER, TOKEN, 'ITEM1', (ok, seg, err) => { result = { ok, seg, err }; });
    assert.equal(stub.count(), 1, 'une seule requête émise pour l\'instant (la 1re variante)');
    stub.resolve(isMediaSegmentsUrl, { Items: [{ Type: 'Intro', StartTicks: 0, EndTicks: 900000000 }] });

    assert.equal(result.ok, true);
    assert.equal(result.seg.source, 'media-segments');
    assert.equal(result.seg.endMs, 90000);
    assert.equal(stub.count(), 0, 'ni legacy ni chapitres n\'ont été appelés');
});

test('fetchIntroSegment : MediaSegments répond sans Intro (modernSupported) => saute directement aux chapitres, jamais l\'endpoint legacy', () => {
    const SkipIntro = loadSkipIntro();
    const stub = makeBridgeStub();
    SkipIntro.JellyfinBridge.sendRequestNoCache = stub.sendRequestNoCache;

    let result = null;
    SkipIntro.fetchIntroSegment(SERVER, TOKEN, 'ITEM2', (ok, seg, err) => { result = { ok, seg, err }; });
    // 3 variantes de requête MediaSegments sont tentées avant d'abandonner cette source.
    for (let i = 0; i < 3; i++) stub.resolve(isMediaSegmentsUrl, { Items: [] });
    assert.equal(stub.urls().length, 1, 'chapitres appelés, pas legacy');
    assert.ok(isItemUrl(stub.urls()[0]));
    stub.resolve(isItemUrl, { Chapters: [{ Name: 'Intro', StartPositionTicks: 0 }, { Name: 'Ep', StartPositionTicks: 900000000 }] });

    assert.equal(result.ok, true);
    assert.equal(result.seg.source, 'chapters');
});

test('fetchIntroSegment : MediaSegments en erreur réseau => legacy essayé => valide, chapitres jamais appelés', () => {
    const SkipIntro = loadSkipIntro();
    const stub = makeBridgeStub();
    SkipIntro.JellyfinBridge.sendRequestNoCache = stub.sendRequestNoCache;

    let result = null;
    SkipIntro.fetchIntroSegment(SERVER, TOKEN, 'ITEM3', (ok, seg, err) => { result = { ok, seg, err }; });
    for (let i = 0; i < 3; i++) stub.reject(isMediaSegmentsUrl, 'network');
    assert.ok(isLegacyUrl(stub.urls()[0]));
    stub.resolve(isLegacyUrl, { Valid: true, IntroStart: 0, IntroEnd: 90 });

    assert.equal(result.ok, true);
    assert.equal(result.seg.source, 'intro-skipper');
    assert.equal(stub.count(), 0, 'les chapitres ne sont jamais interrogés si le legacy a suffi');
});

test('fetchIntroSegment : legacy 404 => mémorise le serveur comme non-legacy, un 2e item saute directement aux chapitres', () => {
    const SkipIntro = loadSkipIntro();
    const stub = makeBridgeStub();
    SkipIntro.JellyfinBridge.sendRequestNoCache = stub.sendRequestNoCache;
    const server = 'http://192.168.50.21:8096'; // hôte dédié : la mémorisation "legacy non supporté" est par serveur.

    let r1 = null;
    SkipIntro.fetchIntroSegment(server, TOKEN, 'ITEMX', (ok, seg, err) => { r1 = { ok, seg, err }; });
    for (let i = 0; i < 3; i++) stub.reject(isMediaSegmentsUrl, 'network');
    stub.reject(isLegacyUrl, 'http_404');
    stub.resolve(isItemUrl, { Chapters: [{ Name: 'Intro', StartPositionTicks: 0 }, { Name: 'Ep', StartPositionTicks: 900000000 }] });
    assert.equal(r1.ok, true);
    assert.equal(r1.seg.source, 'chapters');

    // Deuxième item, même serveur : MediaSegments échoue à nouveau, mais legacy ne doit PLUS être appelé.
    let r2 = null;
    SkipIntro.fetchIntroSegment(server, TOKEN, 'ITEMY', (ok, seg, err) => { r2 = { ok, seg, err }; });
    for (let i = 0; i < 3; i++) stub.reject(isMediaSegmentsUrl, 'network');
    assert.equal(stub.urls().length, 1);
    assert.ok(isItemUrl(stub.urls()[0]), 'legacy sauté, directement les chapitres');
    stub.resolve(isItemUrl, { Chapters: [] });
    assert.equal(r2.ok, false, 'aucune source n\'a de segment');
});

test('fetchIntroSegment : les trois sources échouent => échec propre, sans planter', () => {
    const SkipIntro = loadSkipIntro();
    const stub = makeBridgeStub();
    SkipIntro.JellyfinBridge.sendRequestNoCache = stub.sendRequestNoCache;

    let result = null;
    SkipIntro.fetchIntroSegment(SERVER, TOKEN, 'ITEM4', (ok, seg, err) => { result = { ok, seg, err }; });
    for (let i = 0; i < 3; i++) stub.reject(isMediaSegmentsUrl, 'network');
    stub.reject(isLegacyUrl, 'network');
    stub.reject(isItemUrl, 'network');

    assert.equal(result.ok, false);
    assert.equal(result.seg, null);
});

test('fetchIntroSegment : contexte incomplet ou transport non sécurisé => échec immédiat, aucune requête', () => {
    const SkipIntro = loadSkipIntro();
    const stub = makeBridgeStub();
    SkipIntro.JellyfinBridge.sendRequestNoCache = stub.sendRequestNoCache;

    let result = null;
    SkipIntro.fetchIntroSegment('', TOKEN, 'ITEM5', (ok, seg, err) => { result = { ok, seg, err }; });
    assert.equal(result.err, 'ctx');
    assert.equal(stub.count(), 0);

    result = null;
    // Hôte WAN (non-LAN) en HTTP : un secret ne doit jamais partir en clair.
    SkipIntro.fetchIntroSegment('http://jellyfin.example.com', TOKEN, 'ITEM6', (ok, seg, err) => { result = { ok, seg, err }; });
    assert.equal(result.ok, false);
    assert.equal(result.err, 'insecure_transport');
    assert.equal(stub.count(), 0);
});

test('fetchIntroSegment : requêtes concurrentes pour le même item dédupliquées (une seule requête réseau)', () => {
    const SkipIntro = loadSkipIntro();
    const stub = makeBridgeStub();
    SkipIntro.JellyfinBridge.sendRequestNoCache = stub.sendRequestNoCache;

    let r1 = null, r2 = null;
    SkipIntro.fetchIntroSegment(SERVER, TOKEN, 'ITEMZ', (ok, seg, err) => { r1 = { ok, seg, err }; });
    SkipIntro.fetchIntroSegment(SERVER, TOKEN, 'ITEMZ', (ok, seg, err) => { r2 = { ok, seg, err }; });
    assert.equal(stub.count(), 1, 'la 2e demande rejoint la 1re en vol, sans requête supplémentaire');

    stub.resolve(isMediaSegmentsUrl, { Items: [{ Type: 'Intro', StartTicks: 0, EndTicks: 900000000 }] });
    assert.equal(r1.ok, true);
    assert.equal(r2.ok, true);
    assert.equal(r1.seg.endMs, r2.seg.endMs, 'les deux appelants reçoivent le même résultat');
});

test('fetchIntroSegment : résultat mis en cache, un appel ultérieur ne déclenche aucune requête', () => {
    const SkipIntro = loadSkipIntro();
    const stub = makeBridgeStub();
    SkipIntro.JellyfinBridge.sendRequestNoCache = stub.sendRequestNoCache;

    let result = null;
    SkipIntro.fetchIntroSegment(SERVER, TOKEN, 'ITEMCACHE', (ok, seg, err) => { result = { ok, seg, err }; });
    stub.resolve(isMediaSegmentsUrl, { Items: [{ Type: 'Intro', StartTicks: 0, EndTicks: 900000000 }] });
    assert.equal(result.ok, true);

    let cached = null;
    SkipIntro.fetchIntroSegment(SERVER, TOKEN, 'ITEMCACHE', (ok, seg, err) => { cached = { ok, seg, err }; });
    assert.ok(cached, 'répond de façon synchrone depuis le cache (pas de Qt.callLater sous Node)');
    assert.equal(cached.ok, true);
    assert.equal(stub.count(), 0, 'aucune nouvelle requête réseau');
});
