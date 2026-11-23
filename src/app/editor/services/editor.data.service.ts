import { O24ControlType, IEditorData, Pallette, IQuestionBank, IQuestion, MatchPosition, MatchVersion, QuestionType, IKdQuestionData } from '../editor.interfaces';
import { effect, inject, Injectable } from '@angular/core';

import { FsService } from './fs.service';
import { DialogService } from './dialog.service';
import { EditorStatus } from './enums/editor.enum';
import { EditorMediaService } from './editor.media.service';
import { MatSelectChange } from '@angular/material/select';
import { HostedEditorSession } from '../../host/hosted-editor-session';

/** Fields that only exist at runtime (blob URLs) and never belong in a saved file. */
const RUNTIME_ONLY_KEYS = ['mediaSrc', 'secondaryMediaSrc', 'cnvMediaSrcs', 'miscImageSrc'];

const emptyPools = (count: number): IQuestion[][] => Array.from({ length: count }, () => []);

@Injectable({
  providedIn: 'root',
})
export class EditorDataService {
  readonly hosted = inject(HostedEditorSession, { optional: true });
  constructor(
    private fs: FsService,
    private dialogService: DialogService,
    private media: EditorMediaService
  ) {
    this.loadAvailableEditorDataUids();
  }

  /**
   * The working editor data.
   * Default value is undefined.
   */
  private localData?: IEditorData;
  public get editorData(): IEditorData | undefined { return this.hosted ? this.hosted.data : this.localData; }
  public set editorData(value: IEditorData | undefined) {
    if (this.hosted) this.hosted.data = value;
    else this.localData = value;
  }
  /**
   * The status of the editor.
   * Possible values are:
   * - UNLOADED: The editor is not loaded.
   * - LOADED: The editor is loaded.
   * - UNSAVED: The editor has unsaved changes.
   * - SAVED: The editor has saved changes.
   * - ERROR: The editor has an error.
   * - WORKING: The editor is working.
   * Default value is UNLOADED.
   */
  public editorStatus: EditorStatus = EditorStatus.UNLOADED;
  /**
   * The available editor data uids.
   * Default value is an empty array.
   */
  public availableEditorDataUids: string[] = [];
  /**
   *
   * @returns A new instance of IEditorData with default values.
   */
  public provideNewEditorData(): IEditorData {
    const newEditorData: IEditorData = {
      uiConfig: {
        darkMode: true,
        pallette: Pallette.ROSE,
        miscImageSrcNames: {},
      },
      matchData: {
        matchName: 'Trận đấu mới',
        matchVersion: 26,
        matchPos: MatchPosition.IDLE,
        players: [
          {
            name: 'Nguyễn Văn A',
            score: 0,
            isReady: false,
          },
          {
            name: 'Trần Thị B',
            score: 0,
            isReady: false,
          },
          {
            name: 'Phạm Văn C',
            score: 0,
            isReady: false,
          },
          {
            name: 'Nguyễn Thị D',
            score: 0,
            isReady: false,
          },
        ],
      },
      questionBank: {
        kd: {
          o24Questions: {
            [O24ControlType.MULTIPLAYER]: [],
            [O24ControlType.SINGLEPLAYER]: emptyPools(4),
          },
        },
        vcnv: {
          questions:
            Array(5)
              .fill(null)
              .map(() => ({
                question: '',
                answer: '',
                type: QuestionType.TEXT,
                value: 10,
              })),
          cnvMediaSrcNames: Array(5)
            .fill(null)
            .map(() => ''),
          cnv: ''
        },
        tt: {
          questions: Array(4)
            .fill(null)
            .map(() => ({
              question: '',
              answer: '',
              type: QuestionType.IMAGE,
              value: 40,
            })),
        },
        vd: {
          questions: Array(4).fill(null).map(() => []),
        },
        chp: {
          questions: [],
        },
      },
      uid: crypto.randomUUID(),
      dateModified: Date.now(),
    };
    return newEditorData;
  }
  /**
   *
   * @returns Creates a new instance of IQuestion with default values.
   */

  private readonly matchVersionChangeMessage = {
    title: 'Bạn có chắc không?',
    message: 'Điều này sẽ xoá toàn bộ dữ liệu của phần thi khởi động hiện tại.',
  };
  public async handleMatchVersionChange(snapshot: MatchVersion) {
    if (!this.editorData) return;
    const next = this.editorData.matchData.matchVersion;
    const structuralKdChange = (snapshot === 23) !== (next === 23);
    if (!structuralKdChange) {
      this.saveCurrentEditorData();
      return;
    }
    if (
      (await this.dialogService.openConfirmationDialog(
        this.matchVersionChangeMessage.title,
        this.matchVersionChangeMessage.message
      )) == true
    ) {
      this.editorData.questionBank.kd = {};
      if (next === 23) {
        this.editorData.questionBank.kd.o23Questions = emptyPools(3);
      } else {
        this.editorData.questionBank.kd.o24Questions = {
          [O24ControlType.MULTIPLAYER]: [],
          [O24ControlType.SINGLEPLAYER]: emptyPools(4),
        };
      }
      this.saveCurrentEditorData();
    } else {
      this.editorData.matchData.matchVersion = snapshot;
    }
  }
  /**
   * Reload available editor data uids from local storage.
   */
  public loadAvailableEditorDataUids() {
    this.availableEditorDataUids = this.getAvailableEditorDataUids();
  }
  /** Drop a uid from the local index without touching OPFS. */
  public forgetEditorDataUid(uid: string) {
    this.availableEditorDataUids = this.availableEditorDataUids.filter((u) => u !== uid);
    localStorage.setItem('localEditorDataUids', JSON.stringify(this.availableEditorDataUids));
  }
  /**
   *
   * @param data The data to be set to the editor.
   */
  public async setEditorData(data: IEditorData) {
    this.editorData = data;
    this.editorStatus = EditorStatus.UNSAVED;
    await this.saveLocalEditorData(data);
    this.editorStatus = EditorStatus.SAVED;
    //TODO: Implement saving to localstorage.
  }
  /**
   *
   * @returns The editor data.
   */
  public async getEditorData() {
    //Future: Maybe add loading from Firebase storage.
    return this.editorData;
  }
  /**
   *
   * @returns The available editor data uids from local storage.
   */
  public getAvailableEditorDataUids(): string[] {
    if (!localStorage.getItem('localEditorDataUids')) {
      return [];
    }
    return JSON.parse(
      localStorage.getItem('localEditorDataUids') as string
    ) as string[];
  }

  private ioWorker: undefined | ReturnType<typeof setTimeout> = undefined;

  /**
   * Save the current editor data to local storage with debouncing.
   */
  public saveCurrentEditorData() {
    if (this.hosted) { void this.hosted.save(); return; }
    //implement debouncing
    if (this.editorData) {
      clearInterval(this.ioWorker);
      this.editorStatus = EditorStatus.WORKING;
      this.ioWorker = setTimeout(async () => {
        if (this.editorData) {
          this.editorData.dateModified = Date.now();
          await this.saveLocalEditorData(this.editorData);
        } else {
          this.editorStatus = EditorStatus.ERROR;
        }
        this.editorStatus = EditorStatus.SAVED;
      }, 500);
    }
  }
  public async flushCurrentEditorData(): Promise<void> {
    clearTimeout(this.ioWorker);
    if (this.editorData) {
      this.editorData.dateModified = Date.now();
      await this.saveLocalEditorData(this.editorData);
    }
  }
  /**
   *
   * @param _editorData The editor data to be saved to local storage.
   * @returns A promise that resolves when the data is saved.
   */
  public async saveLocalEditorData(_editorData: IEditorData) {
    this.editorStatus = EditorStatus.WORKING;
    await this.fs.writeLocalFile(
      new Blob([this.serializeEditorData(_editorData)]),
      `${_editorData.uid}/editor_data.json`
    );
    if (!this.availableEditorDataUids) {
      localStorage.setItem('localEditorDataUids', JSON.stringify([]));
    }
    if (!this.availableEditorDataUids.includes(_editorData.uid)) {
      this.availableEditorDataUids.push(_editorData.uid);
      localStorage.setItem(
        'localEditorDataUids',
        JSON.stringify(this.availableEditorDataUids)
      );
    }
    this.editorStatus = EditorStatus.SAVED;
  }
  /**
   *
   * @param uid The uid of the editor data to be loaded.
   * @returns The editor data.
   */
  public async loadLocalEditorData(uid: string) {
    const editorData: IEditorData = this.normalizeEditorData(JSON.parse(
      await (await this.fs.getFile(`${uid}/editor_data.json`)).text()
    ));
    return this.resolveMediaSrcs(editorData);
  }
  public async resolveMediaSrcs(editorData: IEditorData) {
    if (this.hosted) return this.hosted.resolveMedia(editorData);
    editorData.questionBank = await this.media.resolveQuestionBankMediaSrc(
      editorData.questionBank,
      editorData.uid,
      editorData.matchData.matchVersion
    );
    editorData.uiConfig.miscImageSrc = await this.media.resolveMiscMediaSrc(
      editorData.uid,
      editorData.uiConfig.miscImageSrcNames
    );
    return editorData;
  }
  /**
   *
   * @param uid The uid of the editor data to be deleted.
   * @returns A promise that resolves when the data is deleted.
   */
  public async deleteLocalEditorData(uid: string) {
    const editorData = await this.loadLocalEditorData(uid);
    if (
      await this.dialogService.openConfirmationDialog(
        'Xoá trận đấu?',
        `Bạn có muốn xoá trận đấu ${editorData.matchData.matchName} không?`
      )
    ) {
      await this.fs.deleteDirectory(uid);
      const uids = JSON.parse(
        localStorage.getItem('localEditorDataUids') as string
      ) as string[];
      localStorage.setItem(
        'localEditorDataUids',
        JSON.stringify(uids.filter((id: string) => id !== uid))
      );
    }
  }

  /**
   * Serialises editor data for storage or export, leaving out the runtime-only
   * blob URLs (mediaSrc, secondaryMediaSrc, cnvMediaSrcs, miscImageSrc).
   */
  public serializeEditorData(editorData: IEditorData): string {
    return JSON.stringify(editorData, (key, value) =>
      RUNTIME_ONLY_KEYS.includes(key) ? undefined : value
    );
  }

  /**
   * Fills in whatever a freshly parsed editor file may lack and upgrades the
   * legacy upper-case O24 control keys, so files written by the Legion backend
   * (lower-case keys, sparse banks) and old v2 files both open.
   */
  public normalizeEditorData(raw: any): IEditorData {
    const data = raw as IEditorData;
    data.uid ??= crypto.randomUUID();
    data.dateModified ??= Date.now();
    data.uiConfig = {
      darkMode: data.uiConfig?.darkMode === true,
      pallette: typeof data.uiConfig?.pallette === 'number' ? data.uiConfig.pallette : Pallette.ROSE,
      miscImageSrcNames: data.uiConfig?.miscImageSrcNames ?? {},
    };
    data.matchData.players ??= [];
    data.matchData.matchVersion = data.matchData.matchVersion === 23 ? 23 : 24;
    data.matchData.matchPos ??= MatchPosition.IDLE;
    const bank = (data.questionBank ??= {} as IQuestionBank);
    const kd: any = (bank.kd ??= {});
    if (data.matchData.matchVersion === 24) {
      const o24: any = (kd.o24Questions ??= {});
      for (const key of Object.keys(o24)) {
        if (key !== key.toLowerCase()) {
          o24[key.toLowerCase()] ??= o24[key];
          delete o24[key];
        }
      }
      o24[O24ControlType.MULTIPLAYER] ??= [];
      o24[O24ControlType.SINGLEPLAYER] ??= [];
      while (o24[O24ControlType.SINGLEPLAYER].length < 4) o24[O24ControlType.SINGLEPLAYER].push([]);
    } else {
      kd.o23Questions ??= emptyPools(3);
      while (kd.o23Questions.length < 3) kd.o23Questions.push([]);
    }
    const blank = (type: QuestionType, value: number): IQuestion => ({ question: '', answer: '', type, value });
    const vcnv: any = (bank.vcnv ??= {} as any);
    vcnv.questions ??= [];
    while (vcnv.questions.length < 5) vcnv.questions.push(blank(QuestionType.TEXT, 10));
    vcnv.cnv ??= '';
    vcnv.cnvMediaSrcNames ??= [];
    bank.tt ??= { questions: [] };
    while (bank.tt.questions.length < 4) bank.tt.questions.push(blank(QuestionType.IMAGE, 40));
    bank.vd ??= { questions: [] };
    while (bank.vd.questions.length < 4) bank.vd.questions.push([]);
    bank.chp ??= { questions: [] };
    return data;
  }

  public unloadEditorData() {
    this.editorData = undefined;
    this.editorStatus = EditorStatus.UNLOADED;
  }
}
