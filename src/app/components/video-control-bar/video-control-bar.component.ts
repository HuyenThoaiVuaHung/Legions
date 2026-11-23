import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
} from '@angular/core';
import { MatButton, MatIconButton } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import { MatSlider, MatSliderThumb } from '@angular/material/slider';
import { MatTooltip } from '@angular/material/tooltip';
import {
  VideoControlAction,
  VideoControlCommand,
  VideoPlaybackState,
  VideoStateUpdate,
  VideoTarget,
} from '../../core/contracts/game';
import { NetworkService } from '../../core/services/network.service';
import { SessionService } from '../../core/services/session.service';

@Component({
  selector: 'video-control-bar',
  templateUrl: './video-control-bar.component.html',
  styleUrl: './video-control-bar.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatButton, MatIconButton, MatIcon, MatSlider, MatSliderThumb, MatTooltip],
})
export class VideoControlBarComponent {
  private readonly network = inject(NetworkService);
  private readonly session = inject(SessionService);
  private readonly destroyRef = inject(DestroyRef);

  readonly target = input.required<VideoTarget>();
  /** Resolved URL of the currently displayed video, used to probe duration for the scrubber. */
  readonly src = input<string | null>(null);
  readonly disabled = input(false);
  readonly showPlayWithTimer = input(false);
  readonly playWithTimer = output<void>();

  protected readonly state = signal<VideoPlaybackState>({
    playing: false,
    startedAt: null,
    positionSec: 0,
    volume: 1,
    muted: false,
    fullscreen: false,
  });

  protected readonly duration = signal(0);
  protected readonly playheadSec = signal(0);
  private dragging = false;
  /** Local clock ms corresponding to the server state's `positionSec` when playing. */
  private playAnchorMs: number | null = null;
  private playAnchorPos = 0;
  private tickHandle: ReturnType<typeof setInterval> | null = null;

  protected readonly volumePercent = computed(() => Math.round(this.state().volume * 100));
  protected readonly currentTimeLabel = computed(() => this.formatTime(this.playheadSec()));
  protected readonly durationLabel = computed(() => this.formatTime(this.duration()));
  protected readonly formatThumb = (sec: number): string => this.formatTime(sec);

  constructor() {
    effect(() => {
      const snapshot = this.session.liveState();
      if (!snapshot) return;
      const target = untracked(() => this.target());
      const v = target === 'tt' ? snapshot.tt.video : snapshot.vd.video;
      if (v) this.applyState(v, snapshot.serverTime);
    });

    // Probe video metadata when src changes to get exact duration for the scrubber.
    effect((onCleanup) => {
      const url = this.src();
      this.duration.set(0);
      if (!url) return;
      const probe = document.createElement('video');
      probe.preload = 'metadata';
      const onLoaded = () => {
        if (Number.isFinite(probe.duration) && probe.duration > 0) {
          this.duration.set(probe.duration);
        }
      };
      probe.addEventListener('loadedmetadata', onLoaded, { once: true });
      probe.src = url;
      onCleanup(() => {
        probe.removeEventListener('loadedmetadata', onLoaded);
        probe.removeAttribute('src');
        probe.load();
      });
    });

    const off = this.network.on<[VideoStateUpdate]>('video-state', (update) => {
      if (update.target !== this.target()) return;
      this.applyState(update.state, update.serverTime);
    });

    this.destroyRef.onDestroy(() => {
      off();
      this.stopTick();
    });
  }

  protected send(action: VideoControlAction, value?: number | boolean): void {
    const cmd: VideoControlCommand = { target: this.target(), action, value };
    this.network.emit('video-control', cmd);
  }

  protected onVolumeChange(percent: number): void {
    const clamped = Math.min(100, Math.max(0, percent));
    this.state.update((s) => ({
      ...s,
      volume: clamped / 100,
      muted: clamped === 0 ? s.muted : false,
    }));
    this.send('volume', clamped / 100);
  }

  protected onScrubInput(sec: number): void {
    this.dragging = true;
    this.playheadSec.set(Math.max(0, sec));
  }

  protected onScrubCommit(sec: number): void {
    this.dragging = false;
    const dur = this.duration();
    const clamped = Math.min(dur > 0 ? dur : Infinity, Math.max(0, sec));
    this.playheadSec.set(clamped);
    this.send('seek', clamped);
  }

  private applyState(state: VideoPlaybackState, serverTime: number): void {
    this.state.set(state);
    if (state.playing && state.startedAt !== null) {
      const elapsedSec = Math.max(0, (serverTime - state.startedAt) / 1000);
      const pos = state.positionSec + elapsedSec;
      this.playAnchorPos = pos;
      this.playAnchorMs = Date.now();
      if (!this.dragging) this.playheadSec.set(this.clampToDuration(pos));
      this.startTick();
    } else {
      this.playAnchorMs = null;
      this.stopTick();
      if (!this.dragging) this.playheadSec.set(this.clampToDuration(state.positionSec));
    }
  }

  private startTick(): void {
    if (this.tickHandle !== null) return;
    this.tickHandle = setInterval(() => {
      if (this.dragging || this.playAnchorMs === null) return;
      const elapsed = Math.max(0, (Date.now() - this.playAnchorMs) / 1000);
      const pos = this.clampToDuration(this.playAnchorPos + elapsed);
      this.playheadSec.set(pos);
      const dur = this.duration();
      if (dur > 0 && pos >= dur) this.stopTick();
    }, 200);
  }

  private stopTick(): void {
    if (this.tickHandle !== null) {
      clearInterval(this.tickHandle);
      this.tickHandle = null;
    }
  }

  private clampToDuration(sec: number): number {
    const dur = this.duration();
    return dur > 0 ? Math.min(dur, Math.max(0, sec)) : Math.max(0, sec);
  }

  private formatTime(seconds: number): string {
    if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
    const whole = Math.floor(seconds);
    const mins = Math.floor(whole / 60);
    const secs = whole % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  }
}
