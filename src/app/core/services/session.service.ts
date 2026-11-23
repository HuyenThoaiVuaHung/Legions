import { computed, effect, inject, Injectable, signal } from '@angular/core';
import { Router } from '@angular/router';
import { Role, TokenPayload, JoinRoomResponse } from '../contracts/api';
import { LiveStateSnapshot, MatchState } from '../contracts/game';
import { PLAYER_ROUTE_BY_POSITION, STORAGE_KEYS } from '../constants';
import { TokenStore } from './token.store';
import { ApiService } from './api.service';
import { ConfigService, PublicConfig } from './config.service';
import { ConnectionStatus, NetworkService } from './network.service';

const MATCH_UPDATE_EVENT = 'update-match-data';

/**
 * Session state: who we are, the live match, and position-driven navigation.
 * Login is REST (token), realtime sync is the socket handshake with that token.
 */
@Injectable({ providedIn: 'root' })
export class SessionService {
  private readonly api = inject(ApiService);
  private readonly config = inject(ConfigService);
  private readonly network = inject(NetworkService);
  private readonly router = inject(Router);
  private readonly tokens = inject(TokenStore);

  /** Settles once the saved server is connected and the stored token's identity restored; guards wait on it so a refresh keeps the session. */
  readonly ready: Promise<void>;
  readonly identity = signal<TokenPayload | null>(null);
  readonly multiRoom = signal(false);
  readonly serverReady = signal(false);
  readonly followMatch = signal(true);
  /** The room the URL and active token belong to; null on the single-room server and outside rooms. */
  readonly roomCode = computed(() => (this.tokens.code() === TokenStore.DEFAULT ? null : this.tokens.code()));
  /** URL prefix of the active room's pages: `/room/CODE` when hosted, empty otherwise. */
  readonly base = computed(() => (this.roomCode() ? '/room/' + encodeURIComponent(this.roomCode() as string) : ''));
  readonly roomId = computed(() => this.identity()?.roomId ?? null);
  readonly createdRoomAdmin = computed(() => this.role() === Role.Admin && this.multiRoom() && !!this.roomId() && this.roomId() !== 'default');
  readonly roomExpiring = signal<number | null>(null);
  readonly match = signal<MatchState | null>(null);
  readonly liveState = signal<LiveStateSnapshot | null>(null);

  readonly role = computed<Role | null>(() => this.identity()?.roleId ?? null);
  readonly playerIndex = computed(() => this.identity()?.index ?? null);
  readonly self = computed(() => {
    const index = this.playerIndex();
    return index === null ? null : (this.match()?.players[index] ?? null);
  });

  constructor() {
    effect(() => {
      const position = this.match()?.position;
      const role = this.role();
      if (!this.followMatch() || !position || (role !== Role.Player && role !== Role.Viewer)) return;
      if (position === 'H') {
        if (this.multiRoom() || this.router.url.includes('/player')) {
          void this.router.navigateByUrl(this.base() + '/player/waiting');
        }
        return;
      }
      const route = PLAYER_ROUTE_BY_POSITION[position];
      if (route) void this.router.navigateByUrl(this.base() + route);
    });

    const savedUrl = this.network.serverUrl() || window.location.origin;
    this.ready = this.connect(savedUrl).catch(() => undefined);
  }

  get token(): string | null {
    return this.tokens.get();
  }

  /** Connect (or reconnect) to a server; reuses a stored token when present. */
  async connect(url: string): Promise<void> {
    const previousUrl = this.network.serverUrl();
    if (previousUrl && previousUrl.replace(/\/$/, '') !== url.replace(/\/$/, '')) {
      this.clearToken();
      localStorage.removeItem(STORAGE_KEYS.accountToken);
      this.identity.set(null);
    }
    this.serverReady.set(false);
    this.network.closeRoomSocket();
    this.identity.set(null);
    this.match.set(null);
    this.liveState.set(null);
    this.roomExpiring.set(null);
    this.config.reset();
    this.network.serverUrl.set(url);
    this.network.status.set(ConnectionStatus.Connecting);
    try {
      this.multiRoom.set((await this.api.serverInfo()).multiRoom);
    } catch (error) {
      this.network.status.set(ConnectionStatus.Error);
      throw error;
    }
    localStorage.setItem(STORAGE_KEYS.serverUrl, url);
    this.serverReady.set(true);
    if (this.token && (!this.multiRoom() || this.roomCode())) {
      try {
        await this.refreshIdentityFromToken();
      } catch {
        this.clearToken();
      }
    }
    if (this.multiRoom() && !this.roomId()) {
      this.network.closeRoomSocket();
      return;
    }
    await this.loadRoom(this.token ?? undefined);
  }

  /** Exchange a secret for a token, reconnect the socket with it. */
  async login(secret: string): Promise<Role> {
    const response = await this.api.login(secret);
    await this.acceptRoomSession(response);
    return response.roleId;
  }

  /** Where each role starts inside the active room. */
  homeFor(role: Role): string {
    const base = this.base();
    if (role === Role.Admin) return base + '/admin';
    if (role === Role.Mc) return base + '/mc';
    const position = this.match()?.position;
    if (position && position !== 'H') return base + (PLAYER_ROUTE_BY_POSITION[position] ?? '/player/waiting');
    return base + '/player/waiting';
  }

  /** Switch to the room named in the URL; false when there is no usable token for it. */
  async enterRoomCode(code: string): Promise<boolean> {
    if (this.tokens.code() === code && this.identity()) return true;
    this.tokens.use(code);
    this.identity.set(null);
    this.match.set(null);
    this.liveState.set(null);
    this.roomExpiring.set(null);
    this.config.reset();
    this.network.closeRoomSocket();
    const token = this.token;
    if (!token) return false;
    try { await this.refreshIdentityFromToken(); } catch { this.clearToken(); return false; }
    if (this.multiRoom() && !this.roomId()) return false;
    await this.loadRoom(token);
    return true;
  }

  async acceptRoomSession(response: JoinRoomResponse | { token: string; roleId: Role; index?: number; roomId?: string }, code?: string): Promise<void> {
    this.roomExpiring.set(null);
    if (code) this.tokens.use(code);
    this.tokens.set(response.token);
    this.identity.set({ roleId: response.roleId, index: response.index, roomId: response.roomId });
    await this.loadRoom(response.token);
  }

  private async loadRoom(token?: string): Promise<void> {
    this.liveState.set(null);
    let hasConnectedOnce = false;
    this.network.connect(this.network.serverUrl(), token);
    this.network.on<[MatchState]>(MATCH_UPDATE_EVENT, (match) => this.match.set(match));
    this.network.on<[LiveStateSnapshot]>('live-state', (snapshot) => this.liveState.set(snapshot));
    this.network.on<[PublicConfig]>('update-config', (config) => this.config.apply(config));
    this.network.on<[]>('connect', () => {
      if (hasConnectedOnce) {
        // Reconnected after a drop: re-sync match state (server pushes fresh live-state automatically).
        void this.api.getMatch().then((m) => this.match.set(m)).catch(() => undefined);
      }
      hasConnectedOnce = true;
    });
    this.watchRoomExpiry();
    await this.config.load();
    await Promise.all([
      this.api.getMatch().then((m) => this.match.set(m)).catch(() => this.match.set(null)),
      this.api.getLiveState().then((s) => {
        // Don't overwrite a fresher socket snapshot if one already arrived.
        const current = this.liveState();
        if (!current || s.serverTime >= current.serverTime) this.liveState.set(s);
      }).catch(() => undefined),
    ]);
  }

  /**
   * Drop any authenticated session and fall back to an anonymous viewer
   * connection. Idempotent: a no-op when already logged out, so repeated calls
   * (e.g. every visit to the home screen) don't churn the socket.
   */
  logout(): void {
    const wasAuthenticated = this.token !== null || this.identity() !== null;
    if (!wasAuthenticated) return;
    this.clearToken();
    this.identity.set(null);
    this.roomExpiring.set(null);
    if (this.multiRoom()) {
      this.network.closeRoomSocket();
      this.match.set(null);
      this.config.reset();
      return;
    }
    const url = this.network.serverUrl();
    if (url) {
      this.network.connect(url);
      this.network.on<[MatchState]>(MATCH_UPDATE_EVENT, (match) => this.match.set(match));
    }
  }

  disconnect(): void {
    this.clearToken();
    this.identity.set(null);
    this.roomExpiring.set(null);
    this.match.set(null);
    this.serverReady.set(false);
    this.network.disconnect();
  }

  private clearToken(): void {
    this.tokens.clear();
  }

  private watchRoomExpiry(): void {
    this.network.on<[{ expiresAt: number }]>('room-expiring', ({ expiresAt }) => this.roomExpiring.set(expiresAt));
  }

  private async refreshIdentityFromToken(): Promise<void> {
    if (!this.token) return;
    this.identity.set(await this.api.session());
  }
}
