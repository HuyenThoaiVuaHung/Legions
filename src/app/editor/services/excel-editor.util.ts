import * as XLSX from 'xlsx';
import { IEditorData, IQuestion, QuestionType, Pallette, MatchPosition, O24ControlType } from '../editor.interfaces';

type ExcelRow = Record<string, unknown>;

const COL_QUESTION = '__EMPTY';
const COL_ANSWER = '__EMPTY_1';
const COL_VD_VALUE = 'VỀ ĐÍCH';

const KD_SINGLEPLAYER_ROWS = { first: 3, last: 26 } as const;
const KD_MULTIPLAYER_ROWS = { first: 29, last: 40 } as const;
const KD_QUESTIONS_PER_PLAYER = 6;
const VCNV_OBSTACLE_ROW = 1;
const VCNV_FIRST_ROW = 3;
const VCNV_ROW_COUNT = 5;
const TT_FIRST_ROW = 2;
const TT_MIN_COUNT = 4;
const TT_MAX_COUNT = 6;
const VD_POOL_ROWS: ReadonlyArray<{ first: number; last: number }> = [
  { first: 3, last: 8 },
  { first: 11, last: 16 },
  { first: 19, last: 24 },
  { first: 27, last: 32 },
];
const CHP_ROWS = { first: 35, last: 37 } as const;
const VD_LOW_VALUE_LABEL = 'Câu hỏi 20 điểm';
const VD_HIGH_VALUE_LABEL = 'Câu hỏi 30 điểm';

function cellText(row: ExcelRow | undefined, key: string): string {
  const value = row?.[key];
  return value === undefined || value === null ? '' : String(value).trim();
}

function makeQuestion(question: string, answer: string, value: number, type = QuestionType.TEXT): IQuestion {
  return { question, answer, type, value, mediaSrcName: '', secondaryMediaSrcName: '' };
}

/**
 * Parse an Olympia-format .xlsx workbook (matching legendary's ExcelImportService
 * 4-sheet layout: KD, VCNV, TT, VD+CHP) into structured IEditorData.
 */
export async function parseExcelToEditorData(file: File): Promise<IEditorData> {
  const workbook = XLSX.read(await file.arrayBuffer(), { type: 'array' });
  const sheet = (index: number): ExcelRow[] => {
    const name = workbook.SheetNames[index];
    if (!name || !workbook.Sheets[name]) return [];
    return XLSX.utils.sheet_to_json<ExcelRow>(workbook.Sheets[name]);
  };

  const kdRows = sheet(0);
  const vcnvRows = sheet(1);
  const ttRows = sheet(2);
  const vdRows = sheet(3);

  // KD: 4 singleplayer pools (6 each) + multiplayer pool
  const singleplayer: IQuestion[][] = Array.from({ length: 4 }, () => []);
  let qCount = 0;
  let playerIndex = 0;
  for (let i = KD_SINGLEPLAYER_ROWS.first; i <= KD_SINGLEPLAYER_ROWS.last; i++) {
    const q = cellText(kdRows[i], COL_QUESTION);
    if (!q || playerIndex >= 4) continue;
    singleplayer[playerIndex].push(makeQuestion(q, cellText(kdRows[i], COL_ANSWER), 10));
    qCount++;
    if (qCount === KD_QUESTIONS_PER_PLAYER) {
      qCount = 0;
      playerIndex++;
    }
  }
  const multiplayer: IQuestion[] = [];
  for (let i = KD_MULTIPLAYER_ROWS.first; i <= KD_MULTIPLAYER_ROWS.last; i++) {
    const q = cellText(kdRows[i], COL_QUESTION);
    if (!q) continue;
    multiplayer.push(makeQuestion(q, cellText(kdRows[i], COL_ANSWER), 10));
  }

  // VCNV: obstacle + 5 rows
  const cnv = cellText(vcnvRows[VCNV_OBSTACLE_ROW], COL_QUESTION);
  const vcnvQuestions: IQuestion[] = [];
  for (let i = 0; i < VCNV_ROW_COUNT; i++) {
    const row = vcnvRows[VCNV_FIRST_ROW + i];
    vcnvQuestions.push(makeQuestion(cellText(row, COL_QUESTION), cellText(row, COL_ANSWER), 10));
  }

  // TT: 4 to 6 questions
  const ttQuestions: IQuestion[] = [];
  for (let i = 0; i < TT_MAX_COUNT; i++) {
    const row = ttRows[TT_FIRST_ROW + i];
    const q = cellText(row, COL_QUESTION);
    const a = cellText(row, COL_ANSWER);
    if (i < TT_MIN_COUNT || q || a) {
      ttQuestions.push(makeQuestion(q, a, 0, QuestionType.IMAGE));
    }
  }

  // VD: 4 player pools
  const vdQuestions: IQuestion[][] = VD_POOL_ROWS.map(({ first, last }) => {
    const pool: IQuestion[] = [];
    for (let i = first; i <= last; i++) {
      const row = vdRows[i];
      const q = cellText(row, COL_QUESTION);
      const a = cellText(row, COL_ANSWER);
      if (!q && !a) continue;
      const value = cellText(row, COL_VD_VALUE) === VD_LOW_VALUE_LABEL ? 20 : 30;
      pool.push(makeQuestion(q, a, value));
    }
    return pool;
  });

  // CHP: bottom of VD sheet
  const chpQuestions: IQuestion[] = [];
  for (let i = CHP_ROWS.first; i <= CHP_ROWS.last; i++) {
    const row = vdRows[i];
    const q = cellText(row, COL_QUESTION);
    const a = cellText(row, COL_ANSWER);
    if (!q && !a) continue;
    chpQuestions.push(makeQuestion(q, a, 0));
  }

  const matchName = file.name.replace(/\.xlsx?$/i, '').trim().slice(0, 80) || 'Bộ câu hỏi từ Excel';

  return {
    uid: crypto.randomUUID(),
    dateModified: Date.now(),
    uiConfig: {
      darkMode: true,
      pallette: Pallette.RED,
      miscImageSrcNames: {},
    },
    matchData: {
      matchName,
      matchVersion: 24,
      matchPos: MatchPosition.IDLE,
      players: [
        { name: 'Thí sinh 1', score: 0, isReady: false },
        { name: 'Thí sinh 2', score: 0, isReady: false },
        { name: 'Thí sinh 3', score: 0, isReady: false },
        { name: 'Thí sinh 4', score: 0, isReady: false },
      ],
    },
    questionBank: {
      kd: {
        o24Questions: {
          [O24ControlType.SINGLEPLAYER]: singleplayer,
          [O24ControlType.MULTIPLAYER]: multiplayer,
        },
        o23Questions: [[], [], []],
      },
      vcnv: {
        cnv,
        cnvMediaSrcNames: [],
        questions: vcnvQuestions,
      },
      tt: {
        questions: ttQuestions,
      },
      vd: {
        questions: vdQuestions,
      },
      chp: {
        questions: chpQuestions,
      },
    },
  };
}

/**
 * Export IEditorData to a 4-sheet Olympia-format .xlsx workbook (KD, VCNV, TT, VD+CHP)
 * that round-trips cleanly through both this parser and legendary's ExcelImportService.
 */
export function exportEditorDataToExcel(data: IEditorData): Blob {
  const wb = XLSX.utils.book_new();

  // Sheet 1: KD (row 0 has only col A so sheet_to_json produces __EMPTY, __EMPTY_1, ...)
  const kdAoa: (string | number)[][] = Array.from({ length: 42 }, () => ['', '', '', '', '']);
  kdAoa[0] = ['KHỞI ĐỘNG'];
  kdAoa[1] = ['', 'Câu hỏi', 'Đáp án', 'Hình ảnh', 'Âm thanh'];
  kdAoa[2] = ['Lượt cá nhân'];
  const sp = data.questionBank.kd.o24Questions?.[O24ControlType.SINGLEPLAYER] ?? data.questionBank.kd.o23Questions ?? [];
  for (let p = 0; p < 4; p++) {
    const pool = sp[p] ?? [];
    for (let j = 0; j < KD_QUESTIONS_PER_PLAYER; j++) {
      const q = pool[j];
      const rowIdx = KD_SINGLEPLAYER_ROWS.first + 1 + p * KD_QUESTIONS_PER_PLAYER + j;
      kdAoa[rowIdx] = [
        `TS ${p + 1} - Câu ${j + 1}`,
        q?.question ?? '',
        q?.answer ?? '',
        q?.type === QuestionType.IMAGE ? (q.mediaSrcName ?? '') : '',
        q?.type === QuestionType.AUDIO ? (q.mediaSrcName ?? '') : '',
      ];
    }
  }
  kdAoa[29] = ['Lượt chung'];
  const mp = data.questionBank.kd.o24Questions?.[O24ControlType.MULTIPLAYER] ?? [];
  for (let j = 0; j < 12; j++) {
    const q = mp[j];
    const rowIdx = KD_MULTIPLAYER_ROWS.first + 1 + j;
    kdAoa[rowIdx] = [
      `Câu ${j + 1}`,
      q?.question ?? '',
      q?.answer ?? '',
      q?.type === QuestionType.IMAGE ? (q.mediaSrcName ?? '') : '',
      q?.type === QuestionType.AUDIO ? (q.mediaSrcName ?? '') : '',
    ];
  }
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(kdAoa), 'KD');

  // Sheet 2: VCNV
  const vcnvAoa: (string | number)[][] = Array.from({ length: 10 }, () => ['', '', '', '']);
  vcnvAoa[0] = ['VƯỢT CHƯỚNG NGẠI VẬT'];
  vcnvAoa[1] = ['', 'Câu hỏi / CNV', 'Đáp án', 'Media'];
  vcnvAoa[2] = ['Chướng ngại vật', data.questionBank.vcnv.cnv ?? '', '', ''];
  const vcnvQs = data.questionBank.vcnv.questions ?? [];
  for (let i = 0; i < VCNV_ROW_COUNT; i++) {
    const q = vcnvQs[i];
    vcnvAoa[VCNV_FIRST_ROW + 1 + i] = [
      `Hàng ngang ${i + 1}`,
      q?.question ?? '',
      q?.answer ?? '',
      q?.mediaSrcName ?? '',
    ];
  }
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(vcnvAoa), 'VCNV');

  // Sheet 3: TT
  const ttQs = data.questionBank.tt.questions ?? [];
  const ttCount = Math.max(TT_MIN_COUNT, Math.min(TT_MAX_COUNT, ttQs.length));
  const ttAoa: (string | number)[][] = Array.from({ length: TT_FIRST_ROW + 1 + ttCount }, () => ['', '', '', '', '']);
  ttAoa[0] = ['TĂNG TỐC'];
  ttAoa[1] = ['', 'Câu hỏi', 'Đáp án', 'Media câu hỏi', 'Ảnh đáp án'];
  for (let i = 0; i < ttCount; i++) {
    const q = ttQs[i];
    ttAoa[TT_FIRST_ROW + 1 + i] = [
      `Câu ${i + 1}`,
      q?.question ?? '',
      q?.answer ?? '',
      q?.mediaSrcName ?? '',
      q?.secondaryMediaSrcName ?? '',
    ];
  }
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(ttAoa), 'TT');

  // Sheet 4: VD + CHP
  const vdAoa: (string | number)[][] = Array.from({ length: 40 }, () => ['', '', '', '', '', '']);
  vdAoa[0] = [COL_VD_VALUE];
  vdAoa[1] = ['', 'Câu hỏi', 'Đáp án', 'Video', 'Hình ảnh', 'Âm thanh'];
  const vdPools = data.questionBank.vd.questions ?? [];
  VD_POOL_ROWS.forEach(({ first, last }, p) => {
    vdAoa[first] = [`Gói thí sinh ${p + 1}`];
    const pool = vdPools[p] ?? [];
    for (let offset = 0; offset <= last - first; offset++) {
      const q = pool[offset];
      const rowIdx = first + 1 + offset;
      const valueLabel = (q?.value ?? 30) <= 20 ? VD_LOW_VALUE_LABEL : VD_HIGH_VALUE_LABEL;
      vdAoa[rowIdx] = [
        valueLabel,
        q?.question ?? '',
        q?.answer ?? '',
        q?.type === QuestionType.VIDEO ? (q.mediaSrcName ?? '') : '',
        q?.type === QuestionType.IMAGE ? (q.mediaSrcName ?? '') : '',
        q?.type === QuestionType.AUDIO ? (q.mediaSrcName ?? '') : '',
      ];
    }
  });
  vdAoa[CHP_ROWS.first] = ['CÂU HỎI PHỤ'];
  const chpQs = data.questionBank.chp.questions ?? [];
  for (let offset = 0; offset <= CHP_ROWS.last - CHP_ROWS.first; offset++) {
    const q = chpQs[offset];
    vdAoa[CHP_ROWS.first + 1 + offset] = [`CHP ${offset + 1}`, q?.question ?? '', q?.answer ?? ''];
  }
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(vdAoa), 'VD');

  const out = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
  return new Blob([out], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}

export function saveBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
