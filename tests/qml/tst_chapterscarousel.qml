// tst_chapterscarousel.qml — câblage de qml/pages/ChaptersCarousel.qml.
//
// M1 (audit-fiches.md) : le composant refaisait un second GET complet de
// l'item (fetchItemChapters -> fetchItem) pour obtenir les chapitres, alors
// que la page hôte (detailMoviePage.qml) a déjà item.Chapters dans sa propre
// réponse. La nouvelle propriété itemChapters permet à la page de fournir
// directement ce tableau ; le composant ne retombe sur sa propre requête
// réseau que si itemChapters vaut null (page qui ne l'a pas fourni).
//
// Tous les tests laissent serverUrl/accessToken/itemId vides : aucun ne doit
// jamais déclencher de XMLHttpRequest (règle du dépôt : les tests QML
// n'atteignent jamais le réseau). Le contraste attendu est justement que le
// chemin itemChapters s'applique de façon SYNCHRONE (pas de Timer de 150 ms
// ni de round-trip), donc observable sans wait().
import QtQuick 2.15
import QtTest 1.2
import "../../qml/pages" as Pages

TestCase {
    id: testCase
    name: "ChaptersCarousel"
    when: windowShown
    width: 1280
    height: 200

    Component {
        id: carouselComponent
        Pages.ChaptersCarousel {}
    }

    function test_defaultNoItemChaptersNoContextStaysEmpty() {
        var c = createTemporaryObject(carouselComponent, testCase);
        verify(c !== null, "ChaptersCarousel.qml n'a pas pu être instanciée");
        compare(c.itemChapters, null);
        compare(c.hasContent, false);
        compare(c.chapters.length, 0);
    }

    function test_providedChaptersAppliedSynchronouslyWithoutNetwork() {
        var provided = [
            { Name: "Ouverture", StartPositionTicks: 0 },
            { Name: "Scène 2", StartPositionTicks: 6000000000 }
        ];
        var c = createTemporaryObject(carouselComponent, testCase, {
            itemChapters: provided
        });
        // Aucun wait() : si le composant était retombé sur fetchItemChapters()
        // (Timer fetchTimer, 150 ms), chapters serait encore vide ici.
        compare(c.hasContent, true, "itemChapters fourni doit être appliqué tout de suite");
        compare(c.chapters.length, 2);
        compare(c.chapters[0].Name, "Ouverture");
    }

    function test_providedEmptyArrayMeansNoChaptersWithoutFallback() {
        var c = createTemporaryObject(carouselComponent, testCase, {
            itemChapters: []
        });
        compare(c.hasContent, false,
                "un tableau vide fourni par la page signifie « pas de chapitre », pas « à demander »");
        compare(c.chapters.length, 0);
    }

    function test_itemChaptersChangedAfterCreationReapplies() {
        var c = createTemporaryObject(carouselComponent, testCase);
        compare(c.hasContent, false);

        c.itemChapters = [{ Name: "Chap A", StartPositionTicks: 0 }];
        compare(c.hasContent, true, "un changement de itemChapters après coup doit se répercuter");
        compare(c.chapters.length, 1);

        c.itemChapters = null;
        compare(c.hasContent, false,
                "repasser à null signifie « la page ne fournit plus rien » (repli sur fetch, ici sans contexte réseau)");
    }
}
