import { Injectable, NgZone, computed, effect, inject, signal, untracked } from '@angular/core';
import { CountdownView, TimerId } from '../contracts/game';
import { ConnectionStatus, NetworkService } from './network.service';
import { SessionService } from './session.service';

const SYNC_SAMPLES_ON_CONNECT = 5;
const SYNC_SAMPLES_ON_RESYNC = 3;
const SYNC_INTERVAL_MS = 30_000;

const IDLE_VIEW = (id: TimerId): CountdownView => ({
  id,
  status: 'idle',
  durationMs: 0,
  remainingMs: 0,
  startsAt: null,
  deadline: null,
  serverTime: 0,
  seq: 0,
});

/** Reactive read-side of one server countdown. */
export interface ClockTimer {
  readonly view: () => CountdownView;
  readonly status: () => CountdownView['status'];
  readonly owner: () => CountdownView['owner'];
  readonly remainingMs: () => number;
  /** Whole seconds, rounded up (matches the legacy 'update-clock'). */
  readonly seconds: () => number;
  /** Tenths of a second, rounded up (matches the legacy 3s/5s decision timers). */
  readonly tenths: () => number;
  /** Full duration of the current/last run in whole seconds, for progress rings. */
  readonly maxSeconds: () => number;
  /** True only while the countdown is actually running (answers/buzzes accepted). */
  readonly running: () => boolean;
}

/**
 * Server-authoritative countdowns. The server sends a 'clock-state' view on
 * every transition; this service renders them locally from the deadline,
 * corrected by a 'time-sync' offset, so no per-tick traffic is needed.
 */
@Injectable({ providedIn: 'root' })
export class ClockService {
  private readonly network = inject(NetworkService);
  private readonly session = inject(SessionService);
  private readonly zone = inject(NgZone);

  /** serverEpochMs - clientEpochMs, from the lowest-RTT sample. */
  readonly offsetMs = signal(0);
  private readonly now = signal(Date.now());
  private readonly views = signal<Record<TimerId, CountdownView>>({
    main: IDLE_VIEW('main'),
    kdDecision: IDLE_VIEW('kdDecision'),
    vdSteal: IDLE_VIEW('vdSteal'),
  });
  private readonly lastSeq: Partial<Record<TimerId, number>> = {};

  readonly main = this.makeTimer('main');
  readonly kdDecision = this.makeTimer('kdDecision');
  readonly vdSteal = this.makeTimer('vdSteal');

  /** Tenths left on the admin-owned KD buzz window (0 when owned by a player). */
  readonly kdTurnTenths = computed(() => (this.kdDecision.owner() === 'admin' ? this.kdDecision.tenths() : 0));
  /** Tenths left on the player-owned KD answer window (0 when owned by admin). */
  readonly kdAnswerTenths = computed(() => (this.kdDecision.owner() === 'player' ? this.kdDecision.tenths() : 0));

  private readonly ticking = computed(() =>
    Object.values(this.views()).some((v) => v.status === 'running' || v.status === 'pending'),
  );
  private rafId = 0;
  private offs: Array<() => void> = [];
  private syncTimer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    effect(() => {
      const timers = this.session.liveState()?.timers;
      if (timers) untracked(() => Object.values(timers).forEach((v) => this.apply(v)));
    });

    effect(() => {
      const connected = this.network.status() === ConnectionStatus.Connected;
      untracked(() => (connected ? this.onConnected() : this.onDisconnected()));
    });

    effect((onCleanup) => {
      if (!this.ticking()) return;
      this.startLoop();
      onCleanup(() => this.stopLoop());
    });
  }

  timer(id: TimerId): ClockTimer {
    return id === 'main' ? this.main : id === 'kdDecision' ? this.kdDecision : this.vdSteal;
  }

  /** Server epoch ms, estimated from the local clock and the sync offset. */
  serverNow(): number {
    return Date.now() + this.offsetMs();
  }

  private makeTimer(id: TimerId): ClockTimer {
    const view = computed(() => this.views()[id]);
    const remainingMs = computed(() => {
      const v = view();
      switch (v.status) {
        case 'paused':
          return v.remainingMs;
        case 'running':
        case 'pending': {
          if (v.deadline === null) return v.remainingMs;
          const left = v.deadline - (this.now() + this.offsetMs());
          return Math.max(0, Math.min(v.status === 'pending' ? v.durationMs : left, left));
        }
        default:
          return 0;
      }
    });
    return {
      view,
      status: computed(() => view().status),
      owner: computed(() => view().owner),
      remainingMs,
      seconds: computed(() => Math.ceil(remainingMs() / 1000)),
      tenths: computed(() => Math.ceil(remainingMs() / 100)),
      maxSeconds: computed(() => Math.ceil(view().durationMs / 1000)),
      running: computed(() => view().status === 'running'),
    };
  }

  private apply(view: CountdownView): void {
    const last = this.lastSeq[view.id];
    if (last !== undefined && view.seq <= last) return;
    this.lastSeq[view.id] = view.seq;
    this.views.update((all) => ({ ...all, [view.id]: view }));
    this.now.set(Date.now());
  }

  private onConnected(): void {
    this.offs.forEach((off) => off());
    this.offs = [this.network.on<[CountdownView]>('clock-state', (view) => this.apply(view))];
    void this.sync(SYNC_SAMPLES_ON_CONNECT);
    this.syncTimer ??= setInterval(() => void this.sync(SYNC_SAMPLES_ON_RESYNC), SYNC_INTERVAL_MS);
  }

  private onDisconnected(): void {
    this.offs.forEach((off) => off());
    this.offs = [];
    if (this.syncTimer) clearInterval(this.syncTimer);
    this.syncTimer = null;
    for (const key of Object.keys(this.lastSeq) as TimerId[]) delete this.lastSeq[key];
  }

  /** NTP-style: keep the offset of the sample with the smallest round trip. */
  private async sync(samples: number): Promise<void> {
    let best: { rtt: number; offset: number } | null = null;
    for (let i = 0; i < samples; i++) {
      const t0 = Date.now();
      try {
        const serverMs = Number(await this.network.emitWithAck('time-sync', t0));
        const t1 = Date.now();
        const rtt = t1 - t0;
        if (Number.isFinite(serverMs) && (!best || rtt < best.rtt)) {
          best = { rtt, offset: serverMs - (t0 + rtt / 2) };
        }
      } catch {
        // timed out or disconnected; try the next sample
      }
    }
    if (best) this.offsetMs.set(Math.round(best.offset));
  }

  private startLoop(): void {
    if (typeof requestAnimationFrame === 'undefined') return;
    this.zone.runOutsideAngular(() => {
      const frame = () => {
        this.now.set(Date.now());
        this.rafId = requestAnimationFrame(frame);
      };
      this.rafId = requestAnimationFrame(frame);
    });
  }

  private stopLoop(): void {
    if (this.rafId && typeof cancelAnimationFrame !== 'undefined') cancelAnimationFrame(this.rafId);
    this.rafId = 0;
    this.now.set(Date.now());
  }
}
