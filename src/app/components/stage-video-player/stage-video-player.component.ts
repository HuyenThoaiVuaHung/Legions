import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  computed,
  effect,
  inject,
  input,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { MatIcon } from '@angular/material/icon';
import { MatProgressSpinner } from '@angular/material/progress-spinner';
import { VideoPlaybackState, VideoStateUpdate, VideoTarget } from '../../core/contracts/game';
import { NetworkService } from '../../core/services/network.service';
import { SessionService } from '../../core/services/session.service';
import { SfxService } from '../../core/services/sfx.service';

@Component({
  selector: 'stage-video-player',
  templateUrl: './stage-video-player.component.html',
  styleUrl: './stage-video-player.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatIcon, MatProgressSpinner],
})
export class StageVideoPlayerComponent {
  private readonly network = inject(NetworkService);
  private readonly session = inject(SessionService);
  private readonly sfx = inject(SfxService);
  private readonly destroyRef = inject(DestroyRef);

  readonly src = input.required<string>();
  readonly target = input.required<VideoTarget>();
  readonly poster = input<string | null>(null);
  /** Only Viewer screens expand to remote full-viewport takeover. */
  readonly allowRemoteFullscreen = input(false);

  private readonly videoEl = viewChild<ElementRef<HTMLVideoElement>>('video');

  protected readonly remoteState = signal<VideoPlaybackState | null>(null);
  protected readonly playing = signal(false);
  protected readonly buffering = signal(false);
  protected readonly hasError = signal(false);
  private autoplayMutedFallback = false;

  protected readonly isRemoteFullscreen = computed(
    () => this.allowRemoteFullscreen() && (this.remoteState()?.fullscreen ?? false),
  );

  private pendingSync: { state: VideoPlaybackState; serverTime: number } | null = null;

  constructor() {
    effect(() => {
      const snapshot = this.session.liveState();
      if (!snapshot) return;
      const target = untracked(() => this.target());
      const state = target === 'tt' ? snapshot.tt.video : snapshot.vd.video;
      if (state) this.applyRemoteState(state, snapshot.serverTime);
    });

    effect(() => {
      this.src();
      this.hasError.set(false);
      this.buffering.set(false);
      this.autoplayMutedFallback = false;
      this.playing.set(false);
    });

    const offs = [
      this.network.on<[VideoStateUpdate]>('video-state', (update) => {
        if (update.target !== this.target()) return;
        this.applyRemoteState(update.state, update.serverTime);
      }),
      this.sfx.onUnlock(() => {
        if (this.autoplayMutedFallback) {
          this.unmuteAfterGesture();
        }
      }),
    ];

    this.destroyRef.onDestroy(() => offs.forEach((off) => off()));
  }

  protected onLoadedMetadata(): void {
    const video = this.videoEl()?.nativeElement;
    if (!video) return;
    this.hasError.set(false);
    if (this.pendingSync) {
      const { state, serverTime } = this.pendingSync;
      this.pendingSync = null;
      this.syncVideoElement(video, state, serverTime);
    } else if (this.remoteState()) {
      const state = this.remoteState()!;
      video.volume = state.volume;
      video.muted = state.muted;
    }
  }

  protected onPlay(): void {
    this.playing.set(true);
    this.buffering.set(false);
  }

  protected onPause(): void {
    this.playing.set(false);
    this.buffering.set(false);
  }

  protected onWaiting(): void {
    if (this.playing()) this.buffering.set(true);
  }

  protected onCanPlay(): void {
    this.buffering.set(false);
  }

  protected onEnded(): void {
    this.playing.set(false);
    this.buffering.set(false);
  }

  protected onError(): void {
    this.buffering.set(false);
    this.playing.set(false);
    this.hasError.set(true);
  }

  private unmuteAfterGesture(): void {
    const video = this.videoEl()?.nativeElement;
    const state = this.remoteState();
    this.autoplayMutedFallback = false;
    if (!video || !state) return;
    video.volume = state.volume;
    video.muted = state.muted;
    if (state.playing && video.paused) {
      void video.play().catch(() => undefined);
    }
  }

  private applyRemoteState(state: VideoPlaybackState, serverTime: number): void {
    this.remoteState.set(state);
    const video = this.videoEl()?.nativeElement;
    if (!video || video.readyState < 1) {
      this.pendingSync = { state, serverTime };
      if (video) {
        video.volume = state.volume;
        video.muted = state.muted;
      }
      return;
    }
    this.pendingSync = null;
    this.syncVideoElement(video, state, serverTime);
  }

  private syncVideoElement(
    video: HTMLVideoElement,
    state: VideoPlaybackState,
    serverTime: number,
  ): void {
    video.volume = Math.min(1, Math.max(0, state.volume));
    video.muted = state.muted;
    if (state.muted) this.autoplayMutedFallback = false;

    const desiredPos =
      state.playing && state.startedAt !== null
        ? state.positionSec + Math.max(0, (serverTime - state.startedAt) / 1000)
        : state.positionSec;

    const dur = Number.isFinite(video.duration) ? video.duration : Infinity;
    const clampedPos = Math.min(desiredPos, Math.max(0, dur - 0.1));

    const threshold = state.playing ? 0.45 : 0.05;
    if (
      Number.isFinite(clampedPos) &&
      (Math.abs(video.currentTime - clampedPos) > threshold ||
        (state.positionSec === 0 && desiredPos < 0.25 && video.currentTime > 0.4))
    ) {
      video.currentTime = clampedPos;
    }

    if (state.playing) {
      if (desiredPos >= dur - 0.15) return;
      if (video.paused) {
        void video.play().catch(() => {
          if (!video.muted) {
            video.muted = true;
            this.autoplayMutedFallback = true;
            void video.play().catch(() => undefined);
          }
        });
      }
    } else if (!video.paused) {
      video.pause();
    }
  }
}
