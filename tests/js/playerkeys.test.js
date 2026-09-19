'use strict';

/*
 * Télécommande du lecteur : quelle touche fait quoi selon la couche visible.
 *
 * Sur Freebox il n'y a ni souris ni clavier : handlePressed() est le seul
 * chemin d'accès à la lecture. Une régression ici rend le lecteur
 * inutilisable (« Retour » qui ne sort plus, OK qui ne met plus en pause,
 * flèches qui déplacent le focus au lieu de chercher dans le film) et ne se
 * voit dans aucun autre test. Chaque touche consommée doit aussi poser
 * event.accepted, sinon playeroverlay.qml la retraite derrière le helper.
 *
 * Le helper lit les codes de touches dans le singleton `Qt`. On l'injecte ici
 * avec les VRAIES valeurs Qt 5.15 : le mini-dictionnaire de repli du module
 * (playerOverlayHelper.js:486) n'est jamais utilisé sur le boîtier.
 */

const test = require('node:test');
const assert = require('node:assert');

const { loadQmlJs } = require('./qmljs');
const { MP, STUBS, makeRoot, makeMediaPlayer } = require('./playerharness');

/* Codes Qt 5.15 (qnamespace.h). */
const QT = {
    Key_Escape: 0x01000000,
    Key_Return: 0x01000004,
    Key_Enter: 0x01000005,
    Key_Left: 0x01000012,
    Key_Up: 0x01000013,
    Key_Right: 0x01000014,
    Key_Down: 0x01000015,
    Key_Back: 0x01000061,
    Key_Select: 0x01010000,
    Key_MediaPlay: 0x01000080,
    Key_MediaStop: 0x01000081,
    Key_MediaPrevious: 0x01000082,
    Key_MediaNext: 0x01000083,
    Key_MediaPause: 0x01000085,
    Key_MediaTogglePlayPause: 0x01000086,
    Key_Plus: 0x2b,
    Key_Comma: 0x2c,
    Key_Minus: 0x2d,
    Key_Equal: 0x3d,
};

const H = loadQmlJs('qml/js/playerOverlayHelper.js', { stubs: Object.assign({ Qt: QT }, STUBS) });

const CF = { PROGRESS: 0, CONTROLS: 1, MENU: 4, CHAPTERS: 5, QUALITY: 6 };

function keyEvent(key, extra) {
    return Object.assign({ key: key, isAutoRepeat: false, accepted: false }, extra || {});
}

function setup(overrides) {
    const mp = makeMediaPlayer({ playbackState: MP.PlayingState });
    const root = makeRoot(Object.assign({
        controlsVisible: true,
        controlsFocus: CF.PROGRESS,
        controlsButtonIndex: 3,
        actions: [],

        transportToggle(origin) { root.actions.push(['toggle', origin]); },
        transportRewind(origin) { root.actions.push(['rewind', origin]); },
        transportForward(origin) { root.actions.push(['forward', origin]); },
        transportPrev(origin) { root.actions.push(['prev', origin]); },
        transportNext(origin) { root.actions.push(['next', origin]); },
        openAudioMenu() { root.actions.push(['audioMenu']); root.audioMenuVisible = true; },
        openSubMenu() { root.actions.push(['subMenu']); root.subMenuVisible = true; },
        showSubsToast() { root.actions.push(['subsToast']); },
        mediaPause() { root.actions.push(['mediaPause']); },
        finalizePlaybackAndExit(reason) { root.actions.push(['exit', reason]); return true; },
        _openChaptersPanel() { root.actions.push(['chaptersPanel']); },
        _setControlsButtonIndex(idx, origin) { root.controlsButtonIndex = idx; root.actions.push(['index', idx, origin]); },
        _forceControlsFocusNow(origin) { root.controlsFocus = CF.CONTROLS; root.actions.push(['focusControls', origin]); },
        _focusProgressBarSilent() { root.controlsFocus = CF.PROGRESS; root.actions.push(['focusProgress']); },
    }, overrides), { mp });
    return { root, mp };
}

/** Joue une touche et renvoie l'événement pour inspecter `accepted`. */
function press(root, key, extra) {
    const ev = keyEvent(key, extra);
    H.handlePressed(root, ev);
    return ev;
}

function kinds(root) { return root.actions.map((a) => a[0]); }

/* ===================== HUD masqué ===================== */

test('HUD masqué : la première flèche cherche dans le film et pose le focus sur la barre', () => {
    const { root } = setup({ controlsVisible: false, controlsFocus: CF.CONTROLS });
    const ev = press(root, QT.Key_Right);

    assert.strictEqual(ev.accepted, true);
    assert.deepStrictEqual(kinds(root), ['focusProgress', 'forward']);
    assert.strictEqual(root.controlsFocus, CF.PROGRESS);
    assert.strictEqual(root.controlsVisible, true, 'le HUD réapparaît');
});

test('HUD masqué : OK met en pause depuis la barre de progression', () => {
    const { root } = setup({ controlsVisible: false, controlsFocus: CF.CONTROLS, controlsButtonIndex: 1 });
    const ev = press(root, QT.Key_Select);

    assert.strictEqual(ev.accepted, true);
    assert.deepStrictEqual(kinds(root), ['focusProgress', 'toggle']);
});

/* ===================== barre de progression ===================== */

test('barre : gauche/droite cherchent, OK bascule lecture/pause', () => {
    const { root } = setup({ controlsFocus: CF.PROGRESS });
    assert.strictEqual(press(root, QT.Key_Left).accepted, true);
    assert.strictEqual(press(root, QT.Key_Right).accepted, true);
    assert.strictEqual(press(root, QT.Key_Return).accepted, true);
    assert.strictEqual(press(root, QT.Key_Enter).accepted, true);
    assert.deepStrictEqual(kinds(root), ['rewind', 'forward', 'toggle', 'toggle']);
});

test('barre : bas descend vers les contrôles, haut reste sur la barre', () => {
    const { root } = setup({ controlsFocus: CF.PROGRESS });
    assert.strictEqual(press(root, QT.Key_Down).accepted, true);
    assert.strictEqual(root.controlsFocus, CF.CONTROLS);

    root.controlsFocus = CF.PROGRESS;
    assert.strictEqual(press(root, QT.Key_Up).accepted, true);
    assert.strictEqual(root.controlsFocus, CF.PROGRESS, 'pas de ping-pong haut/bas');
});

test('barre : haut donne la priorité au bouton « passer l\'intro » s\'il est affiché', () => {
    const { root } = setup({
        controlsFocus: CF.PROGRESS,
        _focusSkipIntroIfVisible(origin) { root.actions.push(['skipIntroFocus', origin]); return true; },
    });
    assert.strictEqual(press(root, QT.Key_Up).accepted, true);
    assert.deepStrictEqual(kinds(root), ['skipIntroFocus']);
});

/* ===================== boutons de transport ===================== */

test('contrôles : gauche/droite déplacent le bouton sélectionné, sans sortir de 1..5', () => {
    const { root } = setup({ controlsFocus: CF.CONTROLS, controlsButtonIndex: 3 });

    press(root, QT.Key_Right);
    assert.strictEqual(root.controlsButtonIndex, 4);
    press(root, QT.Key_Left);
    assert.strictEqual(root.controlsButtonIndex, 3);
    press(root, QT.Key_Left);
    press(root, QT.Key_Left);
    assert.strictEqual(root.controlsButtonIndex, 1);
    press(root, QT.Key_Left);
    assert.strictEqual(root.controlsButtonIndex, 1, 'pas de débordement à gauche');
});

test('contrôles : depuis le dernier bouton, droite passe au groupe de droite', () => {
    const withChapters = setup({
        controlsFocus: CF.CONTROLS,
        controlsButtonIndex: 5,
        _focusChaptersButtonSilent(origin) { withChapters.root.controlsFocus = CF.CHAPTERS; return true; },
    });
    press(withChapters.root, QT.Key_Right);
    assert.strictEqual(withChapters.root.controlsFocus, CF.CHAPTERS);

    // Sans bouton Chapitres, on tombe directement sur le menu Audio.
    const noChapters = setup({ controlsFocus: CF.CONTROLS, controlsButtonIndex: 5, menuIndex: 2 });
    press(noChapters.root, QT.Key_Right);
    assert.strictEqual(noChapters.root.controlsFocus, CF.MENU);
    assert.strictEqual(noChapters.root.menuIndex, 1);
});

test('contrôles : OK active le bouton sélectionné', () => {
    for (const [idx, expected] of [[2, 'rewind'], [3, 'toggle'], [4, 'forward']]) {
        const { root } = setup({ controlsFocus: CF.CONTROLS, controlsButtonIndex: idx });
        const ev = press(root, QT.Key_Return);
        assert.strictEqual(ev.accepted, true);
        assert.deepStrictEqual(kinds(root), [expected], 'bouton ' + idx);
    }
});

test('contrôles : OK sur précédent/suivant démarre un maintien, sans répétition parasite', () => {
    const { root } = setup({
        controlsFocus: CF.CONTROLS,
        controlsButtonIndex: 5,
        _startControlsTransportHold() { root.actions.push(['holdStart']); },
    });

    assert.strictEqual(press(root, QT.Key_Return).accepted, true);
    assert.deepStrictEqual(kinds(root), ['holdStart']);

    // Les répétitions Freebox ne doivent pas réarmer le maintien.
    assert.strictEqual(press(root, QT.Key_Return, { isAutoRepeat: true }).accepted, true);
    assert.deepStrictEqual(kinds(root), ['holdStart']);
    assert.strictEqual(kinds(root).indexOf('next'), -1, 'aucun saut immédiat');
});

test('contrôles : haut revient à la barre, bas est absorbé', () => {
    const { root } = setup({ controlsFocus: CF.CONTROLS });
    assert.strictEqual(press(root, QT.Key_Up).accepted, true);
    assert.strictEqual(root.controlsFocus, CF.PROGRESS);

    root.controlsFocus = CF.CONTROLS;
    root.actions.length = 0;
    const ev = press(root, QT.Key_Down);
    assert.strictEqual(ev.accepted, true, 'la touche est avalée');
    assert.deepStrictEqual(kinds(root), [], 'mais ne fait rien');
});

/* ===================== menus Audio / Sous-titres ===================== */

test('menu : gauche/droite basculent entre Audio et Sous-titres', () => {
    const { root } = setup({ controlsFocus: CF.MENU, menuIndex: 1 });
    press(root, QT.Key_Right);
    assert.strictEqual(root.menuIndex, 2);
    press(root, QT.Key_Right);
    assert.strictEqual(root.menuIndex, 2, 'pas de débordement à droite');
    press(root, QT.Key_Left);
    assert.strictEqual(root.menuIndex, 1);
});

test('menu : OK ouvre le menu correspondant à la colonne', () => {
    const audio = setup({ controlsFocus: CF.MENU, menuIndex: 1 });
    press(audio.root, QT.Key_Return);
    assert.deepStrictEqual(kinds(audio.root), ['audioMenu']);

    const subs = setup({ controlsFocus: CF.MENU, menuIndex: 2 });
    press(subs.root, QT.Key_Return);
    assert.deepStrictEqual(kinds(subs.root), ['subMenu']);
});

test('menu ouvert : Retour le referme et rien d\'autre ne pilote la lecture', () => {
    const { root } = setup({ audioMenuVisible: true, controlsFocus: CF.MENU });
    const ev = press(root, QT.Key_Back);

    assert.strictEqual(ev.accepted, true);
    assert.strictEqual(root.audioMenuVisible, false);
    assert.strictEqual(root.subMenuVisible, false);
    assert.strictEqual(kinds(root).indexOf('exit'), -1, 'Retour ne quitte pas le lecteur');
});

test('menu ouvert : les flèches et OK ne touchent jamais au transport', () => {
    const { root } = setup({ subMenuVisible: true, controlsFocus: CF.PROGRESS });
    for (const k of [QT.Key_Left, QT.Key_Right, QT.Key_Up, QT.Key_Down, QT.Key_Return])
        press(root, k);
    assert.deepStrictEqual(kinds(root), []);
});

test('panneau Qualité ouvert : toutes les touches lui sont transmises et consommées', () => {
    const { root } = setup({
        controlsFocus: CF.PROGRESS,
        _qualityPanelOpen() { return true; },
        _handleQualityPanelKey(ev) { root.actions.push(['qualityKey', ev.key]); },
    });
    const ev = press(root, QT.Key_Left);

    assert.strictEqual(ev.accepted, true);
    assert.deepStrictEqual(kinds(root), ['qualityKey']);
});

/* ===================== chapitres / qualité (groupe latéral) ===================== */

test('chapitres : OK ouvre le carrousel, gauche revient au dernier bouton de transport', () => {
    const open = setup({ controlsFocus: CF.CHAPTERS });
    assert.strictEqual(press(open.root, QT.Key_Return).accepted, true);
    assert.deepStrictEqual(kinds(open.root), ['chaptersPanel']);

    const back = setup({ controlsFocus: CF.CHAPTERS });
    assert.strictEqual(press(back.root, QT.Key_Left).accepted, true);
    assert.strictEqual(back.root.controlsButtonIndex, 5);
    assert.strictEqual(back.root.controlsFocus, CF.CONTROLS);
});

/* ===================== décalage des sous-titres ===================== */

test('+ / - décalent les sous-titres de 100 ms et affichent le toast', () => {
    const { root } = setup({ subtitleDelayMs: 0 });

    assert.strictEqual(press(root, QT.Key_Plus).accepted, true);
    assert.strictEqual(root.subtitleDelayMs, 100);
    assert.strictEqual(press(root, QT.Key_Equal).accepted, true);
    assert.strictEqual(root.subtitleDelayMs, 200);
    assert.strictEqual(press(root, QT.Key_Minus).accepted, true);
    assert.strictEqual(press(root, QT.Key_Minus).accepted, true);
    assert.strictEqual(press(root, QT.Key_Minus).accepted, true);
    assert.strictEqual(root.subtitleDelayMs, -100, 'le décalage peut devenir négatif');
    assert.deepStrictEqual(kinds(root), ['subsToast', 'subsToast', 'subsToast', 'subsToast', 'subsToast']);
});

test('le décalage des sous-titres reste accessible depuis n\'importe quelle couche', () => {
    const { root } = setup({ audioMenuVisible: true, subtitleDelayMs: 0 });
    assert.strictEqual(press(root, QT.Key_Plus).accepted, true);
    assert.strictEqual(root.subtitleDelayMs, 100);
});

/* ===================== touches média et sortie ===================== */

test('touches média : suivant, précédent, lecture/pause, pause, stop', () => {
    const { root } = setup({ controlsFocus: 99 });   // aucune couche de focus connue

    assert.strictEqual(press(root, QT.Key_MediaNext).accepted, true);
    assert.strictEqual(press(root, QT.Key_MediaPrevious).accepted, true);
    assert.strictEqual(press(root, QT.Key_MediaPlay).accepted, true);
    assert.strictEqual(press(root, QT.Key_MediaTogglePlayPause).accepted, true);
    assert.strictEqual(press(root, QT.Key_MediaPause).accepted, true);
    assert.strictEqual(press(root, QT.Key_MediaStop).accepted, true);

    assert.deepStrictEqual(kinds(root),
        ['next', 'prev', 'toggle', 'toggle', 'mediaPause', 'exit']);
});

test('Retour et Echap quittent le lecteur en finalisant la lecture', () => {
    for (const k of [QT.Key_Back, QT.Key_Escape]) {
        const { root } = setup({ controlsFocus: 99 });
        const ev = press(root, k);
        assert.strictEqual(ev.accepted, true);
        assert.deepStrictEqual(root.actions, [['exit', 'back-key']]);
    }
});

test('une touche inconnue n\'est pas consommée et ne fait rien', () => {
    const { root } = setup({ controlsFocus: CF.PROGRESS });
    const ev = press(root, QT.Key_Comma);
    assert.strictEqual(ev.accepted, false);
    assert.deepStrictEqual(kinds(root), []);
});

test('n\'importe quelle touche rallume le HUD', () => {
    const { root } = setup({ controlsVisible: false, controlsFocus: CF.PROGRESS });
    press(root, QT.Key_Comma);
    assert.strictEqual(root.controlsVisible, true);
});

/* ===================== relâchement de touche ===================== */

function release(root, key, extra) {
    const ev = keyEvent(key, extra);
    H.handleReleased(root, ev);
    return ev;
}

test('relâchement : un maintien transport avale les relâchements de répétition', () => {
    const { root } = setup({
        _controlsTransportHoldActive() { return true; },
        _finishControlsTransportHold() { root.actions.push(['holdFinish']); return true; },
    });

    assert.strictEqual(release(root, QT.Key_Return, { isAutoRepeat: true }).accepted, true);
    assert.deepStrictEqual(kinds(root), [], 'aucun saut sur une répétition');

    assert.strictEqual(release(root, QT.Key_Return).accepted, true);
    assert.deepStrictEqual(kinds(root), ['holdFinish']);
});

test('relâchement : la validation du scrub se fait au relâchement de la flèche', () => {
    const { root } = setup({
        commitOnKeyRelease: true,
        scrubActive: true,
        commitScrub() { root.actions.push(['commitScrub']); },
        stopScrubCommitTimer() { root.actions.push(['stopScrubTimer']); },
    });

    const ev = release(root, QT.Key_Right);
    assert.strictEqual(ev.accepted, true);
    assert.deepStrictEqual(kinds(root), ['stopScrubTimer', 'commitScrub']);
});

test('relâchement : sans scrub en cours, rien n\'est validé', () => {
    const { root } = setup({
        commitOnKeyRelease: true,
        scrubActive: false,
        commitScrub() { root.actions.push(['commitScrub']); },
    });
    const ev = release(root, QT.Key_Right);
    assert.strictEqual(ev.accepted, false);
    assert.deepStrictEqual(kinds(root), []);
});

test('relâchement : les touches sans rapport avec le scrub sont ignorées', () => {
    const { root } = setup({
        commitOnKeyRelease: true,
        scrubActive: true,
        commitScrub() { root.actions.push(['commitScrub']); },
    });
    assert.strictEqual(release(root, QT.Key_Up).accepted, false);
    assert.deepStrictEqual(kinds(root), []);
});
