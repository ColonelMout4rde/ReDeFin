// tst_settingssanitize.qml — garanties de sécurité de main.qml sur
// fbx.application.Settings (le stockage persistant réel du Player).
//
// CLAUDE.md est explicite : « les tokens sont sanitisés : jamais persistés
// dans Settings ». Ce fichier instancie le VRAI main.qml (racine
// fbx.application.Application) pour vérifier cette garantie sur le chemin
// réellement emprunté par ShellPage (le signal saveSettingsRequested, relayé
// vers fbx._applySettingsPayload), plutôt que sur une réécriture de la
// logique en dur dans le test.
//
// ⚠️ RÉSEAU : instancier main.qml charge réellement qml/pages/ShellPage.qml
// (Loader synchrone), dont Component.onCompleted fait
// `Qt.callLater(function() { updateManager.check() })` (~ShellPage.qml:1521) :
// un appel HTTP réel vers raw.githubusercontent.com si rien ne l'empêche.
// Qt.callLater ne s'exécute qu'au tour de boucle d'évènements suivant, donc
// newApp() retrouve l'instance UpdateManager dans l'arbre (elle n'a pas
// d'alias public, on la cherche par duck-typing : un descendant exposant à la
// fois `manifestUrl` et `check`) et force `checking = true` de façon
// SYNCHRONE juste après createObject(), avant tout wait()/retour à la boucle
// d'évènements. UpdateManager.check() teste `if (checking) return` en tout
// premier, donc aucun XMLHttpRequest n'est jamais créé. newApp() échoue
// bruyamment (verify()) si l'objet n'est pas trouvé, pour qu'une
// restructuration future de ShellPage qui casserait ce repérage fasse échouer
// la suite au lieu de recommencer à taper le réseau en silence.
// test_updateManagerCheckIsNeutralized() vérifie explicitement ce câblage.
//
// Vérifié séparément (voir le rapport de l'agent, pas reproduit ici pour ne
// pas alourdir le fichier) : aucun autre chemin réseau ne part à
// l'instanciation. Les deux points de création de XMLHttpRequest de
// qml/js/jellyfinBridge.js ne sont atteints par aucun appel Component.onCompleted
// de ShellPage/main.qml (uniquement du câblage de callbacks et de politique de
// sécurité tant qu'aucun profil n'est choisi, conformément au flux de boot
// documenté dans CLAUDE.md) ; aucun Qt.openUrlExternally n'est présent dans
// main.qml/ShellPage.qml (UpdateDialog.qml en a un, mais son open() n'est
// appelé que si updateManager émet updateAvailable, ce que la neutralisation
// empêche justement).
//
// Limite connue et volontairement acceptée : sous ce harnais Qt 6, le
// singleton `App` du firmware (utilisé par fbx.application.Settings.qml pour
// charger/sauvegarder réellement les valeurs) n'existe pas. Settings.onReady
// ne se déclenche donc jamais ici (voir la ReferenceError « App is not
// defined », interceptée et journalée en QWARN par la bibliothèque elle-même,
// sans faire échouer le test). Les propriétés de `settings` restent de
// simples propriétés QML in-memory : cela suffit à observer la garantie qui
// nous intéresse (ce qui est écrit sur les propriétés), mais PAS le
// chargement/sauvegarde réel ni la migration au démarrage (Settings.onReady),
// qui ne peuvent être vérifiés que sur un vrai Player.
//
// On n'attend jamais le splash (2 s avant routage) : l'objet est détruit
// bien avant, donc aucune navigation supplémentaire ne se produit.
import QtQuick 2.15
import QtTest 1.2

TestCase {
    id: testCase
    name: "SettingsSanitize"

    // Marche récursive générique dans l'arbre d'objets QML : `data` couvre
    // tous les enfants déclarés (visuels ou non, y compris sous un Window qui
    // n'a pas de `children`), `children` complète pour les Item usuels.
    function _collectChildren(obj) {
        var out = [];
        if (!obj) return out;
        try {
            var d = obj.data;
            if (d) for (var i = 0; i < d.length; i++) if (d[i]) out.push(d[i]);
        } catch (e0) {}
        try {
            var c = obj.children;
            if (c) for (var j = 0; j < c.length; j++) {
                if (c[j] && out.indexOf(c[j]) < 0) out.push(c[j]);
            }
        } catch (e1) {}
        return out;
    }

    // UpdateManager.qml n'a pas d'alias public dans ShellPage (juste un
    // `id: updateManager` local) : on le repère par duck-typing (les deux
    // membres qui le caractérisent sans ambiguïté dans cet arbre).
    function _findUpdateManager(root, maxDepth) {
        if (!root || maxDepth <= 0) return null;
        try {
            if (root.manifestUrl !== undefined && typeof root.check === "function")
                return root;
        } catch (e0) {}
        var kids = testCase._collectChildren(root);
        for (var i = 0; i < kids.length; i++) {
            var found = testCase._findUpdateManager(kids[i], maxDepth - 1);
            if (found) return found;
        }
        return null;
    }

    // ShellPage.qml n'a pas d'alias public dans main.qml (Loader privé
    // `mainLoader`) : on le repère par duck-typing, comme UpdateManager plus
    // haut, sur la combinaison _persistLoadedPageContext + saveSettingsRequested
    // qui n'existe qu'à cet endroit de l'arbre.
    function _findShellPage(root, maxDepth) {
        if (!root || maxDepth <= 0) return null;
        try {
            if (typeof root._persistLoadedPageContext === "function" && root.saveSettingsRequested)
                return root;
        } catch (e0) {}
        var kids = testCase._collectChildren(root);
        for (var i = 0; i < kids.length; i++) {
            var found = testCase._findShellPage(kids[i], maxDepth - 1);
            if (found) return found;
        }
        return null;
    }

    // Un compteur pour ne jamais réutiliser le même Application deux fois :
    // chaque test crée puis détruit la sienne, pour ne rien faire fuiter
    // (mainLoader/ShellPage) vers le test suivant dans la même session.
    function newApp() {
        var comp = Qt.createComponent("../../main.qml");
        compare(comp.status, Component.Ready, comp.errorString());
        var obj = comp.createObject(null);
        verify(obj !== null, "main.qml n'a pas pu être instanciée");

        // Neutralisation réseau : voir le commentaire d'en-tête. Synchrone,
        // avant tout wait() de l'appelant.
        var um = testCase._findUpdateManager(obj, 16);
        verify(um !== null,
               "UpdateManager introuvable dans l'arbre ShellPage : la neutralisation " +
               "réseau ne peut plus s'appliquer, ce test ne doit jamais repartir " +
               "silencieusement en tapant raw.githubusercontent.com");
        um.checking = true;

        return obj;
    }

    function destroyApp(obj) {
        // Détruit avant le déclenchement du minuteur de SplashPage (2000 ms).
        obj.destroy();
    }

    /* ===== Preuve que la neutralisation réseau fonctionne réellement ===== */

    function test_updateManagerCheckIsNeutralized() {
        var app = newApp();

        var um = testCase._findUpdateManager(app, 16);
        verify(um !== null);
        compare(um.checking, true,
                "check() doit être court-circuité par le garde-fou 'if (checking) return'");

        // Laisse le Qt.callLater de ShellPage.onCompleted s'exécuter : avec
        // checking=true, check() doit ressortir immédiatement sans jamais
        // créer de XMLHttpRequest.
        wait(300);

        compare(um.checking, true,
                "check() neutralisé ne doit jamais retomber à false via son propre chemin de succès/échec");
        compare(um._request, null, "aucune requête XMLHttpRequest ne doit avoir été créée");

        destroyApp(app);
    }

    /* ===== lastAccessToken : jamais écrit, quelle que soit l'entrée ===== */

    function test_applyPayload_lastAccessTokenAlwaysCleared() {
        var app = newApp();
        app.settingsRef.lastAccessToken = "residual-from-older-version";

        app._applySettingsPayload({ lastAccessToken: "brand-new-secret-token" });

        compare(app.settingsRef.lastAccessToken, "",
                "aucune valeur de lastAccessToken ne doit jamais atteindre Settings");
        destroyApp(app);
    }

    /* ===== usersJson : le token brut est toujours retiré avant stockage ===== */

    function test_applyPayload_usersJsonStripsAccessToken() {
        var app = newApp();

        var payloadUsers = JSON.stringify([{
            serverUrl: "http://jellyfin.test:8096",
            userId: "user-1",
            userName: "Alice",
            accessToken: "tok-TEST-LEAK-ME-NOT",
            remember: true
        }]);

        app._applySettingsPayload({ usersJson: payloadUsers });

        verify(app.settingsRef.usersJson.indexOf("tok-TEST-LEAK-ME-NOT") < 0,
               "le token brut ne doit jamais apparaître dans usersJson persisté");
        verify(app.settingsRef.usersJson.indexOf("user-1") >= 0,
               "le reste du profil (non sensible) doit, lui, être conservé");

        var stored = JSON.parse(app.settingsRef.usersJson);
        compare(stored.length, 1);
        compare(stored[0].accessToken, "");

        destroyApp(app);
    }

    /* ===== maximumSessionSecurity : appliqué avant usersJson, dans le même appel ===== */

    function test_applyPayload_maximumSecurityBlocksRememberInSameCall() {
        var app = newApp();

        // Un seul payload, comme ShellPage pourrait en émettre un : la politique
        // de sécurité maximale doit s'appliquer AVANT usersJson pour qu'un
        // payload malveillant/incohérent ne puisse pas réintroduire un souvenir
        // de session dans la foulée (cf. commentaire de _applySettingsPayload).
        app._applySettingsPayload({
            maximumSessionSecurity: true,
            rememberJellyfinSession: true,
            usersJson: JSON.stringify([{
                serverUrl: "http://jellyfin.test:8096",
                userId: "user-2",
                accessToken: "tok-TEST-SHOULD-NOT-SURVIVE",
                remember: true
            }])
        });

        compare(app.settingsRef.maximumSessionSecurity, true);
        compare(app.settingsRef.rememberJellyfinSession, false,
                "le mode sécurité maximale interdit rememberJellyfinSession, même demandé explicitement");

        var stored = JSON.parse(app.settingsRef.usersJson);
        compare(stored.length, 1);
        compare(stored[0].accessToken, "");
        compare(stored[0].remember, false,
                "remember ne doit pas survivre à la sécurité maximale, même si le payload le demandait");

        destroyApp(app);
    }

    function test_applyPayload_rememberAllowedWithoutMaximumSecurity() {
        var app = newApp();

        app._applySettingsPayload({ rememberJellyfinSession: true });

        compare(app.settingsRef.rememberJellyfinSession, true,
                "sans sécurité maximale, la préférence non secrète doit être honorée");

        destroyApp(app);
    }

    /* ===== clearSensitiveSettings : purge complète et prioritaire ===== */

    function test_clearSensitiveSettings_resetsEverySensitiveField() {
        var app = newApp();

        app.settingsRef.serverUrl = "http://jellyfin.test:8096";
        app.settingsRef.lastUserId = "user-3";
        app.settingsRef.lastUserName = "Bob";
        app.settingsRef.lastAccessToken = "tok-TEST-STILL-HERE";
        app.settingsRef.usersJson = "[{\"userId\":\"user-3\"}]";
        app.settingsRef.usersServersJson = "[{\"serverUrl\":\"http://jellyfin.test:8096\"}]";
        app.settingsRef.usersActiveKey = "http://jellyfin.test:8096|user-3";
        app.settingsRef.usersSessionVaultJson = "{\"v\":1}";
        app.settingsRef.rememberJellyfinSession = true;

        app.clearSensitiveSettings();

        compare(app.settingsRef.serverUrl, "");
        compare(app.settingsRef.lastUserId, "");
        compare(app.settingsRef.lastUserName, "");
        compare(app.settingsRef.lastAccessToken, "");
        compare(app.settingsRef.usersJson, "[]");
        compare(app.settingsRef.usersServersJson, "[]");
        compare(app.settingsRef.usersActiveKey, "");
        compare(app.settingsRef.usersSessionVaultJson, "{}");
        compare(app.settingsRef.rememberJellyfinSession, false);

        destroyApp(app);
    }

    function test_applyPayload_clearSensitiveSettingsTakesPriorityOverRestOfPayload() {
        var app = newApp();
        app.settingsRef.serverUrl = "http://jellyfin.test:8096";

        // Un payload qui demande à la fois la purge ET de réinjecter des
        // données : la purge doit gagner (retour anticipé documenté).
        app._applySettingsPayload({
            clearSensitiveSettings: true,
            serverUrl: "http://attacker.example:8096",
            lastUserId: "should-not-be-set"
        });

        compare(app.settingsRef.serverUrl, "",
                "la demande de purge doit l'emporter sur toute autre donnée du même payload");
        compare(app.settingsRef.lastUserId, "");

        destroyApp(app);
    }

    /* ===== Normalisation défensive des chaînes (_safeString / _normalizeServerUrl) ===== */

    function test_applyPayload_serverUrlStripsQueryStringSoNoTokenLeaksIntoIt() {
        var app = newApp();

        // Une URL de serveur ne devrait jamais porter de jeton de session, mais
        // si une couche amont en laissait passer un par erreur, le champ
        // persisté ne doit jamais le conserver.
        app._applySettingsPayload({
            serverUrl: "http://jellyfin.test:8096/?ApiKey=tok-TEST-IN-QUERY"
        });

        verify(app.settingsRef.serverUrl.indexOf("tok-TEST-IN-QUERY") < 0,
               "le jeton en query string ne doit jamais survivre dans serverUrl persisté");
        compare(app.settingsRef.serverUrl, "http://jellyfin.test:8096");

        destroyApp(app);
    }

    function test_applyPayload_rejectsNonHttpServerUrl() {
        var app = newApp();
        app.settingsRef.serverUrl = "http://previous.test:8096";

        app._applySettingsPayload({ serverUrl: "javascript:alert(1)" });

        compare(app.settingsRef.serverUrl, "",
                "une URL sans schéma http(s) valide doit être rejetée (vidée), pas conservée telle quelle");

        destroyApp(app);
    }

    function test_applyPayload_lastUserIdAndUserNameAreLengthCapped() {
        var app = newApp();

        var hugeId = new Array(500).join("i");   // 499 caractères
        var hugeName = new Array(500).join("n"); // 499 caractères

        app._applySettingsPayload({ lastUserId: hugeId, lastUserName: hugeName });

        verify(app.settingsRef.lastUserId.length <= 160,
               "lastUserId doit être borné (garde-fou anti-dump énorme dans Settings)");
        verify(app.settingsRef.lastUserName.length <= 160,
               "lastUserName doit être borné");

        destroyApp(app);
    }

    function test_applyPayload_usersActiveKeyIsLengthCapped() {
        var app = newApp();

        var hugeKey = new Array(2000).join("k");

        app._applySettingsPayload({ usersActiveKey: hugeKey });

        verify(app.settingsRef.usersActiveKey.length < hugeKey.length,
               "une clé active anormalement longue doit être tronquée, pas stockée telle quelle");

        destroyApp(app);
    }

    /* ===== _purgePersistedSessionTokens : migration/nettoyage direct ===== */

    function test_purgePersistedSessionTokens_clearsLegacyAccessTokenAndStripsUsersJson() {
        var app = newApp();

        app.settingsRef.lastAccessToken = "old-leftover-token";
        app.settingsRef.usersJson = JSON.stringify([{
            serverUrl: "http://jellyfin.test:8096",
            userId: "user-4",
            accessToken: "tok-TEST-LEGACY",
            remember: true
        }]);

        app._purgePersistedSessionTokens();

        compare(app.settingsRef.lastAccessToken, "");
        verify(app.settingsRef.usersJson.indexOf("tok-TEST-LEGACY") < 0);

        destroyApp(app);
    }

    /* ===== F8 (audit shell) : pas de saveSettingsRequested si rien ne change ===== */
    //
    // ShellPage._persistLoadedPageContext("homepage.qml") est appelée à
    // CHAQUE chargement de l'accueil. Avant le correctif, elle réémettait
    // systématiquement saveSettingsRequested avec les trois mêmes valeurs de
    // session, ce qui fait réécrire fbx.application.Settings à chaque fois
    // côté main.qml (voir _applySettingsPayload et
    // tests/js/mainsettingsguard.test.js pour le contrat symétrique côté
    // écriture). Ici on vérifie le signal lui-même : c'est une décision
    // purement locale à ShellPage (pas de dépendance à un comportement réel
    // du firmware), donc testable de façon comportementale, contrairement à
    // la réécriture de Settings elle-même (voir le commentaire de
    // mainsettingsguard.test.js).
    function test_persistLoadedPageContext_homepageSkipsSaveWhenNothingChanged() {
        var app = newApp();
        var shell = testCase._findShellPage(app, 16);
        verify(shell !== null, "ShellPage introuvable dans l'arbre main.qml");

        shell.sessionServerUrl = "http://jellyfin.test:8096";
        shell.sessionUserId = "user-1";
        shell.sessionUserName = "Alice";
        shell.settings.serverUrl = "http://jellyfin.test:8096";
        shell.settings.lastUserId = "user-1";
        shell.settings.lastUserName = "Alice";

        var saveCount = 0;
        shell.saveSettingsRequested.connect(function () { saveCount++; });

        shell._persistLoadedPageContext("homepage.qml");
        compare(saveCount, 0,
                "les trois valeurs sont déjà celles de Settings : aucune émission attendue");

        shell._persistLoadedPageContext("homepage.qml");
        compare(saveCount, 0, "un second appel identique ne doit rien émettre non plus");

        shell.sessionUserName = "Bob";
        shell._persistLoadedPageContext("homepage.qml");
        compare(saveCount, 1, "un champ a réellement changé : une seule émission");

        destroyApp(app);
    }
}
