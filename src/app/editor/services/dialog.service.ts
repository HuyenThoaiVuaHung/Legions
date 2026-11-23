import { Injectable } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { ConfirmationDialog } from '../components/confirmation-dialog/confirmation-dialog.component';
import { lastValueFrom } from 'rxjs';
import { IQuestion } from '../editor.interfaces';
import { QuestionDialog } from '../components/question-dialog/question-dialog.component';
import { ImageCropDialog, ImageCropDialogData } from '../components/image-crop-dialog/image-crop-dialog.component';

export interface ImageCropOptions {
  maintainAspectRatio?: boolean;
  aspectRatioX?: number;
  aspectRatioY?: number;
  resizeToWidth?: number;
  resizeToHeight?: number;
  onlyScaleDown?: boolean;
  title?: string;
  allowOriginal?: boolean;
  skipGif?: boolean;
}

export type ImageCropPreset =
  | 'vcnv'
  | 'tt'
  | 'questionFree'
  | 'logo'
  | 'icon'
  | 'wordmark'
  | 'placeholder'
  | 'background'
  | 'contestant';

export const IMAGE_CROP_PRESETS: Record<ImageCropPreset, ImageCropOptions> = {
  vcnv: {
    maintainAspectRatio: true,
    aspectRatioX: 16,
    aspectRatioY: 9,
    resizeToWidth: 1920,
    onlyScaleDown: true,
    title: 'Cắt ảnh chướng ngại vật (16:9)',
  },
  tt: {
    maintainAspectRatio: true,
    aspectRatioX: 16,
    aspectRatioY: 9,
    resizeToWidth: 1920,
    onlyScaleDown: true,
    skipGif: true,
    title: 'Cắt ảnh Tăng tốc (16:9)',
  },
  questionFree: {
    maintainAspectRatio: false,
    resizeToWidth: 1920,
    onlyScaleDown: true,
    allowOriginal: true,
    skipGif: true,
    title: 'Cắt ảnh câu hỏi',
  },
  logo: {
    maintainAspectRatio: true,
    aspectRatioX: 1,
    aspectRatioY: 1,
    resizeToWidth: 1024,
    onlyScaleDown: true,
    title: 'Cắt ảnh logo (1:1)',
  },
  icon: {
    maintainAspectRatio: true,
    aspectRatioX: 1,
    aspectRatioY: 1,
    resizeToWidth: 512,
    onlyScaleDown: true,
    title: 'Cắt ảnh biểu tượng (1:1)',
  },
  wordmark: {
    maintainAspectRatio: false,
    resizeToWidth: 1200,
    onlyScaleDown: true,
    allowOriginal: true,
    title: 'Cắt ảnh logo ngang',
  },
  placeholder: {
    maintainAspectRatio: true,
    aspectRatioX: 16,
    aspectRatioY: 9,
    resizeToWidth: 1920,
    onlyScaleDown: true,
    title: 'Cắt ảnh chờ (16:9)',
  },
  background: {
    maintainAspectRatio: true,
    aspectRatioX: 16,
    aspectRatioY: 9,
    resizeToWidth: 1920,
    onlyScaleDown: true,
    title: 'Cắt ảnh nền (16:9)',
  },
  contestant: {
    maintainAspectRatio: true,
    aspectRatioX: 3,
    aspectRatioY: 4,
    resizeToWidth: 900,
    onlyScaleDown: true,
    title: 'Cắt ảnh thí sinh (3:4)',
  },
};

@Injectable({
  providedIn: 'root'
})
export class DialogService {

  constructor(
    private dialog: MatDialog
  ) { }
  public async openConfirmationDialog(title?: string, description?: string): Promise<boolean> {
    const dialogRef = this.dialog.open(ConfirmationDialog, {
      data: {
        title: title,
        description: description
      },
      width: 'auto',
    });
    return lastValueFrom<boolean>(dialogRef.afterClosed());
  }
  public async openQuestionDialog(question?: IQuestion, valueList?: number[]): Promise<{question: IQuestion; media: File} | undefined> {
    const dialogRef = this.dialog.open(QuestionDialog, {
      data: {
        question: question,
        valueList: valueList
      },
      width: 'auto',
      maxWidth: 'max-content',
    });
    const result = await lastValueFrom<{question: IQuestion; media: File} | undefined>(dialogRef.afterClosed());
    console.log(result);
    return result;
  }
  public openCropDialog(image: File, presetOrOptions?: ImageCropPreset | ImageCropOptions): Promise<File | undefined>;
  public openCropDialog(image: File, aspectRatioX: number, aspectRatioY: number): Promise<File | undefined>;
  public async openCropDialog(
    image: File,
    presetOrOptionsOrX?: ImageCropPreset | ImageCropOptions | number,
    aspectRatioY?: number
  ): Promise<File | undefined> {
    let options: ImageCropOptions;
    if (typeof presetOrOptionsOrX === 'number') {
      options = {
        maintainAspectRatio: true,
        aspectRatioX: presetOrOptionsOrX,
        aspectRatioY: aspectRatioY ?? 9,
      };
    } else if (typeof presetOrOptionsOrX === 'string') {
      options = IMAGE_CROP_PRESETS[presetOrOptionsOrX];
    } else {
      options = presetOrOptionsOrX ?? {};
    }

    if (options.skipGif && image.type === 'image/gif') {
      return image;
    }

    const dialogRef = this.dialog.open<ImageCropDialog, ImageCropDialogData, File | undefined>(ImageCropDialog, {
      data: {
        image,
        maintainAspectRatio: options.maintainAspectRatio,
        aspectRatioX: options.aspectRatioX,
        aspectRatioY: options.aspectRatioY,
        resizeToWidth: options.resizeToWidth,
        resizeToHeight: options.resizeToHeight,
        onlyScaleDown: options.onlyScaleDown,
        title: options.title,
        allowOriginal: options.allowOriginal,
      },
      width: 'min(760px, 92vw)',
      maxWidth: '92vw',
      maxHeight: '90vh',
    });
    return lastValueFrom<File | undefined>(dialogRef.afterClosed());
  }
}