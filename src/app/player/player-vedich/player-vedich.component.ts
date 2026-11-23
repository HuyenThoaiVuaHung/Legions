import { ChangeDetectionStrategy, Component, DestroyRef, effect, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatFabButton } from '@angular/material/button';
import { MatCheckbox } from '@angular/material/checkbox';
import { Role } from '../../core/contracts/api';
import { VdQuestion, VdRound } from '../../core/contracts/game';
import { ApiService } from '../../core/services/api.service';
import { MediaService } from '../../core/services/media.service';
import { ClockService } from '../../core/services/clock.service';
import { NetworkService } from '../../core/services/network.service';
import { SessionService } from '../../core/services/session.service';
import { SfxService } from '../../core/services/sfx.service';
import { CountdownComponent } from '../../components/countdown/countdown.component';
import { PlayerListComponent } from '../../components/player-list/player-list.component';
import { StageVideoPlayerComponent } from '../../components/stage-video-player/stage-video-player.component';

/** VD's 6 question slots are always laid out as two rows: 20 điểm, 30 điểm. */
const QUESTION_PICKER_ROWS = [
  { points: 20, indices: [0, 1, 2] },
  { points: 30, indices: [3, 4, 5] },
] as const;

@Component({
  selector: 'app-player-vedich',
  templateUrl: './player-vedich.component.html',
  styleUrl: './player-vedich.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CountdownComponent,
    PlayerListComponent,
    StageVideoPlayerComponent,
    MatFabButton,
    MatCheckbox,
    FormsModule,
  ],
})
export class PlayerVedichComponent {
  private readonly api = inject(ApiService);
  private readonly network = inject(NetworkService);
  private readonly clock = inject(ClockService);
  private readonly sfx = inject(SfxService);
  protected readonly media = inject(MediaService);
  private readonly destroyRef = inject(DestroyRef);
  protected readonly session = inject(SessionService);
  protected readonly Role = Role;
  protected readonly pickerRows = QUESTION_PICKER_ROWS;

  protected readonly round = signal<VdRound | null>(null);
  protected readonly currentQuestion = signal<VdQuestion | null>(null);
  protected readonly currentTime = this.clock.main.seconds;
  protected readonly maxTime = this.clock.main.maxSeconds;
  protected readonly fiveSecTimer = this.clock.vdSteal.tenths;
  protected readonly stealingPlayerIndex = signal(-1);
  protected readonly buttonDisabled = signal(true);

  protected readonly videoUrl = signal<string | null>(null);
  protected readonly imageUrl = signal<string | null>(null);

  private audio: HTMLAudioElement | null = null;
  private audioFile: string | null = null;
  private pendingAudioFile: string | null = null;

  constructor() {
    void this.loadRound();
    this.network.emit('request-live-state');

    effect(() => {
      const snapshot = this.session.liveState();
      if (!snapshot) return;
      this.stealingPlayerIndex.set(snapshot.vd.stealingPlayerIndex);
      this.buttonDisabled.set(!snapshot.vd.stealWindowOpen);
      this.onQuestion(snapshot.vd.question);
    });

    const offs = [
      this.sfx.onUnlock(() => {
        if (this.pendingAudioFile) {
          const file = this.pendingAudioFile;
          this.pendingAudioFile = null;
          this.startQuestionAudio(file);
        }
      }),
      this.network.on<[string]>('play-sfx', (code) => this.sfx.play(code)),
      this.network.on<[VdRound]>('update-vedich-data', (data) => this.round.set(data)),
      this.network.on<[VdQuestion | undefined]>('update-vedich-question', (q) => this.onQuestion(q ?? null)),
      this.network.on<[]>('unlock-button-vd', () => this.buttonDisabled.set(false)),
      this.network.on<[]>('lock-button-vd', () => this.buttonDisabled.set(true)),
      this.network.on<[number]>('player-steal-question', (playerIndex) => this.stealingPlayerIndex.set(playerIndex)),
      this.network.on<[]>('clear-stealing-player', () => this.stealingPlayerIndex.set(-1)),
    ];
    this.destroyRef.onDestroy(() => {
      offs.forEach((off) => off());
      this.stopQuestionAudio();
    });
  }

  private async loadRound(): Promise<void> {
    this.round.set(await this.api.getRound('vd'));
  }

  private onQuestion(question: VdQuestion | null): void {
    this.currentQuestion.set(question);
    this.videoUrl.set(null);
    this.imageUrl.set(null);
    if (!question) {
      this.stopQuestionAudio();
      return;
    }

    if (question.type === 'V') {
      this.stopQuestionAudio();
      this.videoUrl.set(this.media.resolve('vd', question.mediaFile));
    } else if (question.type === 'A' && question.mediaFile) {
      if (this.audioFile !== question.mediaFile) {
        this.startQuestionAudio(question.mediaFile);
      }
    } else if (question.type === 'I') {
      this.stopQuestionAudio();
      this.imageUrl.set(this.media.resolve('vd', question.mediaFile));
    } else {
      this.stopQuestionAudio();
    }
  }

  private startQuestionAudio(file: string): void {
    this.stopQuestionAudio();
    this.audioFile = file;
    const audio = new Audio(this.media.resolve('vd', file));
    this.audio = audio;
    audio.load();
    void audio.play().catch(() => {
      if (this.audio === audio) this.pendingAudioFile = file;
    });
  }

  private stopQuestionAudio(): void {
    this.audio?.pause();
    this.audio = null;
    this.audioFile = null;
    this.pendingAudioFile = null;
  }

  stealQuestion(): void {
    this.network.emit('player-steal-question');
  }
}
