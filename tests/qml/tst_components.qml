// tst_components.qml — instanciation « fumée » des composants réutilisables
// de qml/components/ qui ne dépendent ni de QtMultimedia ni du réseau.
//
// Périmètre : d'après tests/README.md/tests/qml/tst_smoke.qml,
// CircleDotsLoader.qml est déjà couvert ailleurs (ne pas dupliquer).
// AppSettings.qml et UpdateManager.qml ont leurs propres fichiers
// (tst_appsettings.qml, tst_updatemanager.qml). SettingsSidePanel est déjà
// couvert par tst_audiooutputsetting.qml.
//
// Composants retenus ici : ceux qui s'instancient proprement sous ce
// harnais Qt 6 (vérifié manuellement : aucun QWARN à l'instanciation) et qui
// exposent une logique/API publique qui vaut la peine d'être figée pour
// détecter une régression lors d'un futur import upstream :
//   - GlassCircleButton (bouton d'action générique : toggle, hint, triggered)
//   - GlassCircleButtonMovie / GlassCircleButtonSeason (contexte Jellyfin,
//     garde d'action, Resume)
//   - SortHudButton (menu de tri clavier)
//   - UnsupportedDialog / UpdateDialog (dialogues modaux, cycle open/close)
//   - SkipIntro (bouton Passer le générique : fenêtre 10 s, skip/dismiss)
//   - Playlist (logique pure de navigation dans une liste d'épisodes)
//   - ClockHUD (horloge + avatar : on vérifie seulement le couplage avec
//     AppSettings.showClock, jamais le rendu de l'avatar)
//   - SeasonEpisodesRow (smoke minimal : le composant est piloté par
//     SeasonPage avec un modèle hydraté ; sans page hôte, on se contente de
//     vérifier qu'il s'instancie et ne plante pas avec un modèle vide)
//
// Explicitement écartés : playeroverlay.qml et tout ce qui importe
// QtMultimedia (non résoluble sous PySide6-Essentials, cf. tests/README.md).
import QtQuick 2.15
import QtTest 1.2
import "../../qml/components" as Components

TestCase {
    id: testCase
    name: "Components"
    when: windowShown
    width: 800
    height: 600
    visible: true

    readonly property int settleMs: 40

    /* ===================== GlassCircleButton ===================== */

    Component {
        id: glassButtonComponent
        Components.GlassCircleButton {}
    }

    function test_glassCircleButton_defaults() {
        var btn = createTemporaryObject(glassButtonComponent, testCase);
        verify(btn !== null, "GlassCircleButton.qml n'a pas pu être instanciée");
        compare(btn.checkable, false);
        compare(btn.checked, false);
        compare(btn.actionType, "none");
        compare(btn.disabled, false);
        compare(btn.shouldShow, true);
    }

    function test_glassCircleButton_okKeyEmitsTriggered() {
        // triggered(origin) transporte l'actionType effectivement exécuté
        // ("none" par défaut), pas la source de l'interaction (clavier/souris) :
        // c'est bien _fireAction("key") qui reçoit la source, en interne, pour
        // actionGuard(actionType, origin) uniquement.
        var btn = createTemporaryObject(glassButtonComponent, testCase, { captureKeys: true });
        var origins = [];
        btn.triggered.connect(function(origin) { origins.push(origin); });

        btn.forceActiveFocus();
        wait(testCase.settleMs);
        verify(btn.activeFocus, "le bouton doit pouvoir prendre le focus pour recevoir les touches");

        keyClick(Qt.Key_Return);
        wait(testCase.settleMs);

        compare(origins.length, 1);
        compare(origins[0], "none");
    }

    function test_glassCircleButton_toggleLikeTogglesCheckedAndFiresCallback() {
        var likedValues = [];
        var btn = createTemporaryObject(glassButtonComponent, testCase, {
            actionType: "toggleLike",
            onToggleLike: function(value) { likedValues.push(value); }
        });

        btn.forceActiveFocus();
        wait(testCase.settleMs);

        keyClick(Qt.Key_Return);
        wait(testCase.settleMs);

        compare(btn.checked, true, "toggleLike doit passer checked à true au premier déclenchement");
        compare(likedValues.length, 1);
        compare(likedValues[0], true);

        keyClick(Qt.Key_Return);
        wait(testCase.settleMs);
        compare(btn.checked, false, "un second déclenchement doit repasser checked à false");
    }

    function test_glassCircleButton_disabledBlocksAction() {
        var btn = createTemporaryObject(glassButtonComponent, testCase, { disabled: true });
        var fired = 0;
        btn.triggered.connect(function() { fired++; });

        btn.forceActiveFocus();
        wait(testCase.settleMs);
        keyClick(Qt.Key_Return);
        wait(testCase.settleMs);

        compare(fired, 0, "un bouton disabled ne doit jamais déclencher triggered");
    }

    function test_glassCircleButton_actionGuardCanVeto() {
        var btn = createTemporaryObject(glassButtonComponent, testCase, {
            actionGuard: function() { return false; }
        });
        var fired = 0;
        btn.triggered.connect(function() { fired++; });

        btn.forceActiveFocus();
        wait(testCase.settleMs);
        keyClick(Qt.Key_Return);
        wait(testCase.settleMs);

        compare(fired, 0, "actionGuard renvoyant false doit bloquer l'action");
    }

    /* ===== GlassCircleButtonMovie / GlassCircleButtonSeason ===== */

    Component {
        id: gcbMovieComponent
        Components.GlassCircleButtonMovie {}
    }
    Component {
        id: gcbSeasonComponent
        Components.GlassCircleButtonSeason {}
    }

    function test_glassCircleButtonMovie_defaultsNoContext() {
        var btn = createTemporaryObject(gcbMovieComponent, testCase);
        verify(btn !== null, "GlassCircleButtonMovie.qml n'a pas pu être instanciée");
        compare(btn.actionType, "restart");
        compare(btn.ctxReady, false, "sans serveur/token/utilisateur, le contexte ne doit jamais être prêt");
        compare(btn.shouldShow, true, "restart doit toujours s'afficher, y compris sans UserData");
    }

    function test_glassCircleButtonMovie_resumeWithoutUserDataIsHidden() {
        var btn = createTemporaryObject(gcbMovieComponent, testCase, { actionType: "resume" });
        compare(btn.shouldShow, false,
                "sans UserData de reprise, le bouton Resume ne doit jamais s'afficher");
    }

    function test_glassCircleButtonMovie_actionGuardRejectsWithoutContext() {
        var btn = createTemporaryObject(gcbMovieComponent, testCase);
        var fired = 0;
        btn.triggered.connect(function() { fired++; });

        btn.forceActiveFocus();
        wait(testCase.settleMs);
        keyClick(Qt.Key_Return);
        wait(testCase.settleMs);

        // actionGuard exige _ensureCtx() ; sans serveur/token/utilisateur il échoue,
        // donc l'action "restart" ne doit jamais déclencher triggered ni de requête.
        compare(fired, 0, "sans contexte Jellyfin valide, l'action ne doit jamais partir");
    }

    function test_glassCircleButtonSeason_missingItemHidesRestartAndResume() {
        var btn = createTemporaryObject(gcbSeasonComponent, testCase, {
            isMissingOverride: true,
            actionType: "restart"
        });
        compare(btn.isMissingItem, true);
        compare(btn.shouldShow, false,
                "un épisode marqué manquant ne doit jamais proposer Lire/Reprendre");
    }

    /* ===================== SortHudButton ===================== */

    Component {
        id: sortHudComponent
        Components.SortHudButton {}
    }

    function test_sortHudButton_openMenuAndSelect() {
        var hud = createTemporaryObject(sortHudComponent, testCase, {
            options: ["A-Z", "Z-A", "Date d'ajout"],
            selectedIndex: 0
        });
        var activatedIdx = [];
        hud.activated.connect(function(idx) { activatedIdx.push(idx); });

        hud.forceActiveFocus();
        wait(testCase.settleMs);

        compare(hud.popupOpen, false);
        keyClick(Qt.Key_Return);
        wait(testCase.settleMs);
        compare(hud.popupOpen, true, "OK sur le bouton doit ouvrir le menu");

        keyClick(Qt.Key_Down);
        wait(testCase.settleMs);
        compare(hud.currentMenuIndex, 1);

        keyClick(Qt.Key_Return);
        wait(testCase.settleMs);
        compare(hud.popupOpen, false, "sélectionner une entrée doit refermer le menu");
        compare(activatedIdx.length, 1);
        compare(activatedIdx[0], 1);
    }

    function test_sortHudButton_escapeClosesWithoutActivating() {
        var hud = createTemporaryObject(sortHudComponent, testCase, {
            options: ["A-Z", "Z-A"]
        });
        var activatedCount = 0;
        hud.activated.connect(function() { activatedCount++; });

        hud.forceActiveFocus();
        wait(testCase.settleMs);
        hud.openMenu();
        wait(testCase.settleMs);
        compare(hud.popupOpen, true);

        keyClick(Qt.Key_Escape);
        wait(testCase.settleMs);

        compare(hud.popupOpen, false);
        compare(activatedCount, 0, "fermer avec Échap/Retour ne doit jamais déclencher activated");
    }

    function test_sortHudButton_upDownNavigateWhenClosed() {
        var hud = createTemporaryObject(sortHudComponent, testCase, { options: ["A-Z", "Z-A"] });
        var avatarReq = 0, gridReq = 0;
        hud.requestFocusAvatar.connect(function() { avatarReq++; });
        hud.requestFocusGrid.connect(function() { gridReq++; });

        hud.forceActiveFocus();
        wait(testCase.settleMs);
        keyClick(Qt.Key_Up);
        wait(testCase.settleMs);
        keyClick(Qt.Key_Down);
        wait(testCase.settleMs);

        compare(avatarReq, 1);
        compare(gridReq, 1);
    }

    /* ===================== UnsupportedDialog ===================== */

    Component {
        id: unsupportedComponent
        Components.UnsupportedDialog {}
    }

    function test_unsupportedDialog_openSetsTextAndVisible() {
        var dlg = createTemporaryObject(unsupportedComponent, testCase);
        compare(dlg.visible, false);

        dlg.open("Message principal", "Détail secondaire");
        wait(testCase.settleMs);

        compare(dlg.visible, true);
        compare(dlg.text, "Message principal");
    }

    function test_unsupportedDialog_closeEmitsClosedAndHides() {
        var dlg = createTemporaryObject(unsupportedComponent, testCase);
        var closedCount = 0;
        dlg.closed.connect(function() { closedCount++; });

        dlg.open("Test");
        wait(testCase.settleMs);
        dlg.close();
        wait(testCase.settleMs);

        compare(dlg.visible, false);
        compare(closedCount, 1);
    }

    function test_unsupportedDialog_returnKeyRequestsCloseAndCloses() {
        var dlg = createTemporaryObject(unsupportedComponent, testCase);
        var requestCloseCount = 0;
        dlg.requestClose.connect(function() { requestCloseCount++; });

        dlg.open("Test clavier");
        wait(150); // laisse forceActiveFocus() + Qt.callLater se stabiliser
        verify(dlg.activeFocus, "la boîte modale doit avoir le focus après open()");

        keyClick(Qt.Key_Return);
        wait(testCase.settleMs);

        compare(requestCloseCount, 1);
        compare(dlg.visible, false);
    }

    /* ===================== SkipIntro ===================== */

    Component {
        id: skipIntroComponent
        Components.SkipIntro {}
    }

    function test_skipIntro_showThenEscapeDismisses() {
        var skip = createTemporaryObject(skipIntroComponent, testCase, { uiMs: 5000 });
        var dismissedCount = 0;
        skip.dismissed.connect(function() { dismissedCount++; });

        compare(skip.effectiveShow, false);
        skip.show = true;
        wait(testCase.settleMs);
        compare(skip.effectiveShow, true);

        skip.forceActiveFocus();
        wait(testCase.settleMs);
        keyClick(Qt.Key_Escape);
        wait(testCase.settleMs);

        compare(dismissedCount, 1, "Échap doit être interprété comme un rejet explicite");
    }

    function test_skipIntro_returnAfterArmDelaySkips() {
        var skip = createTemporaryObject(skipIntroComponent, testCase, {
            uiMs: 12345, endMs: -1, armDelayMs: 30
        });
        var skipTargets = [];
        skip.skipRequested.connect(function(targetMs) { skipTargets.push(targetMs); });

        skip.show = true;
        wait(80); // laisse armTimer (30ms) rendre le bouton "armed"
        skip.forceActiveFocus();
        wait(testCase.settleMs);

        keyClick(Qt.Key_Return);
        wait(testCase.settleMs);

        compare(skipTargets.length, 1);
        compare(skipTargets[0], 12345, "sans endMs valide, la cible doit être uiMs");
    }

    function test_skipIntro_downRequestsFocusBelowWithoutHiding() {
        var skip = createTemporaryObject(skipIntroComponent, testCase);
        var focusBelowCount = 0;
        skip.focusBelowRequested.connect(function() { focusBelowCount++; });

        skip.show = true;
        wait(testCase.settleMs);
        skip.forceActiveFocus();
        wait(testCase.settleMs);

        keyClick(Qt.Key_Down);
        wait(testCase.settleMs);

        compare(focusBelowCount, 1);
        compare(skip.effectiveShow, true, "↓ ne doit jamais masquer le bouton");
    }

    /* ===================== Playlist ===================== */

    Component {
        id: playlistComponent
        Components.Playlist {}
    }

    function test_playlist_setListAndStart() {
        var pl = createTemporaryObject(playlistComponent, testCase);
        var playedIds = [];
        pl.requestPlayItem.connect(function(id) { playedIds.push(id); });

        pl.setList(["ep1", "ep2", "ep3"]);
        compare(pl.hasList(), true);

        var ok = pl.start();
        compare(ok, true);
        compare(playedIds.length, 1);
        compare(playedIds[0], "ep1");
        compare(pl.currentItemId, "ep1");
    }

    function test_playlist_nextFromAndPrevFrom() {
        var pl = createTemporaryObject(playlistComponent, testCase);
        pl.setList(["ep1", "ep2", "ep3"]);

        var advanced = pl.nextFrom("ep1");
        compare(advanced, true);
        compare(pl.currentItemId, "ep2");

        var advancedAgain = pl.nextFrom("ep2");
        compare(advancedAgain, true);
        compare(pl.currentItemId, "ep3");

        var pastEnd = pl.nextFrom("ep3");
        compare(pastEnd, false, "aucun épisode suivant après le dernier");

        var back = pl.prevFrom("ep3");
        compare(back, true);
        compare(pl.currentItemId, "ep2");
    }

    function test_playlist_normalizesInvalidEntries() {
        var pl = createTemporaryObject(playlistComponent, testCase);
        // undefined/null/vides doivent être filtrés, les autres castés en string.
        pl.setList(["ep1", undefined, null, "", 42, "ep2"]);
        compare(pl.list.length, 3);
        compare(pl.list[0], "ep1");
        compare(pl.list[1], "42");
        compare(pl.list[2], "ep2");
    }

    function test_playlist_allowedIdsFiltersOutOfScopeItems() {
        var pl = createTemporaryObject(playlistComponent, testCase);
        pl.setList(["ep1", "ep2", "ep3"]);
        pl.setAllowed(["ep1", "ep3"]);

        compare(pl.list.length, 2, "ep2 doit être retiré, hors périmètre autorisé");
        verify(pl.list.indexOf("ep2") < 0);
    }

    function test_playlist_clearResetsState() {
        var pl = createTemporaryObject(playlistComponent, testCase);
        pl.setList(["ep1", "ep2"]);
        pl.setCurrentItemId("ep2");
        compare(pl.currentItemId, "ep2");

        pl.clear();
        compare(pl.hasList(), false);
        compare(pl.currentItemId, "");
        compare(pl.index, -1);
    }

    /* ===================== UpdateDialog ===================== */

    Component {
        id: updateDialogComponent
        Components.UpdateDialog {}
    }

    function test_updateDialog_openShowsAndDefaultsToOpenStore() {
        var dlg = createTemporaryObject(updateDialogComponent, testCase, {
            availableVersion: "1.2", releaseNotes: ""
        });
        compare(dlg.visible, false);
        compare(dlg.hasNotes, false);

        dlg.open();
        wait(testCase.settleMs);

        compare(dlg.visible, true);
        compare(dlg.selectedAction, 1, "l'action par défaut à l'ouverture doit rester Ouvrir le Free Store");
    }

    function test_updateDialog_leftThenReturnDismissesWithoutOpeningStore() {
        var dlg = createTemporaryObject(updateDialogComponent, testCase, {
            availableVersion: "1.2"
        });
        var dismissedCount = 0;
        var acceptedCount = 0;
        dlg.dismissed.connect(function() { dismissedCount++; });
        dlg.accepted.connect(function() { acceptedCount++; });

        dlg.open();
        wait(150);
        verify(dlg.activeFocus, "la boîte de mise à jour doit avoir le focus après open()");

        keyClick(Qt.Key_Left);
        wait(testCase.settleMs);
        compare(dlg.selectedAction, 0);

        keyClick(Qt.Key_Return);
        wait(testCase.settleMs);

        compare(dismissedCount, 1);
        compare(acceptedCount, 0, "choisir Plus tard ne doit jamais déclencher l'action Free Store");
        compare(dlg.visible, false);
    }

    function test_updateDialog_hasNotesReflectsReleaseNotes() {
        var dlg = createTemporaryObject(updateDialogComponent, testCase, {
            releaseNotes: "  \n  "
        });
        compare(dlg.hasNotes, false, "des notes composées uniquement d'espaces ne comptent pas");

        var dlg2 = createTemporaryObject(updateDialogComponent, testCase, {
            releaseNotes: "Corrections diverses"
        });
        compare(dlg2.hasNotes, true);
    }

    /* ===================== ClockHUD ===================== */

    Component {
        id: clockHudComponent
        Components.ClockHUD {}
    }

    function test_clockHud_defaultsAndAppSettingsCoupling() {
        // Sauvegarde/restauration : AppSettings est un singleton partagé par
        // toute la session de test, jamais supposé dans un état particulier.
        var previousShowClock = Components.AppSettings.showClock;
        try {
            Components.AppSettings.showClock = true;

            var hud = createTemporaryObject(clockHudComponent, testCase);
            verify(hud !== null, "ClockHUD.qml n'a pas pu être instanciée");
            compare(hud.hudOpacity, 1.0);
            compare(hud.showAvatar, false);
            compare(hud.effectiveAvatarUrl, "", "sans contexte serveur/utilisateur, aucune URL d'avatar");
            compare(hud.visible, true, "horloge activée + AppSettings.showClock=true => HUD visible");

            Components.AppSettings.showClock = false;
            wait(testCase.settleMs);
            compare(hud.visible, false,
                    "quand AppSettings.showClock passe à false, le HUD (sans avatar) doit se masquer");
        } finally {
            Components.AppSettings.showClock = previousShowClock;
        }
    }

    /* ===================== SeasonEpisodesRow (smoke minimal) ===================== */

    Component {
        id: seasonRowComponent
        Components.SeasonEpisodesRow {}
    }

    function test_seasonEpisodesRow_instantiatesWithEmptyModel() {
        var row = createTemporaryObject(seasonRowComponent, testCase, { model: [] });
        verify(row !== null, "SeasonEpisodesRow.qml n'a pas pu être instanciée");
        compare(row.currentIndex, 0);
        // Ne doit jamais planter avec une liste vide.
        row.updatePosterGate("test");
        compare(row.posterGateMax, -1);
    }
}
