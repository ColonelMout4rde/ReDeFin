// tst_libraryposterbadgeloaders.qml — LibraryPosterCard : badges paresseux (F9).
//
// Constat (audit-grilles.md F9) : le badge « vu » (3 rectangles tournés en
// antialiasing) et le badge « épisodes non lus » étaient des Rectangle
// toujours créés, seulement rendus invisible: false sur la grande majorité
// des cartes. Remplacés par des Loader dont "active" reprend exactement
// l'ancienne condition "visible" : aucun item enfant n'existe tant que le
// badge ne doit pas apparaître.
//
// LibraryPosterCard.qml n'importe que QtQuick 2.15 (aucun fbx.*, aucun
// QtGraphicalEffects) : il s'instancie proprement sous ce harnais Qt 6.
import QtQuick 2.15
import QtTest 1.2
import "../../qml/pages" as Pages

TestCase {
    id: testCase
    name: "LibraryPosterCardBadgeLoaders"
    when: windowShown
    width: 400
    height: 300
    visible: true

    Component {
        id: cardComponent
        Pages.LibraryPosterCard {}
    }

    function test_defaultInstantiation_noBadgeItemCreated() {
        var card = createTemporaryObject(cardComponent, testCase);
        verify(card !== null, "LibraryPosterCard.qml n'a pas pu être instanciée");

        var watchedLoader = testCase.findChild(card, "watchedBadgeLoader");
        var unplayedLoader = testCase.findChild(card, "unplayedBadgeLoader");
        verify(watchedLoader !== null, "watchedBadgeLoader introuvable");
        verify(unplayedLoader !== null, "unplayedBadgeLoader introuvable");

        compare(watchedLoader.active, false);
        compare(watchedLoader.item, null);
        compare(unplayedLoader.active, false);
        compare(unplayedLoader.item, null);
    }

    function test_watchedBadge_createdOnlyWhenShownAndWatched() {
        var card = createTemporaryObject(cardComponent, testCase, {
            showWatchedBadge: true, watched: false
        });
        var watchedLoader = testCase.findChild(card, "watchedBadgeLoader");
        compare(watchedLoader.active, false, "showWatchedBadge seul ne suffit pas");

        card.watched = true;
        compare(watchedLoader.active, true);
        verify(watchedLoader.item !== null, "l'item du badge doit être créé une fois actif");

        card.watched = false;
        compare(watchedLoader.active, false);
        compare(watchedLoader.item, null, "l'item doit être détruit quand le badge redevient invisible");
    }

    function test_watchedBadge_suppressedWhenUnplayedBadgeShown() {
        // Comportement inchangé : suppressWatchedWhenUnplayed (défaut true)
        // masque le badge "vu" quand le badge "non lus" est déjà affiché.
        var card = createTemporaryObject(cardComponent, testCase, {
            showWatchedBadge: true, watched: true,
            showUnplayedBadge: true, unplayedCount: 3
        });
        var watchedLoader = testCase.findChild(card, "watchedBadgeLoader");
        compare(watchedLoader.active, false);
    }

    function test_unplayedBadge_createdOnlyWhenCountPositive() {
        var card = createTemporaryObject(cardComponent, testCase, {
            showUnplayedBadge: true, unplayedCount: 0
        });
        var unplayedLoader = testCase.findChild(card, "unplayedBadgeLoader");
        compare(unplayedLoader.active, false);

        card.unplayedCount = 4;
        compare(unplayedLoader.active, true);
        verify(unplayedLoader.item !== null);
        compare(unplayedLoader.item.width > 0, true);

        card.unplayedCount = 0;
        compare(unplayedLoader.active, false);
        compare(unplayedLoader.item, null);
    }
}
