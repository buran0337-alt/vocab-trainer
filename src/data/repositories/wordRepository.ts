import { normalizeEnglishWord } from "../normalization";
import {
  DataConflictError,
  DataNotFoundError,
  DataValidationError,
} from "../errors";
import {
  MAX_MEANING_LENGTH,
  MAX_WORD_DISPLAY_LENGTH,
} from "../constants";
import type { AppDatabase } from "../database";
import { runTransaction } from "../database";
import type { RepositoryOptions } from "../repositoryOptions";
import { resolveRepositoryOptions } from "../repositoryOptions";
import type { Word } from "../types";
import {
  assertMaximumTextLength,
  requireNonEmptyText,
} from "../validation";

export interface CreateWordInput {
  displayWord: string;
  chineseMeaning: string;
}

export interface UpdateWordInput {
  displayWord?: string;
  chineseMeaning?: string;
}

export type WordImportAction =
  | {
      type: "create";
      displayWord: string;
      chineseMeaning: string;
    }
  | {
      type: "update-meaning";
      wordId: string;
      chineseMeaning: string;
    };

export interface WordImportBatchResult {
  createdCount: number;
  updatedCount: number;
}

function prepareNewWordFields(
  displayWordInput: string,
  chineseMeaningInput: string,
): {
  displayWord: string;
  normalizedWord: string;
  chineseMeaning: string;
} {
  const displayWord = requireNonEmptyText(
    displayWordInput,
    "英文单词",
  );
  const chineseMeaning = requireNonEmptyText(
    chineseMeaningInput,
    "中文释义",
  );
  assertMaximumTextLength(
    displayWord,
    MAX_WORD_DISPLAY_LENGTH,
    "英文单词",
  );
  assertMaximumTextLength(
    chineseMeaning,
    MAX_MEANING_LENGTH,
    "中文释义",
  );

  const normalizedWord = normalizeEnglishWord(displayWord);
  if (normalizedWord.length === 0) {
    throw new DataValidationError("英文单词标准化后不能为空。");
  }

  return { displayWord, normalizedWord, chineseMeaning };
}

function prepareMeaning(chineseMeaningInput: string): string {
  const chineseMeaning = requireNonEmptyText(
    chineseMeaningInput,
    "中文释义",
  );
  assertMaximumTextLength(
    chineseMeaning,
    MAX_MEANING_LENGTH,
    "中文释义",
  );
  return chineseMeaning;
}

export class WordRepository {
  private readonly database: AppDatabase;
  private readonly now: () => number;
  private readonly createId: () => string;

  constructor(
    database: AppDatabase,
    options: RepositoryOptions = {},
  ) {
    this.database = database;
    const resolved = resolveRepositoryOptions(options);
    this.now = resolved.now;
    this.createId = resolved.createId;
  }

  async create(input: CreateWordInput): Promise<Word> {
    const fields = prepareNewWordFields(
      input.displayWord,
      input.chineseMeaning,
    );

    return runTransaction(
      this.database,
      ["words"],
      "readwrite",
      async (transaction) => {
        const words = transaction.objectStore("words");
        const existing = await words
          .index("byNormalizedWord")
          .get(fields.normalizedWord);

        if (existing) {
          throw new DataConflictError("该英文单词已经存在。");
        }

        const timestamp = this.now();
        const word: Word = {
          id: this.createId(),
          ...fields,
          createdAtMs: timestamp,
          updatedAtMs: timestamp,
        };

        await words.add(word);
        return word;
      },
    );
  }

  async getById(id: string): Promise<Word | null> {
    return (await this.database.get("words", id)) ?? null;
  }

  async requireById(id: string): Promise<Word> {
    const word = await this.getById(id);
    if (!word) {
      throw new DataNotFoundError("没有找到指定单词。");
    }
    return word;
  }

  async getByNormalizedWord(normalizedWord: string): Promise<Word | null> {
    const normalized = normalizeEnglishWord(normalizedWord);
    return (
      (await this.database.getFromIndex(
        "words",
        "byNormalizedWord",
        normalized,
      )) ?? null
    );
  }

  async list(): Promise<Word[]> {
    const words = await this.database.getAll("words");
    return words.sort(
      (left, right) =>
        left.createdAtMs - right.createdAtMs ||
        left.id.localeCompare(right.id),
    );
  }

  async update(id: string, changes: UpdateWordInput): Promise<Word> {
    const hasDisplayChange = changes.displayWord !== undefined;
    const hasMeaningChange = changes.chineseMeaning !== undefined;

    if (!hasDisplayChange && !hasMeaningChange) {
      throw new DataValidationError("没有需要更新的单词字段。");
    }

    return runTransaction(
      this.database,
      ["words"],
      "readwrite",
      async (transaction) => {
        const words = transaction.objectStore("words");
        const current = await words.get(id);

        if (!current) {
          throw new DataNotFoundError("没有找到要修改的单词。");
        }

        let displayWord = current.displayWord;
        let normalizedWord = current.normalizedWord;

        if (hasDisplayChange) {
          displayWord = requireNonEmptyText(
            changes.displayWord,
            "英文单词",
          );
          normalizedWord = normalizeEnglishWord(displayWord);
          const conflicting = await words
            .index("byNormalizedWord")
            .get(normalizedWord);

          if (conflicting && conflicting.id !== id) {
            throw new DataConflictError(
              "修改后的英文单词与已有单词冲突，未保存。",
            );
          }
        }

        const chineseMeaning = hasMeaningChange
          ? prepareMeaning(changes.chineseMeaning as string)
          : current.chineseMeaning;
        assertMaximumTextLength(
          displayWord,
          MAX_WORD_DISPLAY_LENGTH,
          "英文单词",
        );
        assertMaximumTextLength(
          chineseMeaning,
          MAX_MEANING_LENGTH,
          "中文释义",
        );

        const updated: Word = {
          ...current,
          displayWord,
          normalizedWord,
          chineseMeaning,
          updatedAtMs: this.now(),
        };

        await words.put(updated);
        return updated;
      },
    );
  }

  /**
   * Applies validated import actions in one transaction.
   * Creates and meaning-only updates are mutually atomic.
   */
  async applyImportBatch(
    actions: WordImportAction[],
  ): Promise<WordImportBatchResult> {
    if (actions.length === 0) {
      return { createdCount: 0, updatedCount: 0 };
    }

    const preparedActions = actions.map((action) => {
      if (action.type === "create") {
        return {
          type: "create" as const,
          fields: prepareNewWordFields(
            action.displayWord,
            action.chineseMeaning,
          ),
        };
      }

      return {
        type: "update-meaning" as const,
        wordId: requireNonEmptyText(action.wordId, "单词 ID"),
        chineseMeaning: prepareMeaning(action.chineseMeaning),
      };
    });

    const createKeys = preparedActions
      .filter((action) => action.type === "create")
      .map((action) => action.fields.normalizedWord);
    if (new Set(createKeys).size !== createKeys.length) {
      throw new DataConflictError("导入批次中包含重复的新增单词。");
    }

    return runTransaction(
      this.database,
      ["words"],
      "readwrite",
      async (transaction) => {
        const words = transaction.objectStore("words");
        let createdCount = 0;
        let updatedCount = 0;

        for (const action of preparedActions) {
          if (action.type === "create") {
            const existing = await words
              .index("byNormalizedWord")
              .get(action.fields.normalizedWord);

            if (existing) {
              throw new DataConflictError(
                "导入批次中的单词已经存在，未写入任何导入数据。",
              );
            }

            const timestamp = this.now();
            const word: Word = {
              id: this.createId(),
              ...action.fields,
              createdAtMs: timestamp,
              updatedAtMs: timestamp,
            };
            await words.add(word);
            createdCount += 1;
          } else {
            const existing = await words.get(action.wordId);
            if (!existing) {
              throw new DataNotFoundError(
                "导入批次引用了不存在的单词，未写入任何导入数据。",
              );
            }

            const updated: Word = {
              ...existing,
              chineseMeaning: action.chineseMeaning,
              updatedAtMs: this.now(),
            };
            await words.put(updated);
            updatedCount += 1;
          }
        }

        return { createdCount, updatedCount };
      },
    );
  }

  /**
   * R25: deleting the word also removes its group links, review state and
   * learning history in one transaction. Groups themselves remain.
   */
  async delete(id: string): Promise<void> {
    return runTransaction(
      this.database,
      ["words", "wordGroups", "reviewStates", "learningHistory"],
      "readwrite",
      async (transaction) => {
        const words = transaction.objectStore("words");
        const existing = await words.get(id);

        if (!existing) {
          throw new DataNotFoundError("没有找到要删除的单词。");
        }

        const associations = transaction.objectStore("wordGroups");
        const associationKeys = await associations
          .index("byWordId")
          .getAllKeys(id);
        await Promise.all(
          associationKeys.map((key) => associations.delete(key)),
        );

        const history = transaction.objectStore("learningHistory");
        const historyKeys = await history.index("byWordId").getAllKeys(id);
        await Promise.all(historyKeys.map((key) => history.delete(key)));

        await transaction.objectStore("reviewStates").delete(id);
        await words.delete(id);
      },
    );
  }
}

