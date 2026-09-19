'use strict';

/*
 * Machine à états du « hard source reset ».
 *
 * Quand un flux doit être rouvert (changement de piste, de qualité, seek
 * réseau), le backend intelce de la Révolution ne supporte pas qu'on réassigne
 * la source dans le même tour d'événement : il faut arrêter, attendre NoMedia,
 * puis assigner la nouvelle URL. beginHardSourceReset / tickSourceReset /
 * completeFresh…() implémentent cette séquence en trois phases, avec des
 * délais d'attente et un unique réessai de play().
 *
 * C'est une machine fragile et strictement séquentielle : si elle reste
 * coincée en phase 1 ou 2, le lecteur affiche un spinner sur un écran noir
 * sans aucun moyen d'en sortir ; si elle oublie baseOffsetMs, toute la
 * timeline (et la reprise écrite sur le serveur) devient fausse ; si elle
 * inverse la reprise, la lecture repart alors que l'utilisateur avait mis en
 * pause. Ces tests figent les phases, leurs sorties, les délais et l'état
 * de lecture restauré.
 */

const test = require('node:test');
const assert = require('node:assert');

const { H, MP, clock, setNow, advance, makeTimer, makeTimers, makeMediaPlayer, makeRoot } =
    require('./playerharness');

const MIN_30 = 30 * 60 * 1000;

function setup(rootOverrides, mpOverrides) {
    setNow(1700000000000);
    const mp = makeMediaPlayer(mpOverrides);
    const timers = makeTimers();
    const sourceResetTimer = makeTimer('sourceReset');
    const subtitleItem = { gateArmed: false, cues: [], enabled: false, uiMs: 0 };
    const root = makeRoot(rootOverrides, { mp, timers, sourceResetTimer, subtitleItem });
    return { root, mp, timers, sourceResetTimer, subtitleItem };
}

function begin(ctx, url, shouldResume) {
    H.beginHardSourceReset(ctx.root, ctx.mp, ctx.sourceResetTimer, ctx.timers.audioGate,
                           ctx.timers.startup, ctx.subtitleItem, url, shouldResume);
}

function tick(ctx) {
    H.tickSourceReset(ctx.root, ctx.mp, ctx.sourceResetTimer, ctx.timers.seekRestore, ctx.subtitleItem);
}

/** Le MediaPlayer a fini de détruire l'ancien pipeline. */
function pipelineCleared(mp) {
    mp.playbackState = MP.StoppedState;
    mp.status = MP.NoMedia;
    mp.position = 0;
}

/** Le nouveau pipeline est prêt et avance. */
function pipelineReady(mp, localMs) {
    mp.status = MP.Buffered;
    mp.playbackState = MP.PlayingState;
    mp.position = localMs;
}

/* ===================== phase 1 : destruction du pipeline ===================== */

test('début : la gate est armée, la source vidée et la machine passe en phase 1', () => {
    const ctx = setup({ _pendingHardResetBaseMs: MIN_30, baseOffsetMs: 12345, mediaUrl: 'http://old' });
    begin(ctx, 'http://jellyfin.test:8096/Videos/x/stream.mkv?static=false', true);

    assert.strictEqual(ctx.root._sourceResetActive, true);
    assert.strictEqual(ctx.root._sourceResetPhase, 1);
    assert.strictEqual(ctx.root._sourceResetMode, 'server-timed');
    assert.strictEqual(ctx.root._sourceResetShouldResume, true);
    assert.strictEqual(ctx.root._sourceResetExpectedUiMs, MIN_30);
    // La timeline repart de zéro tant que la nouvelle base n'est pas appliquée.
    assert.strictEqual(ctx.root.baseOffsetMs, 0);
    assert.strictEqual(ctx.root._trackSwitchTimebaseVerified, false);
    assert.strictEqual(ctx.root.mediaUrl, '');
    assert.deepStrictEqual(ctx.root.sources.map((s) => s.url), ['']);
    assert.ok(ctx.mp.calls.indexOf('stop') >= 0);
    assert.strictEqual(ctx.sourceResetTimer.running, true);
    assert.strictEqual(ctx.root.videoLoadingGate, true);
    assert.strictEqual(ctx.subtitleItem.gateArmed, true);
    assert.strictEqual(ctx.timers.startup.running, false);
    assert.strictEqual(ctx.timers.audioGate.running, false);
});

test('début : la base de reprise vient de _pendingHardResetBaseMs, sinon de _pendingServerTimedBaseMs', () => {
    const a = setup({ _pendingHardResetBaseMs: MIN_30, _pendingServerTimedBaseMs: 1000 });
    begin(a, 'http://srv/s', false);
    assert.strictEqual(a.root._sourceResetExpectedUiMs, MIN_30);

    const b = setup({ _pendingHardResetBaseMs: -1, _pendingServerTimedBaseMs: MIN_30 });
    begin(b, 'http://srv/s', false);
    assert.strictEqual(b.root._sourceResetExpectedUiMs, MIN_30);

    const c = setup({ _pendingHardResetBaseMs: -1, _pendingServerTimedBaseMs: -1 });
    begin(c, 'http://srv/s', false);
    assert.strictEqual(c.root._sourceResetExpectedUiMs, 0, 'jamais négatif');
});

test('début : chaque reset produit une URL unique pour forcer une vraie réouverture', () => {
    const ctx = setup({ _pendingHardResetBaseMs: 0 });
    begin(ctx, 'http://jellyfin.test:8096/Videos/x/stream.mkv?static=false', false);
    const first = ctx.root._sourceResetPendingUrl;
    begin(ctx, 'http://jellyfin.test:8096/Videos/x/stream.mkv?static=false', false);
    const second = ctx.root._sourceResetPendingUrl;

    assert.ok(/[?&]RdfSourceRevision=/.test(first), first);
    assert.notStrictEqual(first, second, 'deux resets successifs ne réutilisent pas la même URL');
    assert.strictEqual(ctx.root._sourceResetPhase, 1, 'le second reset repart de la phase 1');
});

test('phase 1 : on attend la destruction réelle du pipeline avant d\'assigner la source', () => {
    const ctx = setup({ _pendingHardResetBaseMs: MIN_30 }, { status: MP.Buffered, playbackState: MP.PlayingState });
    begin(ctx, 'http://srv/stream', true);
    ctx.mp.status = MP.Loaded;       // pas encore NoMedia
    ctx.mp.playbackState = MP.StoppedState;

    advance(100);
    tick(ctx);
    assert.strictEqual(ctx.root._sourceResetPhase, 1, 'toujours en attente');
    assert.strictEqual(ctx.root.sources.length, 1, 'aucune nouvelle source assignée');

    pipelineCleared(ctx.mp);
    advance(50);
    tick(ctx);
    assert.strictEqual(ctx.root._sourceResetPhase, 2);
});

test('phase 1 : un pipeline qui ne se libère jamais ne bloque pas la machine', () => {
    // Sans ce délai de garde, un backend qui ne repasse pas NoMedia gèlerait
    // le lecteur avec un spinner définitif.
    const ctx = setup({ _pendingHardResetBaseMs: MIN_30 }, { status: MP.Loaded, playbackState: MP.PlayingState });
    begin(ctx, 'http://srv/stream', true);

    advance(ctx.root.sourceResetClearTimeoutMs - 1);
    tick(ctx);
    assert.strictEqual(ctx.root._sourceResetPhase, 1);

    advance(2);
    tick(ctx);
    assert.strictEqual(ctx.root._sourceResetPhase, 2, 'la phase 2 est forcée au bout du délai de garde');
});

/* ===================== phase 2 : nouvelle source ===================== */

test('phase 2 : la base temporelle serveur est appliquée avec la nouvelle URL', () => {
    const ctx = setup({ _pendingHardResetBaseMs: MIN_30 });
    begin(ctx, 'http://srv/stream', true);
    pipelineCleared(ctx.mp);
    advance(20);
    tick(ctx);

    assert.strictEqual(ctx.root.baseOffsetMs, MIN_30);
    assert.strictEqual(ctx.root.serverTimedStream, true);
    assert.strictEqual(ctx.root.timeShifted, true);
    assert.strictEqual(ctx.root.mediaUrl, ctx.root._sourceResetPendingUrl);
    assert.strictEqual(ctx.root.sources[ctx.root.sources.length - 1].url, ctx.root._sourceResetPendingUrl);
    assert.strictEqual(ctx.root._pendingHardResetBaseMs, -1, 'la base en attente est consommée');
    assert.strictEqual(ctx.root._pendingServerTimedBaseMs, -1);
    assert.ok(ctx.mp.calls.indexOf('play') >= 0);
});

test('phase 2 : un reset à la position zéro n\'est pas marqué « time shifted »', () => {
    const ctx = setup({ _pendingHardResetBaseMs: 0 });
    begin(ctx, 'http://srv/stream', true);
    pipelineCleared(ctx.mp);
    tick(ctx);

    assert.strictEqual(ctx.root.baseOffsetMs, 0);
    assert.strictEqual(ctx.root.serverTimedStream, true);
    assert.strictEqual(ctx.root.timeShifted, false);
});

test('phase 2 : le reset se termine dès que le nouveau pipeline progresse', () => {
    const ctx = setup({ _pendingHardResetBaseMs: MIN_30 });
    begin(ctx, 'http://srv/stream', true);
    pipelineCleared(ctx.mp);
    tick(ctx);

    pipelineReady(ctx.mp, 400);
    advance(300);
    tick(ctx);

    assert.strictEqual(ctx.root._sourceResetActive, false);
    assert.strictEqual(ctx.root._sourceResetPhase, 0);
    assert.strictEqual(ctx.root._sourceResetMode, '');
    assert.strictEqual(ctx.root.baseOffsetMs, MIN_30, 'la base survit à la fin du reset');
    assert.strictEqual(ctx.root._trackSwitchTimebaseVerified, true);
    assert.strictEqual(ctx.sourceResetTimer.running, false);
    assert.strictEqual(ctx.root._gateArmed, false);
    assert.strictEqual(ctx.subtitleItem.gateArmed, false);
    assert.ok(ctx.root.scheduled.indexOf('fresh-source-reset-complete') >= 0);
});

test('phase 2 : un pipeline prêt mais arrêté reçoit UN seul réessai de play()', () => {
    const ctx = setup({ _pendingHardResetBaseMs: MIN_30 });
    begin(ctx, 'http://srv/stream', true);
    pipelineCleared(ctx.mp);
    tick(ctx);

    ctx.mp.calls.length = 0;
    ctx.mp.status = MP.Loaded;
    ctx.mp.playbackState = MP.StoppedState;
    ctx.mp.position = 0;

    advance(ctx.root.sourceResetStartRetryMs + 10);
    tick(ctx);
    assert.deepStrictEqual(ctx.mp.calls, ['play']);
    assert.strictEqual(ctx.root._sourceResetPlayRetries, 1);

    ctx.mp.playbackState = MP.StoppedState;
    advance(100);
    tick(ctx);
    assert.deepStrictEqual(ctx.mp.calls, ['play'], 'pas de martèlement de play()');
});

test('phase 2 : un pipeline qui ne démarre jamais finit en timeout, gate libérée', () => {
    const ctx = setup({ _pendingHardResetBaseMs: MIN_30 });
    begin(ctx, 'http://srv/stream', true);
    pipelineCleared(ctx.mp);
    tick(ctx);

    // Média invalide : jamais Loaded/Buffered, jamais de progression.
    ctx.mp.status = MP.InvalidMedia;
    ctx.mp.playbackState = MP.StoppedState;
    ctx.mp.error = 2;

    advance(ctx.root.sourceResetStartTimeoutMs - 1);
    tick(ctx);
    assert.strictEqual(ctx.root._sourceResetActive, true);

    advance(2);
    tick(ctx);
    assert.strictEqual(ctx.root._sourceResetActive, false, 'la machine ne reste jamais coincée');
    assert.strictEqual(ctx.sourceResetTimer.running, false);
    assert.ok(ctx.root.released.indexOf('fresh-source-reset-timeout') >= 0,
              'le spinner est retiré même sur échec');
});

test('la boucle s\'arrête d\'elle-même quand plus aucun reset n\'est actif', () => {
    const ctx = setup();
    ctx.sourceResetTimer.running = true;
    tick(ctx);
    assert.strictEqual(ctx.sourceResetTimer.running, false);
});

/* ===================== état de lecture restauré ===================== */

test('fin de reset : la lecture reprend si et seulement si elle jouait avant', () => {
    const playing = setup({ _pendingHardResetBaseMs: MIN_30 });
    begin(playing, 'http://srv/stream', true);
    pipelineCleared(playing.mp);
    tick(playing);
    playing.mp.calls.length = 0;
    playing.mp.playbackState = MP.PausedState;
    pipelineReady(playing.mp, 300);
    playing.mp.playbackState = MP.PausedState;
    tick(playing);
    assert.deepStrictEqual(playing.mp.calls, ['play']);

    const paused = setup({ _pendingHardResetBaseMs: MIN_30 });
    begin(paused, 'http://srv/stream', false);
    pipelineCleared(paused.mp);
    tick(paused);
    paused.mp.calls.length = 0;
    pipelineReady(paused.mp, 300);
    tick(paused);
    assert.deepStrictEqual(paused.mp.calls, ['pause']);
    assert.ok(paused.root.released.indexOf('fresh-source-ready-paused') >= 0,
              'une fin en pause doit libérer la gate explicitement');
});

test('la fin de reset serveur est refusée hors phase 2 (pas de sortie prématurée)', () => {
    const ctx = setup({ _pendingHardResetBaseMs: MIN_30 });
    begin(ctx, 'http://srv/stream', true);
    assert.strictEqual(ctx.root._sourceResetPhase, 1);

    H.completeFreshServerTimedSource(ctx.root, ctx.mp, ctx.sourceResetTimer, ctx.subtitleItem);

    assert.strictEqual(ctx.root._sourceResetActive, true, 'toujours en cours');
    assert.strictEqual(ctx.root.baseOffsetMs, 0, 'la base n\'est pas appliquée trop tôt');
});

/* ===================== annulation ===================== */

test('annulation : tout l\'état du reset est effacé et le timer arrêté', () => {
    const ctx = setup({ _pendingHardResetBaseMs: MIN_30 });
    begin(ctx, 'http://srv/stream', true);

    H.cancelHardSourceReset(ctx.root, ctx.sourceResetTimer);

    assert.strictEqual(ctx.root._sourceResetActive, false);
    assert.strictEqual(ctx.root._sourceResetPhase, 0);
    assert.strictEqual(ctx.root._sourceResetMode, '');
    assert.strictEqual(ctx.root._sourceResetPendingUrl, '');
    assert.strictEqual(ctx.root._sourceResetShouldResume, false);
    assert.strictEqual(ctx.root._sourceResetExpectedUiMs, -1);
    assert.strictEqual(ctx.root._sourceResetPlayRetries, 0);
    assert.strictEqual(ctx.root._pendingHardResetBaseMs, -1);
    assert.strictEqual(ctx.sourceResetTimer.running, false);
});

test('annulation : sans reset en cours, le timer n\'est pas touché', () => {
    const ctx = setup();
    ctx.sourceResetTimer.running = true;
    H.cancelHardSourceReset(ctx.root, ctx.sourceResetTimer);
    assert.strictEqual(ctx.sourceResetTimer.running, true);
});

/* ===================== variante DirectPlay statique ===================== */

test('DirectPlay : l\'URL statique négociée est conservée telle quelle', () => {
    const ctx = setup({ baseOffsetMs: MIN_30, serverTimedStream: true, timeShifted: true });
    const url = 'http://jellyfin.test:8096/Videos/x/stream.mkv?static=true';
    H.beginFreshDirectPlayReset(ctx.root, ctx.mp, ctx.sourceResetTimer, ctx.timers.audioGate,
                                ctx.timers.startup, ctx.subtitleItem, url, true, MIN_30);

    assert.strictEqual(ctx.root._sourceResetMode, 'directplay-local');
    assert.strictEqual(ctx.root._sourceResetPendingUrl, url, 'aucun paramètre de révision ajouté');
    assert.strictEqual(ctx.root._sourceResetExpectedUiMs, MIN_30);
    // Un DirectPlay natif n'a plus aucune base temporelle serveur.
    assert.strictEqual(ctx.root.baseOffsetMs, 0);
    assert.strictEqual(ctx.root.serverTimedStream, false);
    assert.strictEqual(ctx.root.timeShifted, false);
});

test('DirectPlay : la phase 2 ne réintroduit jamais de base temporelle serveur', () => {
    const ctx = setup();
    H.beginFreshDirectPlayReset(ctx.root, ctx.mp, ctx.sourceResetTimer, ctx.timers.audioGate,
                                ctx.timers.startup, ctx.subtitleItem,
                                'http://srv/Videos/x/stream.mkv?static=true', true, MIN_30);
    pipelineCleared(ctx.mp);
    tick(ctx);

    assert.strictEqual(ctx.root._sourceResetPhase, 2);
    assert.strictEqual(ctx.root.baseOffsetMs, 0);
    assert.strictEqual(ctx.root.serverTimedStream, false);
});

test('DirectPlay : un seek de restauration en attente relance la vérification', () => {
    const ctx = setup({ _pendingSeekMs: MIN_30 });
    H.beginFreshDirectPlayReset(ctx.root, ctx.mp, ctx.sourceResetTimer, ctx.timers.audioGate,
                                ctx.timers.startup, ctx.subtitleItem,
                                'http://srv/Videos/x/stream.mkv?static=true', true, MIN_30);
    pipelineCleared(ctx.mp);
    tick(ctx);
    pipelineReady(ctx.mp, 120);
    tick(ctx);

    assert.strictEqual(ctx.root._sourceResetActive, false);
    assert.strictEqual(ctx.root._pendingSeekMs, MIN_30, 'le seek reste à faire');
    assert.strictEqual(ctx.timers.seekRestore.running, true);
    assert.strictEqual(ctx.root._seekRestorePhase, 0, 'le protocole de seek repart à zéro');
    assert.strictEqual(ctx.root.scheduled.length, 0,
                       'la gate reste tenue jusqu\'à la restauration du seek');
});

test('DirectPlay : sans seek en attente, la timeline est déclarée vérifiée', () => {
    const ctx = setup({ _pendingSeekMs: -1 });
    H.beginFreshDirectPlayReset(ctx.root, ctx.mp, ctx.sourceResetTimer, ctx.timers.audioGate,
                                ctx.timers.startup, ctx.subtitleItem,
                                'http://srv/Videos/x/stream.mkv?static=true', false, 0);
    pipelineCleared(ctx.mp);
    tick(ctx);
    ctx.mp.calls.length = 0;
    pipelineReady(ctx.mp, 120);
    tick(ctx);

    assert.strictEqual(ctx.root._trackSwitchTimebaseVerified, true);
    assert.ok(ctx.root.scheduled.indexOf('fresh-directplay-reset-complete') >= 0);
    assert.ok(ctx.root.released.indexOf('fresh-directplay-ready-paused') >= 0);
});

test('DirectPlay : un timeout ne transforme pas le DirectPlay en flux serveur', () => {
    const ctx = setup();
    H.beginFreshDirectPlayReset(ctx.root, ctx.mp, ctx.sourceResetTimer, ctx.timers.audioGate,
                                ctx.timers.startup, ctx.subtitleItem,
                                'http://srv/Videos/x/stream.mkv?static=true', true, MIN_30);
    pipelineCleared(ctx.mp);
    tick(ctx);

    ctx.mp.status = MP.Stalled;
    ctx.mp.playbackState = MP.StoppedState;
    advance(ctx.root.sourceResetStartTimeoutMs + 1);
    tick(ctx);

    assert.strictEqual(ctx.root._sourceResetActive, false);
    assert.strictEqual(ctx.root.serverTimedStream, false);
    assert.strictEqual(ctx.root.timeShifted, false);
    assert.strictEqual(ctx.root.baseOffsetMs, 0);
});

test('DirectPlay : la fin de reset est refusée si le mode courant n\'est pas DirectPlay', () => {
    const ctx = setup({ _pendingHardResetBaseMs: MIN_30 });
    begin(ctx, 'http://srv/stream', true);   // mode server-timed
    H.completeFreshDirectPlaySource(ctx.root, ctx.mp, ctx.sourceResetTimer,
                                    ctx.timers.seekRestore, ctx.subtitleItem);
    assert.strictEqual(ctx.root._sourceResetActive, true);
    assert.strictEqual(ctx.root._sourceResetMode, 'server-timed');
});
