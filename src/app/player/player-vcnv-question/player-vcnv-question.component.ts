import { ChangeDetectionStrategy, Component, DestroyRef, computed, effect, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatFabButton, MatIconButton } from '@angular/material/button';
import { MatFormField } from '@angular/material/form-field';
import { MatIcon } from '@angular/material/icon';
import { MatInput } from '@angular/material/input';
import { Role } from '../../core/contracts/api';
import { VcnvRound } from '../../core/contracts/game';
import { ApiService } from '../../core/services/api.service';
import { MediaService } from '../../core/services/media.service';
import { ClockService } from '../../core/services/clock.service';
import { NetworkService } from '../../core/services/network.service';
import { SessionService } from '../../core/services/session.service';
import { SfxService } from '../../core/services/sfx.service';
import { PlayerListComponent } from '../../components/player-list/player-list.component';

/** VCNV board: 4 hàng ngang rows (index 0-3) and one hàng ngang đặc biệt (index 4). */
const HN_ROW_INDICES = [0, 1, 2, 3] as const;

/**
 * The five obstacle reveal pieces: four corners tied to rows 0-3 and the
 * centre tied to row 4. Corners sit at z-10; center sits at z-20 so revealing
 * the center piece paints cleanly above still-closed corner covers.
 */
const OBSTACLE_PIECES = [
  { index: 0, z: 'z-10', cover: 'top-0 left-0 z-10 bg-primary text-on-primary items-start justify-start p-5' },
  { index: 1, z: 'z-10', cover: 'top-0 right-0 z-10 bg-primary text-on-primary items-start justify-end p-5' },
  { index: 2, z: 'z-10', cover: 'bottom-0 left-0 z-10 bg-primary text-on-primary items-end justify-start p-5' },
  { index: 3, z: 'z-10', cover: 'bottom-0 right-0 z-10 bg-primary text-on-primary items-end justify-end p-5' },
  { index: 4, z: 'z-20', cover: 'center z-20 bg-tertiary text-on-tertiary items-center justify-center' },
] as const;

@Component({
  selector: 'app-player-vcnv-question',
  templateUrl: './player-vcnv-question.component.html',
  styleUrl: './player-vcnv-question.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [PlayerListComponent, MatFormField, MatInput, FormsModule, MatIconButton, MatIcon, MatFabButton],
})
export class PlayerVcnvQuestionComponent {
  private readonly api = inject(ApiService);
  private readonly network = inject(NetworkService);
  private readonly clock = inject(ClockService);
  private readonly sfx = inject(SfxService);
  private readonly media = inject(MediaService);
  private readonly destroyRef = inject(DestroyRef);
  protected readonly session = inject(SessionService);
  protected readonly Role = Role;
  protected readonly hnRowIndices = HN_ROW_INDICES;

  protected readonly round = signal<VcnvRound | null>(null);
  protected readonly currentTime = this.clock.main.seconds;
  protected readonly playerAnswer = signal('');
  protected readonly answerCache = signal('');
  private readonly pieceUrls = signal<Readonly<Record<number, string>>>({});
  private lastPieceToken = '';
  private readonly loadingPieces = new Set<number>();

  /** The row/obstacle currently being read out — server marks it isShown. */
  protected readonly activeQuestion = computed(
    () => this.round()?.questions.find((q) => q.isShown) ?? null,
  );

  /**
   * One layer per obstacle piece. `open` mirrors the server's reveal state;
   * only open pieces are fetched via authenticated HTTP blob requests, and
   * the server independently refuses any piece whose row is still closed.
   */
  protected readonly obstaclePieces = computed(() => {
    const round = this.round();
    if (!round) return [];
    const urls = this.pieceUrls();
    return OBSTACLE_PIECES.map((piece) => ({
      ...piece,
      label: piece.index + 1,
      open: round.questions[piece.index]?.isOpen === true,
      url: urls[piece.index] ?? '',
    }));
  });

  protected readonly disabledObstacleButton = computed(() => {
    const index = this.session.playerIndex();
    return index === null || (this.round()?.disabledPlayers.includes(index) ?? false);
  });

  protected readonly obstacleLength = computed(
    () => this.round()?.obstacle.answer.replace(/\s/g, '').length ?? 0,
  );

  /** Row text: masked with ◯ while closed, ⬤ once shown-but-unsolved, plain once open. */
  protected readonly rowStrings = computed(() => {
    const round = this.round();
    if (!round) return [] as string[];
    return round.questions.map((q) => {
      const clean = q.answer.replace(/\s/g, '').toUpperCase();
      if (q.isOpen) return clean;
      return (q.isShown ? '⬤' : '◯').repeat(clean.length);
    });
  });

  private audio: HTMLAudioElement | null = null;
  private audioFile: string | null = null;
  private pendingAudioFile: string | null = null;

  constructor() {
    void this.loadRound();
    this.network.emit('request-live-state');

    const offs = [
      this.sfx.onUnlock(() => {
        if (this.pendingAudioFile) {
          const file = this.pendingAudioFile;
          this.pendingAudioFile = null;
          this.startQuestionAudio(file);
        }
      }),
      this.network.on<[string]>('play-sfx', (code) => this.sfx.play(code)),
      this.network.on<[VcnvRound]>('update-vcnv-data', (data) => this.onRound(data)),
    ];
    this.destroyRef.onDestroy(() => {
      offs.forEach((off) => off());
      this.stopQuestionAudio();
      this.revokePieceUrls();
    });

    effect(() => {
      const round = this.round();
      if (!round) return;
      const token = round.obstacle.imagePieceFiles?.join(',') ?? '';
      if (token !== this.lastPieceToken) {
        this.lastPieceToken = token;
        this.loadingPieces.clear();
        this.revokePieceUrls();
      }
      if (!round.obstacle.imagePieceFiles?.length) return;
      for (const piece of OBSTACLE_PIECES) {
        if (round.questions[piece.index]?.isOpen !== true) continue;
        if (this.pieceUrls()[piece.index] || this.loadingPieces.has(piece.index)) continue;
        void this.fetchPiece(piece.index, token);
      }
    });
  }

  private async fetchPiece(index: number, token: string): Promise<void> {
    this.loadingPieces.add(index);
    try {
      const blob = await this.api.getObstaclePiece(index);
      if (token !== this.lastPieceToken) return;
      const url = URL.createObjectURL(blob);
      this.pieceUrls.update((current) => {
        if (current[index]) URL.revokeObjectURL(current[index]);
        return { ...current, [index]: url };
      });
    } catch {
      // Piece may not be available or not yet revealed.
    } finally {
      this.loadingPieces.delete(index);
    }
  }

  private revokePieceUrls(): void {
    const current = this.pieceUrls();
    for (const url of Object.values(current)) URL.revokeObjectURL(url);
    if (Object.keys(current).length > 0) this.pieceUrls.set({});
  }

  private async loadRound(): Promise<void> {
    this.onRound(await this.api.getRound('vcnv'));
  }

  private onRound(data: VcnvRound): void {
    this.round.set(data);
    const selfIndex = this.session.playerIndex();
    if (selfIndex !== null) {
      const ownAnswer = data.playerAnswers[selfIndex]?.answer ?? '';
      if (ownAnswer) this.answerCache.set(ownAnswer.toUpperCase());
    }
    const active = data.questions.find((q) => q.isShown);
    if (active?.type === 'HN_S' && active.audioFile) {
      if (this.audioFile !== active.audioFile) {
        this.startQuestionAudio(active.audioFile);
      }
    } else {
      this.stopQuestionAudio();
    }
  }

  private startQuestionAudio(file: string): void {
    this.stopQuestionAudio();
    this.audioFile = file;
    const audio = new Audio(this.media.resolve('vcnv', file));
    this.audio = audio;
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

  submitAnswer(): void {
    if (!this.clock.main.running() || !this.playerAnswer().trim()) return;
    this.answerCache.set(this.playerAnswer().toUpperCase());
    this.network.emit('submit-answer-vcnv', this.playerAnswer());
    this.playerAnswer.set('');
  }

  attemptObstacle(): void {
    this.network.emit('attempt-cnv-player', Date.now());
    this.sfx.play('VCNV_OBSTACLE');
  }

  clearAnswerIfExpired(): void {
    if (this.currentTime() <= 0) this.playerAnswer.set('');
  }
}
