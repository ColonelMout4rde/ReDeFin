// tst_postercardtitlelayer.qml — câblage réel de PosterCardTitleLayer.qml
// (accueil + fiches, partagé avec PosterGridCard/LibraryPosterCard/SearchPage).
//
// Constat 5 de l'audit accueil : les deux OpacityMask (titre + sous-titre)
// et leur masque source (3 Rectangle chacun) étaient instanciés dans CHAQUE
// carte, même quand le marquee ne défile pas (l'état normal : le marquee ne
// démarre qu'après 700 ms de focus immobile). Le correctif les place derrière
// un Loader{active: maskActive} : ce test instancie le VRAI composant et
// vérifie que le Loader ne matérialise l'OpacityMask que pendant le
// défilement, puis le détruit une fois le marquee arrêté — sans changer le
// contrat observable (maskActive reste la même propriété, au même moment).
//
// QtGraphicalEffects vient du stub neutre de tests/qml/stubs (aucune
// conclusion à tirer du rendu, seulement de l'instanciation).
import QtQuick 2.15
import QtTest 1.2
import "../../qml/pages" as Pages

TestCase {
    id: testCase
    name: "PosterCardTitleLayer"
    when: windowShown
    width: 400
    height: 200
    visible: true

    readonly property int settleMs: 40

    Component {
        id: hostComponent
        Item { width: 140; height: 60 }
    }

    Component {
        id: cardComponent
        QtObject {
            property bool allowMarquee: true
            property bool allowAnims: true
            property bool allowLoad: true
            property bool selected: true
            property bool marqueeFocusActive: true
            property string effectiveTitleText: "Un titre extrêmement long qui déborde largement de la carte"
            property string effectiveSubtitleText: ""
            property int marqueeGapPx: 20
            property int cardTitleFontPx: 20
            property string titleColor: "#e7eaff"
            property string selectedTitleColor: "#ffffff"
            property bool titleBoldAlways: false
            property int cardSubtitleFontPx: 15
            property string subtitleColor: "#cfd6ff"
            property string selectedSubtitleColor: "#ffffff"
            property bool subtitleBoldAlways: false
            property int marqueeStartDelayMs: 10
            property int marqueeEndPauseMs: 10
            property var marqueeScrollMsFor: function(travel) { return 60; }
            property bool _alive: true
        }
    }

    Component {
        id: layerComponent
        Pages.PosterCardTitleLayer {}
    }

    function test_maskLoader_inactiveWithoutOverflow() {
        // Titre qui tient dans la carte : marqueeNeeded reste faux, donc
        // maskActive ne peut jamais devenir vrai. Cas déterministe (pas
        // d'animation en jeu) : le Loader ne doit rien avoir créé.
        var host = createTemporaryObject(hostComponent, testCase);
        var card = createTemporaryObject(cardComponent, testCase, {
            effectiveTitleText: "Court"
        });
        var layer = createTemporaryObject(layerComponent, host, { card: card });
        verify(layer !== null, "PosterCardTitleLayer.qml n'a pas pu être instanciée");

        var loader = findChild(layer, "titleMaskLoader");
        verify(loader !== null, "titleMaskLoader introuvable");

        wait(testCase.settleMs);
        compare(layer.marqueeNeeded, false);
        compare(layer.maskActive, false);
        compare(loader.active, false);
        compare(loader.item, null);
    }

    function test_maskLoader_instanciatedOnlyWhileMarqueeMoves() {
        var host = createTemporaryObject(hostComponent, testCase);
        verify(host !== null, "hôte de test non instancié");

        var card = createTemporaryObject(cardComponent, testCase);
        verify(card !== null, "carte factice non instanciée");

        var layer = createTemporaryObject(layerComponent, host, { card: card });
        verify(layer !== null, "PosterCardTitleLayer.qml n'a pas pu être instanciée");

        var loader = findChild(layer, "titleMaskLoader");
        verify(loader !== null, "titleMaskLoader introuvable");

        // Titre largement plus long que la carte (140 px) : après
        // marqueeStartDelayMs (10 ms, raccourci pour le test), le marquee
        // passe en mouvement. maskActive devient vrai et le Loader doit
        // matérialiser l'OpacityMask, sans changer le rendu (même source,
        // même maskSource) quand il est actif.
        tryVerify(function() { return layer.maskActive === true; }, 2000,
                  "le marquee n'a jamais démarré (maskActive resté faux)");
        compare(loader.active, true);
        verify(loader.item !== null, "le Loader n'a pas matérialisé l'OpacityMask pendant le défilement");

        // Désélectionner la carte interrompt le marquee de façon synchrone
        // (updateMarquee()._resetMarqueeState() remet marqueeMoving à faux
        // immédiatement, sans dépendre du minutage de l'animation) : le
        // Loader doit alors libérer l'item, preuve qu'il suit maskActive
        // dans les deux sens et ne fuit pas en permanence.
        card.selected = false;
        layer.updateMarquee();
        compare(layer.maskActive, false);
        compare(loader.active, false);
        compare(loader.item, null);
    }

    function test_subtitleMaskLoader_staysInactiveWithoutSubtitle() {
        // Sans sous-titre (cas le plus fréquent), le Loader du sous-titre ne
        // doit jamais s'activer, quel que soit l'état du marquee du titre.
        var host = createTemporaryObject(hostComponent, testCase);
        var card = createTemporaryObject(cardComponent, testCase);
        var layer = createTemporaryObject(layerComponent, host, { card: card });
        verify(layer !== null);

        var subtitleLoader = findChild(layer, "subtitleMaskLoader");
        verify(subtitleLoader !== null, "subtitleMaskLoader introuvable");

        wait(testCase.settleMs);
        compare(subtitleLoader.active, false);
        compare(subtitleLoader.item, null);
    }
}
