import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { NgClass, NgTemplateOutlet } from '@angular/common';
import { MatButton } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatIcon } from '@angular/material/icon';
import { MatProgressBar } from '@angular/material/progress-bar';
import { Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { Crumb, NavbarComponent } from '../components/navbar/navbar.component';
import { HostStore } from './host.store';
import { HostRibbon } from './host-ribbon';

@Component({
  selector: 'app-host',
  changeDetection: ChangeDetectionStrategy.Eager,
  providers: [HostRibbon],
  imports: [NgClass, NgTemplateOutlet, RouterLink, RouterLinkActive, RouterOutlet, MatButton, MatCardModule, MatIcon, MatProgressBar, NavbarComponent],
  templateUrl: './host.component.html',
})
export class HostComponent {
  protected readonly store = inject(HostStore);
  protected readonly ribbon = inject(HostRibbon);
  private readonly router = inject(Router);

  protected readonly menus = [
    { name: 'Phòng của bạn', icon: 'meeting_room', nav: 'rooms' },
    { name: 'Bộ câu hỏi', icon: 'inventory_2', nav: 'bank' },
  ] as const;

  constructor() {
    const path = this.router.currentNavigation()?.finalUrl?.toString() ?? this.router.url;
    if (!path.startsWith('/host/bank/')) void this.store.refresh();
  }
  protected get authoring(): boolean {
    return this.router.url.startsWith('/host/bank/') || this.router.url.startsWith('/host/drafts/');
  }

  protected get trail(): Crumb[] {
    if (this.authoring) {
      const trail: Crumb[] = [{ label: 'Bộ câu hỏi', link: '/host/bank' }];
      if (this.ribbon.title()) {
        const onRename = this.ribbon.onRename();
        trail.push({
          label: this.ribbon.title(),
          editable: !!onRename,
          onRename: onRename ?? undefined,
        });
      }
      return trail;
    }
    return this.section ? [{ label: 'Chủ phòng', link: '/host' }, { label: this.section }] : [{ label: 'Chủ phòng' }];
  }

  protected get section(): string | undefined {
    const last = this.router.url.split(/[?#]/)[0].split('/').filter(Boolean).pop();
    if (this.router.url.startsWith('/host/bank/')) return 'Biên tập bộ câu hỏi';
    if (this.router.url.startsWith('/host/drafts')) return 'Tệp ngoại tuyến';
    return this.menus.find((m) => m.nav === last)?.name;
  }
}
