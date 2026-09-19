// tst_nextupblock_seasonshint.qml — câblage de qml/pages/NextUpBlock.qml
// (BRIEF-COMMUN.md, fiches lot 2, point 4).
//
// NextUpBlock refaisait systématiquement un GET /Shows/{id}/Seasons
// (_ensureSeasons()) pour la barre de position saison, alors que la page
// hôte (detailSeriePage.qml) a déjà obtenu la même liste via son propre
// fetchSeasons() (F3, lot 1). La nouvelle propriété seasonsHint permet à la
// page de fournir directement cette liste ; le composant ne retombe sur sa
// propre requête réseau que si seasonsHint est absente/vide, ou scopée à une
// autre série (repli sur SafeLog/le réseau, exactement comme avant).
//
// Tous les tests laissent serverUrl/accessToken/userId vides : Jellyfin.
// fetchSeasons() répond alors "missing_params" de façon SYNCHRONE (voir
// jellyfinBridge.js), donc sans jamais toucher le réseau ni exiger de
// wait() — le contraste avec le chemin seasonsHint (lui aussi synchrone)
// reste observable immédiatement (cf. tst_chapterscarousel.qml pour le même
// principe sur M1).
import QtQuick 2.15
import QtTest 1.2
import "../../qml/pages" as Pages

TestCase {
    id: testCase
    name: "NextUpBlockSeasonsHint"
    when: windowShown
    width: 1280
    height: 400

    Component {
        id: nextUpComponent
        Pages.NextUpBlock {}
    }

    function test_hintForCurrentSeriesIsUsedWithoutNetwork() {
        var c = createTemporaryObject(nextUpComponent, testCase, {
            seriesId: "s1",
            seasonsHint: [
                { IndexNumber: 1, EpisodeCount: 24 },
                { IndexNumber: 2, ChildCount: 10 }
            ]
        });
        verify(c !== null, "NextUpBlock.qml n'a pas pu être instanciée");
        c._ensureSeasons("s1");
        var cache = c._seasonCacheBySeries["s1"];
        verify(cache !== undefined, "le cache doit être peuplé");
        compare(cache.loaded, true);
        compare(cache.inFlight, false);
        compare(cache.byIndex[1], 24, "IndexNumber 1 doit venir du hint (EpisodeCount)");
        compare(cache.byIndex[2], 10, "IndexNumber 2 doit venir du hint (ChildCount, EpisodeCount absent)");
    }

    function test_noHintFallsBackToFetch_missingParamsCachesEmpty() {
        var c = createTemporaryObject(nextUpComponent, testCase, {
            seriesId: "s1",
            seasonsHint: null
        });
        // serverUrl vide -> Jellyfin.fetchSeasons répond missing_params tout
        // de suite : le repli réseau existe toujours, il aboutit juste à un
        // byIndex vide ici (pas de contexte réseau dans ce test).
        c._ensureSeasons("s1");
        var cache = c._seasonCacheBySeries["s1"];
        verify(cache !== undefined);
        compare(cache.loaded, true);
        compare(Object.keys(cache.byIndex).length, 0,
                "sans hint, le repli réseau (ici sans contexte) ne doit rien inventer");
    }

    function test_emptyHintNotYetArrivedFallsBackToFetch() {
        var c = createTemporaryObject(nextUpComponent, testCase, {
            seriesId: "s1",
            seasonsHint: []
        });
        // [] doit être traité comme "pas encore arrivé", pas "aucune saison" :
        // sinon un hint qui arrive après coup ne serait jamais réappliqué et
        // regarder cache.byIndex resterait vide alors qu'une vraie réponse
        // réseau (hors test) l'aurait peuplé.
        c._ensureSeasons("s1");
        var cache = c._seasonCacheBySeries["s1"];
        compare(cache.loaded, true);
        compare(Object.keys(cache.byIndex).length, 0);
    }

    function test_hintScopedToOtherSeriesIdFallsBackToFetch() {
        var c = createTemporaryObject(nextUpComponent, testCase, {
            seriesId: "s1",
            seasonsHint: [ { IndexNumber: 1, EpisodeCount: 24 } ]
        });
        // La série demandée (s2) n'est pas celle de la page hôte (s1, le
        // seasonsHint fourni) : ne pas mélanger les saisons de deux séries.
        c._ensureSeasons("s2");
        var cache = c._seasonCacheBySeries["s2"];
        compare(cache.loaded, true);
        compare(Object.keys(cache.byIndex).length, 0,
                "un seasonsHint scopé à une autre série ne doit pas être utilisé");
    }

    function test_seasonRatioComputedFromHintWithoutNetwork() {
        var c = createTemporaryObject(nextUpComponent, testCase, {
            seriesId: "s1",
            seasonsHint: [ { IndexNumber: 2, EpisodeCount: 10 } ]
        });
        var ratio = c._seasonRatio({
            SeriesId: "s1",
            ParentIndexNumber: 2,
            IndexNumber: 4
        });
        // (eidx-1)/tot = (4-1)/10 = 0.3, obtenu uniquement via seasonsHint :
        // _ensureSeasons("s1") est déclenché en interne par _seasonRatio via
        // les delegates normalement, ici on vérifie le calcul pur suffit une
        // fois le cache peuplé.
        c._ensureSeasons("s1");
        ratio = c._seasonRatio({
            SeriesId: "s1",
            ParentIndexNumber: 2,
            IndexNumber: 4
        });
        fuzzyCompare(ratio, 0.3, 0.001);
    }
}
