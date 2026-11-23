import { Injectable, TemplateRef, signal } from '@angular/core';

@Injectable()
export class HostRibbon {
  readonly actions = signal<TemplateRef<unknown> | null>(null);
  readonly tools = signal<TemplateRef<unknown> | null>(null);
  readonly title = signal('');
  readonly onRename = signal<((name: string) => void | Promise<void>) | null>(null);
  readonly status = signal('');
}
