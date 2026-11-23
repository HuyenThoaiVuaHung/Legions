import { Injectable, inject, signal } from '@angular/core';
import { EditingLease, QuestionFields, QuestionSet, SetSettings } from '../core/contracts/bank';
import { NetworkService } from '../core/services/network.service';
import { IEditorData, IQuestion, MatchPosition, O24ControlType, QuestionType } from '../editor/editor.interfaces';
import { BankApiService } from './bank-api.service';

@Injectable()
export class HostedEditorSession {
  private readonly api = inject(BankApiService);
  private readonly network = inject(NetworkService);
  readonly set = signal<QuestionSet | null>(null);
  readonly error = signal('');
  readonly online = signal(false);
  readonly active = signal<string | null>(null);
  readonly saving = signal(false);
  readonly peers = signal<string[]>([]);
  readonly tab = crypto.randomUUID();
  data?: IEditorData;
  id = '';
  private lease?: EditingLease;
  private revision = 0;
  private pending = Promise.resolve(true);
  private finishing?: Promise<boolean>;
  private stop?: () => void;
  private interval?: ReturnType<typeof setInterval>;
  private request = 0;
  private change = 0;
  private dirty = false;
  private opening = false;
  private accountId = '';
  private readonly urls = new Map<string, Promise<string | undefined>>();
  private closed = false;
  private readonly poolNames = new WeakMap<IQuestion[], string>();

  async open(id: string, accountId: string): Promise<void> {
    this.id = id;
    this.accountId = accountId;
    try { this.recoverable.set(!!localStorage.getItem(this.recoveryKey)); } catch { /* Storage may be unavailable. */ }
    await this.reload();
    if (!this.data || this.closed) return;
    this.stop = this.network.watchBank(id, this.tab, () => void this.reload(),
      peers => this.peers.set([...new Set(peers.map(peer => peer.username))]), state => {
        this.online.set(state === 'connected');
        if (state === 'revoked') this.error.set('Quyền truy cập đã kết thúc.');
        if (state === 'connected') void this.renew();
      });
    this.interval = setInterval(() => void this.renew(), 12000);
  }

  private async renew(): Promise<void> {
    const section = this.active(), lease = this.lease;
    if (!section || !lease || !this.online()) return;
    try {
      const renewed = await this.api.renew(this.id, section, this.tab, lease.token);
      if (this.lease === lease) this.lease = renewed;
    } catch (error) {
      if (this.lease?.token !== lease.token) return;
      this.report(error);
      if (this.status(error) === 409 || this.status(error) === 403) {
        this.active.set(null);
        this.lease = undefined;
        this.dirty = false;
        void this.reload();
      }
    }
  }

  async reload(): Promise<void> {
    const request = ++this.request, change = this.change;
    try {
      const set = await this.api.get(this.id);
      if (this.closed || request !== this.request || change !== this.change) return;
      this.set.set(set);
      this.project(set);
    } catch (error) { this.report(error); }
  }

  private project(set: QuestionSet): void {
    const current = new Map<string, IQuestion>();
    if (this.data) for (const [, pool] of this.pools(this.data)) for (const q of pool) if (q.bankId) current.set(q.bankId, q);
    const pool = (key: string, minimum = 0): IQuestion[] => {
      const rows = set.questions.filter(q => q.pool === key).map((q): IQuestion => {
        const previous = current.get(q.id);
        if (previous && this.active() === q.id) return previous;
        return { ...q, bankId: q.id, type: q.type };
      });
      const maxPos = set.questions
        .filter(row => row.pool === key)
        .reduce((max, row) => Math.max(max, row.position), -1);
      const slotCount = minimum ? Math.max(minimum, maxPos + 1) : 0;
      const result = slotCount ? Array.from({ length: slotCount }, (_, i) => {
        const question = rows.find(q => set.questions.some(row => row.id === q.bankId && row.position === i));
        return question ?? { question: '', answer: '', type: key === 'tt' ? QuestionType.IMAGE : QuestionType.TEXT, value: key === 'tt' ? 40 : 10 };
      }) : rows;
      this.poolNames.set(result, key);
      return result;
    };
    const settings = set.settings;
    const data: IEditorData = {
      uid: set.item.id, dateModified: set.item.updatedAt,
      matchData: { matchName: settings.matchName, matchVersion: settings.matchVersion, matchPos: MatchPosition.IDLE,
        players: Array.from({ length: 4 }, (_, index) => ({ name: settings.players[index] ?? '', score: 0, isReady: false })) },
      uiConfig: structuredClone(settings.uiConfig),
      questionBank: {
        kd: settings.matchVersion === 23 ? { o23Questions: [0, 1, 2].map(i => pool('kd-single-' + i)) } : {
          o24Questions: { multiplayer: pool('kd-multi'), singleplayer: [0, 1, 2, 3].map(i => pool('kd-single-' + i)) },
        },
        vcnv: { cnv: settings.obstacle, cnvMediaSrcNames: [...settings.obstacleImages], questions: pool('vcnv', 5) },
        tt: { questions: pool('tt', 4) },
        vd: { questions: [0, 1, 2, 3].map(i => pool('vd-' + i)) },
        chp: { questions: pool('chp') },
      },
    };
    if (this.data && this.active() === 'settings') {
      data.matchData = this.data.matchData;
      data.uiConfig = this.data.uiConfig;
      data.questionBank.vcnv.cnv = this.data.questionBank.vcnv.cnv;
      data.questionBank.vcnv.cnvMediaSrcNames = this.data.questionBank.vcnv.cnvMediaSrcNames;
    }
    this.data = data;
    void this.resolveMedia(data);
  }

  private pools(data: IEditorData): [string, IQuestion[]][] {
    const bank = data.questionBank;
    const kd = bank.kd.o24Questions;
    const result: [string, IQuestion[]][] = [['vcnv', bank.vcnv.questions], ['tt', bank.tt.questions], ['chp', bank.chp.questions]];
    if (kd) result.push(['kd-multi', kd[O24ControlType.MULTIPLAYER]]);
    (kd?.singleplayer ?? bank.kd.o23Questions ?? []).forEach((pool, index) => result.push(['kd-single-' + index, pool]));
    bank.vd.questions.forEach((pool, index) => result.push(['vd-' + index, pool]));
    return result;
  }

  async resolveMedia(data: IEditorData): Promise<IEditorData> {
    const get = (kind: string, name?: string): Promise<string | undefined> => {
      if (!name) return Promise.resolve(undefined);
      const key = kind + '/' + name;
      const cached = this.urls.get(key);
      if (cached) return cached;
      const url = this.api.media(this.id, kind, name).then(blob => this.closed ? undefined : URL.createObjectURL(blob))
        .catch(() => { this.urls.delete(key); return undefined; });
      this.urls.set(key, url);
      return url;
    };
    await Promise.all([
      ...this.pools(data).flatMap(([pool, questions]) => questions.map(async q => {
        const kind = pool.split('-')[0];
        q.mediaSrc = await get(kind, q.mediaSrcName);
        q.secondaryMediaSrc = await get(kind, q.secondaryMediaSrcName);
      })),
      Promise.all(data.questionBank.vcnv.cnvMediaSrcNames.map(name => get('vcnv', name))).then(urls => {
        data.questionBank.vcnv.cnvMediaSrcs = urls.filter((url): url is string => !!url);
      }),
      Promise.all(Object.entries(data.uiConfig.miscImageSrcNames).map(async ([slot, name]) =>
        [slot, typeof name === 'string' ? await get('misc', name) : undefined] as const)).then(entries => {
        data.uiConfig.miscImageSrc = Object.fromEntries(entries);
      }),
    ]);
    return data;
  }

  hasEditAccess(): boolean {
    const access = this.set()?.item.access;
    return access === 'owner' || access === 'editor';
  }

  canEdit(): boolean { return this.online() && this.hasEditAccess(); }
  held(section: string): string | undefined {
    return this.set()?.reservations.find(r => r.sectionId === section && r.tabId !== this.tab)?.username;
  }

  async begin(section: string): Promise<boolean> {
    if (!this.canEdit() || this.opening) return false;
    this.opening = true;
    try {
      if (this.finishing && !await this.finishing) return false;
      if (this.active() === section) return true;
      if (!(await this.finish())) return false;
      this.lease = await this.api.reserve(this.id, section, this.tab);
      await this.reload();
      const set = this.set();
      const revision = section === 'settings' ? set?.settingsRevision : set?.questions.find(q => q.id === section)?.revision;
      if (revision === undefined) throw new Error('Không tìm thấy mục chỉnh sửa.');
      this.revision = revision;
      this.active.set(section);
      this.error.set('');
      return true;
    } catch (error) { this.report(error); return false; }
    finally { this.opening = false; }
  }

  async beginQuestion(question: IQuestion, questions: IQuestion[]): Promise<boolean> {
    if (question.bankId) return this.begin(question.bankId);
    const pool = this.poolNames.get(questions);
    if (!pool || !this.canEdit()) return false;
    try {
      const result = await this.api.add(this.id, pool, question, questions.indexOf(question));
      return this.begin(result.addedId);
    } catch (error) { this.report(error); return false; }
  }

  async commit(): Promise<void> {
    void this.save();
    await this.finish();
  }


  async add(questions: IQuestion[], question: IQuestion, file?: File, position?: number): Promise<void> {
    const pool = this.poolNames.get(questions);
    if (!pool || !this.canEdit()) return;
    try {
      const result = await this.api.add(this.id, pool, question, position);
      if (file && await this.begin(result.addedId)) {
        const added = this.find(result.addedId);
        if (added) {
          added.mediaSrcName = await this.upload(pool.split('-')[0], file);
          added.type = this.mediaType(file);
          await this.save();
          await this.finish();
        }
      }
      await this.reload();
    } catch (error) { this.report(error); }
  }

  async remove(question: IQuestion): Promise<void> {
    if (!question.bankId || !this.canEdit()) return;
    try { await this.api.remove(this.id, question.bankId); await this.reload(); }
    catch (error) { this.report(error); }
  }

  async move(questions: IQuestion[], from: number, to: number): Promise<void> {
    if (!this.canEdit() || from === to) return;
    const pool = this.poolNames.get(questions);
    const ids = questions.map(q => q.bankId).filter((id): id is string => !!id);
    if (!pool || ids.length !== questions.length || !ids[from] || !ids[to]) return;
    ids.splice(to, 0, ids.splice(from, 1)[0]);
    try { await this.api.reorder(this.id, pool, ids); await this.reload(); }
    catch (error) { this.report(error); }
  }

  async upload(kind: string, file: File): Promise<string> {
    const section = this.active(), lease = this.lease;
    if (!section || !lease) throw new Error('Hãy mở mục để chỉnh sửa trước khi tải tệp.');
    const { name } = await this.api.upload(this.id, section, this.tab, lease.token, kind, file);
    this.urls.set(kind + '/' + name, Promise.resolve(URL.createObjectURL(file)));
    return name;
  }

  async attachQuestion(kind: string, file: File, secondary = false): Promise<void> {
    const question = this.find(this.active() ?? '');
    if (!question) return;
    const name = await this.upload(kind, file);
    if (secondary) question.secondaryMediaSrcName = name;
    else {
      question.mediaSrcName = name;
      question.type = this.mediaType(file);
    }
    await this.commit();
  }

  private mediaType(file: File): QuestionType {
    if (file.type.startsWith('video/')) return QuestionType.VIDEO;
    if (file.type.startsWith('audio/')) return QuestionType.AUDIO;
    return QuestionType.IMAGE;
  }

  private find(section: string): IQuestion | undefined {
    return this.data && this.pools(this.data).flatMap(([, pool]) => pool).find(q => q.bankId === section);
  }
  private fields(section: string): QuestionFields | SetSettings | undefined {
    const d = this.data;
    if (!d) return undefined;
    if (section === 'settings') return {
      matchName: d.matchData.matchName, matchVersion: d.matchData.matchVersion, players: d.matchData.players.map(p => p.name),
      obstacle: d.questionBank.vcnv.cnv, obstacleImages: [...d.questionBank.vcnv.cnvMediaSrcNames],
      uiConfig: { darkMode: d.uiConfig.darkMode, pallette: d.uiConfig.pallette,
        miscImageSrcNames: Object.fromEntries(Object.entries(d.uiConfig.miscImageSrcNames).filter((entry): entry is [string, string] => typeof entry[1] === 'string')) },
    };
    const q = this.find(section);
    return q && { question: q.question, answer: q.answer, type: q.type, value: q.value, mediaSrcName: q.mediaSrcName ?? '', secondaryMediaSrcName: q.secondaryMediaSrcName ?? '' };
  }

  private get recoveryKey(): string { return 'legion.bank-recovery:' + this.network.apiBase() + ':' + this.accountId + ':' + this.id; }
  readonly recoverable = signal(false);

  save(): Promise<boolean> {
    const section = this.active(), lease = this.lease;
    if (!section || !lease) return Promise.resolve(true);
    this.dirty = true;
    const fields = this.fields(section);
    if (!fields) return Promise.resolve(false);
    const change = ++this.change;
    this.keepRecovery(section, fields);
    this.pending = this.pending.then(async () => {
      if (this.active() !== section || this.lease?.token !== lease.token || change !== this.change) return false;
      if (!this.online()) return false;
      this.saving.set(true);
      try {
        const saved = await this.api.save(this.id, section, this.tab, lease.token, this.revision, fields);
        this.revision = section === 'settings' ? saved.settingsRevision : saved.questions.find(q => q.id === section)?.revision ?? this.revision;
        if (change === this.change) {
          this.dirty = false;
          this.clearRecovery();
        } else {
          const next = this.fields(section);
          if (next) this.keepRecovery(section, next);
        }
        this.error.set('');
        return true;
      } catch (error) { this.report(error); return false; }
      finally { this.saving.set(false); }
    });
    return this.pending;
  }

  private keepRecovery(section: string, fields: QuestionFields | SetSettings): void {
    try {
      localStorage.setItem(this.recoveryKey, JSON.stringify({ section, fields, revision: this.revision }));
      this.recoverable.set(true);
    } catch { this.error.set('Không thể giữ bản khôi phục trên trình duyệt.'); }
  }
  private clearRecovery(): void {
    try { localStorage.removeItem(this.recoveryKey); } catch { /* Storage may be unavailable. */ }
    this.recoverable.set(false);
  }

  async recover(): Promise<void> {
    try {
      const raw = localStorage.getItem(this.recoveryKey);
      if (!raw) return;
      const saved: { section: string; revision: number; fields: QuestionFields | SetSettings } = JSON.parse(raw);
      if (!(await this.begin(saved.section))) return;
      if (this.revision !== saved.revision) {
        await this.finish();
        this.error.set('Mục này đã thay đổi. Nội dung khôi phục vẫn ở trình duyệt.');
        return;
      }
      if ('question' in saved.fields) Object.assign(this.find(saved.section) ?? {}, saved.fields);
      else if (this.data) {
        const d = this.data;
        d.matchData.matchName = saved.fields.matchName;
        d.matchData.players.forEach((p, i) => p.name = (saved.fields as SetSettings).players[i] ?? '');
        d.uiConfig = saved.fields.uiConfig;
        d.questionBank.vcnv.cnv = saved.fields.obstacle;
        d.questionBank.vcnv.cnvMediaSrcNames = saved.fields.obstacleImages;
      }
      await this.save();
      if (this.data) void this.resolveMedia(this.data);
    } catch (error) { this.report(error); }
  }

  finish(): Promise<boolean> {
    this.finishing ??= this.release().finally(() => { this.finishing = undefined; });
    return this.finishing;
  }

  private async release(): Promise<boolean> {
    await this.pending;
    if (this.dirty && !(await this.save())) return false;
    const section = this.active(), lease = this.lease;
    if (!section || !lease) return true;
    try { await this.api.release(this.id, section, this.tab, lease.token); }
    catch (error) {
      if (this.status(error) !== 409) { this.report(error); return false; }
    }
    this.active.set(null);
    this.lease = undefined;
    await this.reload();
    return true;
  }

  close(): void {
    this.closed = true;
    clearInterval(this.interval);
    this.stop?.();
    for (const pending of this.urls.values()) void pending.then(url => { if (url) URL.revokeObjectURL(url); });
  }
  report(error: unknown): void {
    const message = (error as { error?: { error?: unknown } } | null)?.error?.error;
    this.error.set(typeof message === 'string' ? message : error instanceof Error ? error.message : 'Không thể lưu thay đổi. Hãy thử lại.');
  }
  private status(error: unknown): number | undefined { return (error as { status?: number } | null)?.status; }
}
