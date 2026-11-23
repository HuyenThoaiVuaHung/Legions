import { Location } from '@angular/common';
import { EditorDataService } from './services/editor.data.service';
import { Component, Input, OnInit, ChangeDetectionStrategy } from '@angular/core';
import { ActivatedRoute, ActivatedRouteSnapshot, Router, RouterLinkActive, RouterModule } from '@angular/router';
import { IEditorData } from './editor.interfaces';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { ReactiveFormsModule } from '@angular/forms';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { MatSelectModule } from '@angular/material/select';
import { MatDividerModule } from '@angular/material/divider';
import { MatMenuModule } from '@angular/material/menu';
import { MatToolbarModule } from '@angular/material/toolbar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { EditorStatus } from './services/enums/editor.enum';
import { FileHandlerService } from './services/file.handler.service';
import { Crumb, NavbarComponent } from '../components/navbar/navbar.component';
import { Role } from '../core/contracts/api';
import { SessionService } from '../core/services/session.service';
import { inject, signal } from '@angular/core';
import { LocalBankPublisher } from '../host/local-bank-publisher.service';

@Component({
  selector: 'app-editor',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.Eager,
  imports: [
    RouterModule,
    MatCardModule,
    MatButtonModule,
    MatFormFieldModule,
    ReactiveFormsModule,
    MatIconModule,
    MatSelectModule,
    MatDividerModule,
    MatMenuModule,
    MatToolbarModule,
    MatTooltipModule,
    NavbarComponent
  ],
  templateUrl: './editor.component.html',
  styleUrl: './editor.component.scss'
})
export class EditorComponent implements OnInit {
  private readonly publisher = inject(LocalBankPublisher);
  private readonly location = inject(Location);
  protected readonly publishing = signal(false);
  protected readonly publishError = signal('');
  protected get hosted(): boolean { return this.router.url.startsWith('/host/drafts'); }
  protected get draftList(): boolean { return this.router.url.split(/[?#]/)[0].replace(/\/$/, '') === '/host/drafts'; }
  protected get editorBase(): string { return this.hosted ? '/host/drafts' : '/editor'; }
  protected async publish(): Promise<void> {
    const data = this.editorDataService.editorData;
    if (!data || this.publishing()) return;
    this.publishing.set(true);
    this.publishError.set('');
    try { const id = await this.publisher.publish(data.uid); await this.router.navigate(['/host/bank', id]); }
    catch { this.publishError.set('Chưa lưu được vào tài khoản. Bản nháp vẫn ở trình duyệt này. Hãy thử lại.'); }
    finally { this.publishing.set(false); }
  }
  protected async importFile(kind: 'legion' | 'excel'): Promise<void> {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = kind === 'legion' ? '.legion,.lg' : '.xlsx,.xls';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      this.publishError.set('');
      try {
        const uid = kind === 'legion'
          ? await this.fileHandler.loadEditorData(file)
          : await this.fileHandler.loadExcelData(file);
        await this.editorDataService.setEditorData(await this.editorDataService.loadLocalEditorData(uid));
        await this.router.navigate([`${this.editorBase}/general`]);
      } catch (err) {
        this.publishError.set(err instanceof Error ? err.message : 'Không thể nhập tệp.');
      }
    };
    input.click();
  }
  protected async createNew(): Promise<void> {
    const tab = window.open('about:blank', '_blank');
    try {
      const data = this.editorDataService.provideNewEditorData();
      await this.editorDataService.saveLocalEditorData(data);
      const url = this.location.prepareExternalUrl(
        this.router.serializeUrl(this.router.createUrlTree([`${this.editorBase}/general`], { queryParams: { uid: data.uid } })),
      );
      if (tab && !tab.closed) {
        tab.opener = null;
        tab.location.href = url;
      } else {
        await this.editorDataService.setEditorData(data);
        await this.router.navigate([`${this.editorBase}/general`]);
      }
    } catch {
      tab?.close();
    }
  }
  @Input() editorData?: IEditorData;
  constructor(
    public editorDataService: EditorDataService,
    public router: Router,
    public fileHandler: FileHandlerService,
    public route: ActivatedRoute,
    private session: SessionService
  ) { }
  readonly menus: Array<{ name: string, icon: string, nav: string }> = [
    { name: 'Cài đặt chung', icon: 'settings', nav: 'general' },
    { name: 'Khởi động', icon: 'grass', nav: 'kd' },
    { name: 'Vượt chướng ngại vật', icon: 'landscape', nav: 'vcnv' },
    { name: 'Tăng tốc', icon: 'rocket_launch', nav: 'tt' },
    { name: 'Về đích', icon: 'military_tech', nav: 'vd' },
    { name: 'Câu hỏi phụ', icon: 'workspaces', nav: 'chp' }
  ]
  async ngOnInit(): Promise<void> {
    const uid: string | null = this.route.snapshot.queryParamMap.get('uid');
    if (this.editorData) {
      this.editorDataService.editorData = this.editorData;
    } else if (uid) {
      if (this.editorDataService.availableEditorDataUids.includes(uid))
        this.editorDataService.editorData = await this.editorDataService.loadLocalEditorData(uid);
      else {
        this.router.navigate([this.editorBase]);
        return;
      }
    }
  }
  get trail(): Crumb[] {
    const root: Crumb[] = this.session.role() === Role.Admin ? [{ label: 'Quản trị', link: this.session.base() + '/admin' }] : [];
    return this.section ? [...root, { label: 'Editor', link: '/editor' }, { label: this.section }] : [...root, { label: 'Editor' }];
  }
  get section(): string | undefined {
    const segs = this.router.url.split(/[?#]/)[0].split('/').filter(Boolean);
    return segs.length > 1 ? this.routeNameMap[segs[segs.length - 1]] : undefined;
  }
  public readonly routeNameMap: { [key: string]: string } = {
    general: 'Cài đặt chung',
    kd: 'Khởi động',
    vcnv: 'Vượt chướng ngại vật',
    tt: 'Tăng tốc',
    vd: 'Về đích',
    chp: 'Câu hỏi phụ'
  }
  public readonly editorStatusEnum = EditorStatus;
  public readonly editorStatusNameMap: { [key: string]: string } = {
    [this.editorStatusEnum.UNLOADED]: 'Chưa tải dữ liệu',
    [this.editorStatusEnum.LOADED]: 'Đã tải dữ liệu',
    [this.editorStatusEnum.WORKING]: 'Đang lưu',
    [this.editorStatusEnum.SAVED]: 'Đã lưu',
    [this.editorStatusEnum.ERROR]: 'Lỗi',
    [this.editorStatusEnum.UNSAVED]: 'Chưa lưu'
  }
}
