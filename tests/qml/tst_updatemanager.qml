// tst_updatemanager.qml — logique pure de qml/components/UpdateManager.qml.
//
// Sensible car c'est le seul chemin qui décide si l'utilisateur voit une
// notification de mise à jour, et vers quelle version : une régression ici
// est soit silencieuse (jamais de notification) soit trompeuse (mauvaise
// version proposée, ou bascule d'une install stable vers une bêta). Le
// composant lui-même ne fait qu'un GET anonyme vers un manifest JSON public
// (aucune authentification, aucune donnée utilisateur) : on ne teste jamais
// check() (réseau réel interdit dans ce harnais), seulement les fonctions
// pures et le traitement de réponse via _processResponse(), qui accepte un
// faux XMLHttpRequest déjà "répondu".
//
// applicationId/manifestUrl diffèrent entre branches (dev: com.lab.redefin,
// CM/factory: fork) : on les lit toujours depuis l'instance, jamais en dur.
import QtQuick 2.15
import QtTest 1.2
import "../../qml/components" as Components

TestCase {
    id: testCase
    name: "UpdateManager"

    Component {
        id: managerComponent
        Components.UpdateManager {}
    }

    function newManager() {
        var m = createTemporaryObject(managerComponent, testCase);
        verify(m !== null, "UpdateManager.qml n'a pas pu être instanciée");
        return m;
    }

    // Fabrique un faux XMLHttpRequest déjà terminé, pour piloter _processResponse
    // sans jamais émettre de requête réelle.
    function fakeXhr(status, body) {
        return { status: status, responseText: body };
    }

    /* ===== _parseVersion ===== */

    function test_parseVersion_data() {
        return [
            // format, major, minor, patch, beta, channelExplicit
            { tag: "0.49.true (bêta explicite)", raw: "0.49.true", major: 0, minor: 49, patch: 0, beta: true, explicit: true },
            { tag: "0.49.false (stable explicite malgré 0.x)", raw: "0.49.false", major: 0, minor: 49, patch: 0, beta: false, explicit: true },
            { tag: "0.49-beta", raw: "0.49-beta", major: 0, minor: 49, patch: 0, beta: true, explicit: true },
            { tag: "v0.50 (préfixe v, implicite bêta car 0.x)", raw: "v0.50", major: 0, minor: 50, patch: 0, beta: true, explicit: false },
            { tag: "1.0 (implicite stable)", raw: "1.0", major: 1, minor: 0, patch: 0, beta: false, explicit: false },
            { tag: "1.2.3 (trois segments)", raw: "1.2.3", major: 1, minor: 2, patch: 3, beta: false, explicit: false },
            { tag: "2.0.true (stable numérique mais bêta explicite)", raw: "2.0.true", major: 2, minor: 0, patch: 0, beta: true, explicit: true },
            { tag: "0.9.7.1 (révision de fork, quatre segments)", raw: "0.9.7.1", major: 0, minor: 9, patch: 7, revision: 1, beta: true, explicit: false },
            { tag: "0.9.7.1.true (quatre segments + marqueur FreeStore)", raw: "0.9.7.1.true", major: 0, minor: 9, patch: 7, revision: 1, beta: true, explicit: true },
        ];
    }

    function test_parseVersion(data) {
        var mgr = newManager();
        var parsed = mgr._parseVersion(data.raw);
        verify(parsed !== null, "devrait parser : " + data.raw);
        compare(parsed.major, data.major, "major: " + data.tag);
        compare(parsed.minor, data.minor, "minor: " + data.tag);
        compare(parsed.patch, data.patch, "patch: " + data.tag);
        compare(parsed.revision, data.revision || 0, "revision: " + data.tag);
        compare(parsed.beta, data.beta, "beta: " + data.tag);
        compare(parsed.channelExplicit, data.explicit, "channelExplicit: " + data.tag);
    }

    function test_parseVersion_rejectsGarbage() {
        var mgr = newManager();
        compare(mgr._parseVersion(""), null);
        compare(mgr._parseVersion(null), null);
        compare(mgr._parseVersion(undefined), null);
        compare(mgr._parseVersion("abc"), null, "non numérique");
        compare(mgr._parseVersion("1"), null, "un seul segment, insuffisant");
        compare(mgr._parseVersion("1.2.3.4.5"), null, "trop de segments");
        compare(mgr._parseVersion("1.2.x"), null, "segment non numérique");
        compare(mgr._parseVersion("1..2"), null, "segment vide");
        compare(mgr._parseVersion("-beta"), null, "que le marqueur, pas de numéro");
    }

    /* ===== _compareParsed : comparaison numérique, pas lexicographique ===== */

    function test_compareParsed_numericNotLexicographic() {
        var mgr = newManager();
        var v9 = mgr._parseVersion("0.9");
        var v10 = mgr._parseVersion("0.10");
        // Lexicographiquement "0.10" < "0.9", mais numériquement 10 > 9.
        verify(mgr._compareParsed(v10, v9) > 0, "0.10 doit être postérieure à 0.9");
        verify(mgr._compareParsed(v9, v10) < 0);
        compare(mgr._compareParsed(v9, v9), 0);
    }

    // Une révision de fork (« 0.9.7.1 ») se range après sa version de base et
    // avant la version officielle suivante. Sans cela l'analyseur renvoyait
    // null et la vérification de mise à jour s'arrêtait en silence.
    function test_compareParsed_fourthComponentIsARevision() {
        var mgr = newManager();
        var base = mgr._parseVersion("0.9.7");
        var rev1 = mgr._parseVersion("0.9.7.1");
        var rev2 = mgr._parseVersion("0.9.7.2");
        var next = mgr._parseVersion("0.9.8");
        verify(mgr._compareParsed(rev1, base) > 0, "0.9.7.1 > 0.9.7");
        verify(mgr._compareParsed(rev2, rev1) > 0, "0.9.7.2 > 0.9.7.1");
        verify(mgr._compareParsed(next, rev2) > 0, "0.9.8 > 0.9.7.2");
        compare(mgr._compareParsed(mgr._parseVersion("0.9.7.0"), base), 0, "0.9.7.0 == 0.9.7");
    }

    function test_compareParsed_stableBeatsBetaAtEqualNumber() {
        var mgr = newManager();
        var stable = mgr._parseVersion("0.50.false");
        var beta = mgr._parseVersion("0.50.true");
        verify(mgr._compareParsed(stable, beta) > 0, "à numéro égal, stable > bêta");
        verify(mgr._compareParsed(beta, stable) < 0);
    }

    function test_compareParsed_majorMinorPatchOrdering() {
        var mgr = newManager();
        verify(mgr._compareParsed(mgr._parseVersion("2.0"), mgr._parseVersion("1.9.9")) > 0);
        verify(mgr._compareParsed(mgr._parseVersion("1.2.0"), mgr._parseVersion("1.1.9")) > 0);
        verify(mgr._compareParsed(mgr._parseVersion("1.2.3"), mgr._parseVersion("1.2.2")) > 0);
    }

    function test_compareParsed_nullSafe() {
        var mgr = newManager();
        compare(mgr._compareParsed(null, mgr._parseVersion("1.0")), 0);
        compare(mgr._compareParsed(mgr._parseVersion("1.0"), null), 0);
        compare(mgr._compareParsed(null, null), 0);
    }

    /* ===== _readChannel ===== */

    function test_readChannel_unpublishedIsIgnored() {
        var mgr = newManager();
        var doc = { channels: { beta: { published: false, version: "0.99" } } };
        compare(mgr._readChannel(doc, "beta"), null);
    }

    function test_readChannel_missingChannelIsIgnored() {
        var mgr = newManager();
        compare(mgr._readChannel({ channels: {} }, "beta"), null);
        compare(mgr._readChannel(null, "beta"), null);
        compare(mgr._readChannel({}, "beta"), null);
    }

    function test_readChannel_invalidVersionIsIgnored() {
        var mgr = newManager();
        var doc = { channels: { stable: { published: true, version: "not-a-version" } } };
        compare(mgr._readChannel(doc, "stable"), null);
    }

    function test_readChannel_channelNameIsAuthority() {
        // Le nom du canal fait foi pour beta, quel que soit le marqueur du numéro.
        var mgr = newManager();
        var doc = { channels: { beta: { published: true, version: "1.0" } } };
        var ch = mgr._readChannel(doc, "beta");
        verify(ch !== null);
        compare(ch.parsed.beta, true, "canal beta => parsed.beta forcé à true même pour 1.0");
    }

    function test_readChannel_displayVersionSanitisedAndCapped() {
        var mgr = newManager();
        var longVersion = new Array(200).join("x"); // 199 caractères
        var doc = {
            channels: {
                stable: {
                    published: true,
                    version: "1.5",
                    displayVersion: "1.5\nligne\tsuivante " + longVersion
                }
            }
        };
        var ch = mgr._readChannel(doc, "stable");
        verify(ch !== null);
        verify(ch.displayVersion.indexOf("\n") < 0, "pas de retour à la ligne");
        verify(ch.displayVersion.indexOf("\t") < 0, "pas de tabulation");
        compare(ch.displayVersion.length, mgr.maximumDisplayVersionLength);
    }

    function test_readChannel_displayVersionFallsBackToVersion() {
        var mgr = newManager();
        var doc = { channels: { stable: { published: true, version: "1.5" } } };
        var ch = mgr._readChannel(doc, "stable");
        compare(ch.displayVersion, "1.5");
    }

    function test_readChannel_notesCapped() {
        var mgr = newManager();
        var longNotes = new Array(mgr.maximumNotesLength + 500).join("n");
        var doc = { channels: { stable: { published: true, version: "1.5", notes: longNotes } } };
        var ch = mgr._readChannel(doc, "stable");
        compare(ch.notes.length, mgr.maximumNotesLength);
    }

    /* ===== _chooseCandidate ===== */

    function test_chooseCandidate_stableInstallNeverGetsBeta() {
        var mgr = newManager();
        var doc = {
            channels: {
                stable: { published: true, version: "1.0" },
                beta: { published: true, version: "2.0.true" }
            }
        };
        var installed = mgr._parseVersion("1.0"); // stable installée
        var candidate = mgr._chooseCandidate(doc, installed);
        verify(candidate !== null);
        compare(candidate.name, "stable", "une install stable ne doit jamais recevoir une bêta");
    }

    function test_chooseCandidate_betaInstallGetsNewestOfBetaOrStable() {
        var mgr = newManager();
        // Cas 1 : la bêta est plus récente que la stable => bêta proposée.
        var docBetaAhead = {
            channels: {
                stable: { published: true, version: "1.0" },
                beta: { published: true, version: "1.1.true" }
            }
        };
        var installedBeta = mgr._parseVersion("0.9.true");
        var c1 = mgr._chooseCandidate(docBetaAhead, installedBeta);
        compare(c1.name, "beta");

        // Cas 2 : la stable a rattrapé/dépassé la bêta => stable proposée.
        var docStableAhead = {
            channels: {
                stable: { published: true, version: "2.0" },
                beta: { published: true, version: "1.1.true" }
            }
        };
        var c2 = mgr._chooseCandidate(docStableAhead, installedBeta);
        compare(c2.name, "stable");
    }

    function test_chooseCandidate_noInstalledVersionReturnsNull() {
        var mgr = newManager();
        var doc = { channels: { stable: { published: true, version: "1.0" } } };
        compare(mgr._chooseCandidate(doc, null), null);
    }

    /* ===== Traitement de la réponse : schéma et appId ===== */

    function test_processResponse_wrongSchemaVersionFails() {
        var mgr = newManager();
        var failed = [];
        mgr.checkFailed.connect(function(reason, localVersion) { failed.push(reason); });

        var doc = { schemaVersion: 2, appId: mgr.applicationId, channels: {} };
        mgr.checking = true;
        mgr._requestSerial = 1;
        mgr._processResponse(fakeXhr(200, JSON.stringify(doc)), 1, "1.0", mgr._parseVersion("1.0"));

        compare(failed.length, 1);
        compare(failed[0], "invalid_schema");
    }

    function test_processResponse_wrongAppIdFails() {
        var mgr = newManager();
        var failed = [];
        mgr.checkFailed.connect(function(reason, localVersion) { failed.push(reason); });

        // appId différent de mgr.applicationId (jamais codé en dur ici).
        var doc = { schemaVersion: 1, appId: mgr.applicationId + "-imposteur", channels: {} };
        mgr.checking = true;
        mgr._requestSerial = 1;
        mgr._processResponse(fakeXhr(200, JSON.stringify(doc)), 1, "1.0", mgr._parseVersion("1.0"));

        compare(failed.length, 1);
        compare(failed[0], "wrong_application");
    }

    function test_processResponse_validDocumentSignalsUpdateAvailable() {
        var mgr = newManager();
        var available = [];
        mgr.updateAvailable.connect(function(version, displayVersion, channel, notes, releasedAt, localVersion) {
            available.push({ version: version, channel: channel });
        });

        var doc = {
            schemaVersion: 1,
            appId: mgr.applicationId,
            channels: { stable: { published: true, version: "9.9" } }
        };
        mgr.checking = true;
        mgr._requestSerial = 1;
        mgr._processResponse(fakeXhr(200, JSON.stringify(doc)), 1, "1.0", mgr._parseVersion("1.0"));

        compare(available.length, 1);
        compare(available[0].version, "9.9");
        compare(available[0].channel, "stable");
    }

    function test_processResponse_notNewerSignalsNoUpdate() {
        var mgr = newManager();
        var noUpdateCount = 0;
        mgr.noUpdate.connect(function(localVersion) { noUpdateCount++; });

        var doc = {
            schemaVersion: 1,
            appId: mgr.applicationId,
            channels: { stable: { published: true, version: "1.0" } }
        };
        mgr.checking = true;
        mgr._requestSerial = 1;
        // Version installée déjà égale à la candidate => pas de mise à jour.
        mgr._processResponse(fakeXhr(200, JSON.stringify(doc)), 1, "1.0", mgr._parseVersion("1.0"));

        compare(noUpdateCount, 1);
    }

    function test_processResponse_malformedJsonFails() {
        var mgr = newManager();
        var failed = [];
        mgr.checkFailed.connect(function(reason) { failed.push(reason); });

        mgr.checking = true;
        mgr._requestSerial = 1;
        mgr._processResponse(fakeXhr(200, "{ceci n'est pas du JSON"), 1, "1.0", mgr._parseVersion("1.0"));

        compare(failed.length, 1);
        compare(failed[0], "invalid_json");
    }

    function test_processResponse_httpErrorFails() {
        var mgr = newManager();
        var failed = [];
        mgr.checkFailed.connect(function(reason) { failed.push(reason); });

        mgr.checking = true;
        mgr._requestSerial = 1;
        mgr._processResponse(fakeXhr(500, ""), 1, "1.0", mgr._parseVersion("1.0"));

        compare(failed.length, 1);
        compare(failed[0], "http_500");
    }

    function test_processResponse_oversizedBodyFails() {
        var mgr = newManager();
        var failed = [];
        mgr.checkFailed.connect(function(reason) { failed.push(reason); });

        var big = new Array(mgr.maximumResponseLength + 100).join("a");
        mgr.checking = true;
        mgr._requestSerial = 1;
        mgr._processResponse(fakeXhr(200, big), 1, "1.0", mgr._parseVersion("1.0"));

        compare(failed.length, 1);
        compare(failed[0], "too_large");
    }

    function test_processResponse_staleSerialIsIgnored() {
        // Une réponse d'une requête annulée/dépassée ne doit produire aucun signal.
        var mgr = newManager();
        var signals = 0;
        mgr.checkFailed.connect(function() { signals++; });
        mgr.noUpdate.connect(function() { signals++; });
        mgr.updateAvailable.connect(function() { signals++; });

        mgr.checking = true;
        mgr._requestSerial = 5;
        // On répond avec le sérial 1, qui ne correspond plus au sérial courant (5).
        mgr._processResponse(fakeXhr(200, "{}"), 1, "1.0", mgr._parseVersion("1.0"));

        compare(signals, 0, "une réponse obsolète ne doit déclencher aucun signal");
    }
}
