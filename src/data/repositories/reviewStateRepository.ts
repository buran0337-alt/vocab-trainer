import {
  DataConflictError,
  DataNotFoundError,
  DataValidationError,
} from "../errors";
import { runTransaction, type AppDatabase } from "../database";
import {
  INITIAL_EF,
  MINIMUM_EF,
} from "../constants";
import type { RepositoryOptions } from "../repositoryOptions";
import { resolveRepositoryOptions } from "../repositoryOptions";
import type { ReviewState } from "../types";
import { requireNonNegativeInteger } from "../validation";
import { assertEpochMilliseconds } from "../time";

export type ReviewStateChanges = Partial<
  Pick<
    ReviewState,
    | "ef"
    | "consecutiveSuccesses"
    | "consecutiveForgets"
    | "weakScore"
    | "intervalMinutes"
    | "lastFeedbackAtMs"
    | "nextReviewAtMs"
  >
>;

function validateOptionalTimestamp(
  value: number | null,
  fieldName: string,
): void {
  if (value !== null) {
    assertEpochMilliseconds(value, fieldName);
  }
}

function validateReviewChanges(changes: ReviewStateChanges): void {
  if (changes.ef !== undefined) {
    if (
      !Number.isFinite(changes.ef) ||
      changes.ef < MINIMUM_EF
    ) {
      throw new DataValidationError(
        `EF 必须是大于或等于 ${MINIMUM_EF} 的有限数字。`,
      );
    }
  }

  if (changes.consecutiveSuccesses !== undefined) {
    requireNonNegativeInteger(
      changes.consecutiveSuccesses,
      "连续成功次数",
    );
  }
  if (changes.consecutiveForgets !== undefined) {
    requireNonNegativeInteger(changes.consecutiveForgets, "连续忘记次数");
  }
  if (changes.weakScore !== undefined) {
    requireNonNegativeInteger(changes.weakScore, "累计薄弱分数");
  }
  if (changes.intervalMinutes !== undefined && changes.intervalMinutes !== null) {
    requireNonNegativeInteger(changes.intervalMinutes, "上次间隔分钟数");
  }
  if (changes.lastFeedbackAtMs !== undefined) {
    validateOptionalTimestamp(changes.lastFeedbackAtMs, "上次反馈时间");
  }
  if (changes.nextReviewAtMs !== undefined) {
    validateOptionalTimestamp(changes.nextReviewAtMs, "下次到期时间");
  }
}

export class ReviewStateRepository {
  private readonly database: AppDatabase;
  private readonly now: () => number;

  constructor(
    database: AppDatabase,
    options: RepositoryOptions = {},
  ) {
    this.database = database;
    this.now = resolveRepositoryOptions(options).now;
  }

  async create(wordId: string): Promise<ReviewState> {
    return runTransaction(
      this.database,
      ["words", "reviewStates"],
      "readwrite",
      async (transaction) => {
        const word = await transaction.objectStore("words").get(wordId);
        if (!word) {
          throw new DataNotFoundError("无法为不存在的单词创建复习状态。");
        }

        const reviewStates = transaction.objectStore("reviewStates");
        const existing = await reviewStates.get(wordId);
        if (existing) {
          throw new DataConflictError("该单词已经存在复习状态。");
        }

        const timestamp = this.now();
        const state: ReviewState = {
          wordId,
          ef: INITIAL_EF,
          consecutiveSuccesses: 0,
          consecutiveForgets: 0,
          weakScore: 0,
          intervalMinutes: null,
          lastFeedbackAtMs: null,
          nextReviewAtMs: null,
          createdAtMs: timestamp,
          updatedAtMs: timestamp,
        };

        await reviewStates.add(state);
        return state;
      },
    );
  }

  async getByWordId(wordId: string): Promise<ReviewState | null> {
    return (await this.database.get("reviewStates", wordId)) ?? null;
  }

  async listAll(): Promise<ReviewState[]> {
    return this.database.getAll("reviewStates");
  }

  async listDueAt(nowMilliseconds: number): Promise<ReviewState[]> {
    assertEpochMilliseconds(nowMilliseconds, "到期查询时间");
    return runTransaction(
      this.database,
      ["reviewStates"],
      "readonly",
      (transaction) =>
        transaction
          .objectStore("reviewStates")
          .index("byNextReviewAtMs")
          .getAll(IDBKeyRange.upperBound(nowMilliseconds)),
    );
  }

  async update(
    wordId: string,
    changes: ReviewStateChanges,
  ): Promise<ReviewState> {
    validateReviewChanges(changes);

    return runTransaction(
      this.database,
      ["reviewStates"],
      "readwrite",
      async (transaction) => {
        const reviewStates = transaction.objectStore("reviewStates");
        const current = await reviewStates.get(wordId);
        if (!current) {
          throw new DataNotFoundError("没有找到要更新的复习状态。");
        }

        const updated: ReviewState = {
          ...current,
          ...changes,
          wordId,
          createdAtMs: current.createdAtMs,
          updatedAtMs: this.now(),
        };

        await reviewStates.put(updated);
        return updated;
      },
    );
  }
}

