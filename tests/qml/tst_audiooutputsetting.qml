// tst_audiooutputsetting.qml — câblage QML du réglage « Sortie audio ».
//
// Les tests Node (tests/js/audiooutputpolicy.test.js) couvrent la politique
// pure. Ce qu'ils ne peuvent pas couvrir, et qui est l'objet de ce fichier,
// c'est le câblage réel de qml/components/SettingsSidePanel.qml et du
// singleton qml/components/AppSettings.qml :
//   - valeur par défaut « Multicanal » (aucun changement de comportement) ;
//   - navigation télécommande Haut/Bas entre les rangées de la section
//     « Lecture », et bascule par Gauche/Droite/OK ;
//   - persistance par boîtier via AppSettings/UserStore, avec un objet
//     Settings factice (aucun fbx.application.Settings hors Player) ;
//   - normalisation d'une valeur inconnue relue du stockage.
//
// Aucun réseau n'est touché : le panneau ne fait que lire et écrire des
// préférences.
import QtQuick 2.15
import QtTest 1.2
import "../../qml/components" as Components

TestCase {
    id: testCase
    name: "AudioOutputSetting"
    when: windowShown
    width: 1280
    height: 720
    // Le panneau est `enabled: visible` : sans une TestCase visible, il ne peut
    // pas prendre le focus et ne recevrait aucune touche.
    visible: true

    readonly property int settleMs: 80
    readonly property string srv: "http://192.168.51.42:8096"
    readonly property string uid: "user-stereo"

    // Substitut de fbx.application.Settings : UserStore écrit ses propriétés
    // directement (usersJson...), sans API get/set dédiée.
    QtObject {
        id: fakeSettings
        property string usersJson: ""
        property string usersServersJson: ""
        property string usersActiveKey: ""
        property string usersSessionVaultJson: ""
    }

    Component {
        id: panelComponent
        Components.SettingsSidePanel {}
    }

    function bindSettings() {
        fakeSettings.usersJson = "";
        Components.AppSettings.settingsRef = fakeSettings;
        Components.AppSettings.init(null, fakeSettings);
        Components.AppSettings.setContext(testCase.srv, testCase.uid);
        wait(testCase.settleMs);
    }

    function newPanel() {
        var panel = createTemporaryObject(panelComponent, testCase);
        verify(panel !== null, "SettingsSidePanel.qml n'a pas pu être instanciée");
        panel.open();
        wait(300);   // animIn + Qt.callLater du focus initial
        // Le panneau n'est focusable qu'une fois visible (enabled: visible).
        panel.forceActiveFocus();
        wait(testCase.settleMs);
        verify(panel.activeFocus, "le panneau doit avoir le focus pour recevoir les touches");
        return panel;
    }

    // Amène le focus sur la rangée « Sortie audio » depuis l'ouverture du
    // panneau (focus initial : « Afficher l'horloge »), uniquement au clavier.
    function focusAudioRow(panel) {
        keyClick(Qt.Key_Down);   // horloge -> mode de lecture
        wait(testCase.settleMs);
        keyClick(Qt.Key_Down);   // mode de lecture -> sortie audio
        wait(testCase.settleMs);
    }

    function init() {
        bindSettings();
        Components.AppSettings.audioOutputMode = "multichannel";
        wait(testCase.settleMs);
    }

    /* ===== Politique exposée par le singleton ===== */

    function test_normalizeAudioOutputMode() {
        compare(Components.AppSettings.normalizeAudioOutputMode("stereo"), "stereo");
        compare(Components.AppSettings.normalizeAudioOutputMode("STEREO"), "stereo");
        compare(Components.AppSettings.normalizeAudioOutputMode("multichannel"), "multichannel");
        compare(Components.AppSettings.normalizeAudioOutputMode(""), "multichannel");
        compare(Components.AppSettings.normalizeAudioOutputMode("valeur-inconnue"), "multichannel");
    }

    /* ===== Valeur par défaut ===== */

    function test_defaultIsMultichannel() {
        var panel = newPanel();
        compare(panel.audioOutputMode, "multichannel",
                "le défaut doit rester Multicanal : aucun changement de comportement");
        compare(Components.AppSettings.audioOutputMode, "multichannel");
    }

    /* ===== Navigation télécommande ===== */

    function test_downFromPlaybackModeReachesAudioRowAndTogglesIt() {
        var panel = newPanel();
        focusAudioRow(panel);

        // La rangée ciblée est bien « Sortie audio » : Droite la met en stéréo
        // et le mode de lecture, lui, ne bouge pas.
        var playbackBefore = panel.playbackMode;
        keyClick(Qt.Key_Right);
        wait(testCase.settleMs);
        compare(panel.audioOutputMode, "stereo");
        compare(panel.playbackMode, playbackBefore,
                "la rangée Sortie audio ne doit pas toucher au mode de lecture");

        keyClick(Qt.Key_Left);
        wait(testCase.settleMs);
        compare(panel.audioOutputMode, "multichannel");
    }

    function test_okTogglesBothWays() {
        var panel = newPanel();
        focusAudioRow(panel);

        keyClick(Qt.Key_Return);
        wait(testCase.settleMs);
        compare(panel.audioOutputMode, "stereo");

        keyClick(Qt.Key_Return);
        wait(testCase.settleMs);
        compare(panel.audioOutputMode, "multichannel");
    }

    function test_upFromAudioRowReturnsToPlaybackRow() {
        var panel = newPanel();
        focusAudioRow(panel);

        keyClick(Qt.Key_Up);     // sortie audio -> mode de lecture
        wait(testCase.settleMs);

        var audioBefore = panel.audioOutputMode;
        keyClick(Qt.Key_Left);   // agit sur le mode de lecture, pas sur l'audio
        wait(testCase.settleMs);
        compare(panel.playbackMode, "directplay");
        compare(panel.audioOutputMode, audioBefore);
    }

    /* ===== Persistance ===== */

    function test_choiceIsPersistedPerUser() {
        var panel = newPanel();
        focusAudioRow(panel);

        keyClick(Qt.Key_Right);
        wait(testCase.settleMs);

        compare(Components.AppSettings.audioOutputMode, "stereo");
        compare(Components.AppSettings.get("audioOutputMode", "multichannel"), "stereo",
                "le choix doit être écrit dans les préférences du profil");
        verify(fakeSettings.usersJson.indexOf("audioOutputMode") >= 0,
               "le stockage Settings doit contenir la préférence");

        // Un panneau rouvert relit la valeur persistée.
        panel.close();
        wait(300);
        var panel2 = newPanel();
        compare(panel2.audioOutputMode, "stereo");
    }

    function test_unknownStoredValueFallsBackToDefault() {
        // Valeur corrompue/inconnue dans le stockage : elle ne doit jamais
        // activer le downmix par surprise.
        Components.AppSettings.set("audioOutputMode", "surround-42");
        wait(testCase.settleMs);
        compare(Components.AppSettings.get("audioOutputMode", "multichannel"), "multichannel");

        var panel = newPanel();
        compare(panel.audioOutputMode, "multichannel");
    }
}
