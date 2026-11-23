import { HttpClient, HttpHeaders } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { STORAGE_KEYS } from '../core/constants';
import { BankLinkAccess, BankSharing, EditingLease, QuestionFields, QuestionSet, QuestionSetItem, SetSettings } from '../core/contracts/bank';
import { IEditorData } from '../editor/editor.interfaces';
import { NetworkService } from '../core/services/network.service';

@Injectable({ providedIn: 'root' })
export class BankApiService {
  private readonly http = inject(HttpClient);
  private readonly network = inject(NetworkService);
  private url(id = '', suffix = ''): string { return `${this.network.apiBase()}/api/bank${id ? '/' + encodeURIComponent(id) : ''}${suffix}`; }
  private options() { return { headers: new HttpHeaders({ Authorization: `Bearer ${localStorage.getItem(STORAGE_KEYS.accountToken) ?? ''}` }) }; }
  create(name?: string): Promise<QuestionSetItem> {
    return firstValueFrom(this.http.post<QuestionSetItem>(this.url(), name !== undefined ? { name } : {}, this.options()));
  }
  importData(editorData: unknown, replaceId?: string): Promise<QuestionSetItem> {
    return firstValueFrom(this.http.post<QuestionSetItem>(this.url(), replaceId ? { editorData, replaceId } : { editorData }, this.options()));
  }
  importLegion(file: File, replaceId?: string): Promise<QuestionSetItem> {
    const form = new FormData();
    form.append('file', file);
    if (replaceId) form.append('replaceId', replaceId);
    return firstValueFrom(this.http.post<QuestionSetItem>(this.url('', '/import-legion'), form, this.options()));
  }
  exportLegion(id: string): Promise<Blob> {
    return firstValueFrom(this.http.get(this.url(id, '/export-legion'), { ...this.options(), responseType: 'blob' }));
  }
  exportJson(id: string): Promise<IEditorData> {
    return firstValueFrom(this.http.get<IEditorData>(this.url(id, '/export'), this.options()));
  }
  get(id: string): Promise<QuestionSet> { return firstValueFrom(this.http.get<QuestionSet>(this.url(id), this.options())); }
  share(id: string, username: string, access: 'editor' | 'viewer' | null): Promise<QuestionSet> {
    return firstValueFrom(this.http.post<QuestionSet>(this.url(id, '/members'), { username, access }, this.options()));
  }
  sharing(id: string): Promise<BankSharing> {
    return firstValueFrom(this.http.get<BankSharing>(this.url(id, '/sharing'), this.options()));
  }
  searchAccounts(id: string, query: string): Promise<string[]> {
    return firstValueFrom(this.http.get<string[]>(this.url(id, '/sharing/accounts'), { ...this.options(), params: { q: query } }));
  }
  setSharingLink(id: string, settings: BankLinkAccess): Promise<BankLinkAccess> {
    return firstValueFrom(this.http.put<BankLinkAccess>(this.url(id, '/sharing/link'), settings, this.options()));
  }
  openSharingLink(id: string, token: string): Promise<void> {
    return firstValueFrom(this.http.post<void>(this.url(id, '/sharing/open'), { token }, this.options()));
  }
  add(id: string, pool: string, fields: Pick<QuestionFields, 'question' | 'answer' | 'type' | 'value'>, position?: number): Promise<{ addedId: string }> {
    const { question, answer, type, value } = fields;
    return firstValueFrom(this.http.post<{ addedId: string }>(this.url(id, '/questions'), { pool, fields: { question, answer, type, value }, position }, this.options()));
  }
  remove(id: string, section: string): Promise<QuestionSet> { return firstValueFrom(this.http.delete<QuestionSet>(this.url(id, '/questions/' + section), this.options())); }
  reorder(id: string, pool: string, ids: string[]): Promise<void> {
    return firstValueFrom(this.http.put<void>(this.url(id, '/order'), { pool, ids }, this.options()));
  }
  reserve(id: string, section: string, tabId: string): Promise<EditingLease> { return firstValueFrom(this.http.post<EditingLease>(this.url(id, '/reservations/' + section), { tabId }, this.options())); }
  renew(id: string, section: string, tabId: string, token: string): Promise<EditingLease> { return firstValueFrom(this.http.patch<EditingLease>(this.url(id, '/reservations/' + section), { tabId, token }, this.options())); }
  release(id: string, section: string, tabId: string, token: string): Promise<void> { return firstValueFrom(this.http.delete<void>(this.url(id, '/reservations/' + section), { ...this.options(), body: { tabId, token } })); }
  save(id: string, section: string, tabId: string, token: string, revision: number, fields: QuestionFields | SetSettings): Promise<QuestionSet> {
    return firstValueFrom(this.http.put<QuestionSet>(this.url(id, '/sections/' + section), { tabId, token, revision, fields }, this.options()));
  }
  upload(id: string, sectionId: string, tabId: string, token: string, kind: string, file: File): Promise<{ name: string }> {
    const form = new FormData();
    for (const [key, value] of Object.entries({ sectionId, tabId, token, kind })) form.append(key, value);
    form.append('file', file);
    return firstValueFrom(this.http.post<{ name: string }>(this.url(id, '/media'), form, this.options()));
  }
  media(id: string, kind: string, name: string): Promise<Blob> {
    return firstValueFrom(this.http.get(this.url(id, `/media/${encodeURIComponent(kind)}/${encodeURIComponent(name)}`), { ...this.options(), responseType: 'blob' }));
  }
}
