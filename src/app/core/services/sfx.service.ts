import { Injectable, signal } from '@angular/core';
import { ActiveAudioState, LiveStateSnapshot } from '../contracts/game';

/**
 * Sound-effect codes are part of the socket protocol ('play-sfx' payloads).
 * This table is the single mapping from code to bundled asset — extracted
 * verbatim from the legacy switch statement.
 */
const SFX_FILES: Readonly<Record<string, string>> = {
  KD_START: 'assets/audio-assets/kd/StartRound.mp3',
  KD_60S: 'assets/audio-assets/kd/60Seconds.mp3',
  KD_90S: 'assets/audio-assets/kd/90Seconds.mp3',
  BLANK_SPC: 'assets/audio-assets/others/Space.mp3',
  KD_GET_TURN: 'assets/audio-assets/kd/GetTurn.mp3',
  KD_CORRECT: 'assets/audio-assets/kd/CorrectAnswer.mp3',
  KD_WRONG: 'assets/audio-assets/kd/WrongAnswer.mp3',
  VCNV_START: 'assets/audio-assets/vcnv/StartRound.mp3',
  VCNV_15S: 'assets/audio-assets/vcnv/15Seconds.mp3',
  VCNV_SHOWANS: 'assets/audio-assets/vcnv/AnswersShowing.mp3',
  VCNV_CORRECT_ROW: 'assets/audio-assets/vcnv/CorrectRow.mp3',
  VCNV_WRONG_ROW: 'assets/audio-assets/vcnv/WrongRow.mp3',
  VCNV_CHOOSE_ROW: 'assets/audio-assets/vcnv/RowChoose.mp3',
  VCNV_PIC_REVEAL: 'assets/audio-assets/vcnv/PictureReveal.mp3',
  VCNV_OBSTACLE: 'assets/audio-assets/vcnv/ObstacleGrant.mp3',
  VCNV_OBSTACLE_CORRECT: 'assets/audio-assets/vcnv/CorrectObstacle.mp3',
  TT_START: 'assets/audio-assets/tt/StartRound.mp3',
  TT_10S: 'assets/audio-assets/tt/10Seconds.mp3',
  TT_20S: 'assets/audio-assets/tt/20Seconds.mp3',
  TT_30S: 'assets/audio-assets/tt/30Seconds.mp3',
  TT_40S: 'assets/audio-assets/tt/40Seconds.mp3',
  TT_SHOWANS: 'assets/audio-assets/tt/AnswersShowing.mp3',
  TT_CORRECT: 'assets/audio-assets/tt/Correct.mp3',
  TT_WRONG: 'assets/audio-assets/tt/Wrong.mp3',
  TT_QUESTION_SHOW: 'assets/audio-assets/tt/QuestionShowing.mp3',
  VD_START: 'assets/audio-assets/vd/StartRound.mp3',
  VD_5S: 'assets/audio-assets/vd/5Seconds.mp3',
  VD_15S: 'assets/audio-assets/vd/15Seconds.mp3',
  VD_20S: 'assets/audio-assets/vd/20Seconds.mp3',
  VD_CHOOSE: 'assets/audio-assets/vd/Choose.mp3',
  VD_SHOW_PICKER: 'assets/audio-assets/vd/ShowPicker.mp3',
  VD_CHOSEN: 'assets/audio-assets/vd/PackageChosen.mp3',
  VD_CORRECT: 'assets/audio-assets/vd/Correct.mp3',
  VD_WRONG: 'assets/audio-assets/vd/Wrong.mp3',
  VD_START_TURN: 'assets/audio-assets/vd/StartTurn.mp3',
  VD_NSHV: 'assets/audio-assets/vd/NSHV.mp3',
  VD_STEAL_Q: 'assets/audio-assets/vd/Grant.mp3',
  VD_END: 'assets/audio-assets/vd/FinishRound.mp3',
};

interface PendingTrack {
  code: string;
  loop: boolean;
  baseOffsetSec: number;
  recordedAt: number;
  durationMs?: number;
  key: string;
}

@Injectable({ providedIn: 'root' })
export class SfxService {
  private loopingAudio: HTMLAudioElement | null = null;
  private loopingKey: string | null = null;
  private pendingLoop: PendingTrack | null = null;

  private timedAudio: HTMLAudioElement | null = null;
  private timedKey: string | null = null;
  private pendingTimed: PendingTrack | null = null;

  private readonly unlockListeners = new Set<() => void>();

  /** True until the browser allows audio playback or the user interacts once. */
  readonly audioBlocked = signal(true);

  /** Called on user gesture (click / keydown) to unlock and resume deferred tracks. */
  unlock(): void {
    this.audioBlocked.set(false);
    if (this.pendingLoop) {
      const p = this.pendingLoop;
      this.pendingLoop = null;
      const elapsed = p.baseOffsetSec + (Date.now() - p.recordedAt) / 1000;
      this.startLoopAudio(p.code, p.key, elapsed);
    }
    if (this.pendingTimed) {
      const p = this.pendingTimed;
      this.pendingTimed = null;
      const elapsed = p.baseOffsetSec + (Date.now() - p.recordedAt) / 1000;
      if (p.durationMs === undefined || elapsed * 1000 < p.durationMs - 300) {
        this.startTimedAudio(p.code, p.key, elapsed, p.durationMs);
      }
    }
    for (const listener of [...this.unlockListeners]) listener();
  }

  /** Register a one-shot callback invoked when audio is unlocked (returns unsubscribe). */
  onUnlock(cb: () => void): () => void {
    this.unlockListeners.add(cb);
    return () => this.unlockListeners.delete(cb);
  }

  play(code: string, loop = false, offsetSec = 0): void {
    const file = SFX_FILES[code];
    if (!file) return;
    if (loop) {
      this.startLoopAudio(code, `${code}:live`, offsetSec);
      return;
    }
    const audio = new Audio(file);
    this.playWithOffset(audio, offsetSec, false, () => {
      this.audioBlocked.set(true);
    });
  }

  /** Reconcile active looping and timed tracks against a server live-state snapshot. */
  syncFromLiveState(snapshot: LiveStateSnapshot): void {
    this.syncLoop(snapshot.activeLoopSfx, snapshot.serverTime);
    this.syncTimed(snapshot.activeTimedSfx, snapshot.serverTime);
  }

  stopLoop(): void {
    this.pendingLoop = null;
    this.loopingKey = null;
    if (this.loopingAudio) {
      this.loopingAudio.pause();
      this.loopingAudio = null;
    }
  }

  stopTimed(): void {
    this.pendingTimed = null;
    this.timedKey = null;
    if (this.timedAudio) {
      this.timedAudio.pause();
      this.timedAudio = null;
    }
  }

  stopAll(): void {
    this.stopLoop();
    this.stopTimed();
  }

  private syncLoop(active: ActiveAudioState | null, serverTime: number): void {
    if (!active) {
      this.stopLoop();
      return;
    }
    const key = `${active.code}:${active.startedAt}`;
    if (this.loopingKey === key && this.loopingAudio && !this.loopingAudio.paused) return;
    if (this.pendingLoop?.key === key) return;
    const offsetSec = Math.max(0, (serverTime - active.startedAt) / 1000);
    this.startLoopAudio(active.code, key, offsetSec);
  }

  private syncTimed(active: ActiveAudioState | null, serverTime: number): void {
    if (!active) return;
    const key = `${active.code}:${active.startedAt}`;
    if (this.timedKey === key || this.pendingTimed?.key === key) return;
    const offsetSec = Math.max(0, (serverTime - active.startedAt) / 1000);
    if (active.durationMs !== undefined && offsetSec * 1000 >= active.durationMs - 300) return;
    this.startTimedAudio(active.code, key, offsetSec, active.durationMs);
  }

  private startLoopAudio(code: string, key: string, offsetSec: number): void {
    const file = SFX_FILES[code];
    if (!file) return;
    this.stopLoop();
    const audio = new Audio(file);
    audio.loop = true;
    this.loopingAudio = audio;
    this.loopingKey = key;
    const recordedAt = Date.now();
    this.playWithOffset(audio, offsetSec, true, () => {
      if (this.loopingAudio !== audio) return;
      this.audioBlocked.set(true);
      this.pendingLoop = { code, loop: true, baseOffsetSec: offsetSec, recordedAt, key };
    });
  }

  private startTimedAudio(code: string, key: string, offsetSec: number, durationMs?: number): void {
    const file = SFX_FILES[code];
    if (!file) return;
    this.stopTimed();
    const audio = new Audio(file);
    this.timedAudio = audio;
    this.timedKey = key;
    const recordedAt = Date.now();
    audio.addEventListener('ended', () => {
      if (this.timedAudio === audio) {
        this.timedAudio = null;
      }
    });
    this.playWithOffset(audio, offsetSec, false, () => {
      if (this.timedAudio !== audio) return;
      this.audioBlocked.set(true);
      this.pendingTimed = { code, loop: false, baseOffsetSec: offsetSec, recordedAt, durationMs, key };
    });
  }

  private playWithOffset(
    audio: HTMLAudioElement,
    offsetSec: number,
    loop: boolean,
    onBlocked: () => void,
  ): void {
    const start = () => {
      if (offsetSec > 0.15 && Number.isFinite(audio.duration) && audio.duration > 0) {
        if (loop) {
          audio.currentTime = offsetSec % audio.duration;
        } else if (offsetSec >= audio.duration - 0.3) {
          return;
        } else {
          audio.currentTime = offsetSec;
        }
      }
      void audio.play().then(
        () => this.audioBlocked.set(false),
        () => onBlocked(),
      );
    };

    if (offsetSec > 0.15 && audio.readyState < 1) {
      audio.addEventListener('loadedmetadata', start, { once: true });
      audio.load();
    } else {
      start();
    }
  }
}
