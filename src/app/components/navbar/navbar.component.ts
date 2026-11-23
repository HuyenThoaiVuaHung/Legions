import { ChangeDetectionStrategy, Component, ElementRef, computed, effect, inject, input, signal, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatIcon } from '@angular/material/icon';
import { MatChipsModule } from '@angular/material/chips';
import { MatTooltip } from '@angular/material/tooltip';
import { RouterLink } from '@angular/router';
import { AssetService } from '../../core/services/asset.service';
import { PaletteService } from '../../core/services/palette.service';

export interface Crumb {
  label: string;
  link?: string;
  editable?: boolean;
  onRename?: (name: string) => void | Promise<void>;
}

@Component({
  selector: 'app-navbar',
  changeDetection: ChangeDetectionStrategy.Eager,
  imports: [FormsModule, RouterLink, MatIcon, MatChipsModule, MatTooltip],
  template: `
    <header class="w-full box-border">
      <div class="navbar-main px-3 sm:px-6 xl:px-10 py-4 flex items-center justify-between gap-2 sm:gap-5">
      <div class="flex items-center gap-1 min-w-0">
        <a routerLink="/" aria-label="Legion" class="mr-1 sm:mr-2 shrink-0">
          <img [src]="assets.brand('logo-long')" alt="Legion" class="h-10 w-auto object-contain" [class.logo-whiten]="dark()" />
        </a>
        <span class="mat-title-large flex items-center gap-1 min-w-0">
          @for (crumb of trail(); track $index) {
            <mat-icon class="opacity-50 shrink-0">chevron_right</mat-icon>
            @if (crumb.link) {
              <a class="truncate no-underline !text-[var(--mat-sys-on-surface-variant)] hover:!text-[var(--mat-sys-on-surface)]" [routerLink]="crumb.link">{{ crumb.label }}</a>
            } @else if (crumb.editable && crumb.onRename) {
              @if (editingIndex() === $index) {
                <input
                  #crumbInput
                  type="text"
                  class="crumb-edit-input"
                  [ngModel]="editingValue()"
                  (ngModelChange)="editingValue.set($event)"
                  (keydown.enter)="commitEdit(crumb)"
                  (keydown.escape)="cancelEdit()"
                  (blur)="commitEdit(crumb)"
                  maxlength="80"
                  aria-label="Đổi tên"
                />
              } @else {
                <button
                  type="button"
                  class="crumb-editable truncate"
                  [matTooltip]="'Bấm để đổi tên'"
                  (click)="startEdit($index, crumb)"
                >
                  {{ crumb.label }}
                </button>
              }
            } @else {
              <strong class="truncate" [title]="crumb.label">{{ crumb.label }}</strong>
            }
          }
        </span>
        @if (status(); as label) {
          <mat-chip-set class="navbar-status shrink-0 ml-1 sm:ml-2" role="status" aria-live="polite">
            <mat-chip>{{ label }}</mat-chip>
          </mat-chip-set>
        }
      </div>
      <nav class="flex shrink-0 items-center gap-1 sm:gap-2"><ng-content /></nav>
      </div>
      <div class="navbar-ribbon px-3 sm:px-6 xl:px-10"><ng-content select="[navbarRibbon]" /></div>
    </header>
  `,
  styles: `
    .logo-whiten { filter: brightness(0) invert(1); }
    .navbar-ribbon {
      --mat-tab-container-height: 36px;
      --mat-tab-divider-height: 0px;
    }
    .navbar-ribbon:empty { display: none; }
    header:has(.navbar-ribbon:not(:empty)) {
      background: var(--mat-sys-surface);
      border-bottom: 1px solid var(--mat-sys-outline-variant);
    }
    header:has(.navbar-ribbon:not(:empty)) .navbar-main { padding-block: .5rem; }
    .navbar-status {
      --mat-chip-container-height: 22px;
      --mat-chip-label-text-size: 11px;
    }
    .crumb-editable {
      appearance: none;
      background: transparent;
      border: 1px solid transparent;
      border-radius: 6px;
      padding: 2px 6px;
      margin: -2px -6px;
      font: inherit;
      font-weight: 700;
      color: inherit;
      cursor: text;
      max-width: 100%;
      text-align: left;
      transition: border-color 120ms ease, background-color 120ms ease;
    }
    .crumb-editable:hover {
      border-color: var(--mat-sys-outline-variant);
      background: color-mix(in srgb, var(--mat-sys-on-surface) 4%, transparent);
    }
    .crumb-editable:focus-visible {
      outline: 2px solid var(--mat-sys-primary);
      outline-offset: 1px;
    }
    .crumb-edit-input {
      font: inherit;
      font-weight: 700;
      color: var(--mat-sys-on-surface);
      background: var(--mat-sys-surface-container-highest);
      border: 1.5px solid var(--mat-sys-primary);
      border-radius: 6px;
      padding: 2px 8px;
      margin: -2px -6px;
      outline: none;
      min-width: 8rem;
      max-width: 24rem;
    }
  `,
})
export class NavbarComponent {
  readonly trail = input<readonly Crumb[]>([]);
  readonly status = input('');
  protected readonly assets = inject(AssetService);
  private readonly palette = inject(PaletteService);
  private readonly crumbInput = viewChild<ElementRef<HTMLInputElement>>('crumbInput');
  protected readonly editingIndex = signal<number | null>(null);
  protected readonly editingValue = signal('');
  protected readonly dark = computed(() => {
    const mode = this.palette.mode();
    return mode === 'dark' || (mode === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
  });

  constructor() {
    effect(() => {
      const input = this.crumbInput()?.nativeElement;
      if (input) {
        input.focus();
        input.select();
      }
    });
  }

  protected startEdit(index: number, crumb: Crumb): void {
    if (!crumb.editable || !crumb.onRename) return;
    this.editingIndex.set(index);
    this.editingValue.set(crumb.label);
  }

  protected commitEdit(crumb: Crumb): void {
    if (this.editingIndex() === null) return;
    const next = this.editingValue().trim();
    this.editingIndex.set(null);
    if (next && next !== crumb.label) {
      void crumb.onRename?.(next);
    }
  }

  protected cancelEdit(): void {
    this.editingIndex.set(null);
  }
}
