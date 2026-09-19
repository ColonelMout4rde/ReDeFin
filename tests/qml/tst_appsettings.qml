// tst_appsettings.qml — façade qml/components/AppSettings.qml (hors rangée
// « Sortie audio », déjà couverte par tst_audiooutputsetting.qml).
//
// Sensible pour deux raisons :
//   - AppSettings.normalizePlaybackMode() est le seul rempart contre une
//     valeur de stockage corrompue/périmée : une régression ferait démarrer
//     ReDeFin dans un mode de lecture inattendu sans que rien ne le signale ;
//   - AppSettings.get()/set() délèguent à UserStore.js, qui est le point où
//     CLAUDE.md garantit qu'aucun secret n'est jamais écrit dans les
//     préférences persistées (qml/js/UserStore.js:_isSensitivePrefsKey /
//     _sanitizePrefsValue) : une régression y serait une vraie fuite de
//     token, pas juste un bug d'affichage.
//
// AppSettings est un singleton partagé par toute la session de test : chaque
// fonction reconstitue explicitement son propre contexte (settingsRef, serveur,
// utilisateur) avant d'affirmer quoi que ce soit, sans jamais supposer un état
// hérité d'un autre fichier tst_*.qml.
import QtQuick 2.15
import QtTest 1.2
import "../../qml/components" as Components
import "../../qml/js/UserStore.js" as UserStore

TestCase {
    id: testCase
    name: "AppSettings"

    readonly property int settleMs: 30

    // Substitut de fbx.application.Settings : UserStore écrit usersJson
    // directement dessus, comme documenté dans tests/README.md et repris de
    // tst_audiooutputsetting.qml.
    QtObject {
        id: fakeSettings
        property string usersJson: ""
        property string usersServersJson: ""
        property string usersActiveKey: ""
        property string usersSessionVaultJson: ""
    }

    readonly property string srv: "http://jellyfin.test:8096"

    // Un uid distinct par test : on évite tout état de préférences hérité
    // d'un test précédent dans ce même fichier (le magasin est indexé par
    // couple serveur+utilisateur, pas remis à zéro entre les fonctions).
    property int _uidCounter: 0
    function freshUid() {
        _uidCounter++;
        return "user-appsettings-" + _uidCounter;
    }

    function bindContext(uid) {
        fakeSettings.usersJson = "";
        fakeSettings.usersServersJson = "";
        fakeSettings.usersActiveKey = "";
        fakeSettings.usersSessionVaultJson = "";
        Components.AppSettings.settingsRef = fakeSettings;
        Components.AppSettings.init(null, fakeSettings);
        Components.AppSettings.setContext(testCase.srv, uid);
        wait(testCase.settleMs);
    }

    /* ===== normalizePlaybackMode : rempart contre une valeur corrompue ===== */

    function test_normalizePlaybackMode_data() {
        return [
            { tag: "directplay inchangé", input: "directplay", expected: "directplay" },
            { tag: "direct-play (tiret)", input: "direct-play", expected: "directplay" },
            { tag: "direct_play (underscore)", input: "direct_play", expected: "directplay" },
            { tag: "casse ignorée", input: "DIRECTPLAY", expected: "directplay" },
            { tag: "espaces ignorés", input: "  directplay  ", expected: "directplay" },
            { tag: "smart inchangé", input: "smart", expected: "smart" },
            { tag: "valeur inconnue -> smart", input: "surround-hd-42", expected: "smart" },
            { tag: "chaîne vide -> smart", input: "", expected: "smart" },
            { tag: "undefined -> smart", input: undefined, expected: "smart" },
            { tag: "null -> smart", input: null, expected: "smart" },
        ];
    }

    function test_normalizePlaybackMode(data) {
        compare(Components.AppSettings.normalizePlaybackMode(data.input), data.expected, data.tag);
    }

    /* ===== Valeurs par défaut ===== */

    function test_defaultShowClockIsTrue() {
        var uid = freshUid();
        bindContext(uid);
        // Utilisateur jamais vu : get() retombe sur la valeur par défaut fournie.
        compare(Components.AppSettings.get("showClock", true), true);
    }

    function test_getWithoutBoundContextReturnsDefault() {
        Components.AppSettings.setContext("", "");
        wait(testCase.settleMs);
        compare(Components.AppSettings.get("playbackMode", "smart"), "smart");
        compare(Components.AppSettings.get("anything", "fallback-value"), "fallback-value");
    }

    /* ===== set() normalise avant persistance ===== */

    function test_setPlaybackModeNormalizesInvalidValueBeforeStoring() {
        var uid = freshUid();
        bindContext(uid);

        Components.AppSettings.set("playbackMode", "bogus-mode");
        wait(testCase.settleMs);

        compare(Components.AppSettings.playbackMode, "smart",
                "une valeur inconnue ne doit jamais rester telle quelle sur la propriété réactive");
        compare(Components.AppSettings.get("playbackMode", "smart"), "smart",
                "et surtout pas être écrite telle quelle dans le stockage");
        verify(fakeSettings.usersJson.indexOf("bogus-mode") < 0,
               "la valeur brute invalide ne doit jamais apparaître dans le JSON persisté");
    }

    function test_setPlaybackModeAliasIsNormalizedOnStorage() {
        var uid = freshUid();
        bindContext(uid);

        Components.AppSettings.set("playbackMode", "direct-play");
        wait(testCase.settleMs);

        compare(Components.AppSettings.playbackMode, "directplay");
        compare(Components.AppSettings.get("playbackMode", "smart"), "directplay");
    }

    /* ===== Valeur corrompue déjà en stockage (contournant set()) ===== */

    function test_corruptedStoredPlaybackModeFallsBackOnResync() {
        var uid = freshUid();
        bindContext(uid);

        // Écrit directement une valeur invalide dans le magasin, en contournant
        // AppSettings.set() (simule un ancien format ou une corruption externe).
        UserStore.setUserPref(testCase.srv, uid, "playbackMode", "invalid-legacy-mode");

        // _syncFromStore() (déclenché par un changement de contexte) doit
        // renormaliser à la lecture, jamais exposer la valeur brute.
        Components.AppSettings.setContext(testCase.srv, "");
        wait(testCase.settleMs);
        Components.AppSettings.setContext(testCase.srv, uid);
        wait(testCase.settleMs);

        compare(Components.AppSettings.playbackMode, "smart",
                "une valeur corrompue en stockage ne doit jamais fuiter sur la propriété réactive");
    }

    /* ===== Garantie CLAUDE.md : aucun secret dans les préférences persistées ===== */

    function test_tokenLikeKeyIsNeverPersisted_data() {
        return [
            { tag: "accessToken", key: "accessToken" },
            { tag: "token", key: "token" },
            { tag: "apiKey", key: "apiKey" },
            { tag: "password", key: "password" },
        ];
    }

    function test_tokenLikeKeyIsNeverPersisted(data) {
        var uid = freshUid();
        bindContext(uid);

        var secret = "tok-TEST-SECRET-" + data.key;
        Components.AppSettings.set(data.key, secret);
        wait(testCase.settleMs);

        compare(Components.AppSettings.get(data.key, ""), "",
                "une clé sensible (" + data.key + ") ne doit jamais être relisible");
        verify(fakeSettings.usersJson.indexOf(secret) < 0,
               "le secret ne doit apparaître nulle part dans le JSON persisté (" + data.key + ")");
    }

    /* ===== Roundtrip non sensible : preuve que get/set fonctionnent bien pour le cas normal ===== */

    function test_nonSensitivePrefRoundtrips() {
        var uid = freshUid();
        bindContext(uid);

        Components.AppSettings.set("someHarmlessPref", "valeur-ok");
        wait(testCase.settleMs);

        compare(Components.AppSettings.get("someHarmlessPref", ""), "valeur-ok");
        verify(fakeSettings.usersJson.indexOf("valeur-ok") >= 0,
               "une préférence non sensible doit, elle, être persistée normalement");
    }
}
