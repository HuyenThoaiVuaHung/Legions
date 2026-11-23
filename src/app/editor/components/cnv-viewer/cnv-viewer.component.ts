import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

@Component({
  selector: 'cnv-viewer',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [],
  templateUrl: './cnv-viewer.component.html',
  styleUrl: './cnv-viewer.component.scss',
})
export class CnvViewerComponent {
  readonly cnvMediaSrcs = input.required<readonly string[]>();
  protected readonly layers = computed(() =>
    this.cnvMediaSrcs().filter((src): src is string => typeof src === 'string' && src.length > 0),
  );
}
