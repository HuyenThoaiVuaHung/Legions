import { HttpErrorResponse } from '@angular/common/http';
import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, DestroyRef, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButton, MatIconButton } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import { MatTooltip } from '@angular/material/tooltip';
import { MatDialog } from '@angular/material/dialog';
import { MatExpansionModule } from '@angular/material/expansion';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInput } from '@angular/material/input';
import { MatProgressBar } from '@angular/material/progress-bar';
import { MatSelectModule } from '@angular/material/select';
import { MatSlideToggle } from '@angular/material/slide-toggle';
import { MatSnackBar } from '@angular/material/snack-bar';
import { ActivatedRoute, Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { NameDialogComponent, NameDialogData } from '../../components/name-dialog/name-dialog.component';
import { ConfirmationDialogComponent } from '../../components/operator-dialog/confirmation-dialog.component';
import { STORAGE_KEYS } from '../../core/constants';
import { BankItem, LinkRole, RoomInfo, RoomLink, RotateSecretRole, SpectatorMode } from '../../core/contracts/api';
import { ApiService } from '../../core/services/api.service';
import { SessionService } from '../../core/services/session.service';
import { queryParamState } from '../../core/query-param';

@Component({
  selector: 'app-room', templateUrl: './room.component.html', styleUrl: './room.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DatePipe, FormsModule, MatButton, MatIcon, MatIconButton, MatTooltip, MatExpansionModule, MatFormFieldModule, MatInput, MatProgressBar, MatSelectModule, MatSlideToggle],
})
export class RoomComponent {
  private readonly api = inject(ApiService);
  private readonly dialog = inject(MatDialog);
  private readonly snackBar = inject(MatSnackBar);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  protected readonly session = inject(SessionService);
  protected readonly room = signal<RoomInfo | null>(null);
  protected readonly links = signal<RoomLink[]>([]);
  protected readonly bank = signal<BankItem[]>([]);
  protected readonly owner = signal(false);
  protected readonly failed = signal(false);
  private readonly openPanels = queryParamState('open');
  private readonly defaultOpen = this.route.snapshot.fragment === 'bank' ? 'info,bank' : 'info';
  protected isOpen(id: string): boolean {
    return (this.openPanels.value() ?? this.defaultOpen).split(',').includes(id);
  }
  protected toggle(id: string, expanded: boolean): void {
    const open = new Set((this.openPanels.value() ?? this.defaultOpen).split(',').filter((p) => p && p !== 'none'));
    if (expanded) open.add(id); else open.delete(id);
    this.openPanels.set(open.size ? [...open].join(',') : 'none');
  }
  protected readonly now = signal(Date.now());
  protected readonly revealed = signal<Record<string, boolean>>({});
  protected readonly staffRoles: readonly { key: 'admin' | 'mc' | 'spectator'; label: string }[] = [
    { key: 'admin', label: 'Quản trị' }, { key: 'mc', label: 'MC' },
    { key: 'spectator', label: 'Khán giả' },
  ];
  protected playerLabel(index: number): string {
    const name = this.session.match()?.players?.[index]?.name?.trim();
    return name ? `Thí sinh ${index + 1} (${name})` : `Thí sinh ${index + 1}`;
  }
  protected linkSummary(link: RoomLink): string {
    const roleLabel = link.role === 'player'
      ? (link.playerIndex !== undefined ? this.playerLabel(link.playerIndex) : 'Thí sinh')
      : link.role === 'mc' ? 'MC' : 'Khán giả';
    const viewLabel = link.view ? (this.viewOptions.find((o) => o.value === link.view)?.label ?? link.view) : '';
    return viewLabel ? `${roleLabel} · ${viewLabel}` : roleLabel;
  }
  protected readonly countdown = computed(() => {
    const expiry = this.session.roomExpiring() ?? this.room()?.expiresAt;
    if (!expiry) return 'Không xác định';
    const seconds = Math.max(0, Math.ceil((expiry - this.now()) / 1000));
    return this.formatDuration(seconds);
  });
  protected readonly viewOptions: readonly { value: string; label: string }[] = [
    { value: 'points', label: 'Bảng điểm' },
    { value: 'waiting', label: 'Màn hình chờ' },
    { value: 'sc-khoi-dong', label: 'OBS: Khởi động' },
    { value: 'sc-question-bar', label: 'OBS: Thanh câu hỏi' },
    { value: 'sc-ve-dich', label: 'OBS: Về đích' },
    { value: 'kd', label: 'Khởi động' },
    { value: 'vcnv-q', label: 'VCNV (Câu hỏi)' },
    { value: 'vcnv-a', label: 'VCNV (Đáp án)' },
    { value: 'tangtoc-q', label: 'Tăng tốc (Câu hỏi)' },
    { value: 'tangtoc-a', label: 'Tăng tốc (Đáp án)' },
    { value: 'vd', label: 'Về đích' },
    { value: 'chp', label: 'Câu hỏi phụ' },
  ];
  protected role: LinkRole = 'viewer';
  protected playerIndex = 0;
  protected view = '';
  protected label = '';
  protected expiryHours: number | string | null = null;
  protected singleUse = false;
  protected newLink = signal('');
  protected username = '';
  protected bankItemId = '';
  protected bankName = '';

  constructor() {
    const timer = setInterval(() => this.now.set(Date.now()), 1000);
    inject(DestroyRef).onDestroy(() => clearInterval(timer));
    void this.load();
  }
  protected formatBytes(bytes: number): string {
    const units = ['B', 'KB', 'MB', 'GB'];
    let value = bytes;
    let unit = 0;
    while (value >= 1024 && unit < units.length - 1) { value /= 1024; unit++; }
    return `${unit === 0 ? value : value.toFixed(1)} ${units[unit]}`;
  }
  private formatDuration(seconds: number): string {
    const days = Math.floor(seconds / 86400);
    const hours = Math.floor(seconds % 86400 / 3600);
    const minutes = Math.floor(seconds % 3600 / 60);
    if (days > 0) return `${days} ngày ${hours} giờ`;
    if (hours > 0) return `${hours} giờ ${minutes} phút`;
    return `${minutes} phút ${seconds % 60} giây`;
  }
  private error(error: unknown): void {
    const message = error instanceof HttpErrorResponse && typeof error.error?.error === 'string' ? error.error.error : 'Không thể thực hiện thao tác.';
    this.snackBar.open(message, 'Đóng');
  }
  private async confirm(title: string, message: string, confirmLabel: string): Promise<boolean> {
    return !!(await firstValueFrom(this.dialog.open(ConfirmationDialogComponent, { data: { title, message, confirmLabel } }).afterClosed()));
  }
  async load(): Promise<void> {
    this.failed.set(false);
    try {
      const [room, links] = await Promise.all([this.api.currentRoom(), this.api.roomLinks()]);
      this.room.set(room);
      this.links.set(links);
      this.owner.set(false);
      if (localStorage.getItem(STORAGE_KEYS.accountToken)) {
        const profile = await this.api.me();
        this.owner.set(profile.accountId === room.ownerAccountId && profile.rooms.some((item) => item.roomId === room.roomId));
        if (this.owner()) this.bank.set((await this.api.bank()).items);
      }
      if (this.owner() && this.route.snapshot.fragment === 'bank') {
        setTimeout(() => document.getElementById('bank')?.scrollIntoView({ behavior: 'smooth' }));
      }
    } catch (error) { this.failed.set(!this.room()); this.error(error); }
  }
  async copy(value: string): Promise<void> {
    try { await navigator.clipboard.writeText(value); this.snackBar.open('Đã sao chép.', 'Đóng'); }
    catch { this.snackBar.open('Không thể sao chép.', 'Đóng'); }
  }
  spectatorUrl(code: string): string { return `${window.location.origin}/r/${encodeURIComponent(code)}`; }
  toggleSecret(key: string): void { this.revealed.update((v) => ({ ...v, [key]: !v[key] })); }
  async rotate(role: RotateSecretRole, playerIndex?: number): Promise<void> {
    if (!await this.confirm('Đổi mã bí mật', 'Các phiên dùng mã này sẽ bị thu hồi. Tiếp tục?', 'Đổi')) return;
    try { await this.api.rotateSecret(role, playerIndex); await this.load(); } catch (error) { this.error(error); }
  }
  async rename(): Promise<void> {
    const current = this.room();
    if (!current) return;
    const name = await firstValueFrom(
      this.dialog.open<NameDialogComponent, NameDialogData, string>(NameDialogComponent, {
        width: '24rem',
        data: { title: 'Đổi tên phòng', label: 'Tên phòng', value: current.name },
      }).afterClosed(),
    );
    if (!name || name === current.name) return;
    try {
      await this.api.roomSettings({ name });
      await this.load();
      this.snackBar.open('Đã đổi tên phòng.', 'Đóng', { duration: 2500 });
    } catch (error) {
      this.error(error);
    }
  }

  async setListed(listed: boolean): Promise<void> {
    try { await this.api.roomSettings({ listed }); await this.load(); } catch (error) { this.error(error); await this.load(); }
  }

  async setMode(spectatorMode: SpectatorMode): Promise<void> {
    try { await this.api.roomSettings({ spectatorMode }); await this.load(); } catch (error) { this.error(error); await this.load(); }
  }
  async createLink(): Promise<void> {
    const rawExpiry = this.expiryHours;
    const hasExpiry = rawExpiry !== null && rawExpiry !== undefined && String(rawExpiry).trim() !== '';
    const parsedExpiry = hasExpiry ? Number(rawExpiry) : undefined;
    if (!this.label.trim()) {
      this.snackBar.open('Vui lòng nhập nhãn cho liên kết.', 'Đóng', { duration: 3000 }); return;
    }
    if (hasExpiry && (!Number.isFinite(parsedExpiry) || parsedExpiry! <= 0)) {
      this.snackBar.open('Thời hạn phải là số giờ lớn hơn 0.', 'Đóng', { duration: 3000 }); return;
    }
    try {
      const result = await this.api.createRoomLink({
        role: this.role,
        playerIndex: this.role === 'player' ? this.playerIndex : undefined,
        label: this.label.trim(),
        view: this.view || undefined,
        expiresInSeconds: parsedExpiry === undefined ? undefined : parsedExpiry * 3600,
        singleUse: this.singleUse,
      });
      this.newLink.set(window.location.origin + result.path);
      this.label = '';
      this.links.set(await this.api.roomLinks());
    } catch (error) { this.error(error); }
  }
  async revoke(id: string): Promise<void> {
    if (!await this.confirm('Thu hồi liên kết', 'Các phiên dùng liên kết này sẽ bị thu hồi.', 'Thu hồi')) return;
    try { await this.api.deleteRoomLink(id); this.links.set(await this.api.roomLinks()); } catch (error) { this.error(error); }
  }
  async save(): Promise<void> {
    if (this.bankItemId && !await this.confirm('Thay bản lưu', 'Bản lưu trong ngân hàng sẽ bị ghi đè.', 'Thay thế')) return;
    try {
      await this.api.saveToBank(this.bankItemId ? { bankItemId: this.bankItemId } : (this.bankName.trim() ? { name: this.bankName.trim() } : {}));
      this.bank.set((await this.api.bank()).items);
      this.snackBar.open('Đã lưu vào ngân hàng.', 'Đóng');
    } catch (error) { this.error(error); }
  }
  async transfer(): Promise<void> {
    const username = this.username.trim();
    if (!username || !await this.confirm('Chuyển phòng', `Chuyển quyền sở hữu cho ${username}? Phiên của bạn sẽ kết thúc.`, 'Chuyển')) return;
    try { await this.api.transferRoom(username); this.session.logout(); await this.router.navigateByUrl('/host'); } catch (error) { this.error(error); }
  }
  async close(): Promise<void> {
    if (!await this.confirm('Đóng phòng', 'Phòng và dữ liệu trong phòng sẽ bị xóa.', 'Tiếp tục')) return;
    if (!await this.confirm('Xác nhận đóng phòng', 'Bạn chắc chắn muốn đóng phòng? Thao tác này không thể hoàn tác.', 'Đóng phòng')) return;
    try { await this.api.closeRoom(); this.session.logout(); await this.router.navigateByUrl('/host'); } catch (error) { this.error(error); }
  }
}
