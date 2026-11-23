import { ChangeDetectionStrategy, Component, DestroyRef, effect, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { SessionService } from '../core/services/session.service';
import { SfxService } from '../core/services/sfx.service';

/**
 * Shell for every player/viewer screen. Browsers block audio autoplay until
 * the user interacts with the page at least once, so this shows a one-shot
 * overlay hint and resumes any deferred/live looping or timed audio as soon
 * as the user clicks or presses a key.
 */
@Component({
  selector: 'app-player',
  templateUrl: './player.component.html',
  styleUrl: './player.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterOutlet],
  host: {
    '(window:keydown)': 'unlockAudio()',
  },
})
export class PlayerComponent {
  private readonly session = inject(SessionService);
  protected readonly sfx = inject(SfxService);

  constructor() {
    const destroyRef = inject(DestroyRef);
    effect(() => {
      const snapshot = this.session.liveState();
      if (snapshot) this.sfx.syncFromLiveState(snapshot);
    });
    destroyRef.onDestroy(() => this.sfx.stopAll());
  }

  unlockAudio(): void {
    if (this.sfx.audioBlocked()) {
      this.sfx.unlock();
    }
  }
}
