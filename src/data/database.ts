import {
  openDB,
  type DBSchema,
  type IDBPDatabase,
  type IDBPTransaction,
  type StoreNames,
} from "idb";

import { DATABASE_NAME, DATABASE_VERSION } from "./constants";
import { DatabaseOpenError, toDataError } from "./errors";
import type {
  AppSettings,
  DailyTask,
  Group,
  LearningHistory,
  ReviewState,
  Word,
  WordGroup,
} from "./types";

export interface AppDatabaseSchema extends DBSchema {
  words: {
    key: string;
    value: Word;
    indexes: {
      byNormalizedWord: string;
      byCreatedAtMs: number;
    };
  };
  groups: {
    key: string;
    value: Group;
    indexes: {
      byName: string;
      byCreatedAtMs: number;
    };
  };
  wordGroups: {
    key: string;
    value: WordGroup;
    indexes: {
      byWordGroup: [string, string];
      byWordId: string;
      byGroupId: string;
    };
  };
  reviewStates: {
    key: string;
    value: ReviewState;
    indexes: {
      byNextReviewAtMs: number;
      byUpdatedAtMs: number;
    };
  };
  learningHistory: {
    key: string;
    value: LearningHistory;
    indexes: {
      byWordId: string;
      byWordAndFeedbackAt: [string, number];
      byFeedbackAtMs: number;
      byBeijingDate: string;
      bySourceAndBeijingDate: [string, string];
      byGroupId: string;
    };
  };
  dailyTasks: {
    key: string;
    value: DailyTask;
    indexes: {
      byUpdatedAtMs: number;
    };
  };
  settings: {
    key: string;
    value: AppSettings;
  };
}

export type AppDatabase = IDBPDatabase<AppDatabaseSchema>;
export type AppStoreName = StoreNames<AppDatabaseSchema>;
export type AppTransaction<
  Mode extends IDBTransactionMode = IDBTransactionMode,
> = IDBPTransaction<
  AppDatabaseSchema,
  ArrayLike<AppStoreName>,
  Mode
>;

export type DatabaseMigration = (
  database: AppDatabase,
  transaction: IDBPTransaction<
    AppDatabaseSchema,
    ArrayLike<AppStoreName>,
    "versionchange"
  >,
  oldVersion: number,
) => void;

export type DatabaseMigrations = Readonly<Record<number, DatabaseMigration>>;

export const DATABASE_MIGRATIONS: DatabaseMigrations = {
  1(database) {
    const words = database.createObjectStore("words", { keyPath: "id" });
    words.createIndex("byNormalizedWord", "normalizedWord", { unique: true });
    words.createIndex("byCreatedAtMs", "createdAtMs");

    const groups = database.createObjectStore("groups", { keyPath: "id" });
    groups.createIndex("byName", "name", { unique: true });
    groups.createIndex("byCreatedAtMs", "createdAtMs");

    const wordGroups = database.createObjectStore("wordGroups", {
      keyPath: "id",
    });
    wordGroups.createIndex("byWordGroup", ["wordId", "groupId"], {
      unique: true,
    });
    wordGroups.createIndex("byWordId", "wordId");
    wordGroups.createIndex("byGroupId", "groupId");

    const reviewStates = database.createObjectStore("reviewStates", {
      keyPath: "wordId",
    });
    reviewStates.createIndex("byNextReviewAtMs", "nextReviewAtMs");
    reviewStates.createIndex("byUpdatedAtMs", "updatedAtMs");

    const learningHistory = database.createObjectStore("learningHistory", {
      keyPath: "id",
    });
    learningHistory.createIndex("byWordId", "wordId");
    learningHistory.createIndex(
      "byWordAndFeedbackAt",
      ["wordId", "feedbackOccurredAtMs"],
    );
    learningHistory.createIndex("byFeedbackAtMs", "feedbackOccurredAtMs");
    learningHistory.createIndex("byBeijingDate", "beijingDate");
    learningHistory.createIndex("bySourceAndBeijingDate", [
      "source",
      "beijingDate",
    ]);
    learningHistory.createIndex("byGroupId", "groupId");

    const dailyTasks = database.createObjectStore("dailyTasks", {
      keyPath: "beijingDate",
    });
    dailyTasks.createIndex("byUpdatedAtMs", "updatedAtMs");

    database.createObjectStore("settings", { keyPath: "id" });
  },
};

export interface OpenDatabaseOptions {
  name?: string;
  version?: number;
  migrations?: DatabaseMigrations;
}

function runMigrations(
  database: AppDatabase,
  transaction: Parameters<DatabaseMigration>[1],
  oldVersion: number,
  newVersion: number,
  migrations: DatabaseMigrations,
): void {
  for (let version = oldVersion + 1; version <= newVersion; version += 1) {
    const migration = migrations[version];
    if (!migration) {
      throw new DatabaseOpenError(`缺少数据库版本 ${version} 的迁移步骤。`);
    }
    migration(database, transaction, oldVersion);
  }
}

export async function openDatabase(
  options: OpenDatabaseOptions = {},
): Promise<AppDatabase> {
  const {
    name = DATABASE_NAME,
    version = DATABASE_VERSION,
    migrations = DATABASE_MIGRATIONS,
  } = options;

  try {
    let connection: AppDatabase | null = null;
    const database = await openDB<AppDatabaseSchema>(name, version, {
      upgrade(database, oldVersion, newVersion, transaction) {
        if (newVersion === null) {
          return;
        }
        runMigrations(
          database,
          transaction,
          oldVersion,
          newVersion,
          migrations,
        );
      },
      blocking() {
        connection?.close();
      },
    });
    connection = database;
    return database;
  } catch (error) {
    if (error instanceof DatabaseOpenError) {
      throw error;
    }
    throw new DatabaseOpenError("无法打开本地数据库。", { cause: error });
  }
}

export function closeDatabase(database: AppDatabase): void {
  database.close();
}

export async function runTransaction<T, Mode extends IDBTransactionMode>(
  database: AppDatabase,
  storeNames: AppStoreName[],
  mode: Mode,
  operation: (
    transaction: IDBPTransaction<
      AppDatabaseSchema,
      ArrayLike<AppStoreName>,
      Mode
    >,
  ) => Promise<T> | T,
): Promise<T> {
  const transaction = database.transaction(storeNames, mode);

  try {
    const result = await operation(transaction);
    await transaction.done;
    return result;
  } catch (error) {
    try {
      transaction.abort();
    } catch {
      // The transaction may already have aborted after the operation failed.
    }

    try {
      await transaction.done;
    } catch {
      // Preserve the original operation error for the caller.
    }

    throw toDataError(error, "数据事务失败，未提交任何更改。");
  }
}

