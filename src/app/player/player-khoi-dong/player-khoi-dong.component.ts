import { NgTemplateOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, DestroyRef, computed, effect, inject, signal } from '@angular/core';
import { MatFabButton } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import { MatProgressBar } from '@angular/material/progress-bar';
import { ApiService } from '../../core/services/api.service';
import { MediaService } from '../../core/services/media.service';
import { ClockService } from '../../core/services/clock.service';
import { NetworkService } from '../../core/services/network.service';
import { SessionService } from '../../core/services/session.service';
import { SfxService } from '../../core/services/sfx.service';
import { KdFlowService } from '../../core/services/kd-flow.service';
import { KdQuestion, KdRound } from '../../core/contracts/game';
import { Role } from '../../core/contracts/api';
import { PlayerListComponent } from '../../components/player-list/player-list.component';

/**
 * Khởi động (warm-up). Question pools/answers live in KdRound (fetched via
 * REST, since it contains every player's answers); the question currently
 * on screen — and who currently holds the buzzer — are transient state the
 * round contract doesn't carry, so the server keeps pushing them over the
 * socket under their legacy event names.
 */
@Component({
  selector: 'app-player-khoi-dong',
  templateUrl: './player-khoi-dong.component.html',
  styleUrl: './player-khoi-dong.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [NgTemplateOutlet, MatProgressBar, MatIcon, PlayerListComponent, MatFabButton],
  host: {
    '(window:keydown)': 'onKeyDown($event)',
  },
})
export class PlayerKhoiDongComponent {
  private readonly api = inject(ApiService);
  private readonly network = inject(NetworkService);
  private readonly clock = inject(ClockService);
  private readonly sfx = inject(SfxService);
  private readonly media = inject(MediaService);
  private readonly destroyRef = inject(DestroyRef);
  protected readonly session = inject(SessionService);
  protected readonly Role = Role;

  protected readonly round = signal<KdRound | null>(null);
  protected readonly question = signal<KdQuestion | null>(null);
  protected readonly previousAnswer = signal<string | null>(null);
  protected readonly turnIndex = signal(-1);
  protected readonly kdFlow = inject(KdFlowService);
  /** Legacy enable/disable events; only consulted when the server sends no flow state. */
  private readonly legacyButtonDisabled = signal(true);
  protected readonly answerButtonDisabled = computed(() => {
    const open = this.kdFlow.buzzerOpen();
    return open === null ? this.legacyButtonDisabled() : !open;
  });
  protected readonly timerBuzz = this.clock.kdTurnTenths;
  protected readonly timerAnswer = this.clock.kdAnswerTenths;

  protected readonly isPlayer = computed(() => this.session.role() === Role.Player);
  protected readonly isMultiplayer = computed(() => this.round()?.gamemode === 'M');
  protected readonly modeLabel = computed(() => (this.isMultiplayer() ? 'Đối kháng' : 'Cá nhân'));

  protected readonly imageUrl = computed(() => {
    const q = this.question();
    if (!q || q.type !== 'P') return null;
    return this.media.resolve('kd', q.mediaFile);
  });

  protected readonly isAudioQuestion = computed(() => this.question()?.type === 'A');

  protected readonly gotTurn = computed(
    () => this.turnIndex() !== -1 && this.turnIndex() === this.session.playerIndex(),
  );

  /** Question count within the current turn, synced from server events with safe fallback. */
  protected readonly questionNo = signal(0);
  private readonly serverMaxQuestionNo = signal(0);
  protected readonly maxQuestionNo = computed(() => {
    const fromServer = this.serverMaxQuestionNo();
    if (fromServer > 0) return fromServer;
    const round = this.round();
    if (!round?.questions) return 0;
    return round.gamemode === 'M'
      ? (round.questions.multiplayer?.length ?? 0)
      : (round.questions.singleplayer?.[round.activePlayerIndex]?.length ?? 0);
  });

  protected readonly activeTimer = computed<{ seconds: string; label: string; urgent: boolean } | null>(() => {
    const answer = this.timerAnswer();
    if (answer > 0) {
      return { seconds: (answer / 10).toFixed(1), label: 'Trả lời', urgent: answer <= 10 };
    }
    const buzz = this.timerBuzz();
    if (buzz > 0) {
      return {
        seconds: (buzz / 10).toFixed(1),
        label: this.isMultiplayer() ? 'Bấm chuông' : 'Suy nghĩ',
        urgent: buzz <= 10,
      };
    }
    return null;
  });

  private turnKey: string | null = null;
  private audio: HTMLAudioElement | null = null;
  private audioFile: string | null = null;
  private pendingAudioFile: string | null = null;

  constructor() {
    void this.loadRound();
    this.network.emit('request-live-state');

    effect(() => {
      const snapshot = this.session.liveState();
      if (!snapshot) return;
      const kd = snapshot.kd;
      this.serverMaxQuestionNo.set(kd.maxQuestionCount);
      if (kd.currentQuestionNo > 0 || kd.question) {
        this.questionNo.set(kd.currentQuestionNo > 0 ? kd.currentQuestionNo : (kd.question ? 1 : 0));
      }
      this.turnIndex.set(kd.turnPlayerIndex);
      this.legacyButtonDisabled.set(!kd.buzzerOpen);
      this.previousAnswer.set(kd.previousAnswer);
      this.applyQuestion(kd.question);
    });

    const offs = [
      this.sfx.onUnlock(() => {
        if (this.pendingAudioFile) {
          const file = this.pendingAudioFile;
          this.pendingAudioFile = null;
          this.startQuestionAudio(file);
        }
      }),
      this.network.on<[string, boolean?]>('play-sfx', (code, loop) => this.sfx.play(code, loop)),
      this.network.on<[KdQuestion]>('update-kd-question', (data) => this.onQuestion(data)),
      this.network.on<[number]>('player-got-turn-kd', (playerIndex) => this.turnIndex.set(playerIndex)),
      this.network.on<[]>('clear-turn-player-kd', () => this.turnIndex.set(-1)),
      this.network.on<[]>('enable-answer-button-kd', () => this.legacyButtonDisabled.set(false)),
      this.network.on<[]>('disable-answer-button-kd', () => this.legacyButtonDisabled.set(true)),
      this.network.on<[]>('stop-kd-sound', () => this.sfx.stopLoop()),
      this.network.on<[Partial<KdRound>]>('update-kd-data', (data) => {
        if (data) this.round.set(data as KdRound);
      }),
      this.network.on<[number, number]>('update-number-question-kd', (maxCount, currentNo) => {
        this.serverMaxQuestionNo.set(maxCount);
        if (currentNo > 0) this.questionNo.set(currentNo);
      }),
      this.network.on<[number]>('update-questions-number-kd', (questionCount) => {
        this.serverMaxQuestionNo.set(questionCount);
        this.questionNo.set(0);
      }),
    ];
    this.destroyRef.onDestroy(() => {
      offs.forEach((off) => off());
      this.stopQuestionAudio();
    });
  }

  private async loadRound(): Promise<void> {
    this.round.set(await this.api.getRound('kd'));
  }

  private applyQuestion(data: KdQuestion | null): void {
    this.question.set(data);
    if (!data || data.type !== 'A' || !data.mediaFile) {
      this.stopQuestionAudio();
      return;
    }
    if (this.audioFile === data.mediaFile) return;
    this.startQuestionAudio(data.mediaFile);
  }

  private startQuestionAudio(mediaFile: string): void {
    this.stopQuestionAudio();
    this.audioFile = mediaFile;
    const audio = new Audio(this.media.resolve('kd', mediaFile));
    this.audio = audio;
    void audio.play().catch(() => {
      if (this.audio === audio) this.pendingAudioFile = mediaFile;
    });
  }

  private stopQuestionAudio(): void {
    this.audio?.pause();
    this.audio = null;
    this.audioFile = null;
    this.pendingAudioFile = null;
  }

  private onQuestion(data: Partial<KdQuestion> | null): void {
    this.previousAnswer.set(this.question()?.answer || this.previousAnswer());
    if (!data || typeof data.question !== 'string') {
      this.question.set(null);
      this.turnIndex.set(-1);
      this.stopQuestionAudio();
      return;
    }
    const q = data as KdQuestion;
    this.turnIndex.set(-1);
    this.applyQuestion(q);

    const round = this.round();
    const key = round ? `${round.gamemode}:${round.activePlayerIndex}` : null;
    this.questionNo.set(key === this.turnKey ? this.questionNo() + 1 : 1);
    this.turnKey = key;

    // Round-level state (gamemode / active podium player) only changes
    // between questions, so a fresh REST fetch here keeps it in sync
    // without a bespoke push event for it.
    void this.loadRound();
  }

  getAnswerTurn(): void {
    if (!this.isPlayer() || !this.isMultiplayer() || this.answerButtonDisabled()) return;
    this.network.emit('get-turn-kd');
  }

  protected onKeyDown(event: KeyboardEvent): void {
    if (event.code !== 'Space' || event.repeat) return;
    if (!this.isPlayer() || !this.isMultiplayer() || this.answerButtonDisabled()) return;
    const target = event.target as HTMLElement | null;
    if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) {
      return;
    }
    event.preventDefault();
    this.getAnswerTurn();
  }
}
