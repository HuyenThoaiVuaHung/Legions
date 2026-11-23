import { Component, ChangeDetectionStrategy } from '@angular/core';
import { EditorDataService } from '../services/editor.data.service';
import { MatButtonModule } from '@angular/material/button';
import { EmptyStateComponent } from '../../components/empty-state/empty-state.component';
import { ImageInputComponent } from '../components/image-input/image-input.component';
import { IQuestion, QuestionType } from '../editor.interfaces';

import { MatIconModule } from '@angular/material/icon';
import { EditableComponent, EditModeDirective, ViewModeDirective, EditableOnEnterDirective, EditableOnEscapeDirective, EditableFocusDirective } from '@ngneat/edit-in-place';
import { MatInputModule } from '@angular/material/input';
import { FormsModule, ReactiveFormsModule } from '@angular/forms';
import { CommonModule } from '@angular/common';
import { EditorMediaService } from '../services/editor.media.service';
import { DialogService } from '../services/dialog.service';

@Component({
  selector: 'app-tt',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.Eager,
  imports: [
    EmptyStateComponent,
    ImageInputComponent,
    MatButtonModule,
    MatIconModule,
    EditableComponent,
    EditableOnEnterDirective,
    EditableOnEscapeDirective,
    EditableFocusDirective,
    EditModeDirective,
    ViewModeDirective,
    MatInputModule,
    FormsModule
  ],
  templateUrl: './tt.component.html',
  styleUrl: './tt.component.scss'
})
export class EditorTtComponent {
  private readonly allowedImageTypes = new Set([
    'image/png',
    'image/jpeg',
    'image/jpg',
    'image/webp',
    'image/gif',
    'image/avif',
  ]);
  private readonly allowedVideoTypes = new Set([
    'video/mp4',
    'video/webm',
    'video/quicktime',
  ]);

  get questions(): IQuestion[] {
    return this.editorDataService.editorData?.questionBank.tt.questions ?? [];
  }

  get activeIndex(): number {
    const len = this.questions.length;
    if (len === 0) return -1;
    if (this.selectedQuestionIndex >= len) this.selectedQuestionIndex = len - 1;
    if (this.selectedQuestionIndex < 0) this.selectedQuestionIndex = 0;
    return this.selectedQuestionIndex;
  }

  async openField(field: EditableComponent): Promise<void> {
    const rows = this.questions;
    const idx = this.activeIndex;
    if (idx >= 0 && await this.editorDataService.hosted?.beginQuestion(rows[idx], rows)) field.displayEditMode();
  }
  saveField(): void {
    const hosted = this.editorDataService.hosted;
    if (hosted) void hosted.commit();
    else this.editorDataService.saveCurrentEditorData();
  }
  get canEditQuestion(): boolean {
    const hosted = this.editorDataService.hosted;
    const idx = this.activeIndex;
    const question = idx >= 0 ? this.questions[idx] : undefined;
    return !hosted || (hosted.canEdit() && !!question?.bankId && hosted.active() === question.bankId);
  }
  // View controls
  public readonly maxQuestions = 6;
  public selectedQuestionIndex = 0;
  public viewAnswer = false;
  public mediaError = '';

  //Enum
  public readonly questionType = QuestionType;
  constructor(
    public editorDataService: EditorDataService,
    public editorMediaService: EditorMediaService,
    private dialogService: DialogService
  ) {

  }

  public async addQuestion(): Promise<void> {
    const data = this.editorDataService.editorData;
    if (!data || data.questionBank.tt.questions.length >= this.maxQuestions) return;
    const blank: IQuestion = { question: '', answer: '', type: QuestionType.IMAGE, value: 40 };
    const hosted = this.editorDataService.hosted;
    if (hosted) {
      await hosted.add(data.questionBank.tt.questions, blank, undefined, data.questionBank.tt.questions.length);
      this.selectedQuestionIndex = Math.max(0, this.questions.length - 1);
      return;
    }
    data.questionBank.tt.questions.push(blank);
    this.selectedQuestionIndex = data.questionBank.tt.questions.length - 1;
    this.editorDataService.saveCurrentEditorData();
  }

  public async removeQuestion(): Promise<void> {
    const data = this.editorDataService.editorData;
    const idx = this.activeIndex;
    if (!data || idx < 0) return;
    const current = data.questionBank.tt.questions[idx];
    const hosted = this.editorDataService.hosted;
    if (hosted) {
      await hosted.remove(current);
      this.selectedQuestionIndex = Math.max(0, Math.min(idx, this.questions.length - 1));
      return;
    }
    data.questionBank.tt.questions.splice(idx, 1);
    this.selectedQuestionIndex = Math.max(0, Math.min(idx, data.questionBank.tt.questions.length - 1));
    this.editorDataService.saveCurrentEditorData();
  }

  public uploadNewMedia(isSecondary = false, selectedFile?: File): void {
    const index = this.activeIndex;
    if (index < 0) return;
    const process = async (file?: File | null) => {
      if (!file) return;
      const valid = isSecondary
        ? this.allowedImageTypes.has(file.type)
        : this.allowedImageTypes.has(file.type) || this.allowedVideoTypes.has(file.type);
      if (!valid) {
        this.mediaError = isSecondary
          ? 'Chọn ảnh PNG, JPG, WebP, GIF hoặc AVIF.'
          : 'Chọn ảnh (PNG, JPG, WebP, GIF, AVIF) hoặc video (MP4, WebM, MOV).';
        return;
      }
      this.mediaError = '';
      if (this.allowedImageTypes.has(file.type)) {
        file = await this.dialogService.openCropDialog(file, 'tt');
        if (!file) return;
      }
      const hosted = this.editorDataService.hosted;
      if (hosted) {
        const rows = this.editorDataService.editorData?.questionBank.tt.questions;
        if (rows && await hosted.beginQuestion(rows[index], rows)) {
          try { await hosted.attachQuestion('tt', file, isSecondary); }
          catch (error) { hosted.report(error); }
        }
        return;
      }
      if (this.editorDataService.editorData)
        this.editorDataService
          .editorData.questionBank
          .tt.questions[index]
          = await this.editorMediaService.handleQuestionMedia(
            this.editorDataService.editorData.questionBank.tt.questions[index],
            file,
            'tt',
            this.editorDataService.editorData.uid,
            isSecondary
          );
      this.editorDataService.saveCurrentEditorData();
      this.editorDataService.editorData = await this.editorDataService.resolveMediaSrcs(this.editorDataService.editorData!);
    };
    if (selectedFile) { void process(selectedFile); return; }
    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = isSecondary
      ? 'image/png,image/jpeg,image/webp,image/gif,image/avif'
      : 'image/png,image/jpeg,image/webp,image/gif,image/avif,video/mp4,video/webm,video/quicktime';
    fileInput.onchange = () => { void process(fileInput.files?.item(0)); };
    fileInput.click();
  }
}
