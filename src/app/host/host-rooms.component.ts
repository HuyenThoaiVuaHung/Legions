import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { MatButton, MatIconButton } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatRipple } from '@angular/material/core';
import { MatIcon } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { HostStore } from './host.store';

@Component({
  selector: 'app-host-rooms',
  changeDetection: ChangeDetectionStrategy.Eager,
  imports: [MatButton, MatIconButton, MatCardModule, MatIcon, MatMenuModule, MatRipple],
  templateUrl: './host-rooms.component.html',
})
export class HostRoomsComponent {
  protected readonly store = inject(HostStore);
}
