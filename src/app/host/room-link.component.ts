import { HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormBuilder, FormsModule, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButton } from '@angular/material/button';
import { MatFormField, MatLabel } from '@angular/material/form-field';
import { MatIcon } from '@angular/material/icon';
import { MatInput } from '@angular/material/input';
import { MatProgressSpinner } from '@angular/material/progress-spinner';
import { MatTooltip } from '@angular/material/tooltip';
import { ActivatedRoute, Router } from '@angular/router';
import { ApiService } from '../core/services/api.service';
import { AssetService } from '../core/services/asset.service';
import { ScreenService } from '../core/services/screen.service';
import { SessionService } from '../core/services/session.service';
import { joinError } from './join-error';

const VIEW_ROUTES: Readonly<Record<string, string>> = {
  'sc-khoi-dong': '/misc/sc-khoi-dong',
  'sc-question-bar': '/misc/sc-question-bar',
  'sc-ve-dich': '/misc/sc-ve-dich',
  'kd': '/player/kd',
  'vcnv-q': '/player/vcnv-q',
  'vcnv-a': '/player/vcnv-a',
  'tangtoc-q': '/player/tangtoc-q',
  'tangtoc-a': '/player/tangtoc-a',
  'vd': '/player/vd',
  'chp': '/player/chp',
  'points': '/player/points',
  'waiting': '/player/waiting',
};

@Component({
  selector: 'app-room-link',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FormsModule,
    ReactiveFormsModule,
    MatButton,
    MatFormField,
    MatIcon,
    MatInput,
    MatLabel,
    MatProgressSpinner,
    MatTooltip,
  ],
  template: `
    <div class="w-screen min-h-screen flex justify-center items-center p-6 box-border">
      <div class="w-full max-w-[72rem] min-h-[30rem] flex flex-col md:flex-row items-center gap-10">
        <div class="w-full md:w-1/2 flex flex-col justify-center gap-3">
          <img [src]="assets.brand('logo-long')" alt="Legion" class="object-contain max-w-96 max-h-28 self-start" />
          <div>
            <h3>
              <strong>
                @if (hasToken || view) {
                  Vào phòng {{ code }}.
                } @else {
                  Cung cấp mã đăng nhập của bạn.
                }
              </strong>
            </h3>
            <h6 class="font-semibold opacity-70">
              @if (hasToken) {
                Đang xác thực liên kết vào phòng {{ code }}.
              } @else {
                Phòng {{ code }}. Nhập mã thí sinh, MC, ban tổ chức hoặc xem trực tiếp.
              }
            </h6>
          </div>

          @if (!hasToken) {
            <div class="mt-4 flex flex-col gap-2 w-full max-w-96">
              <div class="flex flex-wrap gap-2">
                <button mat-flat-button [disabled]="busy()" (click)="joinAsViewer()">
                  <mat-icon>visibility</mat-icon>
                  Xem trực tiếp
                </button>
                <button
                  mat-stroked-button
                  [disabled]="busy()"
                  (click)="setupBackScreen()"
                  matTooltip="Toàn màn hình & giữ màn hình sáng"
                >
                  <mat-icon>cast</mat-icon>
                  Màn hình chiếu
                </button>
              </div>
            </div>
          }
        </div>

        <div class="w-full md:w-1/2 flex flex-col gap-4 justify-center">
          @if (busy() && (hasToken || view)) {
            <div class="flex items-center gap-3">
              <mat-spinner [diameter]="28"></mat-spinner>
              <span>Đang kết nối vào phòng {{ code }}...</span>
            </div>
          } @else if (!hasToken) {
            <form [formGroup]="secretForm" (ngSubmit)="loginWithSecret()" class="flex flex-col gap-2 max-w-96 w-full">
              <mat-form-field class="w-full">
                <mat-label>Mã đăng nhập</mat-label>
                <input
                  matInput
                  formControlName="secret"
                  placeholder="Nhập mã đăng nhập của bạn."
                  autocomplete="off"
                  required
                />
              </mat-form-field>
              <div>
                <button mat-flat-button type="submit" [disabled]="busy() || secretForm.invalid">
                  <mat-icon>arrow_right</mat-icon>
                  Đăng nhập
                </button>
              </div>
            </form>
          }

          @if (error()) {
            <p role="alert" class="text-red-400 text-sm m-0">{{ error() }}</p>
            @if (hasToken) {
              <div>
                <button mat-button [disabled]="busy()" (click)="joinWithToken()">Thử lại</button>
              </div>
            }
          }
        </div>
      </div>
    </div>
  `,
})
export class RoomLinkComponent {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly api = inject(ApiService);
  private readonly formBuilder = inject(FormBuilder);
  private readonly screen = inject(ScreenService);
  protected readonly session = inject(SessionService);
  protected readonly assets = inject(AssetService);

  readonly code = this.route.snapshot.paramMap.get('code') ?? '';
  protected readonly view = this.route.snapshot.paramMap.get('view');
  private readonly token = new URLSearchParams(window.location.hash.slice(1)).get('k');
  protected readonly hasToken = !!this.token;

  protected readonly busy = signal(false);
  protected readonly error = signal('');

  protected readonly secretForm = this.formBuilder.group({
    secret: ['', [Validators.required]],
  });

  constructor() {
    if (window.location.hash) {
      history.replaceState(history.state, '', window.location.pathname + window.location.search);
    }
    void this.start();
  }

  private async start(): Promise<void> {
    this.busy.set(true);
    try {
      await this.session.connect(window.location.origin);
      if (this.token) {
        await this.joinWithToken();
      } else if (this.view) {
        await this.joinRoom();
      } else {
        this.busy.set(false);
      }
    } catch {
      this.error.set('Không thể kết nối tới máy chủ.');
      this.busy.set(false);
    }
  }

  protected async joinWithToken(): Promise<void> {
    if (!this.token) return;
    this.busy.set(true);
    this.error.set('');
    try {
      const result = await this.api.joinLink({ token: this.token });
      await this.completeJoin(result);
    } catch (error) {
      this.error.set(joinError(error));
    } finally {
      this.busy.set(false);
    }
  }

  protected async loginWithSecret(): Promise<void> {
    if (this.secretForm.invalid) return;
    const secret = this.secretForm.controls.secret.value?.trim() || undefined;
    await this.joinRoom(secret);
  }

  protected async joinAsViewer(): Promise<void> {
    await this.joinRoom();
  }

  protected async setupBackScreen(): Promise<void> {
    const joined = await this.joinRoom();
    if (joined) await this.screen.presentHere();
  }

  private async joinRoom(secret?: string): Promise<boolean> {
    this.busy.set(true);
    this.error.set('');
    try {
      const result = await this.api.joinRoom({ code: this.code, secret });
      await this.completeJoin(result);
      return true;
    } catch (error) {
      this.error.set(joinError(error));
      return false;
    } finally {
      this.busy.set(false);
    }
  }

  private async completeJoin(result: { token: string; roleId: number; index?: number; roomId: string }): Promise<void> {
    this.session.followMatch.set(!this.view);
    await this.session.acceptRoomSession(result, this.code);
    const target = this.view
      ? this.session.base() + (VIEW_ROUTES[this.view] ?? '/player/waiting')
      : this.session.homeFor(result.roleId);
    await this.router.navigateByUrl(target);
  }
}
