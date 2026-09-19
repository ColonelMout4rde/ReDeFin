'use strict';

/*
 * Arithmétique de position du lecteur et reporting Jellyfin.
 *
 * C'est le point le plus sensible du lecteur : un flux « server-timed » est
 * produit par le serveur À PARTIR de StartTimeTicks, donc le MediaPlayer
 * repart de zéro alors que l'utilisateur est à 1 h de film. La position réelle
 * vaut baseOffsetMs + mp.position, et c'est elle — convertie en ticks de
 * 100 ns — qui est écrite dans Jellyfin. Une erreur d'offset ne se voit pas à
 * l'écran mais corrompt durablement les points de reprise du serveur (« reprendre
 * à 3 min » sur un film déjà vu à 80 %).
 *
 * Protégé ici : les conversions (playerDurationMs / playerUiPositionMs /
 * playerSubtitleClockMs / playerKeepUiPosition / clampPlayerPersistableUi /
 * capturePlayerPersistablePosition), le garde-fou de position du helper
 * (reportUiPositionMs) et les trois appels de reporting (Playing / Progress /
 * Stopped), dont l'unicité par session.
 */

const test = require('node:test');
const assert = require('node:assert');

const { H, JF, MP, makeRoot, makeMediaPlayer } = require('./playerharness');

/** Ticks Jellyfin : 1 tick = 100 ns, donc 10 000 ticks par milliseconde. */
const TICKS_PER_MS = 10000;
const MIN_5 = 5 * 60 * 1000;
const MIN_90 = 90 * 60 * 1000;

function setup(rootOverrides, mpOverrides) {
    const mp = makeMediaPlayer(mpOverrides);
    const root = makeRoot(rootOverrides, { mp });
    return { root, mp };
}

/* ===================== durée affichée ===================== */

test('durée : les ticks de l\'item priment sur la durée du MediaPlayer', () => {
    const { root } = setup({ runtimeTicks: MIN_90 * TICKS_PER_MS }, { duration: 1234 });
    assert.strictEqual(root.durationMs(), MIN_90);
});

test('durée : sans ticks, un flux server-timed ajoute l\'offset à la durée locale', () => {
    // Jellyfin ne transcode que la fin du film : mp.duration ne couvre que le
    // reste. La barre de progression doit pourtant afficher la durée totale.
    const { root } = setup({ runtimeTicks: 0, baseOffsetMs: MIN_5, serverTimedStream: true },
                           { duration: MIN_90 - MIN_5 });
    assert.strictEqual(root.durationMs(), MIN_90);
});

test('durée : en DirectPlay pur l\'offset n\'est jamais ajouté', () => {
    const { root } = setup({ runtimeTicks: 0, baseOffsetMs: 0 }, { duration: MIN_90 });
    assert.strictEqual(root.durationMs(), MIN_90);
});

test('durée : aucune source de durée -> 0, jamais un nombre négatif', () => {
    const { root } = setup({ runtimeTicks: 0 }, { duration: -1 });
    assert.strictEqual(root.durationMs(), 0);
});

/* ===================== position réelle ===================== */

test('position : baseOffsetMs + position locale est la position réelle du média', () => {
    const { root } = setup({ baseOffsetMs: MIN_5, serverTimedStream: true }, { position: 42000 });
    assert.strictEqual(root.uiPositionMs(), MIN_5 + 42000);
});

test('position : en DirectPlay pur la position locale est la position réelle', () => {
    const { root } = setup({ baseOffsetMs: 0 }, { position: 42000 });
    assert.strictEqual(root.uiPositionMs(), 42000);
});

test('position : jamais négative même si le backend renvoie une position aberrante', () => {
    const { root } = setup({ baseOffsetMs: 0 }, { position: -5000 });
    assert.strictEqual(root.uiPositionMs(), 0);
});

test('position : pendant un reset de source, la position attendue fait autorité', () => {
    // Le pipeline est détruit : mp.position vaut 0 et ne décrit plus rien.
    const { root } = setup({
        _sourceResetActive: true,
        _sourceResetExpectedUiMs: MIN_90,
        baseOffsetMs: 0,
    }, { position: 0 });
    assert.strictEqual(root.uiPositionMs(), MIN_90);
});

test('position : pendant la vérification d\'un changement de piste, la position demandée fait autorité', () => {
    const { root } = setup({
        _trackSwitchRebaseActive: true,
        _trackSwitchVerificationActive: true,
        _trackSwitchRequestedUiMs: MIN_90,
        baseOffsetMs: 0,
    }, { position: 0 });
    assert.strictEqual(root.uiPositionMs(), MIN_90);
});

test('horloge des sous-titres locaux : toujours offset + position locale', () => {
    // Contrairement à uiPositionMs(), elle ne doit PAS être figée sur une cible :
    // les cues suivent l'image réellement décodée.
    const { root, mp } = setup({
        baseOffsetMs: MIN_5,
        _sourceResetActive: true,
        _sourceResetExpectedUiMs: MIN_90,
    }, { position: 7000 });
    assert.strictEqual(JF.playerSubtitleClockMs(root, mp), MIN_5 + 7000);
});

/* ===================== position « conservée » (scrub / seek en vol) ===================== */

test('keepUi : un scrub en cours prime sur la position décodée', () => {
    const { root } = setup({ scrubActive: true, scrubAccumUiMs: MIN_90, baseOffsetMs: 0 },
                           { position: 1000 });
    assert.strictEqual(root.keepUi(), MIN_90);
});

test('keepUi : scrub sans accumulateur retombe sur la cible de commit', () => {
    const { root } = setup({ scrubActive: true, scrubAccumUiMs: -1, _scrubCommitTargetUiMs: MIN_5 },
                           { position: 1000 });
    assert.strictEqual(root.keepUi(), MIN_5);
});

test('keepUi : un seek réseau en vol prime sur la position décodée', () => {
    const { root } = setup({ _pendingSeekMs: MIN_90, baseOffsetMs: 0 }, { position: 1000 });
    assert.strictEqual(root.keepUi(), MIN_90);
});

test('keepUi : au repos, c\'est la position réelle', () => {
    const { root } = setup({ baseOffsetMs: MIN_5, serverTimedStream: true }, { position: 1000 });
    assert.strictEqual(root.keepUi(), MIN_5 + 1000);
});

/* ===================== position persistée sur le serveur ===================== */

test('persistable : la position est bornée par la durée totale', () => {
    const { root, mp } = setup({ runtimeTicks: MIN_90 * TICKS_PER_MS });
    assert.strictEqual(JF.clampPlayerPersistableUi(root, mp, MIN_90 + 60000), MIN_90);
    assert.strictEqual(JF.clampPlayerPersistableUi(root, mp, -1), 0);
});

test('persistable : sans MediaPlayer, les ticks de l\'item bornent quand même', () => {
    // _sessionPayload() clampe sans MediaPlayer : la borne doit rester celle
    // de l'item quand celui-ci a des RunTimeTicks.
    const { root } = setup({ runtimeTicks: MIN_90 * TICKS_PER_MS });
    assert.strictEqual(JF.playerDurationMs(root, null), MIN_90);
    assert.strictEqual(JF.playerPersistableDurationMs(root, null), MIN_90);
    assert.strictEqual(JF.clampPlayerPersistableUi(root, null, MIN_90 + 60000), MIN_90);
});

test('persistable : sans MediaPlayer ni ticks, la position passe sans être bornée', () => {
    // Direct/enregistrement en cours : aucune durée connue. La position doit
    // traverser telle quelle (jamais négative), surtout pas être ramenée à 0,
    // sinon le point de reprise du serveur est corrompu.
    const { root } = setup({ runtimeTicks: 0 });
    assert.strictEqual(JF.playerDurationMs(root, null), 0);
    assert.strictEqual(JF.playerPersistableDurationMs(root, null), 0);
    assert.strictEqual(JF.clampPlayerPersistableUi(root, null, MIN_90), MIN_90);
    assert.strictEqual(JF.clampPlayerPersistableUi(root, null, -1), 0);
});

test('persistable : une position nulle n\'écrase pas la dernière position connue', () => {
    const { root, mp } = setup({ runtimeTicks: MIN_90 * TICKS_PER_MS, _lastPersistableUiMs: MIN_5 });
    assert.strictEqual(JF.rememberPlayerPersistablePosition(root, mp, 0, 'test'), MIN_5);
    assert.strictEqual(root._lastPersistableUiMs, MIN_5);

    assert.strictEqual(JF.rememberPlayerPersistablePosition(root, mp, MIN_90, 'test'), MIN_90);
    assert.strictEqual(root._lastPersistableUiMs, MIN_90);
});

test('capture : le pré-roll serveur n\'est jamais persisté', () => {
    const { root, mp } = setup({ serverPrerollBlocking: true, baseOffsetMs: MIN_5 }, { position: 9000 });
    assert.strictEqual(JF.capturePlayerPersistablePosition(root, mp, 'exit'), 0);
});

test('capture : à la sortie, la position figée avant Stop fait autorité', () => {
    // Contrat explicite du QML : Stop remet la position locale à zéro, la
    // position de sortie est capturée AVANT et ne doit plus bouger.
    const { root, mp } = setup({
        runtimeTicks: MIN_90 * TICKS_PER_MS,
        _playbackExitInProgress: true,
        _finalExitPositionMs: MIN_5,
    }, { position: 0 });
    assert.strictEqual(JF.capturePlayerPersistablePosition(root, mp, 'exit'), MIN_5);
});

test('capture : un seek en vol est persisté à la cible, pas à la position décodée', () => {
    const { root, mp } = setup({
        runtimeTicks: MIN_90 * TICKS_PER_MS,
        _pendingSeekMs: MIN_5,
        baseOffsetMs: 0,
    }, { position: 1000 });
    assert.strictEqual(JF.capturePlayerPersistablePosition(root, mp, 'seek'), MIN_5);
});

test('capture : la position persistée reste bornée par la durée de l\'item', () => {
    const { root, mp } = setup({
        runtimeTicks: MIN_5 * TICKS_PER_MS,
        baseOffsetMs: MIN_90,
        serverTimedStream: true,
    }, { position: 30000 });
    assert.strictEqual(JF.capturePlayerPersistablePosition(root, mp, 'progress'), MIN_5);
});

test('capture : une position nulle sur un pipeline arrêté retombe sur la dernière position connue', () => {
    // QtMultimedia remet position à 0 dès Stop : sans ce filet, la reprise
    // serveur serait réécrite à 00:00.
    const { root, mp } = setup({
        runtimeTicks: MIN_90 * TICKS_PER_MS,
        _lastPersistableUiMs: MIN_5,
        baseOffsetMs: 0,
    }, { position: 0, playbackState: MP.StoppedState });
    assert.strictEqual(JF.capturePlayerPersistablePosition(root, mp, 'stopped'), MIN_5);
});

/* ===================== garde-fou de position du helper ===================== */

test('garde : après une erreur média, une position retombée à zéro est corrigée', () => {
    // Le pipeline server-timed vient d'être recréé : mp.position ~ 0 et
    // baseOffsetMs pas encore réappliqué. Reporter 0 effacerait la reprise.
    const { root, mp } = setup({
        _mediaErrorRecoveryInProgress: true,
        _mediaErrorRecoverySafeUiMs: MIN_90,
        serverTimedStream: true,
        baseOffsetMs: 0,
        runtimeTicks: 0,
    }, { position: 0, duration: 0 });
    assert.strictEqual(H.reportUiPositionMs(root, mp), MIN_90);
});

test('garde : hors récupération, la position réelle est reportée telle quelle', () => {
    const { root, mp } = setup({
        _mediaErrorRecoverySafeUiMs: MIN_90,
        serverTimedStream: true,
        baseOffsetMs: MIN_5,
        runtimeTicks: 0,
    }, { position: 1000, duration: 0 });
    assert.strictEqual(H.reportUiPositionMs(root, mp), MIN_5 + 1000);
});

test('garde : une progression normale pendant la récupération n\'est pas réécrite', () => {
    const { root, mp } = setup({
        _mediaErrorRecoveryInProgress: true,
        _mediaErrorRecoverySafeUiMs: MIN_5,
        serverTimedStream: true,
        baseOffsetMs: MIN_90,
        runtimeTicks: 0,
    }, { position: 4000, duration: 0 });
    assert.strictEqual(H.reportUiPositionMs(root, mp), MIN_90 + 4000);
});

/* ===================== conversions en ticks ===================== */

test('ticks : 1 ms = 10 000 ticks, jamais de valeur négative', () => {
    const { root } = setup();
    assert.strictEqual(root._ticks(1), TICKS_PER_MS);
    assert.strictEqual(root._ticks(MIN_90), MIN_90 * TICKS_PER_MS);
    assert.strictEqual(root._ticks(-4200), 0);
});

/* ===================== reporting Jellyfin ===================== */

function fakeBridge() {
    const calls = [];
    return {
        calls,
        starts: () => calls.filter((c) => c.kind === 'start'),
        progress: () => calls.filter((c) => c.kind === 'progress'),
        stopped: () => calls.filter((c) => c.kind === 'stopped'),
        userData: () => calls.filter((c) => c.kind === 'userdata'),
        sessionsPlayingStart(serverUrl, token, payload, ok) { calls.push({ kind: 'start', payload }); if (ok) ok(); },
        sessionsPlayingProgress(serverUrl, token, payload, ok) { calls.push({ kind: 'progress', payload }); if (ok) ok(); },
        sessionsPlayingStopped(serverUrl, token, payload, ok) { calls.push({ kind: 'stopped', payload }); if (ok) ok(); },
        updateUserPlaybackPosition(serverUrl, token, userId, itemId, ticks, ok) { calls.push({ kind: 'userdata', ticks }); if (ok) ok(); },
    };
}

function reportableRoot(overrides, mpOverrides) {
    return setup(Object.assign({
        runtimeTicks: MIN_90 * TICKS_PER_MS,
        _startedReported: false,
        _reportedSessionId: '',
        _stoppedReportedSessionId: '',
        _stoppedPendingSessionId: '',
    }, overrides), mpOverrides);
}

test('Playing : envoyé une seule fois par session, avec la position réelle', () => {
    const { root } = reportableRoot({ baseOffsetMs: MIN_5, serverTimedStream: true }, { position: 1000 });
    const bridge = fakeBridge();

    JF.sendStartIfNeeded(root, bridge, MIN_5 + 1000);
    JF.sendStartIfNeeded(root, bridge, MIN_5 + 2000);

    assert.strictEqual(bridge.starts().length, 1);
    assert.strictEqual(bridge.starts()[0].payload.PositionTicks, (MIN_5 + 1000) * TICKS_PER_MS);
    assert.strictEqual(bridge.starts()[0].payload.PlaySessionId, 'sess-TEST');
});

test('Playing : une nouvelle session de lecture est à nouveau annoncée', () => {
    const { root } = reportableRoot();
    const bridge = fakeBridge();

    JF.sendStartIfNeeded(root, bridge, 1000);
    root.playSessionId = 'sess-TEST-2';
    JF.sendStartIfNeeded(root, bridge, 2000);

    assert.strictEqual(bridge.starts().length, 2);
    assert.strictEqual(bridge.starts()[1].payload.PlaySessionId, 'sess-TEST-2');
});

test('Playing : rien n\'est envoyé sans session, sans token ou avec le scrobble coupé', () => {
    const bridge = fakeBridge();
    JF.sendStartIfNeeded(reportableRoot({ playSessionId: '' }).root, bridge, 1000);
    JF.sendStartIfNeeded(reportableRoot({ accessToken: '' }).root, bridge, 1000);
    JF.sendStartIfNeeded(reportableRoot({ scrobbleEnabled: false }).root, bridge, 1000);
    JF.sendStartIfNeeded(reportableRoot({ serverPrerollBlocking: true }).root, bridge, 1000);
    assert.strictEqual(bridge.starts().length, 0);
});

test('Progress : la position réelle et l\'état pause sont envoyés en ticks', () => {
    const { root } = reportableRoot({ baseOffsetMs: MIN_5, serverTimedStream: true, lastUsedServerRemux: true },
                                    { position: 30000 });
    const bridge = fakeBridge();
    const seen = [];

    assert.strictEqual(JF.sendProgress(root, bridge, true, MIN_5 + 30000, (ok) => seen.push(ok)), true);

    const payload = bridge.progress()[0].payload;
    assert.strictEqual(payload.PositionTicks, (MIN_5 + 30000) * TICKS_PER_MS);
    assert.strictEqual(payload.IsPaused, true);
    assert.strictEqual(payload.PlayMethod, 'DirectStream');
    assert.deepStrictEqual(seen, [true]);
});

test('Progress : le PlayMethod annoncé suit le pipeline réellement utilisé', () => {
    const cases = [
        [{}, 'DirectPlay'],
        [{ isHls: true }, 'Transcode'],
        [{ lastUsedTranscoding: true }, 'Transcode'],
        [{ lastUsedServerRemux: true }, 'DirectStream'],
        [{ serverTimedStream: true }, 'DirectStream'],
        [{ timeShifted: true }, 'DirectStream'],
    ];
    for (const [flags, expected] of cases) {
        const { root } = reportableRoot(flags);
        const bridge = fakeBridge();
        JF.sendProgress(root, bridge, false, 1000, null);
        assert.strictEqual(bridge.progress()[0].payload.PlayMethod, expected, JSON.stringify(flags));
    }
});

test('Progress : la position envoyée reste bornée par la durée de l\'item', () => {
    const { root } = reportableRoot({ runtimeTicks: MIN_5 * TICKS_PER_MS });
    const bridge = fakeBridge();
    JF.sendProgress(root, bridge, false, MIN_90, null);
    assert.strictEqual(bridge.progress()[0].payload.PositionTicks, MIN_5 * TICKS_PER_MS);
});

test('Progress : contexte incomplet -> aucun appel, et le callback reçoit false', () => {
    const { root } = reportableRoot({ playSessionId: '' });
    const bridge = fakeBridge();
    const seen = [];
    assert.strictEqual(JF.sendProgress(root, bridge, false, 1000, (ok) => seen.push(ok)), false);
    assert.strictEqual(bridge.progress().length, 0);
    assert.deepStrictEqual(seen, [false]);
});

test('Stopped : Stopped puis UserData exact, une seule fois par session', () => {
    const { root } = reportableRoot();
    const bridge = fakeBridge();
    const seen = [];

    assert.strictEqual(JF.sendStoppedAtPosition(root, bridge, MIN_5, (ok) => seen.push(ok)), true);

    assert.deepStrictEqual(bridge.calls.map((c) => c.kind), ['stopped', 'userdata']);
    assert.strictEqual(bridge.stopped()[0].payload.PositionTicks, MIN_5 * TICKS_PER_MS);
    assert.strictEqual(bridge.userData()[0].ticks, MIN_5 * TICKS_PER_MS);
    assert.deepStrictEqual(seen, [true]);
    assert.strictEqual(root._stoppedReportedSessionId, 'sess-TEST');

    // Deuxième sortie (Retour + fin de média) : aucun doublon réseau.
    JF.sendStoppedAtPosition(root, bridge, MIN_90, (ok) => seen.push(ok));
    assert.strictEqual(bridge.stopped().length, 1);
    assert.deepStrictEqual(seen, [true, true]);
});

test('Stopped : un envoi déjà en vol n\'est pas dupliqué', () => {
    const { root } = reportableRoot({ _stoppedPendingSessionId: 'sess-TEST' });
    const bridge = fakeBridge();
    assert.strictEqual(JF.sendStoppedAtPosition(root, bridge, MIN_5, () => {}), true);
    assert.strictEqual(bridge.calls.length, 0);
});

test('Stopped : un échec réseau est réessayé une fois, puis UserData est tenté quand même', () => {
    const { root } = reportableRoot();
    const bridge = fakeBridge();
    let stoppedTries = 0;
    bridge.sessionsPlayingStopped = (s, t, payload, ok, ko) => {
        stoppedTries++;
        bridge.calls.push({ kind: 'stopped', payload });
        ko();
    };
    const seen = [];
    JF.sendStoppedAtPosition(root, bridge, MIN_5, (ok) => seen.push(ok));

    assert.strictEqual(stoppedTries, 2, 'un seul réessai');
    assert.strictEqual(bridge.userData().length, 1, 'la position exacte est écrite malgré l\'échec');
    assert.deepStrictEqual(seen, [true]);
});

test('Stopped : un échec UserData est réessayé une fois avant d\'abandonner', () => {
    const { root } = reportableRoot();
    const bridge = fakeBridge();
    let userDataTries = 0;
    bridge.updateUserPlaybackPosition = (s, t, u, i, ticks, ok, ko) => {
        userDataTries++;
        bridge.calls.push({ kind: 'userdata', ticks });
        ko();
    };
    const seen = [];
    JF.sendStoppedAtPosition(root, bridge, MIN_5, (ok) => seen.push(ok));

    assert.strictEqual(userDataTries, 2);
    // Le Stopped a réussi : la session reste considérée comme terminée.
    assert.deepStrictEqual(seen, [true]);
    assert.strictEqual(root._stoppedReportedSessionId, 'sess-TEST');
});

test('Stopped : la position figée est envoyée telle quelle, jamais négative', () => {
    const { root } = reportableRoot();
    const bridge = fakeBridge();
    JF.sendStoppedAtPosition(root, bridge, -1, () => {});
    assert.strictEqual(bridge.stopped()[0].payload.PositionTicks, 0);
});

test('Stopped : pré-roll serveur ou contexte incomplet -> rien envoyé', () => {
    const bridge = fakeBridge();
    JF.sendStoppedAtPosition(reportableRoot({ serverPrerollBlocking: true }).root, bridge, MIN_5, () => {});
    JF.sendStoppedAtPosition(reportableRoot({ playSessionId: '' }).root, bridge, MIN_5, () => {});
    JF.sendStoppedAtPosition(reportableRoot({ scrobbleEnabled: false }).root, bridge, MIN_5, () => {});
    assert.strictEqual(bridge.calls.length, 0);
});

test('sendStopped : sans position figée, la position persistable est capturée', () => {
    const { root } = reportableRoot({
        _finalExitPositionMs: -1,
        baseOffsetMs: MIN_5,
        serverTimedStream: true,
    }, { position: 12000 });
    root._capturePersistablePositionMs = (reason) => JF.capturePlayerPersistablePosition(root, root.mp, reason);
    const bridge = fakeBridge();

    JF.sendStopped(root, bridge, () => {});
    assert.strictEqual(bridge.stopped()[0].payload.PositionTicks, (MIN_5 + 12000) * TICKS_PER_MS);
});

test('Progress : un item sans RunTimeTicks doit quand même être reporté', () => {
    const { root } = reportableRoot({ runtimeTicks: 0 }, { duration: MIN_90 });
    const bridge = fakeBridge();
    assert.strictEqual(JF.sendProgress(root, bridge, false, MIN_5, null), true);
    assert.strictEqual(bridge.progress().length, 1);
    assert.strictEqual(bridge.progress()[0].payload.PositionTicks, MIN_5 * TICKS_PER_MS);
});

test('Playing : un item sans RunTimeTicks doit quand même être annoncé', () => {
    const { root } = reportableRoot({ runtimeTicks: 0 }, { duration: MIN_90 });
    const bridge = fakeBridge();
    JF.sendStartIfNeeded(root, bridge, MIN_5);
    assert.strictEqual(bridge.starts().length, 1);
    assert.strictEqual(bridge.starts()[0].payload.PositionTicks, MIN_5 * TICKS_PER_MS);
    assert.strictEqual(root._startedReported, true);
});
