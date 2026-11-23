export type BankAccess = 'owner' | 'editor' | 'viewer';
export type BankSharedRole = Exclude<BankAccess, 'owner'>;
export type BankLinkAccess = { mode: 'restricted' } | { mode: 'link'; access: BankSharedRole; token?: string };
export interface BankSharing { ownerName: string; link: BankLinkAccess }
export type MatchVersion = 23 | 24 | 25 | 26;
export const MATCH_VERSIONS: readonly MatchVersion[] = [23, 24, 25, 26];
export interface SetSettings {
  matchName: string;
  matchVersion: MatchVersion;
  players: string[];
  obstacle: string;
  obstacleImages: string[];
  uiConfig: { darkMode: boolean; pallette: number; miscImageSrcNames: Record<string, string> };
}
export interface QuestionFields {
  question: string;
  answer: string;
  type: number;
  value: number;
  mediaSrcName: string;
  secondaryMediaSrcName: string;
}
export interface BankQuestion extends QuestionFields { id: string; pool: string; position: number; revision: number }
export interface QuestionSetItem {
  id: string; name: string; matchName: string; ownerId: string; access: BankAccess;
  sizeBytes: number; createdAt: number; updatedAt: number;
}
export interface BankReservation { sectionId: string; username: string; tabId: string; expiresAt: number }
export interface BankMember { accountId: string; username: string; access: 'editor' | 'viewer' }
export interface QuestionSet {
  item: QuestionSetItem; settings: SetSettings; settingsRevision: number;
  questions: BankQuestion[]; members: BankMember[]; reservations: BankReservation[];
}
export interface EditingLease { token: string; expiresAt: number }
export interface BankPresence { username: string; tabId: string }
export const QUESTION_POOLS = [
  { id: 'kd-multi', label: 'Khởi động · Chung' },
  ...Array.from({ length: 4 }, (_, i) => ({ id: `kd-single-${i}`, label: `Khởi động · Thí sinh ${i + 1}` })),
  { id: 'vcnv', label: 'Vượt chướng ngại vật' },
  { id: 'tt', label: 'Tăng tốc' },
  ...Array.from({ length: 4 }, (_, i) => ({ id: `vd-${i}`, label: `Về đích · Thí sinh ${i + 1}` })),
  { id: 'chp', label: 'Câu hỏi phụ' },
];
