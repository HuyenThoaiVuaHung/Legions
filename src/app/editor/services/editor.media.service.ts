import { Injectable, inject } from '@angular/core';
import { HostedEditorSession } from '../../host/hosted-editor-session';
import { splitVcnvImage } from '../../core/vcnv-image.util';
import { IQuestionBank, IQuestion, O24ControlType, QuestionType, IMiscMedia } from '../editor.interfaces';

import { FsService } from './fs.service';

@Injectable({
  providedIn: 'root',
})
export class EditorMediaService {
  private readonly hosted = inject(HostedEditorSession, { optional: true });
  constructor(public fs: FsService) { }
  public getMediaType(filetype: string): QuestionType {
    if (filetype.startsWith('image')) return QuestionType.IMAGE;
    if (filetype.startsWith('video')) return QuestionType.VIDEO;
    if (filetype.startsWith('audio')) return QuestionType.AUDIO;
    return QuestionType.TEXT;
  }
  public async handleQuestionMedia(
    question: IQuestion,
    media: File,
    kind: 'kd' | 'vcnv' | 'tt' | 'vd' | 'chp',
    uid: string,
    isSecondary: boolean = false
  ): Promise<IQuestion> {
    const type = this.getMediaType(media.type);
    if (type === QuestionType.TEXT) return question;
    const name = await this.setMedia(uid, media, kind);
    if (isSecondary) question.secondaryMediaSrcName = name;
    else {
      question.type = type;
      question.mediaSrcName = name;
    }
    return question;
  }
  /**
   *
   * @param question The question to be resolved.
   * @param kind The kind of question, possible values are 'kd', 'vcnv', 'tt', 'vd'.
   * @param dataUid The uid of the editor data.
   * @returns The question with mediaSrc resolved as blob URL.
   */
  public async resolveQuestionMediaSrc(
    question: IQuestion,
    kind: 'kd' | 'vcnv' | 'tt' | 'vd' | 'chp',
    dataUid: string,
    blobHandler?: questionMediaFileHandler
  ): Promise<IQuestion> {
    if (question.type !== QuestionType.TEXT) {
      if (question.mediaSrcName !== undefined && question.mediaSrcName !== '') {
        question.mediaSrc = await this.fs.getBlobUrl(
          `${dataUid}/${kind}/${question.mediaSrcName}`
        );
        if (blobHandler) {
          await blobHandler(await this.fs.getFile(`${dataUid}/${kind}/${question.mediaSrcName}`), kind);
        }
      }
      else question.mediaSrc = undefined;
    }
    if (question.secondaryMediaSrcName) {
      const path = `${dataUid}/${kind}/${question.secondaryMediaSrcName}`;
      question.secondaryMediaSrc = await this.fs.getBlobUrl(path);
      if (blobHandler) await blobHandler(await this.fs.getFile(path), kind);
    }
    return question;
  }

  /**
   *
   * @param questions The questions to be resolved.
   * @param kind The kind of questions, possible values are 'kd', 'vcnv', 'tt', 'vd'.
   * @param dataUid The uid of the editor data.
   * @returns The questions with mediaSrc resolved as blob URLs.
   */
  public async resolveQuestionsMediaSrc(
    questions: IQuestion[],
    kind: 'kd' | 'vcnv' | 'tt' | 'vd' | 'chp',
    dataUid: string,
    blobHandler?: questionMediaFileHandler
  ): Promise<IQuestion[]> {
    return Promise.all(
      questions.map(
        async (question) =>
          await this.resolveQuestionMediaSrc(question, kind, dataUid, blobHandler)
      )
    );
  }

  /**
   *
   * @param questionBank The question bank to be resolved.
   * @param ver Version of the matchData.
   * @param dataUid The uid of the editor data.
   * @returns The question bank with mediaSrc resolved as blob URLs.
   */
  public async resolveQuestionBankMediaSrc(
    questionBank: IQuestionBank,
    dataUid: string,
    ver?: number,
    blobHandler?: questionMediaFileHandler
  ): Promise<IQuestionBank> {

    questionBank.vcnv.questions = await this.resolveQuestionsMediaSrc(
      questionBank.vcnv.questions,
      'vcnv',
      dataUid, blobHandler
    );
    questionBank.vcnv.cnvMediaSrcs = [];
    for (let src of questionBank.vcnv.cnvMediaSrcNames) {
      questionBank.vcnv.cnvMediaSrcs.push(
        (await this.fs.getBlobUrl(`${dataUid}/vcnv/${src}`)) || ''
      );
      if (blobHandler && src !== '') {
        await blobHandler(await this.fs.getFile(`${dataUid}/vcnv/${src}`), 'vcnv');
      }
    }

    questionBank.tt.questions = await this.resolveQuestionsMediaSrc(
      questionBank.tt.questions,
      'tt',
      dataUid, blobHandler
    );

    questionBank.vd.questions = await Promise.all(
      questionBank.vd.questions.map((questions) =>
        this.resolveQuestionsMediaSrc(questions, 'vd', dataUid, blobHandler)
      )
    );

    questionBank.chp.questions = await this.resolveQuestionsMediaSrc(questionBank.chp.questions, 'chp', dataUid, blobHandler)
    if (ver) {
      if (ver === 23) {
        if (questionBank.kd.o23Questions) {
          questionBank.kd.o23Questions = await Promise.all(
            questionBank.kd.o23Questions.map(
              async (questions) =>
                await this.resolveQuestionsMediaSrc(questions, 'kd', dataUid, blobHandler)
            )
          );
          console.log(questionBank.kd.o23Questions, 'resolved');
        } else throw new Error('Invalid question bank version');
      } else if (ver === 24) {
        if (questionBank.kd.o24Questions) {
          questionBank.kd.o24Questions[O24ControlType.MULTIPLAYER] =
            await this.resolveQuestionsMediaSrc(
              questionBank.kd.o24Questions[O24ControlType.MULTIPLAYER],
              'kd',
              dataUid, blobHandler
            );
          await Promise.all(
            questionBank.kd.o24Questions[O24ControlType.SINGLEPLAYER].map(
              async (questions) =>
                await this.resolveQuestionsMediaSrc(questions, 'kd', dataUid, blobHandler)
            )
          );
        } else throw new Error('Invalid question bank version');
      }
    }
    return questionBank;
  }
  public async handleCnvMedia(file: File, uid: string): Promise<string[]> {
    const pieces = await splitVcnvImage(file);
    const mediaSrcNames: string[] = [];
    for (let i = 0; i < pieces.length; i++) {
      const pieceFile = new File([pieces[i]], `${crypto.randomUUID()}.png`, { type: 'image/png' });
      mediaSrcNames.push(await this.setMedia(uid, pieceFile, 'vcnv'));
    }
    return mediaSrcNames;
  }
  /**
   *
   * @param questionBank The question bank to be stripped of blob URLs.
   * @param ver Version of the matchData.
   * @returns The question bank with mediaSrc | Blob URLs stripped.
   */
  public stripQuestionBankMediaSrc(
    questionBank: IQuestionBank,
    ver?: number
  ): IQuestionBank {
    questionBank.vcnv.questions = this.stripQuestionsMediaSrc(
      questionBank.vcnv.questions
    );
    questionBank.vcnv.cnvMediaSrcs = undefined;
    questionBank.tt.questions = this.stripQuestionsMediaSrc(
      questionBank.tt.questions
    );
    questionBank.vd.questions = questionBank.vd.questions.map((questions) =>
      this.stripQuestionsMediaSrc(questions)
    );
    questionBank.chp.questions = this.stripQuestionsMediaSrc(
      questionBank.chp.questions
    );
    if (ver) {
      if (ver === 23) {
        if (questionBank.kd.o23Questions) {
          questionBank.kd.o23Questions = questionBank.kd.o23Questions.map(
            (questions) => this.stripQuestionsMediaSrc(questions)
          );
        } else throw new Error('Invalid question bank version');
      } else if (ver === 24) {
        if (questionBank.kd.o24Questions) {
          questionBank.kd.o24Questions[O24ControlType.MULTIPLAYER] =
            this.stripQuestionsMediaSrc(
              questionBank.kd.o24Questions[O24ControlType.MULTIPLAYER]
            );
          questionBank.kd.o24Questions[O24ControlType.SINGLEPLAYER] =
            questionBank.kd.o24Questions[O24ControlType.SINGLEPLAYER].map((questions) =>
              this.stripQuestionsMediaSrc(questions)
            );
        } else throw new Error('Invalid question bank version');
      }
    }
    return questionBank;
  }
  /**
   *
   * @param questions The questions to be stripped of blob URLs.
   * @returns The questions with mediaSrc | Blob URLs stripped.
   */
  public stripQuestionsMediaSrc(questions: IQuestion[]): IQuestion[] {
    return questions.map((question) => this.stripQuestionMediaSrc(question));
  }

  /**
   *
   * @param question The question to be stripped of blob URL.
   * @returns The question with mediaSrc | Blob URL stripped.
   */
  public stripQuestionMediaSrc(question: IQuestion): IQuestion {
    question.mediaSrc = undefined;
    question.secondaryMediaSrc = undefined;
    return question;
  }

  public async resolveMiscMediaSrc(uid: string, mediaSrcName: IMiscMedia,
    fileHandler?: questionMediaFileHandler
  ): Promise<IMiscMedia> {
    const mediaSrc: IMiscMedia = {
      ...mediaSrcName,
      players: [],
    };

    const properties = ['logo-long', 'logo', 'placeholder', 'background'];

    for (const property of properties) {
      if (mediaSrcName[property]) {
        if (fileHandler) {
          await fileHandler(
            await this.fs.getFile(`${uid}/misc/${mediaSrcName[property]}`),
            'misc'
          );
        }
        mediaSrc[property] = await this.fs.getBlobUrl(`${uid}/misc/${mediaSrcName[property]}`);
      }
    }

    if (mediaSrcName.players) {
      for (let name of mediaSrcName.players) {
        if (name != '') {
          if (fileHandler) {
            await fileHandler(
              await this.fs.getFile(`${uid}/misc/${name}`),
              'misc'
            );
          }

          mediaSrc.players!.push(await this.fs.getBlobUrl(`${uid}/misc/${name}`) || '');
        } else mediaSrc.players!.push('');
      }
    }

    return mediaSrc;
  }
  /**
   *
   * @param uid The uid of the editor data.
   * @param media The media to be set.
   * @returns The mediaSrcName of the set media.
   */
  public async setMedia(
    uid: string,
    media: File,
    kind: 'kd' | 'vcnv' | 'tt' | 'vd' | 'chp' | 'misc'
  ): Promise<string> {
    if (this.hosted) return this.hosted.upload(kind, media);
    const mediaSrcName =
      crypto.randomUUID() + '.' + media.name.split('.').pop();
    await this.fs.writeLocalFile(media, `${uid}/${kind}/${mediaSrcName}`);
    return mediaSrcName;
  }
}
type questionMediaFileHandler = (blob: File, kind: string) => Promise<void>;
