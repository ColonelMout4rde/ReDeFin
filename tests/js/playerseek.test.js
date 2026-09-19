'use strict';

/*
 * Seek du lecteur : choix local / réseau, arithmétique de la cible et
 * restauration de position après réouverture du flux.
 *
 * Deux natures de seek coexistent :
 *  - le seek LOCAL (mp.seek) quand le fichier est lu tel quel ; la cible
 *    affichée doit être convertie en position locale, donc amputée de
 *    baseOffsetMs et bornée par la durée du média ;
 *  - le seek RESEAU quand le flux doit être reconstruit par Jellyfin à un
 *    nouveau StartTimeTicks ; il passe par une renégociation complète.
 * Choisir le mauvais des deux donne soit un saut sans effet, soit un
 * transcodage inutile de ~2,5 s sur Révolution.
 *
 * tickSeekRestore() est la machine qui rejoue la position après une
 * réouverture : elle doit finir par accepter (ou escalader), jamais boucler.
 */

const test = require('node:test');
const assert = require('node:assert');

const { H, MP, setNow, advance, makeTimer, makeTimers, makeMediaPlayer, makeRoot } =
    require('./playerharness');

const MIN_5 = 5 * 60 * 1000;
const MIN_30 = 30 * 60 * 1000;
const MIN_90 = 90 * 60 * 1000;

function setup(rootOverrides, mpOverrides) {
    setNow(1700000000000);
    const mp = makeMediaPlayer(Object.assign({ duration: MIN_90 }, mpOverrides));
    const timers = makeTimers();
    const seekRestoreTimer = timers.seekRestore;
    const resumeTimer = makeTimer('verifiedResume');
    const settleTimer = makeTimer('settle');
    const restartTimer = makeTimer('restart');
    const root = makeRoot(Object.assign({ runtimeTicks: MIN_90 * 10000 }, rootOverrides),
                          { mp, timers, seekRestoreTimer, resumeTimer, settleTimer, restartTimer });
    return { root, mp, timers, seekRestoreTimer, resumeTimer, settleTimer, restartTimer };
}

/* ===================== règle local / réseau ===================== */

test('règle : tout flux reconstruit par le serveur impose un seek réseau', () => {
    const cases = [
        { isHls: true },
        { lastUsedTranscoding: true },
        { lastUsedDirectStream: true },
        { lastUsedServerRemux: true },
        { serverTimedStream: true },
        { timeShifted: true },
    ];
    for (const flags of cases)
        assert.strictEqual(H.shouldNetworkSeek(flags, MIN_90), true, JSON.stringify(flags));
});

test('règle : un DirectPlay pur de durée connue autorise le seek local', () => {
    assert.strictEqual(H.shouldNetworkSeek({}, MIN_90), false);
});

test('règle : une durée inconnue impose le seek réseau', () => {
    assert.strictEqual(H.shouldNetworkSeek({}, 0), true);
    assert.strictEqual(H.shouldNetworkSeek({}, -1), true);
    assert.strictEqual(H.shouldNetworkSeek(null, MIN_90), true);
});

/* ===================== seek local ===================== */

test('seek local : la cible affichée est convertie en position locale du flux', () => {
    // Flux serveur démarré à 30 min : viser 35 min = seek local à 5 min.
    const ctx = setup({ baseOffsetMs: MIN_30, serverTimedStream: true }, { duration: MIN_90 - MIN_30 });
    const ok = H.localSeekTo(ctx.root, ctx.mp, ctx.timers, MIN_30 + MIN_5, 'test');

    assert.strictEqual(ok, true);
    assert.deepStrictEqual(ctx.root.seeks, [MIN_5]);
    assert.strictEqual(ctx.root.lastUiTargetMs, MIN_30 + MIN_5);
});

test('seek local : jamais de position locale négative', () => {
    // Reculer avant le début du flux serveur : on se colle à son début.
    const ctx = setup({ baseOffsetMs: MIN_30, serverTimedStream: true });
    H.localSeekTo(ctx.root, ctx.mp, ctx.timers, MIN_5, 'test');
    assert.deepStrictEqual(ctx.root.seeks, [0]);
});

test('seek local : jamais au-delà de la fin du média', () => {
    const ctx = setup({}, { duration: MIN_90 });
    H.localSeekTo(ctx.root, ctx.mp, ctx.timers, MIN_90 + MIN_5, 'test');
    // _clampUi borne d'abord à la durée totale, puis mp.duration borne le local.
    assert.deepStrictEqual(ctx.root.seeks, [MIN_90]);
});

test('seek local : cible négative ramenée à zéro', () => {
    const ctx = setup();
    H.localSeekTo(ctx.root, ctx.mp, ctx.timers, -60000, 'test');
    assert.deepStrictEqual(ctx.root.seeks, [0]);
    assert.strictEqual(ctx.root.lastUiTargetMs, 0);
});

test('seek local : un mp.seek() en erreur bascule sur un seek serveur', () => {
    const ctx = setup();
    ctx.root._seekLocalPosition = () => { throw new Error('backend'); };
    const ok = H.localSeekTo(ctx.root, ctx.mp, ctx.timers, MIN_30, 'test');

    assert.strictEqual(ok, false);
    assert.strictEqual(ctx.root.negotiations.length, 1);
    assert.strictEqual(ctx.root.negotiations[0].startMs, MIN_30);
    assert.strictEqual(ctx.root.negotiations[0].extra.forceServerSeek, true);
});

/* ===================== seek réseau ===================== */

test('seek réseau : une seule négociation, à la position demandée, en remux serveur', () => {
    const ctx = setup({ lastUsedServerRemux: true, serverTimedStream: true, baseOffsetMs: MIN_5 },
                      { playbackState: MP.PlayingState });
    H.serverSeekFallback(ctx.root, ctx.mp, ctx.timers, MIN_30, 'test');

    assert.strictEqual(ctx.root.negotiations.length, 1);
    const n = ctx.root.negotiations[0];
    assert.strictEqual(n.startMs, MIN_30);
    assert.strictEqual(n.forceHls, false);
    assert.strictEqual(n.extra.forceServerSeek, true);
    assert.strictEqual(n.extra.forceServerRemux, true);
    assert.strictEqual(ctx.root.lastUiTargetMs, MIN_30);
    assert.deepStrictEqual(ctx.root.scrubPreviews, [MIN_30], 'la barre affiche la cible immédiatement');
    assert.strictEqual(ctx.root._resumeWantedAfterNegotiation, true);
});

test('seek réseau : un transcodage HLS reste en HLS', () => {
    const ctx = setup({ isHls: true, lastUsedTranscoding: true });
    H.serverSeekFallback(ctx.root, ctx.mp, ctx.timers, MIN_30, 'test');

    const n = ctx.root.negotiations[0];
    assert.strictEqual(n.forceHls, true);
    assert.strictEqual(n.extra.forceServerRemux, false);
});

test('seek réseau : la reprise suivra l\'état de lecture d\'avant le seek', () => {
    const paused = setup({}, { playbackState: MP.PausedState });
    H.serverSeekFallback(paused.root, paused.mp, paused.timers, MIN_30, 'test');
    assert.strictEqual(paused.root._resumeWantedAfterNegotiation, false);

    const wasPlaying = setup({ _wasPlayingBeforeSwitch: true }, { playbackState: MP.PausedState });
    H.serverSeekFallback(wasPlaying.root, wasPlaying.mp, wasPlaying.timers, MIN_30, 'test');
    assert.strictEqual(wasPlaying.root._resumeWantedAfterNegotiation, true);
});

test('seek réseau : la cible est bornée par la durée de l\'item', () => {
    const ctx = setup({ lastUsedServerRemux: true });
    H.serverSeekFallback(ctx.root, ctx.mp, ctx.timers, MIN_90 * 2, 'test');
    assert.strictEqual(ctx.root.negotiations[0].startMs, MIN_90);
});

test('seek réseau : un DirectPlay statique non seekable bascule en remux serveur', () => {
    const ctx = setup({ mediaUrl: 'http://jellyfin.test:8096/Videos/x/stream.mkv?static=true' },
                      { seekable: false, playbackState: MP.PlayingState });
    H.serverSeekFallback(ctx.root, ctx.mp, ctx.timers, MIN_30, 'test');

    assert.strictEqual(ctx.root.negotiations.length, 1, 'une seule négociation, pas deux');
    const n = ctx.root.negotiations[0];
    assert.strictEqual(n.extra.staticDirectPlayFallbackOwner, true);
    assert.strictEqual(n.extra.forceServerRemux, true);
    assert.strictEqual(n.startMs, MIN_30);
    assert.strictEqual(ctx.root.manualDirectPlayMode, false);
    // Le fichier est marqué : les seeks suivants ne repasseront plus par lui.
    assert.strictEqual(H.isCurrentItemDirectPlaySeekUnsafe(ctx.root), true);
});

test('secours DirectPlay : un seul basculement à la fois', () => {
    const ctx = setup({
        mediaUrl: 'http://jellyfin.test:8096/Videos/x/stream.mkv?static=true',
        _staticDirectPlaySeekFallbackInProgress: true,
    });
    assert.strictEqual(
        H.fallbackStaticDirectPlayToServerRemux(ctx.root, ctx.mp, ctx.timers, MIN_30, 'test'), true);
    assert.strictEqual(ctx.root.negotiations.length, 0);
});

test('secours DirectPlay : rien ne se déclenche sur un flux qui n\'est pas un DirectPlay statique', () => {
    const ctx = setup({ mediaUrl: 'http://jellyfin.test:8096/Videos/x/stream.mkv' });
    assert.strictEqual(
        H.fallbackStaticDirectPlayToServerRemux(ctx.root, ctx.mp, ctx.timers, MIN_30, 'test'), false);
    assert.strictEqual(ctx.root.negotiations.length, 0);
});

test('garde : un item déjà marqué non seekable refuse le retour au DirectPlay manuel', () => {
    const ctx = setup({
        itemId: 'item-TEST',
        _staticDirectPlaySeekUnsafe: true,
        _staticDirectPlaySeekUnsafeItemId: 'item-TEST',
        manualDirectPlayMode: true,
        mediaUrl: 'http://jellyfin.test:8096/Videos/x/stream.mkv?static=true',
    });
    assert.strictEqual(
        H.guardUnsafeManualDirectPlayRequest(ctx.root, ctx.mp, ctx.timers, MIN_30, 'test'), true);
    assert.strictEqual(ctx.root.manualDirectPlayMode, false);
    assert.strictEqual(ctx.root.lastUiTargetMs, MIN_30);
});

test('garde : le marquage ne suit pas l\'utilisateur sur un autre média', () => {
    const ctx = setup({
        itemId: 'item-AUTRE',
        _staticDirectPlaySeekUnsafe: true,
        _staticDirectPlaySeekUnsafeItemId: 'item-TEST',
    });
    assert.strictEqual(H.isCurrentItemDirectPlaySeekUnsafe(ctx.root), false);
    assert.strictEqual(
        H.guardUnsafeManualDirectPlayRequest(ctx.root, ctx.mp, ctx.timers, MIN_30, 'test'), false);
});

test('garde : sur un flux déjà serveur, aucune renégociation n\'est déclenchée', () => {
    const ctx = setup({
        itemId: 'item-TEST',
        _staticDirectPlaySeekUnsafe: true,
        _staticDirectPlaySeekUnsafeItemId: 'item-TEST',
        lastUsedServerRemux: true,
    });
    assert.strictEqual(
        H.guardUnsafeManualDirectPlayRequest(ctx.root, ctx.mp, ctx.timers, MIN_30, 'test'), true);
    assert.strictEqual(ctx.root.negotiations.length, 0);
});

/* ===================== chapitres ===================== */

test('chapitre : en DirectPlay, saut local immédiat et lecture conservée', () => {
    const ctx = setup({}, { playbackState: MP.PlayingState });
    const ok = H.seekToChapter(ctx.root, ctx.mp, ctx.timers, MIN_30);

    assert.strictEqual(ok, true);
    assert.deepStrictEqual(ctx.root.seeks, [MIN_30]);
    assert.strictEqual(ctx.root.negotiations.length, 0, 'aucun transcodage déclenché');
    assert.strictEqual(ctx.mp.calls[ctx.mp.calls.length - 1], 'play', 'la lecture reprend');
    assert.strictEqual(ctx.root._wasPlayingBeforeSwitch, true);
});

test('chapitre : en DirectPlay depuis une pause, la pause est conservée', () => {
    const ctx = setup({}, { playbackState: MP.PausedState });
    H.seekToChapter(ctx.root, ctx.mp, ctx.timers, MIN_30);
    assert.strictEqual(ctx.mp.calls.indexOf('play'), -1);
    assert.strictEqual(ctx.root._wasPlayingBeforeSwitch, false);
});

test('chapitre : sur flux serveur, mise en pause puis négociation unique', () => {
    const ctx = setup({ lastUsedServerRemux: true, serverTimedStream: true },
                      { playbackState: MP.PlayingState });
    H.seekToChapter(ctx.root, ctx.mp, ctx.timers, MIN_30);

    assert.deepStrictEqual(ctx.root.seeks, [], 'aucun seek local');
    assert.ok(ctx.mp.calls.indexOf('pause') >= 0);
    assert.strictEqual(ctx.root.negotiations.length, 1);
    assert.strictEqual(ctx.root.negotiations[0].startMs, MIN_30);
    assert.strictEqual(ctx.root._resumeWantedAfterNegotiation, true);
});

test('chapitre : pendant un seek déjà en vol, seule la cible est déplacée', () => {
    const ctx = setup({ _pendingSeekMs: MIN_5, lastUsedServerRemux: true });
    const ok = H.seekToChapter(ctx.root, ctx.mp, ctx.timers, MIN_30);

    assert.strictEqual(ok, true);
    assert.strictEqual(ctx.root._pendingSeekMs, MIN_30);
    assert.strictEqual(ctx.root.lastUiTargetMs, MIN_30);
    assert.strictEqual(ctx.root.negotiations.length, 0, 'pas de seconde négociation');
});

test('chapitre : un scrub en cours est abandonné au profit du chapitre', () => {
    const ctx = setup({ scrubActive: true, scrubAccumUiMs: MIN_5, _scrubCommitTargetUiMs: MIN_5 });
    H.seekToChapter(ctx.root, ctx.mp, ctx.timers, MIN_30);

    assert.strictEqual(ctx.root.scrubActive, false);
    assert.strictEqual(ctx.root.scrubAccumUiMs, -1);
    assert.strictEqual(ctx.root._scrubCommitTargetUiMs, -1);
    assert.strictEqual(ctx.timers.scrubCommit.running, false);
});

test('chapitre : la cible est bornée, et refusée pendant la destruction du lecteur', () => {
    const ctx = setup();
    H.seekToChapter(ctx.root, ctx.mp, ctx.timers, MIN_90 * 3);
    assert.deepStrictEqual(ctx.root.seeks, [MIN_90]);

    const dying = setup({ _tearingDownPlayer: true });
    assert.strictEqual(H.seekToChapter(dying.root, dying.mp, dying.timers, MIN_30), false);
    assert.deepStrictEqual(dying.root.seeks, []);
});

/* ===================== cible de secours à l'ouverture ===================== */

test('cible de secours : seek en vol, puis dernière cible, puis position courante', () => {
    assert.strictEqual(
        H.directPlayOpenFallbackTargetMs(setup({ _pendingSeekMs: MIN_30, lastUiTargetMs: MIN_5 }).root),
        MIN_30);
    assert.strictEqual(
        H.directPlayOpenFallbackTargetMs(setup({ _pendingSeekMs: -1, lastUiTargetMs: MIN_5 }).root),
        MIN_5);
    assert.strictEqual(
        H.directPlayOpenFallbackTargetMs(
            setup({ _pendingSeekMs: -1, lastUiTargetMs: 0, baseOffsetMs: MIN_5, serverTimedStream: true },
                  { position: 1000 }).root),
        MIN_5 + 1000);
});

/* ===================== restauration de position après réouverture ===================== */

/*
 * Reproduit exactement ce que fait negotiateAndApply() avant de lancer la
 * boucle : poser la cible PUIS armer la garde sur cette même cible.
 */
function armRestore(ctx, targetUi, trackSwitch) {
    ctx.root._pendingSeekMs = targetUi;
    if (trackSwitch !== false) {
        ctx.root._trackSwitchRebaseActive = true;
        ctx.root._trackSwitchVerificationActive = true;
        ctx.root._trackSwitchRequestedUiMs = targetUi;
    }
    H.resetSeekRestoreGuard(ctx.root, targetUi, trackSwitch === false ? 'boot-seek' : 'track-switch');
    ctx.seekRestoreTimer.running = true;
}

/** Simule un backend qui accepte l'appel mp.seek() mais ne bouge pas. */
function ignoreSeeks(ctx) {
    ctx.root._seekLocalPosition = (localTarget) => { ctx.root.seeks.push(localTarget); };
}

/** Place la boucle juste après une première tentative de seek. */
function afterFirstAttempt(ctx, targetUi) {
    ctx.root._seekRestorePhase = 3;
    ctx.root._seekRestoreAttempts = 1;
    ctx.root._seekRestoreLastTargetMs = targetUi;
}

function tickRestore(ctx) {
    H.tickSeekRestore(ctx.root, ctx.mp, ctx.seekRestoreTimer);
}

test('restauration : sans seek en attente, la boucle s\'arrête', () => {
    const ctx = setup({ _pendingSeekMs: -1 });
    ctx.seekRestoreTimer.running = true;
    tickRestore(ctx);
    assert.strictEqual(ctx.seekRestoreTimer.running, false);
});

test('restauration : rien ne se passe tant que le média n\'est pas prêt', () => {
    const ctx = setup({}, { status: MP.Loading });
    armRestore(ctx, MIN_30);
    tickRestore(ctx);
    assert.deepStrictEqual(ctx.root.seeks, []);
    assert.strictEqual(ctx.root._seekRestorePhase, 0);
});

test('restauration : amorçage, pause, puis seek à la cible exacte', () => {
    const ctx = setup({}, { status: MP.Buffered, playbackState: MP.PausedState, position: 0 });
    armRestore(ctx, MIN_30);

    tickRestore(ctx);                         // phase 0 -> 1 : amorçage
    assert.strictEqual(ctx.root._seekRestorePhase, 1);
    assert.ok(ctx.mp.calls.indexOf('play') >= 0);

    advance(ctx.root.trackSwitchPrimeMinMs + 10);
    ctx.mp.position = 200;
    tickRestore(ctx);                         // phase 1 -> 2 : pause
    assert.strictEqual(ctx.root._seekRestorePhase, 2);
    assert.ok(ctx.mp.calls.indexOf('pause') >= 0);
    assert.deepStrictEqual(ctx.root.seeks, [], 'pas de seek avant la fin du délai de pause');

    advance(ctx.root.trackSwitchPauseGraceMs + 10);
    tickRestore(ctx);                         // phase 3 : seek
    assert.strictEqual(ctx.root._seekRestorePhase, 3);
    assert.deepStrictEqual(ctx.root.seeks, [MIN_30]);
    assert.strictEqual(ctx.root._seekRestoreAttempts, 1);
    assert.strictEqual(ctx.root._seekRestoreAwaitingResult, true);
});

test('restauration : une position atteinte dans la tolérance est acceptée', () => {
    const ctx = setup({}, { status: MP.Buffered, playbackState: MP.PausedState });
    armRestore(ctx, MIN_30);
    afterFirstAttempt(ctx, MIN_30);
    ctx.mp.position = MIN_30 + 100;           // < trackSwitchSeekToleranceMs

    tickRestore(ctx);

    assert.strictEqual(ctx.root._seekRestoreAccepted, true);
    assert.strictEqual(ctx.root._pendingSeekMs, -1);
    assert.strictEqual(ctx.root._trackSwitchVerificationActive, false);
    assert.strictEqual(ctx.root._trackSwitchTimebaseVerified, true);
    assert.strictEqual(ctx.seekRestoreTimer.running, false);
});

test('restauration : une position trop éloignée n\'est pas acceptée', () => {
    const ctx = setup({}, { status: MP.Buffered, playbackState: MP.PausedState });
    armRestore(ctx, MIN_30);
    afterFirstAttempt(ctx, MIN_30);
    ctx.mp.position = MIN_5;

    tickRestore(ctx);

    assert.strictEqual(ctx.root._seekRestoreAccepted, false);
    assert.strictEqual(ctx.root._pendingSeekMs, MIN_30);
});

test('restauration : hors changement de piste, la cible est convertie avec baseOffsetMs', () => {
    // Reprise au démarrage sur un flux serveur : la cible UI 35 min correspond
    // à 5 min de flux quand celui-ci démarre à 30 min.
    const ctx = setup({ baseOffsetMs: MIN_30, serverTimedStream: true },
                      { status: MP.Buffered, playbackState: MP.PausedState, duration: MIN_90 - MIN_30 });
    armRestore(ctx, MIN_30 + MIN_5, false);

    tickRestore(ctx);

    assert.deepStrictEqual(ctx.root.seeks, [MIN_5]);
});

test('restauration : le délai maximum finit toujours par trancher', () => {
    const ctx = setup({}, { status: MP.Buffered, playbackState: MP.PausedState });
    armRestore(ctx, MIN_30);
    afterFirstAttempt(ctx, MIN_30);
    ignoreSeeks(ctx);
    ctx.mp.position = MIN_5;

    tickRestore(ctx);                                  // arme _seekRestoreReadyWallMs
    advance(ctx.root.trackSwitchSeekMaxTotalMs + 1);
    tickRestore(ctx);

    // Escalade : seconde stratégie locale (remux copie Jellyfin), pas de blocage.
    assert.strictEqual(ctx.root._trackSwitchLocalStrategy, 2);
    assert.strictEqual(ctx.root.negotiations.length, 1);
    assert.strictEqual(ctx.root.negotiations[0].extra.forceJellyfinTranscodingUrlCopyRemux, true);
    assert.strictEqual(ctx.root._pendingSeekMs, -1);
});

test('restauration : un HEVC 10 bits en MKV n\'est tenté qu\'une fois puis abandonné', () => {
    const ctx = setup({
        _trackSwitchSourceHevc10: true,
        _trackSwitchLocalStrategy: 2,
    }, { status: MP.Buffered, playbackState: MP.PausedState });
    armRestore(ctx, MIN_30);
    ctx.root._trackSwitchSourceHevc10 = true;
    ctx.root._trackSwitchLocalStrategy = 2;
    ctx.root._trackSwitchWasPlaying = true;
    afterFirstAttempt(ctx, MIN_30);
    ignoreSeeks(ctx);
    ctx.mp.position = MIN_5;

    assert.strictEqual(H.seekRestoreAttemptLimit(ctx.root), 1);
    tickRestore(ctx);
    advance(ctx.root.trackSwitchSeekHevcMaxTotalMs + 1);
    tickRestore(ctx);

    // Echec assumé : la timeline repart de zéro et la lecture est relancée.
    assert.strictEqual(ctx.root._pendingSeekMs, -1);
    assert.strictEqual(ctx.root.baseOffsetMs, 0);
    assert.strictEqual(ctx.root._trackSwitchVerificationActive, false);
    assert.strictEqual(ctx.restartTimer.running, true);
});

test('restauration : une cible déplacée en cours de route est simplement reciblée', () => {
    const ctx = setup({}, { status: MP.Buffered, playbackState: MP.PausedState });
    armRestore(ctx, MIN_5);
    afterFirstAttempt(ctx, MIN_5);
    ignoreSeeks(ctx);
    tickRestore(ctx);

    // L'utilisateur déplace la cible pendant la restauration.
    ctx.root._pendingSeekMs = MIN_30;
    ctx.root.seeks.length = 0;
    tickRestore(ctx);

    assert.strictEqual(ctx.root._seekRestoreLastTargetMs, MIN_30);
    assert.strictEqual(ctx.root.negotiations.length, 0, 'aucune renégociation déclenchée');
    assert.strictEqual(ctx.root._pendingSeekMs, MIN_30, 'la cible reste à atteindre');
});

test('restauration : la cible déplacée réarme l\'échéance et oublie l\'ancien échantillon', () => {
    // Le meilleur échantillon a été mesuré sur l'ancienne cible : le garder
    // ferait accepter une position qui n'a plus rien à voir avec la nouvelle.
    const ctx = setup({}, { status: MP.Buffered, playbackState: MP.PausedState });
    armRestore(ctx, MIN_5);
    afterFirstAttempt(ctx, MIN_5);
    ignoreSeeks(ctx);
    ctx.mp.position = MIN_5;                  // pile sur l'ancienne cible
    tickRestore(ctx);
    assert.strictEqual(ctx.root._seekRestoreAccepted, true, 'ancienne cible atteinte');

    const ctx2 = setup({}, { status: MP.Buffered, playbackState: MP.PausedState });
    armRestore(ctx2, MIN_5);
    afterFirstAttempt(ctx2, MIN_5);
    ignoreSeeks(ctx2);
    ctx2.mp.position = MIN_5;
    ctx2.root._seekRestoreBestDiffMs = 0;     // mémoire de l'ancienne cible
    ctx2.root._seekRestoreBestLocalMs = MIN_5;
    advance(ctx2.root.trackSwitchSeekMaxTotalMs - 100);
    ctx2.root._pendingSeekMs = MIN_30;
    tickRestore(ctx2);

    assert.strictEqual(ctx2.root._seekRestoreAccepted, false, 'la nouvelle cible n\'est pas atteinte');
    assert.strictEqual(ctx2.root._seekRestoreBestLocalMs, MIN_5, 'échantillon remesuré sur la nouvelle cible');
    assert.strictEqual(ctx2.root._seekRestoreBestDiffMs, MIN_30 - MIN_5);
    // L'échéance repart de la nouvelle cible : pas d'escalade immédiate.
    assert.strictEqual(ctx2.root.negotiations.length, 0);
    assert.deepStrictEqual(ctx2.root.seeks, [MIN_30], 'seek vers la nouvelle cible');
});

test('restauration : une cible qui bouge sans cesse finit par escalader', () => {
    // Borne globale : le recentrage réarme l'échéance, mais pas le compteur de
    // tentatives. Sans cela la boucle tournerait indéfiniment.
    const ctx = setup({}, { status: MP.Buffered, playbackState: MP.PausedState });
    armRestore(ctx, MIN_5);
    afterFirstAttempt(ctx, MIN_5);
    ignoreSeeks(ctx);

    let target = MIN_5;
    for (let i = 0; i < 50 && ctx.root.negotiations.length === 0; i++) {
        target += 60000;
        ctx.root._pendingSeekMs = target;
        advance(ctx.root.trackSwitchSeekRetryDelayMs + 10);
        tickRestore(ctx);
    }

    assert.strictEqual(ctx.root.negotiations.length, 1, 'la boucle ne tourne pas indéfiniment');
    assert.strictEqual(ctx.root.negotiations[0].extra.forceJellyfinTranscodingUrlCopyRemux, true);
    assert.ok(ctx.root.seeks.length <= ctx.root.trackSwitchSeekMaxAttempts,
              'jamais plus de tentatives que le budget: ' + ctx.root.seeks.length);
});

test('restauration : une cible stable garde son échéance d\'origine', () => {
    // Non-régression du voisin : sans déplacement de cible, le délai maximum
    // court toujours depuis la première passe et finit par trancher.
    const ctx = setup({}, { status: MP.Buffered, playbackState: MP.PausedState });
    armRestore(ctx, MIN_30);
    afterFirstAttempt(ctx, MIN_30);
    ignoreSeeks(ctx);
    ctx.mp.position = MIN_5;

    tickRestore(ctx);
    const armedAt = ctx.root._seekRestoreReadyWallMs;
    advance(100);
    tickRestore(ctx);
    assert.strictEqual(ctx.root._seekRestoreReadyWallMs, armedAt, 'échéance non réarmée');
});

test('restauration : la validation est idempotente et remet la timeline à plat', () => {
    const ctx = setup({
        _trackSwitchRebaseActive: true,
        _trackSwitchVerificationActive: true,
        _pendingSeekMs: MIN_30,
        baseOffsetMs: MIN_30,
        _wasPlayingBeforeSwitch: false,
    });

    H.completeSeekRestoreVerified(ctx.root, ctx.seekRestoreTimer, ctx.resumeTimer, MIN_30);
    assert.strictEqual(ctx.root._seekRestoreAccepted, true);
    assert.strictEqual(ctx.root.baseOffsetMs, 0, 'la position locale redevient la position réelle');
    assert.strictEqual(ctx.root._pendingSeekMs, -1);

    const releasedOnce = ctx.root.released.length;
    H.completeSeekRestoreVerified(ctx.root, ctx.seekRestoreTimer, ctx.resumeTimer, MIN_30);
    assert.strictEqual(ctx.root.released.length, releasedOnce, 'second appel sans effet');
});
