import { NgClass } from '@angular/common';
import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { KdQuestion } from '../../core/contracts/game';
import { ClockService } from '../../core/services/clock.service';
import { ConnectionStatus, NetworkService } from '../../core/services/network.service';
import { MediaService } from '../../core/services/media.service';
import { SessionService } from '../../core/services/session.service';
import { KdFlowService } from '../../core/services/kd-flow.service';

/**
 * KD (Khởi động) broadcast overlay: current question, turn indicator and
 * countdown, driven entirely by realtime pushes from the MC/admin screens.
 */
@Component({
  selector: 'app-sc-khoi-dong',
  templateUrl: './sc-khoi-dong.component.html',
  styleUrl: './sc-khoi-dong.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [NgClass],
})
export class ScKhoiDongComponent {
  private readonly session = inject(SessionService);
  private readonly network = inject(NetworkService);
  private readonly clock = inject(ClockService);
  private readonly media = inject(MediaService);
  protected readonly kdFlow = inject(KdFlowService);
  private readonly destroyRef = inject(DestroyRef);

  readonly players = computed(() => this.session.match()?.players ?? []);

  readonly currentQuestion = signal<KdQuestion | null>(null);
  readonly questionNumber = signal(0);
  readonly maxQuestionCount = signal(0);
  readonly turnPlayerIndex = signal<number | null>(null);
  readonly clockSeconds = this.clock.main.seconds;
  /** Tenths of a second left on the "get the turn" / "answer" buzzer windows. */
  readonly turnTimerTenths = this.clock.kdTurnTenths;
  readonly answerTimerTenths = this.clock.kdAnswerTenths;

  constructor() {
    // Overlay pages are opened directly (OBS browser source) rather than
    // through the login flow, so connect ourselves when nothing already has.
    if (this.network.status() === ConnectionStatus.Disconnected) {
      void this.session.connect(this.network.serverUrl());
    }

    const unsubs = [
      this.network.on<[KdQuestion | null]>('update-kd-question', (question) =>
        this.currentQuestion.set(question ?? null),
      ),
      this.network.on<[number, number]>('update-number-question-kd', (max, current) => {
        this.maxQuestionCount.set(max);
        this.questionNumber.set(current);
      }),
      this.network.on<[number]>('player-got-turn-kd', (playerIndex) =>
        this.turnPlayerIndex.set(playerIndex),
      ),
      this.network.on<[]>('clear-turn-player-kd', () => this.turnPlayerIndex.set(null)),
    ];
    this.destroyRef.onDestroy(() => unsubs.forEach((unsub) => unsub()));
  }

  resolveImage(question: KdQuestion): string {
    return this.media.resolve('kd', question.mediaFile);
  }
}
