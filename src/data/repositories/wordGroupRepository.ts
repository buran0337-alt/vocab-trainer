import {
  DataConflictError,
  DataNotFoundError,
} from "../errors";
import { runTransaction, type AppDatabase } from "../database";
import type { RepositoryOptions } from "../repositoryOptions";
import { resolveRepositoryOptions } from "../repositoryOptions";
import type { Group, Word, WordGroup } from "../types";

export class WordGroupRepository {
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

  async add(wordId: string, groupId: string): Promise<WordGroup> {
    return runTransaction(
      this.database,
      ["words", "groups", "wordGroups"],
      "readwrite",
      async (transaction) => {
        const word = await transaction.objectStore("words").get(wordId);
        const group = await transaction.objectStore("groups").get(groupId);

        if (!word) {
          throw new DataNotFoundError("无法关联不存在的单词。");
        }
        if (!group) {
          throw new DataNotFoundError("无法关联不存在的分组。");
        }

        const wordGroups = transaction.objectStore("wordGroups");
        const existing = await wordGroups
          .index("byWordGroup")
          .get([wordId, groupId]);

        if (existing) {
          throw new DataConflictError("该单词已经在此分组中。");
        }

        const association: WordGroup = {
          id: this.createId(),
          wordId,
          groupId,
          createdAtMs: this.now(),
        };

        await wordGroups.add(association);
        return association;
      },
    );
  }

  async addMany(
    wordIds: string[],
    groupId: string,
  ): Promise<WordGroup[]> {
    const uniqueWordIds = Array.from(new Set(wordIds));

    return runTransaction(
      this.database,
      ["words", "groups", "wordGroups"],
      "readwrite",
      async (transaction) => {
        const group = await transaction.objectStore("groups").get(groupId);
        if (!group) {
          throw new DataNotFoundError("无法向不存在的分组添加单词。");
        }

        const wordsStore = transaction.objectStore("words");
        const words = await Promise.all(
          uniqueWordIds.map((wordId) => wordsStore.get(wordId)),
        );
        if (words.some((word) => !word)) {
          throw new DataNotFoundError("待加入分组的数据包含不存在的单词。");
        }

        const wordGroups = transaction.objectStore("wordGroups");
        const existing = await wordGroups
          .index("byGroupId")
          .getAll(groupId);
        const existingWordIds = new Set(
          existing.map((association) => association.wordId),
        );
        const additions: WordGroup[] = [];

        for (const wordId of uniqueWordIds) {
          if (existingWordIds.has(wordId)) {
            continue;
          }
          const association: WordGroup = {
            id: this.createId(),
            wordId,
            groupId,
            createdAtMs: this.now(),
          };
          await wordGroups.add(association);
          additions.push(association);
        }

        return additions;
      },
    );
  }

  async getById(id: string): Promise<WordGroup | null> {
    return (await this.database.get("wordGroups", id)) ?? null;
  }

  async getByPair(
    wordId: string,
    groupId: string,
  ): Promise<WordGroup | null> {
    return (
      (await this.database.getFromIndex(
        "wordGroups",
        "byWordGroup",
        [wordId, groupId],
      )) ?? null
    );
  }

  async listForWord(wordId: string): Promise<WordGroup[]> {
    return this.database.getAllFromIndex("wordGroups", "byWordId", wordId);
  }

  async listForGroup(groupId: string): Promise<WordGroup[]> {
    return this.database.getAllFromIndex("wordGroups", "byGroupId", groupId);
  }

  async listAll(): Promise<WordGroup[]> {
    return this.database.getAll("wordGroups");
  }

  async getWordsForGroup(groupId: string): Promise<Word[]> {
    return runTransaction(
      this.database,
      ["groups", "wordGroups", "words"],
      "readonly",
      async (transaction) => {
        const group = await transaction.objectStore("groups").get(groupId);
        if (!group) {
          throw new DataNotFoundError("没有找到指定分组。");
        }

        const associations = await transaction
          .objectStore("wordGroups")
          .index("byGroupId")
          .getAll(groupId);
        const words = transaction.objectStore("words");
        const result = await Promise.all(
          associations.map((association) => words.get(association.wordId)),
        );

        return result.filter((word): word is Word => Boolean(word));
      },
    );
  }

  async getGroupsForWord(wordId: string): Promise<Group[]> {
    return runTransaction(
      this.database,
      ["words", "wordGroups", "groups"],
      "readonly",
      async (transaction) => {
        const word = await transaction.objectStore("words").get(wordId);
        if (!word) {
          throw new DataNotFoundError("没有找到指定单词。");
        }

        const associations = await transaction
          .objectStore("wordGroups")
          .index("byWordId")
          .getAll(wordId);
        const groups = transaction.objectStore("groups");
        const result = await Promise.all(
          associations.map((association) => groups.get(association.groupId)),
        );

        return result.filter((group): group is Group => Boolean(group));
      },
    );
  }

  async remove(wordId: string, groupId: string): Promise<boolean> {
    return runTransaction(
      this.database,
      ["wordGroups"],
      "readwrite",
      async (transaction) => {
        const wordGroups = transaction.objectStore("wordGroups");
        const existing = await wordGroups
          .index("byWordGroup")
          .get([wordId, groupId]);

        if (!existing) {
          return false;
        }

        await wordGroups.delete(existing.id);
        return true;
      },
    );
  }
}

