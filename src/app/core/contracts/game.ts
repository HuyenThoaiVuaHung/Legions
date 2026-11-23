/**
 * Canonical game contracts, shared verbatim with the Legion frontend
 * (mirrored at Legion/src/app/core/contracts/game.ts — keep in sync).
 *
 * Index convention: every player reference is a 0-based index into
 * MatchState.players. Player.id remains the 1-based display number.
 */

export const ROUND_KINDS = ['kd', 'vcnv', 'tt', 'vd', 'chp'] as const;
export type RoundKind = (typeof ROUND_KINDS)[number];

export const MATCH_POSITIONS = [
  'H',
  'KD',
  'VCNV_Q',
  'VCNV_A',
  'TT_Q',
  'TT_A',
  'VD',
  'CHP',
  'PNTS',
] as const;
export type MatchPosition = (typeof MATCH_POSITIONS)[number];

export interface Player {
  /** 1-based display number, not an array index. */
  id: number;
  name: string;
  score: number;
  isReady: boolean;
}

export interface MatchState {
  matchName: string;
  position: MatchPosition;
  players: Player[];
  /** Paths of the per-round data files, relative to the server root. */
  roundFiles: Record<RoundKind, string>;
  /** Seconds left on the paused main clock; 0 when nothing is paused. */
  pausedTimerSeconds: number;
}

// ---------------------------------------------------------------- KD (Khởi động)

export type KdGamemode = 'S' | 'M';
/** N: plain text, P: picture, A: audio. */
export type KdQuestionType = 'N' | 'P' | 'A';

export interface KdQuestion {
  question: string;
  answer: string;
  type: KdQuestionType;
  mediaFile?: string;
}

export interface KdRound {
  questions: {
    /** One pool per player, in player-index order. */
    singleplayer: KdQuestion[][];
    multiplayer: KdQuestion[];
  };
  gamemode: KdGamemode;
  /** Player currently on the podium in singleplayer mode. */
  activePlayerIndex: number;
}

// ------------------------------------------------- VCNV (Vượt chướng ngại vật)

/** HN: horizontal row, HN_S: special row (with audio). */
export type VcnvQuestionType = 'HN' | 'HN_S';

export interface VcnvQuestion {
  id: number;
  type: VcnvQuestionType;
  value: number;
  isOpen: boolean;
  isShown: boolean;
  question: string;
  answer: string;
  audioFile?: string;
}

/** The central obstacle; its value is derived from the revealed-row count. */
export interface VcnvObstacle {
  question: string;
  answer: string;
  value: number;
  imageFile?: string;
  /**
   * The five reveal-piece files cut from imageFile ([corner1..corner4, center]);
   * piece i is served to clients only once its row is open, so the uncut image
   * never leaks early.
   */
  imagePieceFiles?: string[];
}

export interface PlayerAnswer {
  answer: string;
  correct: boolean;
}

export interface ObstacleBuzz {
  playerIndex: number;
  timestamp: number;
  readableTime: string;
}

export interface VcnvRound {
  questions: VcnvQuestion[];
  obstacle: VcnvObstacle;
  playerAnswers: PlayerAnswer[];
  showResults: boolean;
  disabledPlayers: number[];
  openRowCount: number;
  obstacleBuzzes: ObstacleBuzz[];
}

// ---------------------------------------------------------------- TT (Tăng tốc)

export type TtQuestionType = 'image' | 'video';

export interface TtQuestion {
  id: number;
  question: string;
  answer: string;
  type: TtQuestionType;
  questionImage?: string;
  answerImage?: string;
  videoFile?: string;
}

export interface TtAnswer {
  playerIndex: number;
  answer: string;
  timestamp: number;
  readableTime: string;
  correct: boolean;
}

export interface TtRound {
  questions: TtQuestion[];
  playerAnswers: TtAnswer[];
  showResults: boolean;
  activeQuestionIndex: number;
  showAnswer: boolean;
  timerStartTimestamp: number;
}

// ----------------------------------------------------------------- VD (Về đích)

/** N: plain text, I: image, A: audio, V: video. */
export type VdQuestionType = 'N' | 'I' | 'A' | 'V';

export interface VdQuestion {
  value: number;
  type: VdQuestionType;
  question: string;
  answer: string;
  mediaFile?: string;
}

export interface VdRound {
  /** One pool per player, in player-index order. */
  questionPools: VdQuestion[][];
  activePlayerIndex: number;
  isQuestionPickerShown: boolean;
  pickedQuestions: boolean[];
  /** Ngôi sao hy vọng — doubles the active question's stakes. */
  hopeStarActive: boolean;
}

// --------------------------------------------------- CHP (Câu hỏi phụ, tiebreak)

export interface ChpQuestion {
  question: string;
  answer: string;
}

export interface ChpRound {
  questions: ChpQuestion[];
  /** True once a player has used their tiebreak attempt. */
  playedPlayers: boolean[];
}

// ------------------------------------------------------------------- Round map

export interface RoundDataMap {
  kd: KdRound;
  vcnv: VcnvRound;
  tt: TtRound;
  vd: VdRound;
  chp: ChpRound;
}

export type RoundData = RoundDataMap[RoundKind];

// ------------------------------------------------------------------ Live state

export interface ActiveAudioState {
  code: string;
  loop: boolean;
  /** Server epoch ms when this audio track started. */
  startedAt: number;
  /** Optional nominal duration in ms for non-looping timed tracks. */
  durationMs?: number;
}

export type VideoTarget = 'tt' | 'vd';

export interface VideoPlaybackState {
  playing: boolean;
  /** Server epoch ms when playback last started/resumed; null when paused. */
  startedAt: number | null;
  /** Video timestamp in seconds when paused or last seeked/restarted. */
  positionSec: number;
  /** Normalized volume in [0, 1]. */
  volume: number;
  muted: boolean;
  /** Remote fullscreen stage mode (applied to viewer screens). */
  fullscreen: boolean;
}

export type VideoControlAction =
  | 'play'
  | 'pause'
  | 'toggle'
  | 'restart'
  | 'seek'
  | 'volume'
  | 'mute'
  | 'fullscreen';

export interface VideoControlCommand {
  target: VideoTarget;
  action: VideoControlAction;
  value?: number | boolean;
}

export interface VideoStateUpdate {
  target: VideoTarget;
  state: VideoPlaybackState;
  serverTime: number;
}

/**
 * Ephemeral in-memory match state snapshotted for reconnecting, refreshing, or
 * late-joining clients. Sensitive fields (e.g. active question answers) are
 * stripped for non-staff roles by the server.
 */
export interface LiveStateSnapshot {
  /** Server epoch ms when this snapshot was built (avoids client clock skew). */
  serverTime: number;
  clock: {
    running: boolean;
    remaining: number;
    maxSeconds: number;
    paused: boolean;
  };
  activeLoopSfx: ActiveAudioState | null;
  activeTimedSfx: ActiveAudioState | null;
  kd: {
    question: KdQuestion | null;
    previousAnswer: string | null;
    turnPlayerIndex: number;
    buzzerOpen: boolean;
    maxQuestionCount: number;
    currentQuestionNo: number;
    decisionTimerOwner: 'none' | 'admin' | 'player';
    decisionRemaining: number;
  };
  vcnv: {
    question: VcnvQuestion | null;
    highlightedQuestionId: number | null;
  };
  tt: {
    question: TtQuestion | null;
    videoPlaying: boolean;
    videoStartedAt: number | null;
    video: VideoPlaybackState;
  };
  vd: {
    question: VdQuestion | null;
    stealingPlayerIndex: number;
    stealWindowOpen: boolean;
    stealRemaining: number;
    videoPlaying: boolean;
    videoStartedAt: number | null;
    video: VideoPlaybackState;
  };
  chp: {
    question: ChpQuestion | null;
    turnPlayerIndex: number;
    buzzerOpen: boolean;
  };
}
