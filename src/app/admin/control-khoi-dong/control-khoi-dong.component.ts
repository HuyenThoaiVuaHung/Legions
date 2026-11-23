import { ChangeDetectionStrategy, Component, DestroyRef, computed, effect, inject, signal, untracked } from '@angular/core';
import { MatSlideToggle } from '@angular/material/slide-toggle';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatButton } from '@angular/material/button';
import {
  MatCard,
  MatCardActions,
  MatCardContent,
  MatCardHeader,
  MatCardSubtitle,
  MatCardTitle,
} from '@angular/material/card';
import { MatCheckbox } from '@angular/material/checkbox';
import { MatDialog } from '@angular/material/dialog';
import { MatFormField, MatLabel } from '@angular/material/form-field';
import { MatIcon } from '@angular/material/icon';
import { MatOption, MatSelect } from '@angular/material/select';
import { CellEdit, EditableTableComponent, TableCellDirective, TableColumn } from '../../components/editable-table/editable-table.component';
import { MatTooltip } from '@angular/material/tooltip';
import { FormQKdComponent } from '../../components/forms/form-q-kd/form-q-kd.component';
import { MenuItemComponent } from '../../components/menu-item/menu-item.component';
import { KdGamemode, KdMarkCommand, KdMarkRejectReason, KdQuestion, KdRound, Player } from '../../core/contracts/game';
import { ConfigService } from '../../core/services/config.service';
import { KdFlowService } from '../../core/services/kd-flow.service';
import { ApiService } from '../../core/services/api.service';
import { ClockService } from '../../core/services/clock.service';
import { NetworkService } from '../../core/services/network.service';
import { SessionService } from '../../core/services/session.service';
import { queryParamState } from '../../core/query-param';

/** Question counts per Olympia rules: 6 per singleplayer turn, 12 head-to-head. */
const SINGLEPLAYER_QUESTIONS = 6;
const MULTIPLAYER_QUESTIONS = 12;

import { ResizeGroupDirective } from '../../components/resizable/resize-group.directive';

const REJECT_MESSAGES: Record<KdMarkRejectReason, string> = {
  'stale-question': 'Câu hỏi đã chuyển, lệnh chấm không còn hiệu lực.',
  'wrong-player': 'Thí sinh giành quyền đã thay đổi, lệnh chấm bị từ chối.',
  'bad-phase': 'Chưa thể chấm ở giai đoạn hiện tại.',
  'nothing-to-undo': 'Không có lần chấm nào để hoàn tác.',
};

@Component({
  selector: 'app-control-khoi-dong',
  templateUrl: './control-khoi-dong.component.html',
  styleUrls: ['./control-khoi-dong.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    ResizeGroupDirective,
    MatButton,
    MatCard,
    MatCardActions,
    MatCardContent,
    MatCardHeader,
    MatCardSubtitle,
    MatCardTitle,
    MatCheckbox,
    MatSlideToggle,
    MatFormField,
    MatLabel,
    MatIcon,
    MatOption,
    MatSelect,
    EditableTableComponent,
    TableCellDirective,
    MatTooltip,
    MenuItemComponent,
  ],
})
export class ControlKhoiDongComponent {
  private readonly api = inject(ApiService);
  private readonly network = inject(NetworkService);
  private readonly clock = inject(ClockService);
  private readonly dialog = inject(MatDialog);
  private readonly snackBar = inject(MatSnackBar);
  private readonly config = inject(ConfigService);
  protected readonly kdFlow = inject(KdFlowService);
  protected readonly session = inject(SessionService);

  protected readonly questionColumns: readonly TableColumn[] = [
    { key: 'question', label: 'Câu hỏi', flex: 3, edit: 'text' },
    { key: 'answer', label: 'Đáp án', flex: 2, edit: 'text' },
    { key: 'type', label: 'Loại', flex: 1 },
  ];
  protected readonly playerColumns: readonly TableColumn[] = [
    { key: 'id', label: 'ID', flex: 0.5 },
    { key: 'name', label: 'Tên', flex: 2, edit: 'text', sortable: true },
    { key: 'score', label: 'Điểm', flex: 1, edit: 'number', sortable: true, align: 'end' },
    { key: 'active', label: 'Đã kết nối?', flex: 1 },
  ];
  protected readonly singleplayerQuestions = SINGLEPLAYER_QUESTIONS;
  protected readonly multiplayerQuestions = MULTIPLAYER_QUESTIONS;

  protected readonly round = signal<KdRound | null>(null);
  protected readonly currentTime = this.clock.main.seconds;
  protected readonly displayingRow = signal<KdQuestion | null>(null);
  /** Name of the player who buzzed in ('' when nobody holds the turn). */
  protected readonly lastTurnName = signal('');
  protected readonly maxQuestionNo = signal(0);
  protected readonly currentQuestionNo = signal(0);
  /** [admin countdown, player countdown] seconds. */
  protected readonly threeSecTimers = computed<[number, number]>(() => [this.clock.kdTurnTenths(), this.clock.kdAnswerTenths()]);

  private questionCount = 0;
  /** Last questionSeq we auto-advanced from, so one grade never advances twice. */
  private advancedSeq = -1;

  protected readonly isMultiplayer = computed(() => this.round()?.gamemode === 'M');
  protected readonly flow = this.kdFlow.flow;
  protected readonly flowTurnIndex = computed(() => this.flow()?.turnPlayerIndex ?? -1);
  protected readonly flowTurnName = computed(() => this.players()[this.flowTurnIndex()]?.name ?? '');
  private readonly markPhase = computed(() => {
    const phase = this.flow()?.phase;
    return phase === 'answering' || phase === 'awaitingMark';
  });
  protected readonly canGrade = computed(() => this.isMultiplayer() && this.markPhase() && this.flowTurnIndex() >= 0);
  protected readonly canNoAnswer = computed(() => this.isMultiplayer() && this.markPhase());
  protected readonly canUndo = computed(() => this.isMultiplayer() && !!this.flow()?.lastMark);
  protected readonly autoWrong = computed(
    () => (this.flow()?.timeUpMode ?? this.config.rules().kdTimeUpMode) === 'autoWrong',
  );
  protected readonly phaseLabel = computed(() => {
    const flow = this.flow();
    const clock = this.clock.kdDecision;
    const tenths = (clock.tenths() / 10).toFixed(1);
    switch (flow?.phase) {
      case 'reading':
        return 'Đang đọc';
      case 'buzzWindow':
        return `Mở chuông ${tenths}s`;
      case 'answering':
        return `${this.flowTurnName() || 'Thí sinh'} trả lời ${tenths}s`;
      case 'awaitingMark':
        return 'Chờ chấm';
      case 'resolved':
        return 'Đã chấm';
      default:
        return 'Chưa bắt đầu';
    }
  });

  /** Chosen question index within the shown list, kept in the URL ("q"). */
  private readonly chosenIndex = queryParamState('q');
  protected readonly chosenRow = computed<KdQuestion | null>(() => {
    const raw = this.chosenIndex.value();
    const index = raw !== null && /^\d+$/.test(raw) ? Number(raw) : -1;
    return this.currentQuestionList()[index] ?? null;
  });

  protected readonly players = computed(() => this.session.match()?.players ?? []);

  protected readonly currentQuestionList = computed<KdQuestion[]>(() => {
    const round = this.round();
    if (!round) return [];
    return round.gamemode === 'S'
      ? (round.questions.singleplayer[round.activePlayerIndex] ?? [])
      : round.questions.multiplayer;
  });

  protected readonly activePlayer = computed<Player | null>(() => this.players()[this.round()?.activePlayerIndex ?? -1] ?? null);

  protected readonly currentQuestionListName = computed(() => {
    const round = this.round();
    if (round?.gamemode === 'M') return 'Đối kháng';
    if (round?.gamemode === 'S') {
      const player = this.players()[round.activePlayerIndex];
      return `Cá nhân - Người chơi ${player?.name ?? '?'}`;
    }
    return 'Không xác định';
  });

  constructor() {
    const destroyRef = inject(DestroyRef);
    for (const off of [
      this.network.on<[KdRound]>('update-kd-data-admin', (data) => this.round.set(data)),
      this.network.on<[number, number]>('update-number-question-kd', (max, curr) => {
        this.maxQuestionNo.set(max);
        this.currentQuestionNo.set(curr);
      }),
      this.network.on<[number]>('player-got-turn-kd', (playerIndex) =>
        this.lastTurnName.set(this.session.match()?.players[playerIndex]?.name ?? ''),
      ),
      this.network.on('next-question', () => {
        this.nextQuestion();
        this.lastTurnName.set('');
      }),
    ]) {
      destroyRef.onDestroy(off);
    }
    // Leaving the KD screen (another admin section, home, logout) silences the looping music.
    destroyRef.onDestroy(() => this.network.emit('stop-kd-sound'));
    void this.init();

    const baselineResolved = this.kdFlow.lastResolved();
    effect(() => {
      const resolved = this.kdFlow.lastResolved();
      if (!resolved || resolved === baselineResolved) return;
      untracked(() => {
        if (!this.isMultiplayer() || resolved.questionSeq <= this.advancedSeq) return;
        this.advancedSeq = resolved.questionSeq;
        this.nextQuestion(resolved.questionSeq);
        this.lastTurnName.set('');
      });
    });

    const baselineRejected = this.kdFlow.lastRejected();
    effect(() => {
      const rejected = this.kdFlow.lastRejected();
      if (!rejected || rejected === baselineRejected) return;
      this.snackBar.open(REJECT_MESSAGES[rejected.reason], 'Đóng', { duration: 4000 });
    });
  }

  private sendMark(event: 'correct-mark-kd' | 'wrong-mark-kd' | 'no-answer-kd'): void {
    const flow = this.flow();
    if (!flow) return;
    const command: KdMarkCommand = { questionSeq: flow.questionSeq, playerIndex: flow.turnPlayerIndex };
    this.network.emit(event, command);
  }

  markNoAnswer(): void {
    if (this.canNoAnswer()) this.sendMark('no-answer-kd');
  }

  undoMark(): void {
    this.network.emit('undo-mark-kd');
  }

  async setAutoWrong(on: boolean): Promise<void> {
    try {
      await this.config.updateRules({ kdTimeUpMode: on ? 'autoWrong' : 'manual' });
    } catch {
      this.snackBar.open('Không thể đổi chế độ hết giờ.', 'Đóng', { duration: 4000 });
    }
  }

  private async init(): Promise<void> {
    this.round.set(await this.api.getRound('kd'));
    this.session.match.set(await this.api.setPosition('KD'));
  }

  onClickQuestion(row: KdQuestion): void {
    const index = this.currentQuestionList().indexOf(row);
    this.chosenIndex.set(index >= 0 ? String(index) : null);
  }

  onDoubleClickQuestion(row: KdQuestion): void {
    this.displayingRow.set(row);
    this.network.emit('broadcast-kd-question', row);
  }

  /** Puts a player on the singleplayer podium. */
  async onDoubleClickPlayer(row: Player): Promise<void> {
    const index = this.players().indexOf(row);
    if (index < 0) return;
    this.chosenIndex.set(null);
    this.round.set(await this.api.patchKdControl({ activePlayerIndex: index }));
  }

  async saveQuestionCell(edit: CellEdit<KdQuestion>): Promise<void> {
    const round = this.round();
    if (!round) return;
    const updated = structuredClone(round);
    const list = updated.gamemode === 'S' ? updated.questions.singleplayer[updated.activePlayerIndex] : updated.questions.multiplayer;
    const question = list?.[edit.index];
    if (!question) return;
    Object.assign(question, { [edit.key]: edit.value });
    this.round.set(await this.api.putRound('kd', updated));
  }

  async savePlayerCell(edit: CellEdit<Player>): Promise<void> {
    this.session.match.set(await this.api.updatePlayer(edit.index, { ...edit.row, [edit.key]: edit.value }));
  }

  async onGamemodeChange(gamemode: KdGamemode): Promise<void> {
    this.chosenIndex.set(null);
    this.round.set(await this.api.patchKdControl({ gamemode }));
  }

  editQuestion(): void {
    const round = this.round();
    const chosen = this.chosenRow();
    if (!round || !chosen) return;
    const questionIndex = this.currentQuestionList().indexOf(chosen);
    if (questionIndex < 0) return;
    const dialogRef = this.dialog.open<FormQKdComponent, KdQuestion, KdQuestion>(
      FormQKdComponent,
      { data: structuredClone(chosen) },
    );
    dialogRef.afterClosed().subscribe(async (result) => {
      if (!result) return;
      const updated = structuredClone(round);
      if (updated.gamemode === 'S') {
        updated.questions.singleplayer[updated.activePlayerIndex][questionIndex] = result;
      } else {
        updated.questions.multiplayer[questionIndex] = result;
      }
      this.round.set(await this.api.putRound('kd', updated));
      this.chosenIndex.set(null);
    });
  }

  playSfx(sfxId: string, loop?: boolean): void {
    this.network.emit('play-sfx', sfxId, loop);
  }

  roundStart(amount: number): void {
    this.network.emit('start-turn-kd', amount);
    this.network.emit('stop-kd-sound');
    this.maxQuestionNo.set(amount);
    this.currentQuestionNo.set(0);
    this.questionCount = 0;
    this.playSfx('KD_60S', true);
    this.nextQuestion();
  }

  clockPause(): void {
    this.network.emit('play-pause-clock');
  }

  start3sTimer(): void {
    this.network.emit('start-3s-timer-kd', this.lastTurnName() !== '');
  }

  resetTurn(): void {
    this.network.emit('clear-turn-kd');
    this.lastTurnName.set('');
  }

  markCorrect(): void {
    if (this.isMultiplayer()) {
      if (!this.canGrade()) return;
      this.sendMark('correct-mark-kd');
      this.playSfx('KD_CORRECT');
      return;
    }
    if (this.lastTurnName() === '' && this.round()?.gamemode !== 'S') return;
    this.network.emit('correct-mark-kd');
    this.network.emit('stop-3s-timer-kd');
    this.playSfx('KD_CORRECT');
    this.network.emit('clear-turn-kd');
    this.nextQuestion();
    this.lastTurnName.set('');
  }

  markWrong(): void {
    if (this.isMultiplayer()) {
      if (!this.canGrade()) return;
      this.sendMark('wrong-mark-kd');
      this.playSfx('KD_WRONG');
      return;
    }
    if (this.lastTurnName() === '' && this.round()?.gamemode !== 'S') return;
    this.network.emit('stop-3s-timer-kd');
    this.network.emit('wrong-mark-kd');
    this.playSfx('KD_WRONG');
    this.network.emit('clear-turn-kd');
    this.nextQuestion();
    this.lastTurnName.set('');
  }

  nextQuestion(replacesSeq?: number): void {
    if (this.questionCount >= this.maxQuestionNo()) {
      this.network.emit('stop-kd-sound');
      return;
    }
    const next = this.currentQuestionList()[this.questionCount];
    if (!next) return;
    this.displayingRow.set(next);
    if (replacesSeq === undefined) this.network.emit('broadcast-kd-question', next);
    else this.network.emit('broadcast-kd-question', next, replacesSeq);
    this.questionCount += 1;
    this.network.emit('update-number-question-kd', this.maxQuestionNo(), this.questionCount);
  }

  clearQuestion(): void {
    this.network.emit('clear-question-kd');
  }
}
