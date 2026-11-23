import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, Output, ChangeDetectionStrategy } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatRippleModule } from '@angular/material/core';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';

@Component({
  selector: 'image-input',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.Eager,
  imports: [MatRippleModule, MatIconModule, MatButtonModule, CommonModule, MatInputModule],
  templateUrl: './image-input.component.html',
  styleUrl: './image-input.component.scss',
})
export class ImageInputComponent {
  @Input() title: string | undefined;
  @Input() description: string | undefined;
  @Input() src: string | undefined;
  @Input() allowVideo = false;
  @Input() disabled = false;
  @Output() imageChangeEvent = new EventEmitter<File>();
  protected dragging = false;
  private readonly imageTypes = ['image/png', 'image/jpeg', 'image/jpg', 'image/webp', 'image/gif', 'image/avif'];
  private readonly videoTypes = ['video/mp4', 'video/webm', 'video/quicktime'];
  protected get acceptedTypes(): string {
    return this.types.join(',');
  }
  private get types(): string[] {
    return this.allowVideo ? [...this.imageTypes, ...this.videoTypes] : this.imageTypes;
  }
  public error: string | undefined;
  public handleImageInput() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = this.acceptedTypes;
    input.onchange = () => this.select(input.files);
    input.click();
  }
  protected dragOver(event: DragEvent): void {
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = this.disabled ? 'none' : 'copy';
    if (!this.disabled && event.dataTransfer?.types.includes('Files')) this.dragging = true;
  }
  protected dragLeave(event: DragEvent): void {
    if (event.currentTarget instanceof Node && event.relatedTarget instanceof Node &&
        event.currentTarget.contains(event.relatedTarget)) return;
    this.dragging = false;
  }
  protected drop(event: DragEvent): void {
    event.preventDefault();
    this.dragging = false;
    this.select(event.dataTransfer?.files);
  }
  private select(files?: FileList | null): void {
    if (this.disabled || !files?.length) return;
    if (files.length > 1) { this.error = 'Mỗi lần chỉ chọn một tệp.'; return; }
    const file = files[0];
    if (!this.types.includes(file.type)) {
      this.error = this.allowVideo
        ? 'Chọn ảnh (PNG, JPG, WebP, GIF, AVIF) hoặc video (MP4, WebM, MOV).'
        : 'Chọn ảnh PNG, JPG, WebP, GIF hoặc AVIF.';
      return;
    }
    this.error = undefined;
    this.imageChangeEvent.emit(file);
  }
}
