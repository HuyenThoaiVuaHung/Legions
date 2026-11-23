import { Component, ChangeDetectionStrategy } from '@angular/core';
import { FormsModule, ReactiveFormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatExpansionModule } from '@angular/material/expansion';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { ImageInputComponent } from '../components/image-input/image-input.component';
import { EditorDataService } from '../services/editor.data.service';
import { PlayerTableComponent } from '../components/player-table/player-table.component';
import { MatDividerModule } from '@angular/material/divider';
import { CommonModule } from '@angular/common';
import { EditorItemComponent } from '../components/editor-item/editor-item.component';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { IMiscMedia, Pallette } from '../editor.interfaces';
import { EditorMediaService } from '../services/editor.media.service';
import { DialogService, ImageCropPreset } from '../services/dialog.service';
import { HostedSettingsDirective } from '../services/hosted-settings.directive';

@Component({
  selector: 'app-general',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.Eager,
  imports: [
    HostedSettingsDirective,
    MatCardModule,
    MatExpansionModule,
    MatButtonModule,
    MatFormFieldModule,
    ReactiveFormsModule,
    MatSelectModule,
    MatInputModule,
    MatSlideToggleModule,
    ImageInputComponent,
    PlayerTableComponent,
    MatDividerModule,
    CommonModule,
    MatSelectModule,
    EditorItemComponent,
    MatIconModule,
    MatProgressSpinnerModule,
    FormsModule
  ],
  templateUrl: './general.component.html',
  styleUrl: './general.component.scss'
})
export class EditorGeneralComponent {
  private readonly cropPresets: Record<string, ImageCropPreset> = {
    logo: 'logo',
    'logo-long': 'wordmark',
    placeholder: 'placeholder',
    background: 'background',
    players: 'contestant',
  };
  constructor(
    public editorDataService: EditorDataService,
    public mediaService: EditorMediaService,
    private dialogService: DialogService
  ) {
  }
  public matchVersionSnapshot = this.editorDataService.editorData?.matchData.matchVersion!;
  public readonly palettes = Pallette;
  async save() {
    this.editorDataService.saveCurrentEditorData();
  }
  public async handleImageChange(file: File, type: keyof IMiscMedia, index?: number) {
    if (!this.editorDataService.editorData) return;
    const preset = this.cropPresets[String(type)];
    const cropped = preset ? await this.dialogService.openCropDialog(file, preset) : file;
    if (!cropped || !this.editorDataService.editorData) return;
    if (type !== 'players') {
      this.editorDataService.editorData.uiConfig.miscImageSrcNames[type] = await this.mediaService.setMedia(this.editorDataService.editorData.uid, cropped, 'misc');
    } else {
      if (!this.editorDataService.editorData.uiConfig.miscImageSrcNames.players) {
        this.editorDataService.editorData.uiConfig.miscImageSrcNames.players = new Array(this.editorDataService.editorData.matchData.players.length).fill('');
      }
      const fn = await this.mediaService.setMedia(this.editorDataService.editorData.uid, cropped, 'misc');
      this.editorDataService.editorData.uiConfig.miscImageSrcNames.players[index!] = fn;
    }
    this.editorDataService.editorData = await this.editorDataService.resolveMediaSrcs(this.editorDataService.editorData);
    this.editorDataService.saveCurrentEditorData();
  }

}
