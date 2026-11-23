import { ChangeDetectionStrategy, Component, OnDestroy, OnInit, TemplateRef, effect, inject, signal, viewChild } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { Location } from '@angular/common';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MatDividerModule } from '@angular/material/divider';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatTabsModule } from '@angular/material/tabs';
import { MatToolbarModule } from '@angular/material/toolbar';
import { ActivatedRoute, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { EditorDataService } from '../editor/services/editor.data.service';
import { EditorMediaService } from '../editor/services/editor.media.service';
import { BankApiService } from './bank-api.service';
import { HostedEditorSession } from './hosted-editor-session';
import { HostStore } from './host.store';
import { ApiService } from '../core/services/api.service';
import { HostRibbon } from './host-ribbon';
import { EmptyStateComponent } from '../components/empty-state/empty-state.component';
import { ConfirmationDialogComponent, ConfirmationDialogData } from '../components/operator-dialog/confirmation-dialog.component';
import { HostLoginDialogComponent } from './host-login-dialog.component';
import { ShareSetDialogComponent, ShareSetDialogData } from './share-set-dialog.component';
import { NetworkService } from '../core/services/network.service';
import { SessionService } from '../core/services/session.service';
import { STORAGE_KEYS } from '../core/constants';
import { parseExcelToEditorData } from '../editor/services/excel-editor.util';
import { firstValueFrom } from 'rxjs';

@Component({
  selector: 'app-shared-set',
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [HostedEditorSession, EditorDataService, EditorMediaService],
  imports: [RouterLink, RouterLinkActive, RouterOutlet, EmptyStateComponent, MatButtonModule, MatDialogModule, MatDividerModule, MatIconModule, MatMenuModule, MatTabsModule, MatToolbarModule],
  templateUrl: './shared-set.component.html',
  styleUrl: './shared-set.component.scss',
})
export class SharedSetComponent implements OnInit, OnDestroy {
  protected readonly editor = inject(HostedEditorSession);
  private readonly host = inject(HostStore);
  protected readonly hostBusy = this.host.busy;
  private readonly api = inject(BankApiService);
  private readonly account = inject(ApiService);
  private readonly network = inject(NetworkService);
  private readonly session = inject(SessionService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly location = inject(Location);
  private readonly dialog = inject(MatDialog);
  private readonly snackBar = inject(MatSnackBar);
  private readonly ribbon = inject(HostRibbon);
  private readonly actions = viewChild<TemplateRef<unknown>>('ribbonActions');
  private readonly tools = viewChild<TemplateRef<unknown>>('ribbonTools');

  protected readonly accountName = signal('');
  protected readonly entryState = signal<'opening' | 'signIn' | 'denied'>('opening');
  protected readonly fileBusy = signal(false);
  private entering = false;
  private destroyed = false;

  protected readonly sections = [
    { path: 'general', label: 'Cài đặt chung' },
    { path: 'kd', label: 'Khởi động' },
    { path: 'vcnv', label: 'Vượt chướng ngại vật' },
    { path: 'tt', label: 'Tăng tốc' },
    { path: 'vd', label: 'Về đích' },
    { path: 'chp', label: 'Câu hỏi phụ' },
  ];

  constructor() {
    effect(() => {
      const set = this.editor.set();
      this.ribbon.actions.set(this.actions() ?? null);
      this.ribbon.tools.set(this.tools() ?? null);
      this.ribbon.title.set(set?.item.name ?? '');
      this.ribbon.onRename.set(set?.item.access === 'owner' ? (name) => this.renameInline(name) : null);
      this.ribbon.status.set(!set ? '' : !this.editor.online() ? 'Mất kết nối' : this.editor.saving() ? 'Đang lưu' : 'Đã đồng bộ');
    });
  }

  ngOnInit(): void { void this.openEditor(); }

  protected async openEditor(changeAccount = false): Promise<void> {
    if (this.entering || this.destroyed) return;
    this.entering = true;
    this.entryState.set('opening');
    this.editor.error.set('');
    try {
      const route = this.route.snapshot;
      const fromShare = route.queryParamMap.has('shared');
      await this.session.ready;
      if (fromShare && this.network.apiBase() && this.network.apiBase() !== window.location.origin) {
        await this.session.connect(window.location.origin);
      }
      if (this.destroyed) return;
      let account = changeAccount || !localStorage.getItem(STORAGE_KEYS.accountToken)
        ? null
        : await this.account.me().catch(error => {
            if (error instanceof HttpErrorResponse && error.status === 401) return null;
            throw error;
          });
      if (!account) {
        this.entryState.set('signIn');
        const signedIn = await firstValueFrom(this.dialog.open(HostLoginDialogComponent, { width: '26rem', maxWidth: '95vw' }).afterClosed());
        if (!signedIn || this.destroyed) return;
        this.entryState.set('opening');
        account = await this.account.me();
      }
      const id = route.paramMap.get('id') ?? '';
      if (fromShare && route.fragment) {
        try { await this.api.openSharingLink(id, route.fragment); }
        catch (error) {
          // A direct invitation can still grant access after a link expires.
          if (!(error instanceof HttpErrorResponse) || error.status !== 404) throw error;
        }
      }
      this.accountName.set(account.username);
      if (this.destroyed) return;
      await this.editor.open(id, account.accountId);
      if (!this.editor.set()) {
        this.editor.error.set('');
        this.entryState.set('denied');
        return;
      }
      const openShare = route.queryParamMap.has('share');
      if (fromShare || openShare) {
        await this.router.navigate([], {
          relativeTo: this.route.firstChild ?? this.route,
          queryParams: { shared: null, share: null }, queryParamsHandling: 'merge', replaceUrl: true,
        });
      }
      if (openShare) {
        setTimeout(() => this.openSharing());
      }
    } catch (error) {
      if (error instanceof HttpErrorResponse && error.status === 401) this.entryState.set('signIn');
      else this.entryState.set('denied');
    } finally { this.entering = false; }
  }

  protected async createRoom(): Promise<void> {
    if (await this.editor.finish()) await this.host.create(this.editor.id);
  }

  protected newSet(): void {
    this.host.newSet({ openInNewTab: true });
  }

  protected renameSet(): void {
    const item = this.editor.set()?.item;
    if (item) this.host.rename(item);
  }

  private async renameInline(name: string): Promise<void> {
    const item = this.editor.set()?.item;
    if (!item || name === item.name) return;
    const previous = item.name;
    this.ribbon.title.set(name);
    try {
      await this.account.renameBank(item.id, name);
      await this.editor.reload();
      await this.host.refresh();
    } catch (error) {
      this.ribbon.title.set(previous);
      this.snackBar.open(
        error instanceof HttpErrorResponse && typeof error.error?.error === 'string'
          ? error.error.error
          : 'Không thể đổi tên bộ câu hỏi.',
        'Đóng',
        { duration: 3000 },
      );
    }
  }

  protected exportSet(format: 'legion' | 'excel' | 'json'): void {
    const item = this.editor.set()?.item;
    if (!item) return;
    if (format === 'legion') void this.host.exportLegion(item);
    else if (format === 'excel') void this.host.exportExcel(item);
    else void this.host.download(item);
  }

  protected importFile(format: 'legion' | 'excel', replaceCurrent: boolean): void {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = format === 'legion' ? '.legion,.lg' : '.xlsx,.xls';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      if (replaceCurrent) {
        const ok = await firstValueFrom(this.dialog.open<ConfirmationDialogComponent, ConfirmationDialogData, boolean>(
          ConfirmationDialogComponent,
          {
            width: '26rem',
            data: {
              title: 'Ghi đè bộ câu hỏi hiện tại?',
              message: `Nhập “${file.name}” sẽ thay thế toàn bộ câu hỏi và media hiện có trong bộ này.`,
              confirmLabel: 'Ghi đè',
            },
          },
        ).afterClosed());
        if (!ok) return;
        if (!(await this.editor.finish())) return;
      }
      this.fileBusy.set(true);
      this.editor.error.set('');
      try {
        const replaceId = replaceCurrent ? this.editor.id : undefined;
        const item = format === 'legion'
          ? await this.api.importLegion(file, replaceId)
          : await this.api.importData(await parseExcelToEditorData(file), replaceId);
        await this.host.refresh();
        if (replaceCurrent) {
          await this.editor.reload();
        } else {
          await this.router.navigate(['/host/bank', item.id]);
        }
      } catch (error) {
        this.editor.error.set(
          error instanceof HttpErrorResponse && typeof error.error?.error === 'string'
            ? error.error.error
            : 'Không thể nhập tệp. Vui lòng kiểm tra định dạng tệp và thử lại.',
        );
      } finally {
        this.fileBusy.set(false);
      }
    };
    input.click();
  }

  protected openSharing(): void {
    const set = this.editor.set();
    if (!set) return;
    this.dialog.open<ShareSetDialogComponent, ShareSetDialogData>(ShareSetDialogComponent, {
      width: '33rem',
      maxWidth: 'calc(100vw - 2rem)',
      autoFocus: set.item.access === 'owner' ? 'input[name="username"]' : 'dialog',
      data: {
        id: this.editor.id,
        name: set.item.name,
        access: set.item.access,
        accountName: this.accountName(),
        initialMembers: set.members,
        onMembersChanged: () => this.editor.reload(),
      },
    });
  }

  protected async copyShareLink(notify = false): Promise<void> {
    try {
      const sharing = await this.api.sharing(this.editor.id);
      const link = sharing.link;
      const tree = this.router.createUrlTree(['/share/questions', this.editor.id], {
        fragment: link?.mode === 'link' ? link.token : undefined,
      });
      const address = this.location.prepareExternalUrl(this.router.serializeUrl(tree));
      await navigator.clipboard.writeText(new URL(address, window.location.origin).href);
      if (notify) this.snackBar.open('Đã sao chép liên kết chia sẻ.', undefined, { duration: 2500 });
    } catch {
      const message = 'Không thể sao chép. Bạn có thể sao chép liên kết từ thanh địa chỉ.';
      if (notify) this.snackBar.open(message, undefined, { duration: 3500 });
    }
  }

  async canLeave(): Promise<boolean> { return await this.editor.finish(); }

  ngOnDestroy(): void {
    this.destroyed = true;
    this.ribbon.actions.set(null);
    this.ribbon.tools.set(null);
    this.ribbon.title.set('');
    this.ribbon.onRename.set(null);
    this.ribbon.status.set('');
    this.editor.close();
  }
}
