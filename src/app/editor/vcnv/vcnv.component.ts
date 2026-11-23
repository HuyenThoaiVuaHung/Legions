import { Component, ChangeDetectionStrategy } from '@angular/core';
import { EditorDataService } from '../services/editor.data.service';
import { QuestionTableComponent } from '../components/question-table/question-table.component';
import { IQuestion, QuestionType } from '../editor.interfaces';

import { ImageInputComponent } from '../components/image-input/image-input.component';
import { EditorMediaService } from '../services/editor.media.service';
import { DialogService } from '../services/dialog.service';
import { CnvViewerComponent } from '../components/cnv-viewer/cnv-viewer.component';
import { MatButtonModule } from '@angular/material/button';
import { EmptyStateComponent } from '../../components/empty-state/empty-state.component';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { EditableComponent, EditModeDirective, ViewModeDirective, EditableOnEnterDirective, EditableOnEscapeDirective, EditableFocusDirective } from '@ngneat/edit-in-place';
import { MatFormFieldModule } from '@angular/material/form-field';
import { FormsModule } from '@angular/forms';
import { MatInputModule } from '@angular/material/input';

@Component({
  selector: 'app-vcnv',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.Eager,
  imports: [
    EmptyStateComponent,
    QuestionTableComponent,
    ImageInputComponent,
    CnvViewerComponent,
    MatButtonModule,
    MatIconModule,
    MatProgressSpinnerModule,
    EditableComponent,
    EditableOnEnterDirective,
    EditableOnEscapeDirective,
    EditableFocusDirective,
    EditModeDirective,
    ViewModeDirective,
    MatFormFieldModule,
    FormsModule,
    MatInputModule
  ],
  templateUrl: './vcnv.component.html',
  styleUrl: './vcnv.component.scss',
})
export class EditorVcnvComponent {
  constructor(
    public editorDataService: EditorDataService,
    public editorMediaService: EditorMediaService,
    private dialogService: DialogService
  ) {}
  public cache: string = '';
  public imageProccessing: boolean = false;
  async editObstacle(field: EditableComponent): Promise<void> {
    if (await this.editorDataService.hosted?.begin('settings')) field.displayEditMode();
  }
  saveObstacle(): void {
    const hosted = this.editorDataService.hosted;
    if (hosted) void hosted.commit();
    else this.save();
  }
  save() {
    this.editorDataService.saveCurrentEditorData();
  }
  async handleQuestionMediaChange(event: { questionIndex: number, media: File }) {
    if(this.editorDataService.editorData) this.editorDataService.editorData.questionBank.vcnv.questions[event.questionIndex] = await this.editorMediaService.handleQuestionMedia(
      this.editorDataService.editorData.questionBank.vcnv.questions[event.questionIndex],
      event.media,
      'vcnv',
      this.editorDataService.editorData.uid
    );
    this.save();
  }
  handleCnvImage(selectedFile?: File): void {
    const process = async (file?: File) => {
      if (file && this.editorDataService.editorData) {
        const cropped = await this.dialogService.openCropDialog(
          file,
          'vcnv'
        );
        if (cropped) {
          const hosted = this.editorDataService.hosted;
          if (hosted && !await hosted.begin('settings')) return;
          this.imageProccessing = true;
          this.editorDataService.editorData.questionBank.vcnv.cnvMediaSrcNames =
            await this.editorMediaService.handleCnvMedia(
              cropped,
              this.editorDataService.editorData.uid
            );
          this.editorDataService.editorData =
            await this.editorDataService.resolveMediaSrcs(
              this.editorDataService.editorData
            );
          this.saveObstacle();
          this.imageProccessing = false;
        }
      }
    };
    if (selectedFile) { void process(selectedFile); return; }
    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = 'image/*';
    fileInput.onchange = () => { void process(fileInput.files?.[0]); };
    fileInput.click();
  }
}
