import { Injectable } from '@angular/core';
import JSZip from 'jszip';
import { FsService } from './fs.service';
import { EditorMediaService } from './editor.media.service';
import { EditorDataService } from './editor.data.service';
import { exportEditorDataToExcel, parseExcelToEditorData, saveBlob } from './excel-editor.util';
@Injectable({
  providedIn: 'root'
})
export class FileHandlerService {

  constructor(
    private editorMediaService: EditorMediaService,
    private editorDataService: EditorDataService,
    private fs: FsService
  ) { }
  public async downloadEditorData(uid: string): Promise<void> {
    const editorData = await this.editorDataService.loadLocalEditorData(uid);
    const zip = new JSZip();
    // Handle question bank media
    await this.editorMediaService.resolveQuestionBankMediaSrc(editorData.questionBank, editorData.uid, editorData.matchData.matchVersion,
      async (media: File, kind: string) => {
        zip.file(`${kind}/${media.name}`, await media.arrayBuffer());
      }
    );
    await this.editorMediaService.resolveMiscMediaSrc(editorData.uid, editorData.uiConfig.miscImageSrcNames,
      async (media: File, kind: string) => {
        zip.file(`${kind}/${media.name}`, await media.arrayBuffer());
      }
    )
    zip.file('editorData.json', this.editorDataService.serializeEditorData(editorData));
    const blob = await zip.generateAsync({ type: 'blob' });
    saveBlob(blob, `${editorData.matchData.matchName || 'match'}.legion`);
  }
  public async downloadExcelData(uid: string): Promise<void> {
    const editorData = await this.editorDataService.loadLocalEditorData(uid);
    saveBlob(exportEditorDataToExcel(editorData), `${editorData.matchData.matchName || 'match'}.xlsx`);
  }
  public async loadEditorData(file: File): Promise<string> {
    const zip = new JSZip();
    await zip.loadAsync(file);
    const dataFile = zip.file('editorData.json');
    if (!dataFile) throw new Error('Tệp .legion không hợp lệ (thiếu editorData.json).');
    const editorData = this.editorDataService.normalizeEditorData(
      JSON.parse(await dataFile.async('text'))
    );
    editorData.uid = crypto.randomUUID();
    await this.editorDataService.saveLocalEditorData(editorData);
    for (const entry of Object.values(zip.files)) {
      if (entry.name !== 'editorData.json' && entry.dir === false && !entry.name.split('/').includes('..')) {
        const media = await entry.async('blob');
        await this.fs.writeLocalFile(media, `/${editorData.uid}/${entry.name}`)
      }
    }
    return editorData.uid;
  }
  public async loadExcelData(file: File): Promise<string> {
    const editorData = this.editorDataService.normalizeEditorData(await parseExcelToEditorData(file));
    await this.editorDataService.saveLocalEditorData(editorData);
    return editorData.uid;
  }
}
