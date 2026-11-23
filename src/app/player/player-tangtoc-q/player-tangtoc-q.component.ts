import { ChangeDetectionStrategy, Component, DestroyRef, computed, effect, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatIconButton } from '@angular/material/button';
import { MatFormField } from '@angular/material/form-field';
import { MatIcon } from '@angular/material/icon';
import { MatInput } from '@angular/material/input';
import { Role } from '../../core/contracts/api';
import { TtRound } from '../../core/contracts/game';
import { ApiService } from '../../core/services/api.service';
import { MediaService } from '../../core/services/media.service';
import { ClockService } from '../../core/services/clock.service';
import { NetworkService } from '../../core/services/network.service';
import { SessionService } from '../../core/services/session.service';
import { SfxService } from '../../core/services/sfx.service';
import { CountdownComponent } from '../../components/countdown/countdown.component';
import { PlayerListComponent } from '../../components/player-list/player-list.component';
import { StageVideoPlayerComponent } from '../../components/stage-video-player/stage-video-player.component';

@Component({
  selector: 'app-player-tangtoc-q',
  templateUrl: './player-tangtoc-q.component.html',
  styleUrl: './player-tangtoc-q.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CountdownComponent,
    PlayerListComponent,
    StageVideoPlayerComponent,
    MatFormField,
    MatInput,
    FormsModule,
    MatIconButton,
    MatIcon,
  ],
})
export class PlayerTangtocQComponent {
  private readonly api = inject(ApiService);
  private readonly network = inject(NetworkService);
  private readonly clock = inject(ClockService);
  private readonly sfx = inject(SfxService);
  protected readonly media = inject(MediaService);
  private readonly destroyRef = inject(DestroyRef);
  protected readonly session = inject(SessionService);
  protected readonly Role = Role;

  protected readonly round = signal<TtRound | null>(null);
  protected readonly currentTime = this.clock.main.seconds;
  protected readonly maxTime = this.clock.main.maxSeconds;
  protected readonly playerAnswer = signal('');
  protected readonly answerCache = signal('');
  protected readonly readableTime = signal('');

  protected readonly currentQuestion = computed(() => {
    const round = this.round();
    return round ? (round.questions[round.activeQuestionIndex] ?? null) : null;
  });

  protected readonly answerImageUrl = computed(() => {
    const q = this.currentQuestion();
    const round = this.round();
    if (!q || !round?.showAnswer || !q.answerImage) return null;
    return this.media.resolve('tt', q.answerImage);
  });

  protected readonly imageUrl = computed(() => {
    const q = this.currentQuestion();
    if (!q || q.type !== 'image' || !q.questionImage) return null;
    return this.media.resolve('tt', q.questionImage);
  });

  protected readonly videoUrl = computed(() => {
    const q = this.currentQuestion();
    if (!q || q.type !== 'video' || !q.videoFile) return null;
    return this.media.resolve('tt', q.videoFile);
  });

  protected readonly disabledAnswerBox = computed(() => !this.clock.main.running());

  constructor() {
    void this.loadRound();
    this.network.emit('request-live-state');

    effect(() => {
      const snapshot = this.session.liveState();
      if (!snapshot) return;
    });

    // Clock hit zero (expired/stopped): wipe any half-typed answer.
    effect(() => {
      if (this.currentTime() <= 0) this.playerAnswer.set('');
    });

    const offs = [
      this.network.on<[string]>('play-sfx', (code) => this.sfx.play(code)),
      this.network.on<[TtRound]>('update-tangtoc-data', (data) => this.onRound(data)),
    ];
    this.destroyRef.onDestroy(() => offs.forEach((off) => off()));
  }

  private async loadRound(): Promise<void> {
    this.onRound(await this.api.getRound('tt'));
  }

  private onRound(data: TtRound): void {
    this.round.set(data);
    const selfIndex = this.session.playerIndex();
    if (selfIndex === null) return;
    const own = data.playerAnswers.find((a) => a.playerIndex === selfIndex);
    if (own?.answer) {
      this.answerCache.set(own.answer);
      if (own.elapsedMs !== undefined || (own.timestamp > 0 && data.timerStartTimestamp > 0)) {
        const elapsedMs = Math.max(0, own.elapsedMs ?? own.timestamp - data.timerStartTimestamp);
        this.readableTime.set(`${Math.trunc(elapsedMs / 1000)}s${elapsedMs % 1000}ms`);
      }
    } else if (own && !own.answer) {
      this.answerCache.set('');
      this.readableTime.set('');
    }
  }

  submitAnswer(): void {
    if (this.disabledAnswerBox() || !this.playerAnswer().trim()) return;
    this.network.emit('player-submit-answer-tangtoc', this.playerAnswer());
    this.answerCache.set(this.playerAnswer());
    this.playerAnswer.set('');
    this.updateReadableTime();
  }

  private updateReadableTime(): void {
    const index = this.session.playerIndex();
    if (index === null) return;
    setTimeout(() => {
      const answer = this.round()?.playerAnswers.find((a) => a.playerIndex === index);
      const round = this.round();
      if (!answer || !round) return;
      const elapsedMs = answer.elapsedMs ?? answer.timestamp - round.timerStartTimestamp;
      this.readableTime.set(`${Math.trunc(elapsedMs / 1000)}s${elapsedMs % 1000}ms`);
    }, 200);
  }

  clearAnswerIfExpired(): void {
    if (this.disabledAnswerBox()) this.playerAnswer.set('');
  }
}
