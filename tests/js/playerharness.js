'use strict';

/*
 * Harnais commun aux tests player*.test.js.
 *
 * playeroverlay.qml ne peut pas être instancié localement (QtMultimedia
 * absent) : tout ce qui est testable du lecteur vit dans
 * qml/js/playerOverlayHelper.js et dans les fonctions « player* » de
 * qml/js/JellyfinPlaybackRouter.js. Ces modules pilotent un objet `root`
 * (le FocusScope QML) et un objet `mp` (MediaPlayer). Ce fichier fournit
 * des doubles fidèles de ces deux objets :
 *
 *   - makeMediaPlayer() : position/duration/status/playbackState + journal
 *     des appels play/pause/stop/seek ;
 *   - makeTimer()       : Timer QML modélisé en objet simple (running,
 *     start/stop/restart, ticks) — les tests avancent l'horloge à la main ;
 *   - makeRoot()        : l'état du lecteur et les façades `_xxx()` que
 *     playeroverlay.qml expose au helper, recopiées à l'identique depuis le
 *     QML, plus des journaux d'observation (négociations, seeks, sources,
 *     libérations du loader).
 *
 * L'horloge est figée : `clock.now` est injecté à la fois dans Date.now()
 * (vu par _poNowMs() du helper) et dans root._nowMs().
 */

const { loadQmlJs } = require('./qmljs');

/* Codes Qt 5.15 réellement utilisés par playeroverlay.qml (cf. CLAUDE.md). */
const MP = {
    StoppedState: 0,
    PlayingState: 1,
    PausedState: 2,

    NoMedia: 1,
    Loading: 2,
    Loaded: 3,
    Stalled: 4,
    Buffering: 5,
    Buffered: 6,
    EndOfMedia: 7,
    InvalidMedia: 8,
};

/* Horloge murale partagée par Date.now() et root._nowMs(). */
const clock = { now: 1700000000000 };

function setNow(ms) { clock.now = ms; return clock.now; }
function advance(ms) { clock.now += ms; return clock.now; }

const RealDate = Date;
const FrozenDate = function (...args) { return new RealDate(...args); };
FrozenDate.now = () => clock.now;
FrozenDate.parse = RealDate.parse;
FrozenDate.UTC = RealDate.UTC;
FrozenDate.prototype = RealDate.prototype;

const STUBS = { Date: FrozenDate };

/** Helper et routeur chargés une seule fois, horloge figée incluse. */
const H = loadQmlJs('qml/js/playerOverlayHelper.js', { stubs: STUBS });
const JF = loadQmlJs('qml/js/JellyfinPlaybackRouter.js', { stubs: STUBS });

/** Timer QML simplifié : les tests décident quand il « sonne ». */
function makeTimer(name) {
    return {
        name: name || 'timer',
        running: false,
        interval: 0,
        starts: 0,
        stops: 0,
        start() { this.running = true; this.starts++; },
        restart() { this.running = true; this.starts++; },
        stop() { this.running = false; this.stops++; },
    };
}

function makeTimers() {
    return {
        startup: makeTimer('startup'),
        audioGate: makeTimer('audioGate'),
        seekRestore: makeTimer('seekRestore'),
        scrubCommit: makeTimer('scrubCommit'),
        frozenWatch: makeTimer('frozenWatch'),
        mediaGuard: makeTimer('mediaGuard'),
    };
}

/** MediaPlayer QtMultimedia simplifié. */
function makeMediaPlayer(overrides) {
    const mp = {
        position: 0,
        duration: 0,
        status: MP.Buffered,
        playbackState: MP.StoppedState,
        source: '',
        seekable: true,
        error: 0,
        errorString: '',
        calls: [],
        play() { this.calls.push('play'); this.playbackState = MP.PlayingState; },
        pause() { this.calls.push('pause'); this.playbackState = MP.PausedState; },
        stop() { this.calls.push('stop'); this.playbackState = MP.StoppedState; this.position = 0; },
        seek(ms) { this.calls.push('seek:' + ms); this.position = ms; },
    };
    return Object.assign(mp, overrides || {});
}

/**
 * Double de l'objet root de playeroverlay.qml.
 *
 * Les façades reproduisent EXACTEMENT celles du QML (mêmes arguments passés
 * au helper) afin qu'une régression dans le helper se voie ici comme sur le
 * boîtier. Les journaux (negotiations, seeks, sources, released…) permettent
 * d'observer ce que le lecteur ferait réellement.
 */
function makeRoot(overrides, deps) {
    const d = deps || {};
    const mp = d.mp || makeMediaPlayer();
    const timers = d.timers || makeTimers();
    const subtitleItem = d.subtitleItem || null;

    const root = {
        /* --- constantes MediaPlayer recopiées dans le QML --- */
        _mpStoppedState: MP.StoppedState,
        _mpPlayingState: MP.PlayingState,
        _mpPausedState: MP.PausedState,
        _mpNoMedia: MP.NoMedia,
        _mpLoading: MP.Loading,
        _mpLoaded: MP.Loaded,
        _mpStalled: MP.Stalled,
        _mpBuffered: MP.Buffered,

        /* --- contexte serveur --- */
        serverUrl: 'http://jellyfin.test:8096',
        accessToken: 'tok-TEST',
        userId: 'user-TEST',
        itemId: 'item-TEST',
        currentMediaSourceId: 'src-TEST',
        playSessionId: 'sess-TEST',
        scrobbleEnabled: true,
        serverPrerollBlocking: false,

        /* --- mode de lecture courant --- */
        mediaUrl: '',
        isHls: false,
        lastUsedTranscoding: false,
        lastUsedDirectStream: false,
        lastUsedServerRemux: false,
        serverTimedStream: false,
        timeShifted: false,
        baseOffsetMs: 0,
        runtimeTicks: 0,
        manualDirectPlayMode: false,
        manualRemuxMode: false,
        manualQualityBitrate: 0,
        currentPlaybackVideoTranscodeByPolicy: false,
        coalescedDirectPlaySeekMode: false,

        /* --- position / scrub --- */
        lastUiTargetMs: 0,
        scrubActive: false,
        scrubAccumUiMs: -1,
        _scrubCommitTargetUiMs: -1,
        _pendingSeekMs: -1,
        _lastPersistableUiMs: 0,
        _finalExitPositionMs: -1,
        _playbackExitInProgress: false,
        _tearingDownPlayer: false,

        /* --- reset dur de source --- */
        _sourceResetActive: false,
        _sourceResetPhase: 0,
        _sourceResetMode: '',
        _sourceResetPendingUrl: '',
        _sourceResetShouldResume: false,
        _sourceResetExpectedUiMs: -1,
        _sourceResetStartedWallMs: 0,
        _sourceResetAssignedWallMs: 0,
        _sourceResetReadyWallMs: 0,
        _sourceResetPlayRetries: 0,
        _sourceResetRevision: 0,
        _pendingServerTimedBaseMs: -1,
        _pendingHardResetBaseMs: -1,
        sourceResetPollMs: 50,
        sourceResetClearTimeoutMs: 900,
        sourceResetStartRetryMs: 1400,
        sourceResetStartTimeoutMs: 6500,

        /* --- rebase de changement de piste / restauration de seek --- */
        _trackSwitchRebaseActive: false,
        _trackSwitchRebaseSeq: 0,
        _trackSwitchAnchorUiMs: 0,
        _trackSwitchAnchorWallMs: 0,
        _trackSwitchWasPlaying: false,
        _trackSwitchSettleTicks: 0,
        _trackSwitchForceLocalSeek: false,
        _trackSwitchLocalSeekMs: 0,
        _trackSwitchRequestedUiMs: 0,
        _trackSwitchVerificationActive: false,
        _trackSwitchTimebaseVerified: false,
        _trackSwitchLocalStrategy: 1,
        _trackSwitchSourceVideoCodec: '',
        _trackSwitchSourceContainer: '',
        _trackSwitchSourceHevc10: false,
        _trackSwitchRestartAfterFailure: false,
        _trackSwitchResumeAfterVerified: false,
        _wasPlayingBeforeSwitch: false,
        _resumeWantedAfterNegotiation: false,
        _forceResumeAfterDeferredReload: false,
        trackSwitchSeekMaxAttempts: 6,
        trackSwitchSeekMaxTotalMs: 4200,
        trackSwitchSeekHevcMaxTotalMs: 1500,
        trackSwitchSeekToleranceMs: 220,
        trackSwitchSeekRetryDelayMs: 160,
        trackSwitchPrimeMinMs: 120,
        trackSwitchPauseGraceMs: 90,
        seekRestoreBootToleranceMs: 1500,
        _seekRestoreAttempts: 0,
        _seekRestoreHlsFallbackTried: false,
        _seekRestoreLastTargetMs: -1,
        _seekRestoreLastCallWallMs: 0,
        _seekRestoreAwaitingResult: false,
        _seekRestoreStableSamples: 0,
        _seekRestoreBestDiffMs: 2147483647,
        _seekRestoreBestLocalMs: -1,
        _seekRestoreAccepted: false,
        _seekRestoreReadyWallMs: 0,
        _seekRestorePrimeWallMs: 0,
        _seekRestorePauseWallMs: 0,
        _seekRestorePhase: 0,

        /* --- DirectPlay statique / secours --- */
        _staticDirectPlaySeekUnsafe: false,
        _staticDirectPlaySeekUnsafeItemId: '',
        _staticDirectPlaySeekFallbackInProgress: false,
        _staticDirectPlayFallbackAwaitingStableRemux: false,
        _staticDirectPlayFallbackTargetMs: -1,
        _staticDirectPlayFallbackStartedWallMs: 0,
        _directPlayOpenFallbackUsed: false,
        _directPlayOpenStartedWallMs: 0,
        directPlayOpenFallbackMinMs: 1200,

        /* --- gel / erreurs média --- */
        _mediaErrorRecoveryArmed: false,
        _mediaErrorRecoveryInProgress: false,
        _mediaErrorRecoveryCount: 0,
        _mediaErrorRecoverySafeUiMs: 0,
        _mediaErrorRecoveryReason: '',
        _mediaErrorProgressGuardUntilWallMs: 0,
        _frozenPlaybackWatchActive: false,
        _frozenPlaybackWatchArmedWallMs: 0,
        _frozenPlaybackWatchUntilWallMs: 0,
        _frozenPlaybackNoProgressSinceWallMs: 0,
        _frozenPlaybackLastLocalMs: -1,
        _frozenPlaybackLastUiMs: -1,
        _frozenPlaybackRecoveryCount: 0,
        frozenPlaybackWatchWindowMs: 30000,
        frozenPlaybackStartupGraceMs: 4000,
        frozenPlaybackNoProgressMs: 6000,
        _pauseWatchLastStableUiMs: 0,
        _pauseWatchLastStableWallMs: 0,
        _pauseWatchStartedUiMs: 0,
        resumePrerollMs: 2500,

        /* --- gate de chargement / démarrage --- */
        videoLoadingGate: false,
        _videoLoadingReason: '',
        _gateArmed: false,
        _resumeAfterGate: false,
        _startupPlayWanted: false,
        _startupPlayTries: 0,
        audioGateMsDefault: 350,

        /* --- HUD / focus / menus --- */
        controlsVisible: true,
        controlsFocus: 0,
        controlsButtonIndex: 3,
        menuIndex: 1,
        audioMenuVisible: false,
        subMenuVisible: false,
        subtitleDelayMs: 0,
        cF_PROGRESS: 0,
        cF_CONTROLS: 1,
        cF_MENU: 4,
        cF_CHAPTERS: 5,
        cF_QUALITY: 6,

        /* --- pistes --- */
        selectedAudioStream: -1,
        selectedSubtitleStream: -1,
        effectiveAudioStream: -1,
        effectiveSubtitleStream: -1,
        audioIndex: 0,
        subtitleIndex: 0,
        audioTracks: [],
        subtitleTracks: [],
        audioStreamIndexMap: [],
        subtitleStreamIndexMap: [-1],
        subtitleIsTextMap: [false],
        useLocalSubs: false,
        localCues: [],
        localSubFormat: '',
        localSubStreamIndex: -1,
        _autoLocalizeSubStream: -1,
        _localSubtitlePickSeq: 0,
        _lastSubsUiPushMs: -1,
        subsUiPushMinDeltaMs: 120,

        /* --- journaux d'observation --- */
        negotiations: [],
        seeks: [],
        sources: [],
        released: [],
        scheduled: [],
        armed: [],
        scrubPreviews: [],
        clockUpdates: 0,

        /* ===== façades recopiées de playeroverlay.qml ===== */
        _nowMs() { return clock.now; },
        _ticks(ms) { return Math.max(0, ms | 0) * 10000; },
        durationMs() { return JF.playerDurationMs(root, mp); },
        uiPositionMs() { return JF.playerUiPositionMs(root, mp); },
        keepUi() { return JF.playerKeepUiPosition(root, mp); },
        _clampUi(t) { let dur = root.durationMs(); if (dur <= 0) dur = 24 * 3600 * 1000; return Math.max(0, Math.min(t, dur)); },
        _serverTimedLike() {
            return !!(root.serverTimedStream || root.timeShifted || root.lastUsedServerRemux || root.baseOffsetMs > 0);
        },
        _mediaSeekable() { try { return !!(mp && mp.seek && mp.seekable === true); } catch (e) { return false; } },
        _isStaticDirectPlaySource() { return H.isStaticDirectPlaySource(root); },
        shouldNetworkSeek() {
            if (root._isStaticDirectPlaySource() && !root._mediaSeekable()) return true;
            if (root.isHls) return true;
            if (root.lastUsedTranscoding) return true;
            if (root.lastUsedDirectStream) return true;
            if (root.lastUsedServerRemux) return true;
            if (root.serverTimedStream || root.timeShifted) return true;
            if (root.baseOffsetMs > 0) return true;
            if (!root.durationMs() || root.durationMs() <= 0) return true;
            return false;
        },
        isDsLike() { return H.isDsLike(root); },
        isPureDirectPlay() { return H.isPureDirectPlay(root); },
        listIndexForStream(s) { return H.indexForStream(root.subtitleStreamIndexMap, s); },

        _seekLocalPosition(localTarget) { root.seeks.push(localTarget); mp.seek(localTarget); },
        _setMediaPlayerSource(u, reason) { root.sources.push({ url: u, reason: reason }); mp.source = u; },
        _setPendingSeekMs(value) { root._pendingSeekMs = value; return root._pendingSeekMs; },

        _armVideoLoading(reason) { root.videoLoadingGate = true; root._videoLoadingReason = String(reason || ''); root.armed.push(root._videoLoadingReason); },
        _releaseVideoLoading(reason) { root.videoLoadingGate = false; root._videoLoadingReason = ''; root.released.push(String(reason || '')); },
        _scheduleVideoLoadingRelease(reason) { root.scheduled.push(String(reason || '')); },
        _cancelStartupPlay() { root._startupPlayWanted = false; root._startupPlayTries = 0; timers.startup.stop(); },

        showScrubPreview(targetUi) { root.scrubPreviews.push(targetUi); },
        updateClocksFromPlayback() { root.clockUpdates++; },
        updateClocksFromPlaybackThrottled() { root.clockUpdates++; },
        resetControlsTimer() { root.controlsVisible = true; },
        _syncControlsTimer() {},
        _syncTrackMenuIndexes() {},
        _pushLocalSubsUiMs(pos, force) { H.pushLocalSubsUiMs(root, subtitleItem, pos, force); },
        _reassertSettingsFocus() {},
        disableLocalSubsOverlay() { H.disableLocalSubsOverlay(root, subtitleItem, null, null); },

        negotiatePlayback(startMs, forceHls, preferTicks, forceMp4, forceDPOnAudioSwitch, extra) {
            root.negotiations.push({
                startMs: startMs,
                forceHls: forceHls === true,
                preferTicks: preferTicks === true,
                forceMp4: forceMp4 === true,
                forceDPOnAudioSwitch: forceDPOnAudioSwitch === true,
                extra: extra || {},
            });
            return true;
        },

        /* façades helper (mêmes arguments que playeroverlay.qml) */
        _cancelHardSourceReset() { H.cancelHardSourceReset(root, timers.sourceReset || d.sourceResetTimer || makeTimer()); },
        _beginHardSourceReset(u, shouldResume) {
            H.beginHardSourceReset(root, mp, d.sourceResetTimer, timers.audioGate, timers.startup, subtitleItem, u, shouldResume);
        },
        _beginFreshDirectPlayReset(u, shouldResume, targetUi) {
            H.beginFreshDirectPlayReset(root, mp, d.sourceResetTimer, timers.audioGate, timers.startup, subtitleItem, u, shouldResume, targetUi);
        },
        _commitFreshServerTimedSource() {
            H.completeFreshServerTimedSource(root, mp, d.sourceResetTimer, subtitleItem);
        },
        _finishFreshServerTimedSourceTimeout() {
            H.completeFreshServerTimedSource(root, mp, d.sourceResetTimer, subtitleItem);
            root._releaseVideoLoading('fresh-source-reset-timeout');
        },
        _reportUiPositionMs() { return H.reportUiPositionMs(root, mp); },
        _beginTrackSwitchRebase(reason, forceLocalSeek) { return H.beginTrackSwitchRebase(root, mp, forceLocalSeek); },
        _resetSeekRestoreGuard(targetMs, reason) { H.resetSeekRestoreGuard(root, targetMs, reason); },
        _seekRestoreIsTrueTrackSwitch() { return H.seekRestoreIsTrueTrackSwitch(root); },
        _seekRestoreToleranceMs() { return H.seekRestoreToleranceMs(root); },
        _trackSwitchFragileHevc() { return H.trackSwitchFragileHevc(root); },
        _completeSeekRestoreVerified(targetUi) {
            H.completeSeekRestoreVerified(root, d.seekRestoreTimer || timers.seekRestore,
                                          d.resumeTimer || makeTimer(), targetUi);
        },
        _abandonBootSeekRestoreWithoutReload(targetUi, reason) {
            H.abandonBootSeekRestoreWithoutReload(root, d.seekRestoreTimer || timers.seekRestore, targetUi, reason);
        },
        _failTrackSwitchExactSeek(reason) {
            H.failTrackSwitchExactSeek(root, mp, d.seekRestoreTimer || timers.seekRestore,
                                       d.settleTimer || makeTimer(), d.restartTimer || makeTimer());
        },
        _finishTrackSwitchRebase(reason) { H.finishTrackSwitchRebase(root, d.settleTimer || makeTimer()); },
        _retrySeekRestoreWithJellyfinCopyRemux(targetUi, reason) {
            H.retrySeekRestoreWithJellyfinCopyRemux(root, mp, timers, targetUi, reason);
        },
        _guardUnsafeManualDirectPlayRequest(targetUi, reason) {
            return H.guardUnsafeManualDirectPlayRequest(root, mp, timers, targetUi, reason);
        },
        _armSkipIntroResumeGate() {},
        _releaseSkipIntroResumeGate() {},
        _deferredReloadPauseActive() { return mp.playbackState === MP.PausedState; },

        /* accès pour les tests */
        mp: mp,
        timers: timers,
    };

    return Object.assign(root, overrides || {});
}

module.exports = { H, JF, MP, clock, setNow, advance, makeTimer, makeTimers, makeMediaPlayer, makeRoot, STUBS };
