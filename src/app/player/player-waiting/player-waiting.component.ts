import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { Role } from '../../core/contracts/api';
import { AssetService } from '../../core/services/asset.service';
import { SessionService } from '../../core/services/session.service';

@Component({
  selector: 'app-player-waiting',
  templateUrl: './player-waiting.component.html',
  styleUrl: './player-waiting.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [],
})
export class PlayerWaitingComponent {
  protected readonly session = inject(SessionService);
  protected readonly assets = inject(AssetService);

  protected readonly backgroundUrl = computed(() => this.assets.brand('background'));
  protected readonly matchName = computed(() => this.session.match()?.matchName?.trim() || '');
  protected readonly greeting = computed(() => {
    switch (this.session.role()) {
      case Role.Player:
        return this.session.self()?.name ?? 'Thí sinh';
      case Role.Admin:
        return 'Ban tổ chức';
      case Role.Mc:
        return 'Người dẫn chương trình';
      case Role.Viewer:
        return 'Khán giả';
      default:
        return 'bạn';
    }
  });
}
