import { inject, Injectable } from '@angular/core';
import { QuestionFields, SetSettings } from '../core/contracts/bank';
import { ApiService } from '../core/services/api.service';
import { EditorDataService } from '../editor/services/editor.data.service';
import { FsService } from '../editor/services/fs.service';
import { BankApiService } from './bank-api.service';

/** Publish a browser draft as records and individual files, without packaging it. */
@Injectable({ providedIn: 'root' })
export class LocalBankPublisher {
  private readonly bank = inject(BankApiService);
  private readonly api = inject(ApiService);
  private readonly editor = inject(EditorDataService);
  private readonly fs = inject(FsService);

  async publish(uid: string): Promise<string> {
    if (this.editor.editorData?.uid === uid) await this.editor.flushCurrentEditorData();
    const data = await this.editor.loadLocalEditorData(uid);
    const raw = JSON.parse(this.editor.serializeEditorData(data));
    const names: Record<string, string> = {};
    for (const slot of ['logo', 'logo-long', 'background', 'placeholder']) {
      const name = data.uiConfig.miscImageSrcNames[slot];
      if (typeof name === 'string') names[slot] = name;
    }
    raw.uiConfig.miscImageSrcNames = names;
    const item = await this.bank.importData(raw);
    const tabId = crypto.randomUUID();
    try {
      const doc = await this.bank.get(item.id);
      for (const q of doc.questions) {
        if (!q.mediaSrcName && !q.secondaryMediaSrcName) continue;
        const fields: QuestionFields = { question: q.question, answer: q.answer, type: q.type, value: q.value, mediaSrcName: q.mediaSrcName, secondaryMediaSrcName: q.secondaryMediaSrcName };
        await this.withLease(item.id, q.id, tabId, async (token) => {
          for (const slot of ['mediaSrcName', 'secondaryMediaSrcName'] as const) if (fields[slot]) {
            fields[slot] = await this.upload(item.id, q.id, tabId, token, uid, q.pool.split('-')[0], fields[slot]);
          }
          await this.bank.save(item.id, q.id, tabId, token, q.revision, fields);
        });
      }
      const settings: SetSettings = structuredClone(doc.settings);
      if (settings.obstacleImages.length || Object.keys(settings.uiConfig.miscImageSrcNames).length) {
        await this.withLease(item.id, 'settings', tabId, async (token) => {
          for (let i = 0; i < settings.obstacleImages.length; i++) settings.obstacleImages[i] = await this.upload(item.id, 'settings', tabId, token, uid, 'vcnv', settings.obstacleImages[i]);
          for (const [slot, name] of Object.entries(settings.uiConfig.miscImageSrcNames)) {
            settings.uiConfig.miscImageSrcNames[slot] = await this.upload(item.id, 'settings', tabId, token, uid, 'misc', name);
          }
          await this.bank.save(item.id, 'settings', tabId, token, doc.settingsRevision, settings);
        });
      }
      return item.id;
    } catch (error) {
      // An incomplete publish is never left masquerading as a complete account copy.
      await this.api.deleteBank(item.id).catch(() => undefined);
      throw error;
    }
  }
  private async withLease(id: string, section: string, tabId: string, work: (token: string) => Promise<void>): Promise<void> {
    const lease = await this.bank.reserve(id, section, tabId);
    const renew = setInterval(() => { void this.bank.renew(id, section, tabId, lease.token).catch(() => undefined); }, 12000);
    try { await work(lease.token); }
    finally { clearInterval(renew); await this.bank.release(id, section, tabId, lease.token).catch(() => undefined); }
  }
  private async upload(id: string, section: string, tabId: string, token: string, uid: string, kind: string, name: string): Promise<string> {
    const source = await this.fs.getFile(`${uid}/${kind}/${name}`);
    const ext = name.split('.').pop()?.toLowerCase() ?? '';
    const types: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', avif: 'image/avif', mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg', m4a: 'audio/mp4', mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime' };
    const file = new File([source], name, { type: source.type || types[ext] || 'application/octet-stream' });
    return (await this.bank.upload(id, section, tabId, token, kind, file)).name;
  }
}
