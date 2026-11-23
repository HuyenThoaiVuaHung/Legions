import { Component, Inject, ChangeDetectionStrategy } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialogActions, MatDialogClose, MatDialogContent, MatDialogTitle } from '@angular/material/dialog';
import { ImageCroppedEvent, ImageCropperComponent } from 'ngx-image-cropper';

export interface ImageCropDialogData {
  image: File;
  maintainAspectRatio?: boolean;
  aspectRatioX?: number;
  aspectRatioY?: number;
  resizeToWidth?: number;
  resizeToHeight?: number;
  onlyScaleDown?: boolean;
  title?: string;
  allowOriginal?: boolean;
}

@Component({
  selector: 'app-image-crop-dialog',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.Eager,
  imports: [
    MatDialogTitle,
    MatDialogActions,
    MatDialogClose,
    MatButtonModule,
    MatDialogContent,
    ImageCropperComponent
  ],
  templateUrl: './image-crop-dialog.component.html',
  styleUrl: './image-crop-dialog.component.scss'
})
export class ImageCropDialog {
  public resultImage: File | undefined = undefined;
  public loadFailed = false;

  constructor(
    @Inject(MAT_DIALOG_DATA) public data: ImageCropDialogData
  ) {}

  get dialogTitle(): string {
    return this.data.title || 'Cắt ảnh';
  }

  get maintainAspectRatio(): boolean {
    return this.data.maintainAspectRatio ?? true;
  }

  get aspectRatio(): number {
    const x = this.data.aspectRatioX && this.data.aspectRatioX > 0 ? this.data.aspectRatioX : 16;
    const y = this.data.aspectRatioY && this.data.aspectRatioY > 0 ? this.data.aspectRatioY : 9;
    return x / y;
  }

  get resizeToWidth(): number {
    return this.data.resizeToWidth ?? 0;
  }

  get resizeToHeight(): number {
    return this.data.resizeToHeight ?? 0;
  }

  get onlyScaleDown(): boolean {
    return this.data.onlyScaleDown ?? true;
  }

  get allowOriginal(): boolean {
    return this.data.allowOriginal ?? false;
  }

  imageCropped(event: ImageCroppedEvent) {
    if (!event.blob) return;
    const base = this.data.image.name.replace(/\.[^.]+$/, '') || 'image';
    this.resultImage = new File([event.blob], `${base}.png`, { type: 'image/png' });
  }

  onLoadImageFailed() {
    this.loadFailed = true;
    this.resultImage = undefined;
  }
}