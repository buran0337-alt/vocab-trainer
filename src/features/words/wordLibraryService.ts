import {
  MAX_MEANING_LENGTH,
  MAX_WORD_DISPLAY_LENGTH,
  normalizeEnglishWord,
  textLength,
  type ReviewState,
  type Repositories,
  type Word,
} from "../../data";

export interface WordFormValues {
  displayWord: string;
  chineseMeaning: string;
}

export type WordFieldErrors = Partial<
  Record<keyof WordFormValues, string>
>;

export interface WordListItem {
  word: Word;
  reviewState: ReviewState | null;
  learningCount: number;
}

export type AddWordResult =
  | { status: "created"; word: Word }
  | { status: "unchanged"; word: Word }
  | { status: "conflict"; word: Word; candidateMeaning: string };

export function validateWordForm(values: WordFormValues): WordFieldErrors {
  const errors: WordFieldErrors = {};

  if (values.displayWord.trim().length === 0) {
    errors.displayWord = "英文单词不能为空。";
  } else if (textLength(values.displayWord) > MAX_WORD_DISPLAY_LENGTH) {
    errors.displayWord = `英文单词不能超过 ${MAX_WORD_DISPLAY_LENGTH} 个字符。`;
  }

  if (values.chineseMeaning.trim().length === 0) {
    errors.chineseMeaning = "中文释义不能为空。";
  } else if (
    textLength(values.chineseMeaning) > MAX_MEANING_LENGTH
  ) {
    errors.chineseMeaning = `中文释义不能超过 ${MAX_MEANING_LENGTH} 个字符。`;
  }

  return errors;
}

export function hasWordFormErrors(errors: WordFieldErrors): boolean {
  return Object.keys(errors).length > 0;
}

export class WordLibraryService {
  private readonly repositories: Repositories;

  constructor(repositories: Repositories) {
    this.repositories = repositories;
  }

  async listWords(): Promise<WordListItem[]> {
    const [words, states, histories] = await Promise.all([
      this.repositories.words.list(),
      this.repositories.reviewStates.listAll(),
      this.repositories.learningHistory.listAll(),
    ]);
    const stateByWordId = new Map(
      states.map((state) => [state.wordId, state]),
    );
    const learningCountByWordId = new Map<string, number>();
    for (const history of histories) {
      learningCountByWordId.set(
        history.wordId,
        (learningCountByWordId.get(history.wordId) ?? 0) + 1,
      );
    }

    return words.map((word) => ({
      word,
      reviewState: stateByWordId.get(word.id) ?? null,
      learningCount: learningCountByWordId.get(word.id) ?? 0,
    }));
  }

  async addWord(values: WordFormValues): Promise<AddWordResult> {
    const existing = await this.repositories.words.getByNormalizedWord(
      normalizeEnglishWord(values.displayWord),
    );

    if (existing) {
      if (existing.chineseMeaning === values.chineseMeaning) {
        return { status: "unchanged", word: existing };
      }

      return {
        status: "conflict",
        word: existing,
        candidateMeaning: values.chineseMeaning,
      };
    }

    const word = await this.repositories.words.create(values);
    return { status: "created", word };
  }

  async updateWord(wordId: string, values: WordFormValues): Promise<Word> {
    return this.repositories.words.update(wordId, values);
  }

  async updateMeaning(wordId: string, chineseMeaning: string): Promise<Word> {
    return this.repositories.words.update(wordId, { chineseMeaning });
  }

  async deleteWord(wordId: string): Promise<void> {
    await this.repositories.words.delete(wordId);
  }
}

