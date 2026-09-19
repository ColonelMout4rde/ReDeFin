// tst_homebackdrop.qml — câblage réel de HomeBackdrop.qml (fond animé de
// l'accueil).
//
// Constat 6 de l'audit accueil : le fond était affiché à opacity 0.90 puis
// recouvert d'un Rectangle noir séparé à opacity 0.40 (deux fusions alpha
// plein écran par image animée sur un SGX535). Sur fond noir, ces deux
// calques équivalent exactement à une seule image à opacity 0.90*(1-0.40) =
// 0.54 : le Rectangle d'assombrissement a été supprimé et targetOpacity
// porte directement la valeur combinée. Ce test instancie le vrai composant
// (aucun réseau : host reste null, currentUrl()/scheduleUpdate() ne sont
// jamais appelées) et fige la valeur ainsi que la disparition du second
// calque noir.
import QtQuick 2.15
import QtTest 1.2
import "../../qml/pages" as Pages

TestCase {
    id: testCase
    name: "HomeBackdrop"
    when: windowShown
    width: 400
    height: 200
    visible: true

    Component {
        id: backdropComponent
        Pages.HomeBackdrop { width: 400; height: 200 }
    }

    function test_targetOpacity_isTheCombinedSingleLayerValue() {
        var backdrop = createTemporaryObject(backdropComponent, testCase);
        verify(backdrop !== null, "HomeBackdrop.qml n'a pas pu être instanciée");
        // 0.90 * (1 - 0.40) = 0.54, cf. calcul détaillé dans le message de
        // commit et le commentaire du fichier source.
        fuzzyCompare(backdrop.targetOpacity, 0.54, 0.0001);
    }

    function test_onlyOneFullscreenBlackRectangleRemains() {
        // Avant le correctif il y en avait deux : le calque d'assombrissement
        // (supprimé) et le masque « Mes médias » à z:100 (conservé, hors
        // périmètre de ce constat : il cache tout le fond quand la première
        // rangée est focalisée).
        var backdrop = createTemporaryObject(backdropComponent, testCase);
        verify(backdrop !== null);
        var blackRects = 0;
        for (var i = 0; i < backdrop.children.length; ++i) {
            var child = backdrop.children[i];
            if (child && String(child.color || "") === "#000000")
                blackRects++;
        }
        compare(blackRects, 1);
    }
}
