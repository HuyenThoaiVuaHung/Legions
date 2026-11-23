import { HttpClient } from '@angular/common/http';
import { inject, Injectable, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { PublicUi } from '../contracts/api';
import { NetworkService } from './network.service';

/**
 * Runtime game knobs. Mirror of the backend `PublicConfig` served at
 * GET /api/config (keep the shapes in sync with legendary's
 * src/http/config.routes.ts + src/game.rules.ts).
 */
export interface GameRules {
  playerCount: number;
  mainClockTickMs: number;
  decisionTickMs: number;
  kdCorrectPoints: number;
  kdWrongPenalty: number;
  kdDecisionTicks: number;
  kdClockStartDelayMs: number;
  vcnvRowPoints: number;
  obstacleValueByRevealedCount: Record<number, number>;
  ttPointsByPlacement: number[];
  ttQuestionSeconds: number[];
  ttVideoSeconds: number;
  vdStealTicks: number;
  vdWrongPenaltyDivisor: number;
  vdHopeStarMultiplier: number;
  chpTurnSeconds: number;
  chpCorrectPoints: number;
}

export interface PublicConfig {
  rules: GameRules;
  ui: PublicUi;
  playerCount: number;
  uploadLimitBytes: number;
}

/** Defaults used until the server config loads (and if it can't be reached). */
const DEFAULT_RULES: Readonly<GameRules> = {
  playerCount: 4,
  mainClockTickMs: 1000,
  decisionTickMs: 100,
  kdCorrectPoints: 10,
  kdWrongPenalty: 5,
  kdDecisionTicks: 30,
  kdClockStartDelayMs: 1000,
  vcnvRowPoints: 10,
  obstacleValueByRevealedCount: { 0: 60, 1: 60, 2: 50, 3: 40, 4: 30, 5: 20 },
  ttPointsByPlacement: [40, 30, 20, 10],
  ttQuestionSeconds: [20, 20, 30, 30],
  ttVideoSeconds: 30,
  vdStealTicks: 50,
  vdWrongPenaltyDivisor: 2,
  vdHopeStarMultiplier: 2,
  chpTurnSeconds: 15,
  chpCorrectPoints: 1,
};

function copyRules(rules: GameRules): GameRules {
  return {
    ...rules,
    obstacleValueByRevealedCount: { ...rules.obstacleValueByRevealedCount },
    ttPointsByPlacement: [...rules.ttPointsByPlacement],
    ttQuestionSeconds: [...(rules.ttQuestionSeconds ?? DEFAULT_RULES.ttQuestionSeconds)],
  };
}

/** Fetches and caches the server's runtime knobs. */
@Injectable({ providedIn: 'root' })
export class ConfigService {
  private readonly http = inject(HttpClient);
  private readonly network = inject(NetworkService);
  readonly ui = signal<PublicUi | null>(null);

  readonly rules = signal<GameRules>(copyRules(DEFAULT_RULES));
  readonly uploadLimitBytes = signal<number>(0);

  /** Load the config for the connected server; falls back to defaults. */
  async load(): Promise<void> {
    try {
      const config = await firstValueFrom(
        this.http.get<PublicConfig>(`${this.network.apiBase()}/api/config`),
      );
      this.apply(config);
    } catch {
      this.reset();
    }
  }

  reset(): void {
    this.rules.set(copyRules(DEFAULT_RULES));
    this.ui.set(null);
    this.uploadLimitBytes.set(0);
  }

  /** Apply a config payload (from GET, PATCH, or the update-config push). */
  apply(config: PublicConfig): void {
    this.rules.set(copyRules(config.rules));
    this.ui.set(config.ui ?? null);
    this.uploadLimitBytes.set(config.uploadLimitBytes);
  }

  /** Admin: persist edited game rules; the server echoes the full config. */
  async updateRules(patch: Partial<GameRules>): Promise<void> {
    const config = await firstValueFrom(
      this.http.patch<PublicConfig>(`${this.network.apiBase()}/api/config`, patch),
    );
    this.apply(config);
  }
}
