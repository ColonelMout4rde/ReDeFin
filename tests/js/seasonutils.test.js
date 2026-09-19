'use strict';

/*
 * Régressions ciblées sur qml/js/SeasonUtils.js (upstream + retouches locales).
 *
 * Ce module porte toute la logique saisons/épisodes : conversions de temps
 * (ticks Jellyfin = 100ns), sélection de l'épisode affiché à l'ouverture
 * d'une saison (restauration, playlist, "next up"), repli d'affichage quand
 * les métadonnées sont pauvres (titre = nom de fichier), et repli d'image de
 * fond quand une saison n'a pas ses propres visuels. Une régression ici se
 * voit rarement dans les tests QML : elle se voit sur l'écran (mauvais
 * épisode repris, mauvaise durée affichée, fond d'écran vide).
 *
 * TZ fixé à UTC : formatEndClockFromTicks()/endTimeFor() lisent l'heure
 * locale (Date.getHours()), qui dépendrait sinon du fuseau de la machine qui
 * exécute les tests.
 */
process.env.TZ = 'UTC';

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadQmlJs } = require('./qmljs');

const FIXED_NOW = Date.UTC(2024, 0, 1, 10, 0, 0); // 2024-01-01T10:00:00Z, fixe et arbitraire.
const DateStub = Object.assign(
    function (...a) { return new Date(...a); },
    { now: () => FIXED_NOW, parse: Date.parse, UTC: Date.UTC }
);
const QtStub = {
    locale: () => 'C',
    formatTime: (d, fmt) => {
        const hh = String(d.getHours()).padStart(2, '0');
        const mm = String(d.getMinutes()).padStart(2, '0');
        return fmt === 'hh:mm' ? `${hh}:${mm}` : '';
    },
};

const SU = loadQmlJs('qml/js/SeasonUtils.js', { stubs: { Date: DateStub, Qt: QtStub } });

// Cf. tests/js/mediacatalog.test.js : les objets/tableaux construits DANS le
// module vivent dans un autre réalme vm, assert.deepEqual les rejette même
// quand ils sont identiques. On compare via leur sérialisation JSON.
function js(value) { return JSON.stringify(value); }
function assertJsonEqual(actual, expected, message) { assert.equal(js(actual), js(expected), message); }

const SNT = -999; // Sentinelle "pas de saison inconnue demandée" utilisée par l'appelant réel (seasonpage.qml).

/* ===================== 1. Conversions de temps (ticks/ms/s) =============== */

test('msFromTicks : ticks Jellyfin (100ns) -> millisecondes', () => {
    assert.equal(SU.msFromTicks(10000000), 1000, '1 tick = 100ns, 10 000 000 ticks = 1 s');
    assert.equal(SU.msFromTicks(0), 0);
    assert.equal(SU.msFromTicks(undefined), 0);
    assert.equal(SU.msFromTicks(null), 0);
});

test('fmtMinutesFromTicks : minutes entières arrondies vers le bas', () => {
    assert.equal(SU.fmtMinutesFromTicks(600000000 * 45), '45 min');
    assert.equal(SU.fmtMinutesFromTicks(0), '');
});

test('ticksToSeconds / formatTicksToHhMm : secondes entières, format "h min"/"min"', () => {
    assert.equal(SU.ticksToSeconds(600000000 * 90), 5400);
    assert.equal(SU.ticksToSeconds(0), 0);
    assert.equal(SU.formatTicksToHhMm(600000000 * 90), '1 h 30');
    assert.equal(SU.formatTicksToHhMm(600000000 * 45), '45 min');
    assert.equal(SU.formatTicksToHhMm(0), '');
});

test('formatEndClockFromTicks / endTimeFor : "maintenant + durée", horloge et fuseau figés', () => {
    assert.equal(SU.formatEndClockFromTicks(600000000 * 90), '11:30', '10:00 + 1h30 = 11:30');
    assert.equal(SU.formatEndClockFromTicks(0), '');
    assert.equal(SU.endTimeFor(600000000 * 30), '10:30');
    assert.equal(SU.endTimeFor(0), '');
});

test('chapterStartMs / chapterTimeLabel : ticks -> ms/label, avec ou sans heures', () => {
    assert.equal(SU.chapterStartMs({ StartPositionTicks: 10000000 * 90 }), 90000);
    assert.equal(SU.chapterStartMs(null), 0);
    assert.equal(SU.chapterTimeLabel({ StartPositionTicks: 10000000 * 90 }), '1:30');
    assert.equal(SU.chapterTimeLabel({ StartPositionTicks: 10000000 * 3661 }), '1:01:01');
});

test('chapterIndexForPosition : chapitre courant à une position donnée, tolérance, bornes', () => {
    const chapters = [{ StartPositionTicks: 0 }, { StartPositionTicks: 10 * 10000000 }, { StartPositionTicks: 60 * 10000000 }];
    assert.equal(SU.chapterIndexForPosition(chapters, 5000, 0), 0);
    assert.equal(SU.chapterIndexForPosition(chapters, 10000, 0), 1, 'exactement au démarrage du chapitre suivant');
    assert.equal(SU.chapterIndexForPosition(chapters, 200000, 0), 2, 'après le dernier chapitre : reste sur le dernier');
    assert.equal(SU.chapterIndexForPosition([], 100, 0), -1, 'aucun chapitre');
});

/* ===================== 2. Numérotation / titres d'épisode ================= */

test('sxeCode : saison 0 (spécial) correctement affichée, repli sur l\'IndexNumber de la saison', () => {
    assert.equal(SU.sxeCode({ ParentIndexNumber: 1, IndexNumber: 5 }, null), 'S1:E5');
    assert.equal(SU.sxeCode({ ParentIndexNumber: 0, IndexNumber: 2 }, null), 'S0:E2', 'les spéciaux gardent leur "S0"');
    assert.equal(SU.sxeCode({ IndexNumber: 2 }, { IndexNumber: 3 }), 'S3:E2', 'saison absente sur l\'épisode : repli sur seasonItem');
    assert.equal(SU.sxeCode({}, null), '');
    assert.equal(SU.sxeCode(null, null), '');
});

test('isLikelyFilename : détecte les noms bruts de fichier, pas les vrais titres', () => {
    assert.equal(SU.isLikelyFilename('Movie.Name.2020.mkv'), true);
    assert.equal(SU.isLikelyFilename('Show.S01E02_something-123'), true, 'suffixe numérique caractéristique d\'un rip');
    assert.equal(SU.isLikelyFilename('Le Retour du Roi'), false);
    assert.equal(SU.isLikelyFilename(''), false);
});

test('displayEpisodeTitle : préfère un titre propre, mais n\'invente jamais quand tout manque', () => {
    assert.equal(SU.displayEpisodeTitle({ Name: 'Pilote' }), 'Pilote');
    assert.equal(SU.displayEpisodeTitle({ Name: 'show.s01e02.mkv', OriginalTitle: 'Vrai titre' }), 'Vrai titre',
        'un nom de fichier cède la place à OriginalTitle si celui-ci est propre');
    assert.equal(SU.displayEpisodeTitle({ Name: 'show.s01e02.mkv', IndexNumber: 2 }), 'show.s01e02.mkv',
        'à défaut de mieux, le nom de fichier reste plus informatif que le générique');
    assert.equal(SU.displayEpisodeTitle({ IndexNumber: 5 }), 'Épisode 5');
    assert.equal(SU.displayEpisodeTitle({}), 'Épisode');
    assert.equal(SU.displayEpisodeTitle(null), '');
});

test('computeTags : résolution/codec/HDR vidéo, codec/canaux audio, sous-titres, conteneur', () => {
    const it = {
        MediaStreams: [
            { Type: 'Video', Width: 1920, Height: 1080, Codec: 'hevc', VideoRange: 'HDR10' },
            { Type: 'Audio', Codec: 'eac3', Channels: 6 },
        ],
        Container: 'mkv',
    };
    assertJsonEqual(SU.computeTags(it), ['1080p', 'HEVC', 'HDR10', 'EAC3', '5.1', 'MKV']);
    assertJsonEqual(SU.computeTags({ MediaStreams: [], SubtitleFiles: ['fr.srt'] }), ['ST']);
    assertJsonEqual(SU.computeTags(null), []);
});

/* ===================== 3. Sélection de l'épisode à afficher ("next"/reprise) */

test('applyRestoreIndexIfAny : préselection > restauration par id > restauration par index', () => {
    const list = [{ Id: 'a' }, { Id: 'b' }, { Id: 'c' }];
    assert.equal(SU.applyRestoreIndexIfAny(list, 'c', 'a', 0), 2, 'la préselection explicite gagne');
    assert.equal(SU.applyRestoreIndexIfAny(list, null, 'b', 0), 1);
    assert.equal(SU.applyRestoreIndexIfAny(list, null, null, 2), 2);
    assert.equal(SU.applyRestoreIndexIfAny(list, null, null, 99), -1, 'index hors bornes');
    assert.equal(SU.applyRestoreIndexIfAny([], 'a', null, 0), -1);
});

test('indexFromPlaylistIfAny : playlist.index prioritaire, puis currentItemId/getCurrentItemId', () => {
    const list = [{ Id: 'a' }, { Id: 'b' }, { Id: 'c' }];
    assert.equal(SU.indexFromPlaylistIfAny({ index: 2 }, list), 2);
    assert.equal(SU.indexFromPlaylistIfAny({ index: 99 }, list), -1, 'index hors bornes ignoré');
    assert.equal(SU.indexFromPlaylistIfAny({ currentItemId: 'b' }, list), 1);
    assert.equal(SU.indexFromPlaylistIfAny({ getCurrentItemId: () => 'c' }, list), 2);
    assert.equal(SU.indexFromPlaylistIfAny(null, list), -1);
});

test('desiredIndexFromInputs : ordre de priorité complet (entrées explicites > playlist > 0)', () => {
    const list = [{ Id: 'a' }, { Id: 'b' }, { Id: 'c' }];
    assert.equal(SU.desiredIndexFromInputs(list, 'b', null, -1, { currentItemId: 'c' }), 1, 'préselection bat la playlist');
    assert.equal(SU.desiredIndexFromInputs(list, null, null, -1, { currentItemId: 'c' }), 2, 'sinon la playlist est utilisée');
    assert.equal(SU.desiredIndexFromInputs(list, null, null, -1, null), 0, 'sans indice : le premier épisode');
    assert.equal(SU.desiredIndexFromInputs([], 'a', null, -1, null), -1, 'liste vide');
});

test('bucketUnknownEpisodes : filtre par saison explicite, par préselection, ou par la première saison rencontrée', () => {
    const eps = [{ Id: 'e1', ParentIndexNumber: 1 }, { Id: 'e2', ParentIndexNumber: 2 }, { Id: 'e3', ParentIndexNumber: 1 }];
    assertJsonEqual(SU.bucketUnknownEpisodes(eps, 2, SNT, null).map((e) => e.Id), ['e2'], 'numéro de saison explicite');
    assertJsonEqual(SU.bucketUnknownEpisodes(eps, SNT, SNT, 'e2').map((e) => e.Id), ['e2'], 'déduit de l\'épisode présélectionné');
    assertJsonEqual(SU.bucketUnknownEpisodes(eps, SNT, SNT, null).map((e) => e.Id), ['e1', 'e3'], 'à défaut : la 1re saison rencontrée');
    assertJsonEqual(SU.bucketUnknownEpisodes([], SNT, SNT, null), []);
});

test('nextUpEpisodeFromBlock : clés directes, tableau + index courant, model.get(), hasContent=false', () => {
    assertJsonEqual(SU.nextUpEpisodeFromBlock({ currentEpisode: { Id: 'e1' } }), { Id: 'e1' });
    assertJsonEqual(SU.nextUpEpisodeFromBlock({ items: [{ Id: 'e1' }, { Id: 'e2' }], currentIndex: 1 }), { Id: 'e2' });
    assertJsonEqual(SU.nextUpEpisodeFromBlock({ items: [{ Id: 'e1' }], currentIndex: 5 }), { Id: 'e1' }, 'index hors bornes : repli sur le premier');
    assertJsonEqual(SU.nextUpEpisodeFromBlock({ model: { get: (i) => ({ Id: 'm' + i }) }, currentIndex: 3 }), { Id: 'm3' });
    assert.equal(SU.nextUpEpisodeFromBlock({ hasContent: false, currentEpisode: { Id: 'e1' } }), null);
    assert.equal(SU.nextUpEpisodeFromBlock(null), null);
});

test('countDisplaySeasons : ignore les spéciaux (index<=0) sauf s\'il n\'y a QUE des spéciaux', () => {
    assert.equal(SU.countDisplaySeasons([{ IndexNumber: 0 }, { IndexNumber: 1 }, { IndexNumber: 2 }]), 2);
    assert.equal(SU.countDisplaySeasons([{ IndexNumber: 0 }]), 1, 'repli sur le total quand aucune saison numérotée');
    assert.equal(SU.countDisplaySeasons([]), 0);
    assert.equal(SU.countDisplaySeasons(null), 0);
});

test('seasonPlaylistTitle : saison liée, saison inconnue, bucket "non liée"', () => {
    assert.equal(SU.seasonPlaylistTitle({ Id: 'S2', SeriesName: 'Show', IndexNumber: 2 }, SNT, SNT), 'Show — Saison 2');
    assert.equal(SU.seasonPlaylistTitle({ Id: 'S1', SeriesName: 'Show', Name: 'Épisodes spéciaux' }, SNT, SNT),
        'Show — Épisodes spéciaux');
    assert.equal(SU.seasonPlaylistTitle({ SeriesName: 'Show' }, SNT, SNT), 'Show — Saison inconnue',
        'pas d\'Id => bucket "saison inconnue" même si IndexNumber était présent ailleurs');
    assert.equal(SU.seasonPlaylistTitle({ SeriesName: 'Show' }, 3, SNT), 'Show — Saison 3 (non liée)');
});

/* ===================== 4. Repli d'image de fond (backdrop) ================ */

test('computeBgUrl : priorité parent (série) > seriesId nu > backdrop propre > primary propre > seasonId nu', () => {
    const server = 'http://192.168.50.10:8096';
    const withParent = SU.computeBgUrl(server, { ParentBackdropItemId: 'P1', ParentBackdropImageTags: ['tagP'] }, [], 'SERIES1', 'SEASON1', 10, 70);
    assert.match(withParent, /\/Items\/P1\/Images\/Backdrop\?/, 'le backdrop du parent (série) gagne toujours');
    assert.match(withParent, /tag=tagP/);

    const seriesOnly = SU.computeBgUrl(server, {}, [], 'SERIES1', 'SEASON1', 10, 70);
    assert.match(seriesOnly, /\/Items\/SERIES1\/Images\/Backdrop\?/);

    const seasonBackdrop = SU.computeBgUrl(server, { Id: 'SEASON1', BackdropImageTags: ['tagS'] }, [], '', 'SEASON1', 10, 70);
    assert.match(seasonBackdrop, /\/Items\/SEASON1\/Images\/Backdrop\?.*tag=tagS/);

    const seasonPrimary = SU.computeBgUrl(server, { Id: 'SEASON1', ImageTags: { Primary: 'tagPrim' } }, [], '', 'SEASON1', 10, 70);
    assert.match(seasonPrimary, /\/Items\/SEASON1\/Images\/Primary\?.*tag=tagPrim/);

    const seasonIdBare = SU.computeBgUrl(server, null, [], '', 'SEASON1', 10, 70);
    assert.match(seasonIdBare, /\/Items\/SEASON1\/Images\/Backdrop\?/);

    assert.equal(SU.computeBgUrl(server, null, [], '', '', 10, 70), '', 'rien à afficher');
    assert.equal(SU.computeBgUrl('', null, [], 'S1', 'SE1', 10, 70), '', 'pas de serveur');
});

/* ===================== 5. Distribution invité/casting ===================== */

test('extractGuestStars : liste GuestStars nommée > People marqués invité > repli sur les acteurs', () => {
    const withExplicitList = {
        GuestStars: ['Jane Doe'],
        People: [{ Name: 'Jane Doe', Type: 'Actor' }, { Name: 'John Roe', Type: 'Actor', IsGuestStar: true }, { Name: 'Main Actor', Type: 'Actor' }],
    };
    assertJsonEqual(SU.extractGuestStars(withExplicitList).map((p) => p.Name), ['Jane Doe', 'John Roe']);

    const flaggedOnly = { People: [{ Name: 'Guest1', IsGuestStar: true }, { Name: 'Regular', Type: 'Actor' }] };
    assertJsonEqual(SU.extractGuestStars(flaggedOnly).map((p) => p.Name), ['Guest1']);

    const noFlagAtAll = { People: [{ Name: 'Actor1', Type: 'Actor' }, { Name: 'Director1', Type: 'Director' }] };
    assertJsonEqual(SU.extractGuestStars(noFlagAtAll).map((p) => p.Name), ['Actor1'], 'sans aucun invité marqué, repli sur les acteurs');

    assertJsonEqual(SU.extractGuestStars(null), []);
});

test('guestDisplayRole : Character > Role > Job, jamais un libellé générique ("Guest Star"...)', () => {
    assert.equal(SU.guestDisplayRole({ Character: 'Le Docteur' }), 'Le Docteur');
    assert.equal(SU.guestDisplayRole({ Character: 'Guest Star' }), 'Invité·e', 'libellé générique filtré');
    assert.equal(SU.guestDisplayRole({ Role: 'Invité' }), 'Invité·e');
    assert.equal(SU.guestDisplayRole({ Job: 'Cascadeur' }), 'Cascadeur');
    assert.equal(SU.guestDisplayRole({}), 'Invité·e');
});

test('normalizeGuestUiList : les invités marqués passent devant, les non-acteurs (scénariste...) sont exclus', () => {
    const list = SU.normalizeGuestUiList([
        { Name: 'Star1', IsGuestStar: true, Character: 'Roi' },
        { Name: 'Actor1', Type: 'Actor' },
        { Name: 'Writer1', Type: 'Writer' },
    ]);
    assertJsonEqual(list.map((p) => p.Name), ['Star1', 'Actor1']);
    assertJsonEqual(SU.normalizeGuestUiList(['Nom seul']), [{ Id: '', PersonId: '', ItemId: '', Name: 'Nom seul', Role: 'Invité·e' }],
        'forme historique : une simple liste de chaînes');
    assertJsonEqual(SU.normalizeGuestUiList([]), []);
    assertJsonEqual(SU.normalizeGuestUiList(null), []);
});

/* ===================== 6. Messages d'erreur réseau (table) ================ */

test('_seasonLoadErrorMessage : code d\'erreur -> message utilisateur stable', () => {
    const cases = [
        ['too_large', 'Réponse Jellyfin trop lourde. Chargement paginé requis.'],
        [{ status: 404 }, 'Saison introuvable côté Jellyfin.'],
        [{ status: 401 }, 'Session Jellyfin expirée ou accès refusé.'],
        [{ status: 403 }, 'Session Jellyfin expirée ou accès refusé.'],
        ['timeout', 'Timeout réseau / API.'],
        [{ status: 500 }, 'Erreur Jellyfin HTTP 500.'],
        [undefined, 'Erreur réseau / API lors du chargement des épisodes.'],
    ];
    for (const [err, expected] of cases) assert.equal(SU._seasonLoadErrorMessage(err), expected, JSON.stringify(err));
});

/* ===================== 7. Tolérance générale aux champs manquants ========= */

test('tolérance : un panel de fonctions ne lève jamais sur null/undefined', () => {
    const calls = [
        () => SU.fmtDateLong(null),
        () => SU.chapterTitle(undefined),
        () => SU.chapterImageUrl('http://s', 'id', null, 0, 100, 100, 80),
        () => SU.directorNames(null),
        () => SU.normName(undefined),
        () => SU.mapByName(null),
        () => SU.isGuestStarEntry(null),
        () => SU.isActorLike(undefined),
        () => SU.normalizePersonLike(null, 'fallback'),
        () => SU.hasGuestStars(null),
        () => SU.slice(null, 3),
        () => SU.buildOverviewOverlayPayload(null, 'http://s'),
        () => SU.computeSeriesPosterFallbackUrl('http://s', null, null, null),
        () => SU.computeSeriesLogoUrl('', '', null, null),
    ];
    for (const fn of calls) assert.doesNotThrow(fn);
});
