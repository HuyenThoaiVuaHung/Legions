import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatCardModule } from '@angular/material/card';
import { MatRippleModule } from '@angular/material/core';
import { MatDividerModule } from '@angular/material/divider';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatMenuModule } from '@angular/material/menu';
import { MatSelectModule } from '@angular/material/select';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatTableModule } from '@angular/material/table';
import { MatTooltipModule } from '@angular/material/tooltip';
import { Router, RouterLink } from '@angular/router';
import { EmptyStateComponent } from '../../components/empty-state/empty-state.component';
import { HostStore } from '../../host/host.store';
import { LocalBankPublisher } from '../../host/local-bank-publisher.service';
import { IEditorData } from '../editor.interfaces';
import { EditorDataService } from '../services/editor.data.service';
import { FileHandlerService } from '../services/file.handler.service';

interface OfflineFileItem {
  uid: string;
  name: string;
  dateModified: number;
  questionCount: number;
  playerCount: number;
  data: IEditorData;
}

type SortKey = 'updated' | 'name';
type ViewMode = 'grid' | 'list';

const VIEW_MODE_KEY = 'legion.offline.viewMode';
const HIDE_GALLERY_KEY = 'legion.offline.hideGallery';

@Component({
  selector: 'app-dashboard',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.Eager,
  imports: [
    FormsModule,
    RouterLink,
    MatButtonModule,
    MatButtonToggleModule,
    MatCardModule,
    MatRippleModule,
    MatDividerModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatMenuModule,
    MatSelectModule,
    MatTableModule,
    MatTooltipModule,
    EmptyStateComponent,
  ],
  templateUrl: './dashboard.component.html',
  styleUrl: './dashboard.component.scss',
})
export class EditorDashboardComponent implements OnInit {
  private readonly router = inject(Router);
  private readonly publisher = inject(LocalBankPublisher);
  private readonly hostStore = inject(HostStore);
  private readonly snackBar = inject(MatSnackBar);

  protected readonly items = signal<OfflineFileItem[]>([]);
  protected readonly loading = signal(true);
  protected readonly busy = signal(false);
  protected readonly error = signal('');
  protected readonly query = signal('');
  protected readonly sortBy = signal<SortKey>('updated');
  protected readonly viewMode = signal<ViewMode>(
    localStorage.getItem(VIEW_MODE_KEY) === 'list' ? 'list' : 'grid',
  );
  protected readonly galleryDismissed = signal(localStorage.getItem(HIDE_GALLERY_KEY) === '1');
  protected readonly displayedColumns = ['name', 'summary', 'updatedAt', 'actions'];

  protected dismissGallery(): void {
    this.galleryDismissed.set(true);
    localStorage.setItem(HIDE_GALLERY_KEY, '1');
  }

  protected get hosted(): boolean {
    return this.router.url.startsWith('/host/drafts');
  }

  protected readonly filteredItems = computed<OfflineFileItem[]>(() => {
    const q = this.query().trim().toLowerCase();
    const sort = this.sortBy();
    const filtered = this.items().filter((item) => !q || item.name.toLowerCase().includes(q));
    return [...filtered].sort((a, b) => {
      if (sort === 'name') return a.name.localeCompare(b.name, 'vi');
      return (b.dateModified || 0) - (a.dateModified || 0);
    });
  });

  constructor(
    public editorDataService: EditorDataService,
    private fileHandler: FileHandlerService,
  ) {}

  ngOnInit(): void {
    void this.loadItems();
  }

  protected async loadItems(): Promise<void> {
    this.loading.set(true);
    this.editorDataService.loadAvailableEditorDataUids();
    const loaded: OfflineFileItem[] = [];
    for (const uid of [...this.editorDataService.availableEditorDataUids]) {
      try {
        const data = await this.editorDataService.loadLocalEditorData(uid);
        loaded.push({
          uid,
          name: data.matchData?.matchName || 'Trận đấu mới',
          dateModified: data.dateModified || 0,
          questionCount: this.countQuestions(data),
          playerCount: data.matchData?.players?.length ?? 0,
          data,
        });
      } catch {
        this.editorDataService.forgetEditorDataUid(uid);
      }
    }
    this.items.set(loaded);
    this.loading.set(false);
  }

  private countQuestions(data: IEditorData): number {
    const bank = data.questionBank;
    if (!bank) return 0;
    const kdMulti = bank.kd?.o24Questions?.multiplayer?.length ?? 0;
    const kdSingle = (bank.kd?.o24Questions?.singleplayer ?? []).reduce((sum, list) => sum + list.length, 0);
    const kd23 = (bank.kd?.o23Questions ?? []).reduce((sum, list) => sum + list.length, 0);
    const vcnv = bank.vcnv?.questions?.length ?? 0;
    const tt = bank.tt?.questions?.length ?? 0;
    const vd = (bank.vd?.questions ?? []).reduce((sum, list) => sum + list.length, 0);
    const chp = bank.chp?.questions?.length ?? 0;
    return kdMulti + kdSingle + kd23 + vcnv + tt + vd + chp;
  }

  protected setViewMode(mode: ViewMode): void {
    this.viewMode.set(mode);
    localStorage.setItem(VIEW_MODE_KEY, mode);
  }

  protected formatShortDate(timestamp: number): string {
    return new Date(timestamp).toLocaleDateString('vi-VN', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    });
  }

  protected formatDateTime(timestamp: number): string {
    return new Date(timestamp).toLocaleString('vi-VN');
  }

  protected async openItem(item: OfflineFileItem): Promise<void> {
    await this.editorDataService.setEditorData(item.data);
    await this.router.navigate([this.hosted ? '/host/drafts/general' : '/editor/general']);
  }

  protected async publishItem(item: OfflineFileItem): Promise<void> {
    if (this.busy()) return;
    this.busy.set(true);
    this.error.set('');
    try {
      const id = await this.publisher.publish(item.uid);
      await this.hostStore.refresh();
      this.snackBar.open('Đã lưu lên tài khoản.', undefined, { duration: 2500 });
      await this.router.navigate(['/host/bank', id]);
    } catch {
      this.error.set('Chưa lưu được lên tài khoản. Tệp vẫn được giữ ngoại tuyến trên trình duyệt này.');
    } finally {
      this.busy.set(false);
    }
  }

  protected exportItem(item: OfflineFileItem, format: 'legion' | 'excel'): void {
    if (format === 'legion') void this.fileHandler.downloadEditorData(item.uid);
    else void this.fileHandler.downloadExcelData(item.uid);
  }

  protected async deleteItem(item: OfflineFileItem): Promise<void> {
    await this.editorDataService.deleteLocalEditorData(item.uid);
    if (this.editorDataService.editorData?.uid === item.uid) {
      this.editorDataService.unloadEditorData();
    }
    this.items.update((list) => list.filter((entry) => entry.uid !== item.uid));
    this.snackBar.open(`Đã xóa “${item.name}”.`, undefined, { duration: 2500 });
  }

  public async createNewEditorData(): Promise<void> {
    const data = this.editorDataService.provideNewEditorData();
    await this.editorDataService.setEditorData(data);
    await this.router.navigate([this.hosted ? '/host/drafts/general' : '/editor/general']);
  }

  public uploadEditorDataFile(): void {
    this.pickFile('.legion,.lg', async (file) => {
      this.busy.set(true);
      this.error.set('');
      try {
        const uid = await this.fileHandler.loadEditorData(file);
        await this.editorDataService.setEditorData(await this.editorDataService.loadLocalEditorData(uid));
        await this.router.navigate([this.hosted ? '/host/drafts/general' : '/editor/general']);
      } catch (err) {
        this.error.set(err instanceof Error ? err.message : 'Không thể nhập tệp .legion.');
      } finally {
        this.busy.set(false);
      }
    });
  }

  public uploadExcelFile(): void {
    this.pickFile('.xlsx,.xls', async (file) => {
      this.busy.set(true);
      this.error.set('');
      try {
        const uid = await this.fileHandler.loadExcelData(file);
        await this.editorDataService.setEditorData(await this.editorDataService.loadLocalEditorData(uid));
        await this.router.navigate([this.hosted ? '/host/drafts/general' : '/editor/general']);
      } catch (err) {
        this.error.set(err instanceof Error ? err.message : 'Không thể nhập tệp Excel.');
      } finally {
        this.busy.set(false);
      }
    });
  }

  private pickFile(accept: string, handler: (file: File) => Promise<void>): void {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.onchange = () => {
      const file = input.files?.[0];
      if (file) void handler(file);
    };
    input.click();
  }
}
