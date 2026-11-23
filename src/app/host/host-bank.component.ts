import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { Location } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatButton, MatIconButton } from '@angular/material/button';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatCardModule } from '@angular/material/card';
import { MatRippleModule } from '@angular/material/core';
import { MatDialog } from '@angular/material/dialog';
import { MatDividerModule } from '@angular/material/divider';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIcon } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatMenuModule } from '@angular/material/menu';
import { MatSelectModule } from '@angular/material/select';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatTableModule } from '@angular/material/table';
import { MatTooltip } from '@angular/material/tooltip';
import { Router, RouterLink } from '@angular/router';
import { QuestionSetItem } from '../core/contracts/bank';
import { EmptyStateComponent } from '../components/empty-state/empty-state.component';
import { BankApiService } from './bank-api.service';
import { HostStore } from './host.store';
import { ShareSetDialogComponent, ShareSetDialogData } from './share-set-dialog.component';

type OwnerFilter = 'all' | 'owner' | 'shared';
type SortKey = 'updated' | 'name' | 'size';
type ViewMode = 'grid' | 'list';

const VIEW_MODE_KEY = 'legion.bank.viewMode';
const HIDE_GALLERY_KEY = 'legion.bank.hideGallery';

@Component({
  selector: 'app-host-bank',
  changeDetection: ChangeDetectionStrategy.Eager,
  imports: [
    FormsModule,
    RouterLink,
    MatButton,
    MatIconButton,
    MatButtonToggleModule,
    MatCardModule,
    MatRippleModule,
    MatDividerModule,
    MatFormFieldModule,
    MatIcon,
    MatInputModule,
    MatMenuModule,
    MatSelectModule,
    MatTableModule,
    MatTooltip,
    EmptyStateComponent,
  ],
  templateUrl: './host-bank.component.html',
  styleUrl: './host-bank.component.scss',
})
export class HostBankComponent {
  protected readonly store = inject(HostStore);
  private readonly bankApi = inject(BankApiService);
  private readonly dialog = inject(MatDialog);
  private readonly location = inject(Location);
  private readonly snackBar = inject(MatSnackBar);
  private readonly router = inject(Router);

  protected readonly query = signal('');
  protected readonly ownerFilter = signal<OwnerFilter>('all');
  protected readonly sortBy = signal<SortKey>('updated');
  protected readonly viewMode = signal<ViewMode>(
    localStorage.getItem(VIEW_MODE_KEY) === 'list' ? 'list' : 'grid',
  );
  protected readonly galleryDismissed = signal(localStorage.getItem(HIDE_GALLERY_KEY) === '1');
  protected readonly displayedColumns = ['name', 'access', 'size', 'updatedAt', 'actions'];

  protected dismissGallery(): void {
    this.galleryDismissed.set(true);
    localStorage.setItem(HIDE_GALLERY_KEY, '1');
  }

  protected readonly filteredItems = computed<QuestionSetItem[]>(() => {
    const items = this.store.bank()?.items ?? [];
    const q = this.query().trim().toLowerCase();
    const filter = this.ownerFilter();
    const sort = this.sortBy();

    const filtered = items.filter((item) => {
      if (filter === 'owner' && item.access !== 'owner') return false;
      if (filter === 'shared' && item.access === 'owner') return false;
      if (q && !item.name.toLowerCase().includes(q)) return false;
      return true;
    });

    return [...filtered].sort((a, b) => {
      if (sort === 'name') return a.name.localeCompare(b.name, 'vi');
      if (sort === 'size') return b.sizeBytes - a.sizeBytes;
      return b.updatedAt - a.updatedAt;
    });
  });

  protected setViewMode(mode: ViewMode): void {
    this.viewMode.set(mode);
    localStorage.setItem(VIEW_MODE_KEY, mode);
  }

  protected resetFilters(): void {
    this.query.set('');
    this.ownerFilter.set('all');
  }

  protected openItem(item: QuestionSetItem): void {
    void this.router.navigate(['/host/bank', item.id]);
  }

  protected shareItem(item: QuestionSetItem): void {
    this.dialog.open<ShareSetDialogComponent, ShareSetDialogData>(ShareSetDialogComponent, {
      width: '33rem',
      maxWidth: 'calc(100vw - 2rem)',
      autoFocus: item.access === 'owner' ? 'input[name="username"]' : 'dialog',
      data: {
        id: item.id,
        name: item.name,
        access: item.access,
        accountName: this.store.profile()?.username,
      },
    });
  }

  protected async copyShareLink(item: QuestionSetItem): Promise<void> {
    try {
      const sharing = await this.bankApi.sharing(item.id);
      const link = sharing.link;
      const tree = this.router.createUrlTree(['/share/questions', item.id], {
        fragment: link?.mode === 'link' ? link.token : undefined,
      });
      const address = this.location.prepareExternalUrl(this.router.serializeUrl(tree));
      await navigator.clipboard.writeText(new URL(address, window.location.origin).href);
      this.snackBar.open('Đã sao chép liên kết chia sẻ.', undefined, { duration: 2500 });
    } catch {
      this.snackBar.open('Không thể sao chép liên kết chia sẻ.', undefined, { duration: 3000 });
    }
  }

  protected accessLabel(access: QuestionSetItem['access']): string {
    if (access === 'owner') return 'Của bạn';
    return access === 'editor' ? 'Được chia sẻ · Sửa' : 'Được chia sẻ · Xem';
  }

  protected formatShortDate(timestamp: number): string {
    return new Date(timestamp).toLocaleDateString('vi-VN', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    });
  }

  protected pickFile(accept: string, handler: (file: File) => Promise<void>): void {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.onchange = () => {
      const file = input.files?.[0];
      if (file) void handler(file);
    };
    input.click();
  }

  protected importLegion(): void {
    this.pickFile('.legion,.lg', (file) => this.store.importLegionFile(file));
  }

  protected importExcel(): void {
    this.pickFile('.xlsx,.xls', (file) => this.store.importExcelFile(file));
  }
}
