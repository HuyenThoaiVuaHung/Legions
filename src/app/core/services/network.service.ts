import { Injectable, signal } from '@angular/core';
import { io, Socket } from 'socket.io-client';
import { STORAGE_KEYS } from '../constants';
import { PublicRoom } from '../contracts/api';
import { BankPresence } from '../contracts/bank';

export enum ConnectionStatus {
  Disconnected = 'disconnected',
  Connecting = 'connecting',
  Connected = 'connected',
  Error = 'error',
}

/**
 * Owns the socket.io connection and the server base URL. Nothing outside
 * this file (and SessionService) may touch the raw Socket.
 */
@Injectable({ providedIn: 'root' })
export class NetworkService {
  private socketRef: Socket | null = null;

  readonly status = signal(ConnectionStatus.Disconnected);
  readonly serverUrl = signal(localStorage.getItem(STORAGE_KEYS.serverUrl) ?? '');

  /** HTTP base for REST/media calls; '' means same-origin. */
  apiBase(): string {
    return this.serverUrl().replace(/\/$/, '');
  }

  /** (Re)connects, replacing any previous socket. Token rides the handshake. */
  connect(url: string, token?: string): Socket {
    this.socketRef?.removeAllListeners();
    this.socketRef?.disconnect();

    this.serverUrl.set(url);
    this.status.set(ConnectionStatus.Connecting);
    const socket = io(url || window.location.origin, {
      auth: token ? { token } : undefined,
    });
    this.socketRef = socket;

    socket.on('connect', () => {
      this.status.set(ConnectionStatus.Connected);
      this.serverUrl.set(url);
      localStorage.setItem(STORAGE_KEYS.serverUrl, url);
    });
    socket.on('connect_error', () => {
      this.status.set(ConnectionStatus.Error);
      socket.disconnect();
    });
    socket.on('disconnect', () => {
      if (this.status() !== ConnectionStatus.Error) {
        this.status.set(ConnectionStatus.Disconnected);
      }
    });
    return socket;
  }

  /** Landing-page room list: a tokenless lobby socket, independent of the session socket. */
  watchRooms(url: string, handler: (rooms: PublicRoom[]) => void): () => void {
    const lobby = io(url || window.location.origin, { auth: { lobby: true } });
    lobby.on('rooms-list', handler);
    return () => { lobby.removeAllListeners(); lobby.disconnect(); };
  }

  /** Authoring has its own account-authenticated connection, independent of live rooms. */
  watchBank(setId: string, tabId: string, changed: () => void, presence: (peers: BankPresence[]) => void, status: (state: 'connected' | 'disconnected' | 'revoked') => void): () => void {
    const socket = io(`${this.apiBase() || window.location.origin}/bank`, {
      auth: { token: localStorage.getItem(STORAGE_KEYS.accountToken), setId, tabId },
    });
    socket.on('changed', changed);
    socket.on('presence', presence);
    socket.on('connect', () => status('connected'));
    socket.on('disconnect', () => status('disconnected'));
    socket.on('connect_error', () => status('disconnected'));
    socket.on('access-revoked', () => { status('revoked'); socket.disconnect(); });
    return () => { socket.removeAllListeners(); socket.disconnect(); };
  }

  closeRoomSocket(): void {
    this.socketRef?.removeAllListeners();
    this.socketRef?.disconnect();
    this.socketRef = null;
    this.status.set(ConnectionStatus.Disconnected);
  }

  disconnect(): void {
    this.closeRoomSocket();
    localStorage.removeItem(STORAGE_KEYS.serverUrl);
  }

  /** Subscribe to a server event. Returns an unsubscribe function. */
  on<T extends unknown[]>(event: string, handler: (...args: T) => void): () => void {
    this.socketRef?.on(event, handler as (...args: unknown[]) => void);
    return () => this.socketRef?.off(event, handler as (...args: unknown[]) => void);
  }

  emit(event: string, ...args: unknown[]): void {
    this.socketRef?.emit(event, ...args);
  }

  /** Emit and wait for the server's ack (2 s timeout). Rejects when offline or on timeout. */
  emitWithAck(event: string, ...args: unknown[]): Promise<unknown> {
    if (!this.socketRef) return Promise.reject(new Error('socket not connected'));
    return this.socketRef.timeout(2000).emitWithAck(event, ...args);
  }

  get connected(): boolean {
    return this.status() === ConnectionStatus.Connected;
  }
}
