import { Directive, ElementRef, OnDestroy, inject } from '@angular/core';
import { HostedEditorSession } from '../../host/hosted-editor-session';

/** Reserve settings at the first edit interaction and release when focus leaves them. */
@Directive({ selector: '[hostedSettings]' })
export class HostedSettingsDirective implements OnDestroy {
  private readonly editor = inject(HostedEditorSession, { optional: true });
  private readonly element = inject(ElementRef<HTMLElement>).nativeElement;
  private opening?: Promise<boolean>;
  private replaying = false;
  private release?: ReturnType<typeof setTimeout>;
  constructor() {
    if (!this.editor) return;
    this.element.addEventListener('click', this.click, true);
    this.element.addEventListener('focusin', this.focusIn);
    this.element.addEventListener('focusout', this.focusOut);
    this.element.addEventListener('keydown', this.keydown, true);
  }
  private reserve(): Promise<boolean> {
    this.opening ??= this.editor!.begin('settings').finally(() => { this.opening = undefined; });
    return this.opening;
  }
  private readonly click = (event: MouseEvent): void => {
    const target = event.target instanceof Element ? event.target : null;
    if (this.replaying || this.editor?.active() === 'settings' || !target || target.closest('mat-expansion-panel-header')) return;
    const control = target.closest<HTMLElement>('editable, input, textarea, button, mat-select, mat-slide-toggle, image-input');
    if (!control) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    void this.reserve().then(ok => {
      if (!ok || !target.isConnected) return;
      this.replaying = true;
      try { (target instanceof HTMLElement ? target : control).click(); }
      finally { this.replaying = false; }
    });
  };
  private readonly focusIn = (event: FocusEvent): void => {
    clearTimeout(this.release);
    if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) void this.reserve();
  };
  private readonly focusOut = (): void => {
    clearTimeout(this.release);
    this.release = setTimeout(() => {
      if (this.editor?.active() === 'settings' && !this.element.contains(document.activeElement) &&
        !document.activeElement?.closest('.cdk-overlay-container')) void this.editor.finish();
    }, 150);
  };
  private readonly keydown = (event: KeyboardEvent): void => {
    if (this.editor?.active() === 'settings' || event.key === 'Tab' || event.key === 'Escape' || !(event.target instanceof HTMLElement)) return;
    if (!event.target.closest('input,textarea,editable,button,mat-select,mat-slide-toggle')) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    void this.reserve();
  };
  ngOnDestroy(): void {
    clearTimeout(this.release);
    this.element.removeEventListener('click', this.click, true);
    this.element.removeEventListener('focusin', this.focusIn);
    this.element.removeEventListener('focusout', this.focusOut);
    this.element.removeEventListener('keydown', this.keydown, true);
    if (this.editor?.active() === 'settings') void this.editor.finish();
  }
}
