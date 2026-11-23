import { Injectable, computed, effect, inject, signal } from '@angular/core';
import { KdFlowState, KdMarkRejected, KdResolved } from '../contracts/game';
import { NetworkService } from './network.service';
import { SessionService } from './session.service';

/** Mirror of the server-owned multiplayer KD state machine ('kd-phase', snapshot kd.flow). */
@Injectable({ providedIn: 'root' })
export class KdFlowService {
  private readonly network = inject(NetworkService);
  private readonly session = inject(SessionService);

  /** Null until the server has sent flow state (older servers never do). */
  readonly flow = signal<KdFlowState | null>(null);
  readonly lastRejected = signal<KdMarkRejected | null>(null);
  readonly lastResolved = signal<KdResolved | null>(null);

  /** True only while the buzzer is open; null when the server sent no flow state. */
  readonly buzzerOpen = computed(() => {
    const flow = this.flow();
    return flow ? flow.phase === 'buzzWindow' : null;
  });

  /** Viewer-facing phase text (Vietnamese); empty when there is no flow or the phase is idle. */
  readonly statusText = computed(() => {
    const flow = this.flow();
    if (!flow) return '';
    const name = this.session.match()?.players[flow.turnPlayerIndex]?.name ?? '';
    switch (flow.phase) {
      case 'reading':
        return 'Chuông đang khóa';
      case 'buzzWindow':
        return 'Chuông đang mở';
      case 'answering':
        return `${name || 'Thí sinh'} đang trả lời`;
      case 'awaitingMark':
        return 'Chờ chấm';
      case 'resolved':
        return 'Đã chấm';
      default:
        return '';
    }
  });

  constructor() {
    effect(() => {
      const flow = this.session.liveState()?.kd?.flow;
      if (flow) this.flow.set(flow);
    });
    this.network.on<[KdFlowState]>('kd-phase', (flow) => this.flow.set(flow));
    this.network.on<[KdMarkRejected]>('kd-mark-rejected', (rejected) => this.lastRejected.set({ ...rejected }));
    this.network.on<[KdResolved]>('kd-resolved', (resolved) => this.lastResolved.set({ ...resolved }));
  }
}
