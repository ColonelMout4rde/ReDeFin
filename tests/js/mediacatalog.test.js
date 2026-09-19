'use strict';

/*
 * Régressions ciblées sur qml/js/MediaCatalog.js (upstream + retouches locales).
 *
 * Ce module est la seule source de vérité pour transformer les payloads
 * Jellyfin (souvent incomplets ou légèrement différents d'une version de
 * serveur à l'autre) en ce que l'UI affiche. Les zones couvertes ici sont
 * celles où une régression est silencieuse (rien ne plante, l'écran affiche
 * juste la mauvaise bibliothèque, la mauvaise image, ou perd la position de
 * lecture) et celles qui existent uniquement pour tenir sur la Freebox
 * Révolution (structures de taille bornée en mémoire) :
 *
 *  - classification de type d'item et filtrage des bibliothèques affichées ;
 *  - sélection d'image/tag et ses replis (poster -> thumb, etc.) ;
 *  - état lu/repris et ratio de progression ;
 *  - conversions durée/ticks ;
 *  - tri des dossiers, ordre saisons/épisodes (dont les spéciaux saison 0) ;
 *  - détection des épisodes manquants/virtuels ;
 *  - structures bornées en mémoire (piles, caches, fenêtres de pagination).
 *
 * Tolérance aux champs manquants : vérifiée en passant systématiquement des
 * items null/undefined/incomplets à côté des cas nominaux.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadQmlJs } = require('./qmljs');

const FIXED_NOW = 1700000000000; // 2023-11-14T22:13:20.000Z, fixe et arbitraire.
// Object.assign(fn, Date, {...}) NE copie PAS parse/UTC (statiques non
// énumérables de Date) : on les fixe explicitement, comme bridgeharness.js.
const DateStub = Object.assign(
    function (...a) { return new Date(...a); },
    { now: () => FIXED_NOW, parse: Date.parse, UTC: Date.UTC }
);

const MC = loadQmlJs('qml/js/MediaCatalog.js', { stubs: { Date: DateStub } });

// Les objets/tableaux CONSTRUITS PAR le module (littéraux évalués dans son
// propre contexte vm) ont un prototype d'un autre réalme : assert.deepEqual
// les rejette ("same structure but not reference-equal") même quand ils sont
// structurellement identiques. On compare donc leur sérialisation JSON
// (aucune valeur ici n'est une fonction/Date/Symbol, donc c'est fidèle).
function js(value) { return JSON.stringify(value); }
function assertJsonEqual(actual, expected, message) {
    assert.equal(js(actual), js(expected), message);
}

/* ===================== 1. Classification de type d'item ================= */

test('itemTypeLower : tolère les items absents ou sans Type', () => {
    assert.equal(MC.itemTypeLower(null), '');
    assert.equal(MC.itemTypeLower(undefined), '');
    assert.equal(MC.itemTypeLower({}), '');
    assert.equal(MC.itemTypeLower({ Type: 'Movie' }), 'movie');
    assert.equal(MC.itemTypeLower({ Type: 'Episode' }), 'episode');
});

test('isRealTypedMediaItem : exclut les dossiers et les épisodes/films virtuels', () => {
    assert.equal(MC.isRealTypedMediaItem({ Id: '1', Type: 'Movie' }, 'movie'), true);
    assert.equal(MC.isRealTypedMediaItem({ Id: '1', Type: 'Movie', IsFolder: true }, 'movie'), false);
    assert.equal(MC.isRealTypedMediaItem({ Id: '1', Type: 'Movie', LocationType: 'Virtual' }, 'movie'), false);
    assert.equal(MC.isRealTypedMediaItem({ Id: '1', Type: 'Movie', locationType: 'missing' }, 'movie'), false);
    assert.equal(MC.isRealTypedMediaItem({ Type: 'Movie' }, 'movie'), false, 'sans Id');
    assert.equal(MC.isRealTypedMediaItem({ Id: '1', Type: 'Series' }, 'movie'), false, 'mauvais type');
    // Series n'est pas soumis au filtre IsFolder/LocationType (branche movie/video/musicvideo uniquement).
    assert.equal(MC.isRealTypedMediaItem({ Id: '1', Type: 'Series', IsFolder: true }, 'series'), true);
});

test('filterRealTypedMediaItems : liste de types séparés par virgule, items invalides écartés', () => {
    const items = [
        { Id: '1', Type: 'Movie' },
        { Id: '2', Type: 'Movie', LocationType: 'Virtual' },
        { Id: '3', Type: 'Video' },
        { Id: '4', Type: 'Series' },
        null,
    ];
    const out = MC.filterRealTypedMediaItems(items, 'Movie,Video');
    assertJsonEqual(out.map((it) => it.Id), ['1', '3']);
    assert.equal(MC.filterRealTypedMediaItems(null, 'Movie').length, 0);
});

test('isUnsupportedMediaItem : audio/livres écartés, vidéo/série acceptées', () => {
    assert.equal(MC.isUnsupportedMediaItem({ Type: 'Audio' }), true);
    assert.equal(MC.isUnsupportedMediaItem({ Type: 'MusicAlbum' }), true);
    assert.equal(MC.isUnsupportedMediaItem({ Type: 'AudioBook' }), true);
    assert.equal(MC.isUnsupportedMediaItem({ Type: 'Book' }), true);
    assert.equal(MC.isUnsupportedMediaItem({ Type: 'Movie' }), false);
    assert.equal(MC.isUnsupportedMediaItem({ Type: 'Series' }), false);
});

test('isMusicVideoItem', () => {
    assert.equal(MC.isMusicVideoItem({ Type: 'MusicVideo' }), true);
    assert.equal(MC.isMusicVideoItem({ Type: 'Movie' }), false);
});

/* ===================== 2. Visibilité des bibliothèques =================== */

test('isKnownUnsupportedLibraryFolder : livres, Live TV, enregistrements DVR', () => {
    assert.equal(MC.isKnownUnsupportedLibraryFolder({ CollectionType: 'books' }), true);
    assert.equal(MC.isKnownUnsupportedLibraryFolder({ Type: 'BookFolder' }), true);
    assert.equal(MC.isKnownUnsupportedLibraryFolder({ Name: 'Livres' }), true);
    assert.equal(MC.isKnownUnsupportedLibraryFolder({ Name: 'Bibliothèque de livres' }), true, 'accents normalisés');
    assert.equal(MC.isKnownUnsupportedLibraryFolder({ CollectionType: 'livetv' }), true);
    assert.equal(MC.isKnownUnsupportedLibraryFolder({ Name: 'Chaînes TV' }), true);
    assert.equal(MC.isKnownUnsupportedLibraryFolder({ CollectionType: 'recordings' }), true);
    assert.equal(MC.isKnownUnsupportedLibraryFolder({ Name: 'Enregistrements TV' }), true);
    assert.equal(MC.isKnownUnsupportedLibraryFolder({ CollectionType: 'movies' }), false);
    assert.equal(MC.isKnownUnsupportedLibraryFolder(null), false);
});

test('isMovieLibraryFolder / isSeriesLibraryFolder / isMixedLibraryFolder / isCollectionsLibraryFolder', () => {
    assert.equal(MC.isMovieLibraryFolder({ CollectionType: 'movies' }), true);
    assert.equal(MC.isMovieLibraryFolder({ Type: 'MovieFolder' }), true);
    assert.equal(MC.isMovieLibraryFolder({ CollectionType: 'books' }), false, 'un livre reste exclu même nommé "movies"');

    assert.equal(MC.isSeriesLibraryFolder({ CollectionType: 'tvshows' }), true);
    assert.equal(MC.isSeriesLibraryFolder({ Name: 'Séries' }), true);
    assert.equal(MC.isSeriesLibraryFolder({ Name: 'Films et séries' }), false, 'un mélange détecté par nom devient "mixed"');

    assert.equal(MC.isMixedLibraryFolder({ CollectionType: 'moviesandshows' }), true);
    assert.equal(MC.isMixedLibraryFolder({ Name: 'Films et séries' }), true);

    assert.equal(MC.isCollectionsLibraryFolder({ CollectionType: 'boxsets' }), true);
    assert.equal(MC.isCollectionsLibraryFolder({ Name: 'Collections' }), true);
});

test('isPersonalMediaLibraryFolder : détection par CollectionType, Type ou heuristique de nom', () => {
    assert.equal(MC.isPersonalMediaLibraryFolder({ CollectionType: 'homevideos' }), true);
    assert.equal(MC.isPersonalMediaLibraryFolder({ Type: 'PhotoAlbum' }), true);
    assert.equal(MC.isPersonalMediaLibraryFolder({ Name: 'Vidéos et photos personnelles' }), true);
    assert.equal(MC.isPersonalMediaLibraryFolder({ Name: 'Mes vidéos personnelles' }), true);
    assert.equal(MC.isPersonalMediaLibraryFolder({ Name: 'Films' }), false);
    assert.equal(MC.isPersonalMediaLibraryFolder({ CollectionType: 'books', Name: 'Vidéos et photos' }), false,
        'un livre nommé ambigu reste exclu');
});

test('isClipsOrPersonalLibraryName : liste exacte et heuristique combinée', () => {
    assert.equal(MC.isClipsOrPersonalLibraryName('Clips'), true);
    assert.equal(MC.isClipsOrPersonalLibraryName('Music Videos'), true);
    assert.equal(MC.isClipsOrPersonalLibraryName('Mes Clips Perso'), true, 'contient "clips"');
    assert.equal(MC.isClipsOrPersonalLibraryName('Vidéos & Photos de vacances'), true, 'video+photo');
    assert.equal(MC.isClipsOrPersonalLibraryName('Films'), false);
});

test('folderShouldOpenOnMoviePage : films + dossiers plats assimilés (home videos, "Autres"...)', () => {
    assert.equal(MC.folderShouldOpenOnMoviePage({ CollectionType: 'movies' }), true);
    assert.equal(MC.folderShouldOpenOnMoviePage({ CollectionType: 'homevideos' }), true);
    assert.equal(MC.folderShouldOpenOnMoviePage({ Name: 'Autres' }), true);
    assert.equal(MC.folderShouldOpenOnMoviePage({ Name: 'Clips' }), true);
    assert.equal(MC.folderShouldOpenOnMoviePage({ CollectionType: 'tvshows' }), false);
    assert.equal(MC.folderShouldOpenOnMoviePage({ CollectionType: 'books' }), false);
});

test('isSupportedRootMediaFolder : agrège les prédicats, mais jamais une bibliothèque non supportée', () => {
    assert.equal(MC.isSupportedRootMediaFolder({ CollectionType: 'movies' }), true);
    assert.equal(MC.isSupportedRootMediaFolder({ CollectionType: 'tvshows' }), true);
    assert.equal(MC.isSupportedRootMediaFolder({ CollectionType: 'boxsets' }), true);
    assert.equal(MC.isSupportedRootMediaFolder({ CollectionType: 'books' }), false);
    assert.equal(MC.isSupportedRootMediaFolder({ CollectionType: 'livetv' }), false);
    assert.equal(MC.isSupportedRootMediaFolder(null), false);
});

/* ===================== 3. Images : tags et URLs, avec repli ============== */

test('primaryImageTag : PrimaryImageTag prioritaire, ImageTags.Primary en repli', () => {
    assert.equal(MC.primaryImageTag({ PrimaryImageTag: 'abc' }), 'abc');
    assert.equal(MC.primaryImageTag({ ImageTags: { Primary: 'def' } }), 'def');
    assert.equal(MC.primaryImageTag({ PrimaryImageTag: 'abc', ImageTags: { Primary: 'def' } }), 'abc');
    assert.equal(MC.primaryImageTag({}), '');
    assert.equal(MC.primaryImageTag(null), '');
});

test('collectionPrimaryImageTag / ThumbImageTag / LogoImageTag : ImageTags prioritaire sur le champ plat', () => {
    assert.equal(MC.collectionPrimaryImageTag({ ImageTags: { Primary: 'a' }, PrimaryImageTag: 'b' }), 'a');
    assert.equal(MC.collectionPrimaryImageTag({ PrimaryImageTag: 'b' }), 'b');
    assert.equal(MC.collectionThumbImageTag({ ThumbImageTag: 'c' }), 'c');
    assert.equal(MC.collectionLogoImageTag({ ImageTags: { Logo: 'd' } }), 'd');
    assert.equal(MC.collectionPrimaryImageTag(null), '');
});

test('hasPrimaryOrThumbImage / hasLogoOrPrimaryImage : combinaisons', () => {
    assert.equal(MC.hasPrimaryOrThumbImage({ ImageTags: { Thumb: 'x' } }), true);
    assert.equal(MC.hasPrimaryOrThumbImage({}), false);
    assert.equal(MC.hasLogoOrPrimaryImage({ ImageTags: { Logo: 'x' } }), true);
    assert.equal(MC.hasLogoOrPrimaryImage({ PrimaryImageTag: 'y' }), true);
    assert.equal(MC.hasLogoOrPrimaryImage({}), false);
});

function fakeJellyfin() {
    const calls = [];
    return {
        calls,
        itemImageUrl(serverUrl, id, kind, tag, options) {
            calls.push({ serverUrl, id, kind, tag, options });
            return `${serverUrl}/Items/${id}/Images/${kind}?tag=${tag}`;
        },
    };
}

test('primaryImageUrl / collectionPrimaryImageUrl : construites seulement si Jellyfin+item+id+serverUrl+tag présents', () => {
    const J = fakeJellyfin();
    const url = MC.primaryImageUrl(J, 'http://s', { Id: '1', PrimaryImageTag: 'tag1' }, { q: 1 });
    assert.equal(url, 'http://s/Items/1/Images/Primary?tag=tag1');
    assert.equal(J.calls.length, 1);
    assert.equal(J.calls[0].kind, 'Primary');

    assert.equal(MC.primaryImageUrl(null, 'http://s', { Id: '1', PrimaryImageTag: 't' }), '');
    assert.equal(MC.primaryImageUrl(J, '', { Id: '1', PrimaryImageTag: 't' }), '');
    assert.equal(MC.primaryImageUrl(J, 'http://s', { Id: '1' }), '', 'pas de tag => pas d\'URL');
    assert.equal(MC.primaryImageUrl(J, 'http://s', null), '');
});

test('collectionPosterOrThumbImageUrl : Primary prioritaire, Thumb en repli, rien sinon', () => {
    const J = fakeJellyfin();
    const withPrimary = MC.collectionPosterOrThumbImageUrl(J, 'http://s', { Id: '1', ImageTags: { Primary: 'p', Thumb: 't' } });
    assert.equal(J.calls[J.calls.length - 1].kind, 'Primary');
    assert.match(withPrimary, /Primary\?tag=p$/);

    const withThumbOnly = MC.collectionPosterOrThumbImageUrl(J, 'http://s', { Id: '1', ImageTags: { Thumb: 't' } });
    assert.equal(J.calls[J.calls.length - 1].kind, 'Thumb');
    assert.match(withThumbOnly, /Thumb\?tag=t$/);

    assert.equal(MC.collectionPosterOrThumbImageUrl(J, 'http://s', { Id: '1' }), '');
});

test('posterGridBackdropImageSpec : priorité parent (épisode/saison) > backdrop propre > primary > thumb', () => {
    const episode = {
        Id: 'E1', Type: 'Episode', SeriesId: 'S1',
        ParentBackdropItemId: 'S1', ParentBackdropImageTags: ['pbTag'],
    };
    assertJsonEqual(MC.posterGridBackdropImageSpec(episode), { id: 'S1', type: 'Backdrop', tag: 'pbTag' });

    const movieWithOwnBackdrop = { Id: 'M1', Type: 'Movie', BackdropImageTags: ['bTag'] };
    assertJsonEqual(MC.posterGridBackdropImageSpec(movieWithOwnBackdrop), { id: 'M1', type: 'Backdrop', tag: 'bTag' });

    const onlyPrimary = { Id: 'M2', Type: 'Movie', ImageTags: { Primary: 'primTag' } };
    assertJsonEqual(MC.posterGridBackdropImageSpec(onlyPrimary), { id: 'M2', type: 'Primary', tag: 'primTag' });

    const onlyThumb = { Id: 'M3', Type: 'Movie', ImageTags: { Thumb: 'thumbTag' } };
    assertJsonEqual(MC.posterGridBackdropImageSpec(onlyThumb), { id: 'M3', type: 'Thumb', tag: 'thumbTag' });

    assertJsonEqual(MC.posterGridBackdropImageSpec({ Id: 'M4', Type: 'Movie' }), { id: '', type: '', tag: '' });
    assertJsonEqual(MC.posterGridBackdropImageSpec(null), { id: '', type: '', tag: '' });
});

/* ===================== 4. Lu / repris / progression ======================= */

test('isPlayedItem : UserData.Played prioritaire, repli sur it.Played (formes historiques)', () => {
    assert.equal(MC.isPlayedItem({ UserData: { Played: true } }), true);
    assert.equal(MC.isPlayedItem({ Played: true }), true);
    assert.equal(MC.isPlayedItem({ UserData: { Played: false }, Played: true }), true);
    assert.equal(MC.isPlayedItem({}), false);
    assert.equal(MC.isPlayedItem(null), false);
});

test('resumeProgressRatioFor : jamais affiché avant 1%, jamais après 98%, clampé sinon', () => {
    const base = { RunTimeTicks: 600000000 }; // 60 s
    assert.equal(MC.resumeProgressRatioFor(Object.assign({}, base, { UserData: { PlaybackPositionTicks: 1000000 } })), 0, 'sous le seuil 1%');
    assert.equal(MC.resumeProgressRatioFor(Object.assign({}, base, { UserData: { PlaybackPositionTicks: 594000000 } })), 0, 'au-dessus du seuil 98%');
    const mid = MC.resumeProgressRatioFor(Object.assign({}, base, { UserData: { PlaybackPositionTicks: 300000000 } }));
    assert.ok(mid > 0.03 && mid < 0.97, 'ratio médian clampé dans [0.03, 0.97]');
    assert.equal(MC.resumeProgressRatioFor(Object.assign({}, base, { UserData: { Played: true, PlaybackPositionTicks: 300000000 } })), 0, 'item déjà vu => 0');
    assert.equal(MC.resumeProgressRatioFor({ RunTimeTicks: 0, UserData: { PlaybackPositionTicks: 1 } }), 0, 'durée inconnue');
    assert.equal(MC.resumeProgressRatioFor(null), 0);

    // allowCumulativeRuntime : nécessaire quand RunTimeTicks est absent (ex: saison).
    const cumulative = { CumulativeRunTimeTicks: 600000000, UserData: { PlaybackPositionTicks: 300000000 } };
    assert.equal(MC.resumeProgressRatioFor(cumulative, false), 0, 'sans le flag, la durée cumulée est ignorée');
    assert.ok(MC.resumeProgressRatioFor(cumulative, true) > 0, 'avec le flag, la durée cumulée est utilisée');
});

test('mediaIsPlayedIncludingPercentage : Played=true OU PlayedPercentage >= 99', () => {
    assert.equal(MC.mediaIsPlayedIncludingPercentage({ UserData: { PlayedPercentage: 99 } }), true);
    assert.equal(MC.mediaIsPlayedIncludingPercentage({ UserData: { PlayedPercentage: 98.9 } }), false);
    assert.equal(MC.mediaIsPlayedIncludingPercentage({ Played: true }), true);
    assert.equal(MC.mediaIsPlayedIncludingPercentage({}), false);
    assert.equal(MC.mediaIsPlayedIncludingPercentage(null), false);
});

test('mediaPlaybackPositionTicks : UserData prioritaire sur le champ plat, jamais négatif', () => {
    assert.equal(MC.mediaPlaybackPositionTicks({ UserData: { PlaybackPositionTicks: 500 }, PlaybackPositionTicks: 999 }), 500);
    assert.equal(MC.mediaPlaybackPositionTicks({ PlaybackPositionTicks: 999 }), 999);
    assert.equal(MC.mediaPlaybackPositionTicks({}), 0);
    assert.equal(MC.mediaPlaybackPositionTicks(null), 0);
});

test('mediaProgressRatio : borné à [0, 1], 0 sans durée', () => {
    assert.equal(MC.mediaProgressRatio({ RunTimeTicks: 0 }), 0);
    assert.equal(MC.mediaProgressRatio({ RunTimeTicks: 1000, UserData: { PlaybackPositionTicks: 5000 } }), 1, 'position > durée => clampé à 1');
    assert.equal(MC.mediaProgressRatio({ RunTimeTicks: 1000, UserData: { PlaybackPositionTicks: 500 } }), 0.5);
});

/* ===================== 5. Durées et ticks ================================= */

test('mediaRuntimeMinutes : RunTimeTicks > AverageRuntime > "Runtime" texte > 0', () => {
    assert.equal(MC.mediaRuntimeMinutes({ RunTimeTicks: 600000000 * 90 }), 90);
    assert.equal(MC.mediaRuntimeMinutes({ AverageRuntime: 42 }), 42);
    assert.equal(MC.mediaRuntimeMinutes({ Runtime: '45 min' }), 45);
    assert.equal(MC.mediaRuntimeMinutes({}), 0);
    assert.equal(MC.mediaRuntimeMinutes(null), 0);
});

test('mediaRuntimeSeconds : RunTimeTicks (100ns) converti correctement', () => {
    assert.equal(MC.mediaRuntimeSeconds({ RunTimeTicks: 10000000 * 125 }), 125);
    assert.equal(MC.mediaRuntimeSeconds({ RunTimeSeconds: 30 }), 30);
    assert.equal(MC.mediaRuntimeSeconds({}), 0);
});

test('fmtDurationMinutes : formats h/min français', () => {
    assert.equal(MC.fmtDurationMinutes(0), '');
    assert.equal(MC.fmtDurationMinutes(-5), '');
    assert.equal(MC.fmtDurationMinutes(45), '45 min');
    assert.equal(MC.fmtDurationMinutes(125), '2h 5m');
    assert.equal(MC.fmtDurationMinutes(120), '2h');
});

test('formatDurationHms : jamais négatif, toujours deux chiffres min/sec', () => {
    assert.equal(MC.formatDurationHms(-10), '0:00:00');
    assert.equal(MC.formatDurationHms(3661), '1:01:01');
    assert.equal(MC.formatDurationHms(59), '0:00:59');
});

test('formatDurationTicksCompact : compact "XhYY"/"Ym"', () => {
    assert.equal(MC.formatDurationTicksCompact(0), '');
    assert.equal(MC.formatDurationTicksCompact(600000000 * 65), '1h05');
    assert.equal(MC.formatDurationTicksCompact(600000000 * 45), '45m');
});

/* ===================== 6. Tri, ordre saisons/épisodes ===================== */

test('folderSortCompare mode 0 (nom) : ordre alphabétique insensible à la casse', () => {
    const items = [{ Name: 'zebra' }, { Name: 'Alpha' }, { Name: 'bravo' }];
    const sorted = MC.folderSortItems(items, 0).map((i) => i.Name);
    assert.deepEqual(sorted, ['Alpha', 'bravo', 'zebra']);
});

test('folderSortCompare mode 3 (note communauté) : décroissant, valeurs manquantes toujours en dernier', () => {
    const items = [{ Name: 'NoRating' }, { Name: 'Low', CommunityRating: 5.0 }, { Name: 'High', CommunityRating: 9.0 }];
    const sorted = MC.folderSortItems(items, 3).map((i) => i.Name);
    assert.deepEqual(sorted, ['High', 'Low', 'NoRating']);
});

test('folderSortCompare mode 1 (date d\'ajout) : chaîne de repli DateCreated > PremiereDate > année', () => {
    const items = [
        { Name: 'NoDate' },
        { Name: 'Older', DateCreated: '2020-01-01' },
        { Name: 'Newer', DateCreated: '2022-01-01' },
    ];
    const sorted = MC.folderSortItems(items, 1).map((i) => i.Name);
    assert.deepEqual(sorted, ['Newer', 'Older', 'NoDate']);
});

test('sortSeasonsInPlace : les spéciaux (saison 0) toujours en dernier, quel que soit leur index', () => {
    const seasons = [{ IndexNumber: 2 }, { IndexNumber: 0 }, { IndexNumber: 1 }];
    MC.sortSeasonsInPlace(seasons);
    assert.deepEqual(seasons.map((s) => s.IndexNumber), [1, 2, 0]);
});

test('sortSeasonsInPlace : IndexNumber manquant traité comme "très grand" (après les saisons numérotées)', () => {
    const seasons = [{ IndexNumber: 1 }, {}, { IndexNumber: 0 }];
    MC.sortSeasonsInPlace(seasons);
    assert.deepEqual(seasons.map((s) => s.IndexNumber), [1, undefined, 0]);
});

test('sortEpisodesInPlace : tri par saison puis par épisode, valeurs manquantes en fin', () => {
    const episodes = [
        { ParentIndexNumber: 1, IndexNumber: 3 },
        { ParentIndexNumber: 1, IndexNumber: 1 },
        { ParentIndexNumber: 2, IndexNumber: 1 },
        { IndexNumber: 2 },
    ];
    MC.sortEpisodesInPlace(episodes);
    assert.deepEqual(episodes.map((e) => [e.ParentIndexNumber, e.IndexNumber]), [
        [1, 1], [1, 3], [2, 1], [undefined, 2],
    ]);
});

test('isUnknownSeasonEpisode : season 0 avec SeasonId lié est CONNU (spécial normal), pas "inconnu"', () => {
    assert.equal(MC.isUnknownSeasonEpisode({ SeasonId: 'S0', ParentIndexNumber: 0 }), false);
    assert.equal(MC.isUnknownSeasonEpisode({ SeasonId: '', ParentIndexNumber: null }), true);
    assert.equal(MC.isUnknownSeasonEpisode({ SeasonId: 'S1', ParentIndexNumber: undefined }), true);
    assert.equal(MC.isUnknownSeasonEpisode(null), true);
});

test('sortUnknownSeasonEpisodesInPlace : saison puis épisode puis date de diffusion', () => {
    const eps = [
        { ParentIndexNumber: 2, IndexNumber: 1 },
        { ParentIndexNumber: 1, PremiereDate: '2021-05-01' },
        { ParentIndexNumber: 1, PremiereDate: '2020-01-01' },
    ];
    MC.sortUnknownSeasonEpisodesInPlace(eps);
    assert.deepEqual(eps.map((e) => e.PremiereDate || `S${e.ParentIndexNumber}`), ['2020-01-01', '2021-05-01', 'S2']);
});

/* ===================== 7. Épisodes manquants / virtuels =================== */

test('episodeMissingReason : LocationType, drapeaux virtuels/manquants sous toutes leurs formes', () => {
    assert.equal(MC.episodeMissingReason(null), 'null');
    assert.equal(MC.episodeMissingReason({ LocationType: 'Virtual' }), 'LocationType=Virtual');
    assert.equal(MC.episodeMissingReason({ locationType: 'missing' }), 'LocationType=Missing');
    assert.equal(MC.episodeMissingReason({ LocationType: 'Placeholder' }), 'LocationType=Placeholder');
    assert.equal(MC.episodeMissingReason({ IsMissing: 'oui' }), 'IsMissing/Missing=true');
    assert.equal(MC.episodeMissingReason({ Missing: '1' }), 'IsMissing/Missing=true');
    assert.equal(MC.episodeMissingReason({ IsVirtual: 'yes' }), 'IsVirtual=true');
    assert.equal(MC.episodeMissingReason({ IsVirtualUnaired: true }), 'IsVirtualUnaired=true');
    assert.equal(MC.episodeMissingReason({ IsPlaceholder: true }), 'IsPlaceholder=true');
    assert.equal(MC.episodeMissingReason({ IsUnaired: true }), 'IsUnaired=true');
    assert.equal(MC.episodeMissingReason({ LocationType: 'FileSystem' }), '', 'épisode réel');
    assert.equal(MC.episodeMissingReason({}), '');
});

test('episodeHasPlayableHints : filesystem, sources, flux ou durée suffisent', () => {
    assert.equal(MC.episodeHasPlayableHints({ LocationType: 'FileSystem' }), true);
    assert.equal(MC.episodeHasPlayableHints({ MediaSources: [{}] }), true);
    assert.equal(MC.episodeHasPlayableHints({ MediaStreams: [{ Type: 'Video' }] }), true);
    assert.equal(MC.episodeHasPlayableHints({ RunTimeTicks: 100 }), true);
    assert.equal(MC.episodeHasPlayableHints({}), false);
    assert.equal(MC.episodeHasPlayableHints(null), false);
});

test('episodeIsPlayableForPlaylist : type/Id requis, une raison de manque bloque, sources+chemin vides bloquent', () => {
    assert.equal(MC.episodeIsPlayableForPlaylist({ Id: 'e1', Type: 'Episode' }), true);
    assert.equal(MC.episodeIsPlayableForPlaylist({ Type: 'Episode' }), false, 'pas d\'Id');
    assert.equal(MC.episodeIsPlayableForPlaylist({ Id: 'e1', Type: 'Movie' }), false, 'mauvais type explicite');
    assert.equal(MC.episodeIsPlayableForPlaylist({ Id: 'e1', Type: 'Episode', LocationType: 'Virtual' }), false);
    assert.equal(MC.episodeIsPlayableForPlaylist({ Id: 'e1', Type: 'Episode', MediaSources: [], Path: '' }), false);
    assert.equal(MC.episodeIsPlayableForPlaylist({ Id: 'e1', Type: 'Episode', MediaSources: [{}], Path: '' }), true);
    // DTO partiel où MediaSources/Path ne sont même pas présents : tolérant par défaut.
    assert.equal(MC.episodeIsPlayableForPlaylist({ Id: 'e1', Type: 'Episode' }), true);
});

test('episodeIdListFromItems : ordre préféré filtré par jouabilité, sinon ordre naturel dédupliqué', () => {
    const items = [
        { Id: 'a', Type: 'Episode' },
        { Id: 'b', Type: 'Episode', LocationType: 'Virtual' },
        { Id: 'c', Type: 'Episode' },
    ];
    assertJsonEqual(MC.episodeIdListFromItems(items, ['c', 'b', 'a', 'unknown']), ['c', 'a']);
    assertJsonEqual(MC.episodeIdListFromItems(items, []), ['a', 'c']);
    assertJsonEqual(MC.episodeIdListFromItems([{ Id: 'a', Type: 'Episode' }, { Id: 'a', Type: 'Episode' }], []), ['a']);
});

/* ===================== 8. Structures bornées en mémoire ==================== */

test('trimObjectMemo : ne garde que les N dernières clés (ordre d\'insertion)', () => {
    const memo = { a: 1, b: 2, c: 3, d: 4, e: 5 };
    assertJsonEqual(MC.trimObjectMemo(memo, 3), { c: 3, d: 4, e: 5 });
    assert.equal(MC.trimObjectMemo(memo, 10), memo, 'sous la limite : même référence, inchangé');
});

test('homeCacheEntryValid / touchHomeCache : version de schéma et fraîcheur', () => {
    assert.equal(MC.homeCacheEntryValid({ schemaVersion: 1, ts: 1000 }, 1, 5000, 4000), true);
    assert.equal(MC.homeCacheEntryValid({ schemaVersion: 1, ts: 1000 }, 1, 5000, 7000), false, 'expiré');
    assert.equal(MC.homeCacheEntryValid({ schemaVersion: 2, ts: 1000 }, 1, 5000, 1000), false, 'schéma différent');
    assert.equal(MC.homeCacheEntryValid(null, 1, 5000, 1000), false);

    const store = { k: { schemaVersion: 1, ts: 1000 } };
    assert.equal(MC.touchHomeCache(store, 'k', 1, 5000, 4000), store.k, 'entrée valide retournée et lastAccess mis à jour');
    assert.equal(store.k.lastAccess, 4000);
    assert.equal(MC.touchHomeCache(store, 'k', 1, 5000, 9000), null, 'expirée => purgée');
    assert.equal(store.k, undefined);
});

test('trimHomeCacheStore : purge les entrées expirées et respecte le plafond en protégeant la clé active', () => {
    const now = 1000000;
    const store = {
        k1: { schemaVersion: 1, ts: now - 100, lastAccess: now - 100 },
        k2: { schemaVersion: 1, ts: now - 50, lastAccess: now - 50 },
        k3: { schemaVersion: 1, ts: now - 10, lastAccess: now - 10 },
        expired: { schemaVersion: 1, ts: now - 999999, lastAccess: now - 999999 },
    };
    MC.trimHomeCacheStore(store, 'k1', 1, 500000, 2, now);
    assert.deepEqual(Object.keys(store).sort(), ['k1', 'k3'], 'k1 protégée malgré son ancienneté, k2 évincée, expired purgée');
});

test('appendCatalogPageWindow : fenêtre glissante avant (shift des pages anciennes)', () => {
    let pages = [];
    let r = MC.appendCatalogPageWindow(pages, [{ Id: 'a' }, { Id: 'b' }, { Id: 'c' }, { Id: 'd' }, { Id: 'e' }], 0, 5, 'forward', 10);
    assert.equal(r.pages.length, 1);
    assert.equal(r.hasMoreAfter, true);
    r = MC.appendCatalogPageWindow(r.pages, [{ Id: 'f' }, { Id: 'g' }, { Id: 'h' }, { Id: 'i' }, { Id: 'j' }], 5, 5, 'forward', 10);
    assert.equal(r.pages.reduce((n, p) => n + p.items.length, 0), 10);
    r = MC.appendCatalogPageWindow(r.pages, [{ Id: 'k' }, { Id: 'l' }, { Id: 'm' }, { Id: 'n' }, { Id: 'o' }], 10, 5, 'forward', 10);
    // La page la plus ancienne (start=0) doit avoir été évincée : jamais plus de maxItems en mémoire.
    assert.equal(r.pages.reduce((n, p) => n + p.items.length, 0), 10);
    assert.equal(r.pages[0].start, 5);
    assert.equal(r.hasMoreBefore, true, 'la page 0 a disparu => on peut re-précharger vers l\'arrière');
});

test('appendCatalogPageWindow : fenêtre glissante arrière (pop des pages les plus récentes)', () => {
    let pages = [
        { start: 10, limit: 5, items: [{ Id: 'k' }, { Id: 'l' }, { Id: 'm' }, { Id: 'n' }, { Id: 'o' }], full: false },
    ];
    const r = MC.appendCatalogPageWindow(pages, [{ Id: 'f' }, { Id: 'g' }, { Id: 'h' }, { Id: 'i' }, { Id: 'j' }], 5, 5, 'backward', 5);
    // maxItems=5 < 10 items totaux => la page la plus récente (celle qu'on ne vient pas de charger côté "backward" = la queue) est évincée.
    assert.equal(r.pages.reduce((n, p) => n + p.items.length, 0), 5);
});

test('pushBrowserReturn / popBrowserParent : pile plafonnée à 12, dépilée seulement si l\'enfant correspond', () => {
    const shared = {};
    for (let i = 0; i < 15; i++) MC.pushBrowserReturn(shared, 'folder' + i, 'child' + i, 'titre', 0, 0, 'movies');
    assert.equal(shared.__mediaBrowserReturnStack.length, 12, 'jamais plus de 12 entrées mémorisées');
    assert.equal(MC.popBrowserParent(shared, 'wrong-child'), null, 'refuse si l\'enfant ne correspond pas au sommet');
    const popped = MC.popBrowserParent(shared, 'child14');
    assert.equal(popped.folderId, 'folder14');
    assert.equal(shared.__mediaBrowserReturnStack.length, 11);
});

test('compactCollectionDetails / compactCollectionStreams : ne garde que les champs utiles à l\'UI', () => {
    const raw = {
        Id: '1', Name: 'Film', Overview: 'x', ExtraJunkField: 'should not survive',
        MediaStreams: [{ Type: 'Video', Codec: 'hevc', Width: 1920, Height: 1080, ExtraField: 'drop-me' }],
    };
    const compact = MC.compactCollectionDetails(raw);
    assert.equal(compact.ExtraJunkField, undefined);
    assert.equal(compact.MediaStreams[0].ExtraField, undefined);
    assert.equal(compact.MediaStreams[0].Codec, 'hevc');
    assert.equal(MC.compactCollectionDetails(null), null);
});

test('compactEpisodeDetailsForCache : ne garde que Primary parmi les tags image et les réalisateurs parmi People', () => {
    const details = {
        Id: 'e1', Name: 'Pilote', RunTimeTicks: 100,
        ImageTags: { Primary: 'p', Backdrop: 'b', Thumb: 't' },
        People: [
            { Name: 'Réal', Type: 'Director' },
            { Name: 'Acteur', Type: 'Actor' },
        ],
        SubtitleFiles: ['fr.srt'],
    };
    const compact = MC.compactEpisodeDetailsForCache(details);
    assertJsonEqual(compact.ImageTags, { Primary: 'p' });
    assert.equal(compact.People.length, 1);
    assert.equal(compact.People[0].Name, 'Réal');
    assertJsonEqual(compact.SubtitleFiles, [true], 'seule la présence de sous-titres externes est retenue, pas leur contenu');
    assert.equal(MC.compactEpisodeDetailsForCache(null), null);
});

/* ===================== 9. Tolérance générale aux champs manquants ========= */

test('tolérance : un large panel de fonctions ne lève jamais sur null/undefined', () => {
    const nullaryOrUnary = [
        () => MC.movieStreamInfo(null),
        () => MC.personalMediaStreamInfo(undefined),
        () => MC.mediaAgeTag(null),
        () => MC.seriesStatusText(undefined),
        () => MC.seriesProductionRange(null),
        () => MC.mediaDirectorsText(null),
        () => MC.mediaArtistsText(undefined),
        () => MC.folderCount(null),
        () => MC.unreadCount(undefined),
        () => MC.plainOverview(null),
        () => MC.mediaGenresLine(null),
        () => MC.homeItemSignature(null),
        () => MC.collectionTechChips(null, null),
        () => MC.personEpisodeMeta(null),
        () => MC.searchSectionKey(null),
    ];
    for (const fn of nullaryOrUnary) assert.doesNotThrow(fn);
});
