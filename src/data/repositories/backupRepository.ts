import {
  runTransaction,
  type AppDatabase,
  type AppStoreName,
} from "../database";
import type { DatabaseSnapshot } from "../backup";

const BACKUP_STORES: AppStoreName[] = [
  "words",
  "groups",
  "wordGroups",
  "reviewStates",
  "learningHistory",
  "dailyTasks",
  "settings",
];

function recordKey(storeName: AppStoreName, value: unknown): string {
  const record = value as Record<string, unknown>;
  const candidates =
    storeName === "reviewStates"
      ? [record.wordId]
      : storeName === "dailyTasks"
        ? [record.beijingDate]
        : [record.id];
  const key = candidates[0];
  if (typeof key !== "string") {
    throw new Error(`恢复后 ${storeName} 记录缺少主键。`);
  }
  return key;
}

function sameRecords(
  storeName: AppStoreName,
  expected: readonly unknown[],
  actual: readonly unknown[],
): boolean {
  if (expected.length !== actual.length) return false;
  const actualByKey = new Map(
    actual.map((record) => [recordKey(storeName, record), record]),
  );
  return expected.every((record) => {
    const saved = actualByKey.get(recordKey(storeName, record));
    return (
      saved !== undefined &&
      JSON.stringify(saved) === JSON.stringify(record)
    );
  });
}

export class BackupRepository {
  private readonly database: AppDatabase;

  constructor(database: AppDatabase) {
    this.database = database;
  }

  async readSnapshot(): Promise<DatabaseSnapshot> {
    return runTransaction(
      this.database,
      BACKUP_STORES,
      "readonly",
      async (transaction) => {
        const [
          words,
          groups,
          wordGroups,
          reviewStates,
          learningHistory,
          dailyTasks,
          settings,
        ] = await Promise.all([
          transaction.objectStore("words").getAll(),
          transaction.objectStore("groups").getAll(),
          transaction.objectStore("wordGroups").getAll(),
          transaction.objectStore("reviewStates").getAll(),
          transaction.objectStore("learningHistory").getAll(),
          transaction.objectStore("dailyTasks").getAll(),
          transaction.objectStore("settings").getAll(),
        ]);

        return {
          words,
          groups,
          wordGroups,
          reviewStates,
          learningHistory,
          dailyTasks,
          settings,
        };
      },
    );
  }

  async replaceSnapshot(snapshot: DatabaseSnapshot): Promise<void> {
    return runTransaction(
      this.database,
      BACKUP_STORES,
      "readwrite",
      async (transaction) => {
        for (const storeName of BACKUP_STORES) {
          await transaction.objectStore(storeName).clear();
        }

        for (const word of snapshot.words) {
          await transaction.objectStore("words").put(word);
        }
        for (const group of snapshot.groups) {
          await transaction.objectStore("groups").put(group);
        }
        for (const association of snapshot.wordGroups) {
          await transaction.objectStore("wordGroups").put(association);
        }
        for (const state of snapshot.reviewStates) {
          await transaction.objectStore("reviewStates").put(state);
        }
        for (const history of snapshot.learningHistory) {
          await transaction.objectStore("learningHistory").put(history);
        }
        for (const task of snapshot.dailyTasks) {
          await transaction.objectStore("dailyTasks").put(task);
        }
        for (const settings of snapshot.settings) {
          await transaction.objectStore("settings").put(settings);
        }

        const expected: DatabaseSnapshot = {
          words: snapshot.words,
          groups: snapshot.groups,
          wordGroups: snapshot.wordGroups,
          reviewStates: snapshot.reviewStates,
          learningHistory: snapshot.learningHistory,
          dailyTasks: snapshot.dailyTasks,
          settings: snapshot.settings,
        };
        const actual: DatabaseSnapshot = {
          words: await transaction.objectStore("words").getAll(),
          groups: await transaction.objectStore("groups").getAll(),
          wordGroups: await transaction.objectStore("wordGroups").getAll(),
          reviewStates: await transaction
            .objectStore("reviewStates")
            .getAll(),
          learningHistory: await transaction
            .objectStore("learningHistory")
            .getAll(),
          dailyTasks: await transaction.objectStore("dailyTasks").getAll(),
          settings: await transaction.objectStore("settings").getAll(),
        };
        if (
          !sameRecords("words", expected.words, actual.words) ||
          !sameRecords("groups", expected.groups, actual.groups) ||
          !sameRecords(
            "wordGroups",
            expected.wordGroups,
            actual.wordGroups,
          ) ||
          !sameRecords(
            "reviewStates",
            expected.reviewStates,
            actual.reviewStates,
          ) ||
          !sameRecords(
            "learningHistory",
            expected.learningHistory,
            actual.learningHistory,
          ) ||
          !sameRecords(
            "dailyTasks",
            expected.dailyTasks,
            actual.dailyTasks,
          ) ||
          !sameRecords("settings", expected.settings, actual.settings)
        ) {
          throw new Error("恢复后数据核对失败。");
        }
      },
    );
  }
}
