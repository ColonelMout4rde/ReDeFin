// tst_smoke.qml - Test de fumée pour le harnais Qt Quick Test.
//
// Objectif : prouver que run_qml_tests.py sait exécuter un test QtTest
// headless sur un composant réel du projet. On charge
// qml/components/CircleDotsLoader.qml, qui n'a aucune dépendance aux
// modules fbx.* du firmware (uniquement QtQuick 2.15), et on vérifie ses
// valeurs par défaut ainsi qu'une réaction simple à un changement de
// propriété.
import QtQuick 2.15
import QtTest 1.2
import "../../qml/components" as Components

TestCase {
    id: testCase
    name: "Smoke"
    // test_lightweightSlowsTheStep observe le Timer interne sur la durée
    // réelle (wait()) : sans fenêtre affichée, rien ne garantit qu'il tourne.
    when: windowShown
    width: 200
    height: 200
    visible: true

    Component {
        id: loaderComponent
        Components.CircleDotsLoader {}
    }

    function test_defaultProperties() {
        var dots = createTemporaryObject(loaderComponent, testCase);
        verify(dots !== null);
        compare(dots.dotCount, 12);
        compare(dots.dotSize, 8);
        compare(dots.active, true);
        compare(dots.litCount, 0);
    }

    function test_dotCountChangeResetsLitCount() {
        var dots = createTemporaryObject(loaderComponent, testCase, { litCount: 5 });
        compare(dots.litCount, 5);

        dots.dotCount = 20;

        compare(dots.dotCount, 20);
        compare(dots.litCount, 0);
    }

    // F3 (audit shell) : lightweight ralentit le pas (~110 ms) pour le
    // rideau global de page, par défaut désactivé pour les loaders locaux.
    function test_lightweightDefaultsFalse() {
        var dots = createTemporaryObject(loaderComponent, testCase);
        compare(dots.lightweight, false);
    }

    function test_lightweightSlowsTheStep() {
        var fast = createTemporaryObject(loaderComponent, testCase);
        var slow = createTemporaryObject(loaderComponent, testCase, { lightweight: true });

        var fastTicks = 0, slowTicks = 0;
        fast.litCountChanged.connect(function() { fastTicks++; });
        slow.litCountChanged.connect(function() { slowTicks++; });

        // Pas par défaut ≈ 64 ms (900 / 14), pas lightweight fixé à 110 ms :
        // sur une même fenêtre, le loader par défaut doit avancer nettement
        // plus vite.
        wait(400);

        verify(slowTicks >= 1, "le loader lightweight doit tout de même avancer");
        verify(fastTicks > slowTicks,
               "lightweight doit ralentir sensiblement le pas (fast=" + fastTicks +
               " slow=" + slowTicks + ")");
    }
}
