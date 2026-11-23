import { Component, EventEmitter, inject, Input, Output, ChangeDetectionStrategy } from '@angular/core';
import { IQuestion, QuestionType, IPlayer } from '../../editor.interfaces';

import { CdkDropList, CdkDrag, CdkDragHandle, CdkDragDrop, moveItemInArray } from '@angular/cdk/drag-drop';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { EditableComponent, EditModeDirective, ViewModeDirective, EditableOnEnterDirective, EditableOnEscapeDirective, EditableFocusDirective } from '@ngneat/edit-in-place';
import { MatCardModule } from '@angular/material/card';
import { MatDividerModule } from '@angular/material/divider';
import { MatButtonModule } from '@angular/material/button';
import { MatTooltipModule } from '@angular/material/tooltip';
import { DialogService } from '../../services/dialog.service';
import { HostedEditorSession } from '../../../host/hosted-editor-session';
import { EmptyStateComponent } from '../../../components/empty-state/empty-state.component';

@Component({
  selector: 'question-table',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.Eager,
  imports: [
    EmptyStateComponent,
    CdkDropList,
    CdkDrag,
    EditableComponent,
    EditableOnEnterDirective,
    EditableOnEscapeDirective,
    EditableFocusDirective,
    EditModeDirective,
    ViewModeDirective,
    MatIconModule,
    CommonModule,
    CdkDragHandle,
    MatInputModule,
    MatSelectModule,
    FormsModule,
    MatFormFieldModule,
    MatCardModule,
    MatDividerModule,
    MatButtonModule,
    MatTooltipModule
  ],
  templateUrl: './question-table.component.html',
  styleUrl: './question-table.component.scss'
})
export class QuestionTableComponent {
  protected readonly hosted = inject(HostedEditorSession, { optional: true });
  protected readonly finishingPointValues = [20, 30];
  protected editable(question: IQuestion): boolean {
    return !this.hosted || (this.hosted.canEdit() && !!question.bankId && this.hosted.active() === question.bankId);
  }
  protected async openField(question: IQuestion, field: EditableComponent): Promise<void> {
    if (!this.hosted) return;
    if (await this.hosted.beginQuestion(question, this.questions)) field.displayEditMode();
  }
  protected async attach(question: IQuestion, index: number, event: Event): Promise<void> {
    const input = event.target;
    if (!(input instanceof HTMLInputElement) || !input.files?.[0]) return;
    let file: File | undefined = input.files[0];
    input.value = '';
    if (file.type.startsWith('image/')) {
      file = await this.dialogService.openCropDialog(file, 'questionFree');
      if (!file) return;
    }
    if (this.hosted && this.context) {
      try {
        if (!await this.hosted.beginQuestion(question, this.questions)) return;
        await this.hosted.attachQuestion(this.context, file);
        if (this.hosted.data) await this.hosted.resolveMedia(this.hosted.data);
      } catch (error) { this.hosted.report(error); }
    } else this.onQuestionMediaChange.emit({ questionIndex: index, media: file });
  }
  @Input({ required: true }) questions!: IQuestion[];
  @Input() allowDelete = true;
  @Input() mediaPlacement: 'inline' | 'under' = 'inline';
  @Input() allowCreate = true;
  @Input() context: "kd" | "vcnv" | "tt" | "vd" | "chp" | undefined;
  @Output() questionsChangeEvent = new EventEmitter<IQuestion[]>();
  @Output() onQuestionMediaChange = new EventEmitter<{
    questionIndex: number,
    media: File
  }>();
  public readonly questionType = QuestionType;
  save() {
    if (this.hosted) { void this.hosted.commit(); return; }
    this.questionsChangeEvent.emit(this.questions);
  }
  cancel() {
    if (this.hosted) void this.hosted.finish();
    return;
  }
  constructor(
    private dialogService: DialogService,
  ) { }
  drop(event: CdkDragDrop<IPlayer[]>) {
    if (this.hosted) {
      void this.hosted.move(this.questions, event.previousIndex, event.currentIndex);
      return;
    }
    moveItemInArray(this.questions, event.previousIndex, event.currentIndex);
    this.questionsChangeEvent.emit(this.questions);
  }
  async add() {
    const data = await this.dialogService.openQuestionDialog({
      question: '',
      answer: '',
      type: QuestionType.TEXT,
      value: 10
    },
      this.context === 'vd' ? this.finishingPointValues : undefined);
    if (data) {
      if (this.hosted) {
        await this.hosted.add(this.questions, data.question, data.media);
        return;
      }
      let workingQuestion = data.question;
      this.questions.push(workingQuestion);
      this.questionsChangeEvent.emit();
      this.onQuestionMediaChange.emit(
        {
          questionIndex: this.questions.length - 1,
          media: data.media
        }
      );
    }
  }
}
