import { ChangeDetectionStrategy, Component, OnDestroy, OnInit, inject, signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { Location } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatAutocompleteModule } from '@angular/material/autocomplete';
import { MatButtonModule } from '@angular/material/button';
import { MatChipsModule } from '@angular/material/chips';
import { MAT_DIALOG_DATA, MatDialogModule } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatMenuModule } from '@angular/material/menu';
import { MatSelectModule } from '@angular/material/select';
import { Router } from '@angular/router';
import { BankAccess, BankLinkAccess, BankMember, BankSharedRole, BankSharing } from '../core/contracts/bank';
import { BankApiService } from './bank-api.service';

export interface ShareSetDialogData {
  id: string;
  name: string;
  access: BankAccess;
  accountName?: string;
  initialMembers?: BankMember[];
  onMembersChanged?: () => Promise<void> | void;
}

@Component({
  selector: 'app-share-set-dialog',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FormsModule,
    MatAutocompleteModule,
    MatButtonModule,
    MatChipsModule,
    MatDialogModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatMenuModule,
    MatSelectModule,
  ],
  templateUrl: './share-set-dialog.component.html',
  styleUrl: './share-set-dialog.component.scss',
})
export class ShareSetDialogComponent implements OnInit, OnDestroy {
  protected readonly data = inject<ShareSetDialogData>(MAT_DIALOG_DATA);
  private readonly api = inject(BankApiService);
  private readonly router = inject(Router);
  private readonly location = inject(Location);

  protected username = '';
  protected access: BankSharedRole = 'editor';
  protected readonly sharingData = signal<BankSharing | null>(null);
  protected readonly members = signal<BankMember[]>(this.data.initialMembers ?? []);
  protected readonly selectedPerson = signal('');
  protected readonly suggestedAccounts = signal<string[]>([]);
  protected readonly searchStatus = signal<'idle' | 'loading' | 'done' | 'error'>('idle');
  protected readonly sharing = signal(false);
  protected readonly shareError = signal('');
  protected readonly linkCopied = signal(false);
  protected readonly roleLabel = { editor: 'Có thể chỉnh sửa', viewer: 'Chỉ xem' } as const;

  private searchTimer?: ReturnType<typeof setTimeout>;
  private searchGeneration = 0;

  ngOnInit(): void {
    void this.loadSharing();
  }

  private async loadSharing(): Promise<void> {
    try {
      const [sharing, set] = await Promise.all([
        this.api.sharing(this.data.id),
        this.data.initialMembers ? Promise.resolve(null) : this.api.get(this.data.id),
      ]);
      this.sharingData.set(sharing);
      if (set) this.members.set(set.members);
    } catch {
      this.shareError.set('Không thể tải thông tin chia sẻ.');
    }
  }

  protected invite(): Promise<void> {
    return this.share(this.selectedPerson(), this.access, true);
  }

  protected async share(username: string, access: BankSharedRole | null, inviting = false): Promise<void> {
    if (!username || this.sharing()) return;
    this.sharing.set(true);
    this.shareError.set('');
    try {
      await this.api.share(this.data.id, username, access);
      if (inviting) this.resetInvite();
      const [set] = await Promise.all([
        this.api.get(this.data.id),
        this.data.onMembersChanged?.(),
      ]);
      this.members.set(set.members);
    } catch (error) {
      this.shareError.set(
        inviting && error instanceof HttpErrorResponse && error.status === 404
          ? 'Không tìm thấy tài khoản này.'
          : 'Không thể cập nhật quyền truy cập. Hãy thử lại.',
      );
    } finally {
      this.sharing.set(false);
    }
  }

  protected search(query: string): void {
    this.username = query;
    clearTimeout(this.searchTimer);
    const generation = ++this.searchGeneration;
    this.suggestedAccounts.set([]);
    this.searchStatus.set('idle');
    if (query.trim().length < 3) return;
    this.searchStatus.set('loading');
    this.searchTimer = setTimeout(async () => {
      try {
        const matches = await this.api.searchAccounts(this.data.id, query.trim());
        if (generation !== this.searchGeneration) return;
        this.suggestedAccounts.set(matches);
        this.searchStatus.set('done');
      } catch {
        if (generation === this.searchGeneration) this.searchStatus.set('error');
      }
    }, 250);
  }

  protected choosePerson(username: string): void {
    this.resetInvite();
    this.selectedPerson.set(username);
  }

  protected resetInvite(): void {
    this.search('');
    this.selectedPerson.set('');
    this.access = 'editor';
  }

  protected async changeLink(mode: BankLinkAccess['mode'], access: BankSharedRole = 'viewer'): Promise<void> {
    const current = this.sharingData();
    if (!current || this.sharing()) return;
    this.sharing.set(true);
    this.shareError.set('');
    try {
      const link = await this.api.setSharingLink(this.data.id, mode === 'restricted' ? { mode } : { mode, access });
      this.sharingData.set({ ...current, link });
      this.linkCopied.set(false);
    } catch {
      this.shareError.set('Không thể thay đổi quyền truy cập qua liên kết.');
    } finally {
      this.sharing.set(false);
    }
  }

  protected async copyShareLink(): Promise<void> {
    this.shareError.set('');
    try {
      const link = this.sharingData()?.link;
      const tree = this.router.createUrlTree(['/share/questions', this.data.id], {
        fragment: link?.mode === 'link' ? link.token : undefined,
      });
      const address = this.location.prepareExternalUrl(this.router.serializeUrl(tree));
      await navigator.clipboard.writeText(new URL(address, window.location.origin).href);
      this.linkCopied.set(true);
    } catch {
      this.shareError.set('Không thể sao chép. Bạn có thể sao chép liên kết từ thanh địa chỉ.');
    }
  }

  ngOnDestroy(): void {
    clearTimeout(this.searchTimer);
    this.searchGeneration++;
  }
}
