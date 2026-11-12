import {
  DataNotFoundError,
  DataValidationError,
} from "../errors";
import { runTransaction, type AppDatabase } from "../database";
import type { RepositoryOptions } from "../repositoryOptions";
import { resolveRepositoryOptions } from "../repositoryOptions";
import type {
  Feedback,
  LearningHistory,
  LearningMode,
  LearningSource,
  ReviewStateSnapshot,
} from "../types";
import { assertEpochMilliseconds, toBeijingDate } from "../time";
import { requireNonEmptyText } from "../validation";

const LEARNING_MODES = new Set<LearningMode>([
  "english-to-chinese",
  "chinese-to-english",
]);
const LEARNING_SOURCES = new Set<LearningSource>(["global", "group", "weak"]);
const FEEDBACKS = new Set<Feedback>(["forgotten", "fuzzy", "remembered"]);

export interface AddLearningHistoryInput {
  wordId: string;
  mode: LearningMode;
  source: LearningSource;
  groupId: string | null;
  feedback: Feedback;
  feedbackOccurredAtMs: number;
  stateBefore: ReviewStateSnapshot | null;
  stateAfter: ReviewStateSnapshot | null;
}

function validateSnapshot(
  snapshot: ReviewStateSnapshot | null,
  label: string,
): void {
  if (snapshot === null) {
    return;
  }

  if (snapshot.ef !== null && (!Number.isFinite(snapshot.ef) || snapshot.ef < 1.3)) {
    throw new DataValidationError(`${label}的 EF 无效。`);
  }

  const integerFields: Array<keyof ReviewStateSnapshot> = [
    "consecutiveSuccesses",
    "consecutiveForgets",
    "weakScore",
    "intervalMinutes",
  ];

  for (const field of integerFields) {
    const value = snapshot[field];
    if (value !== null && (!Number.isInteger(value) || value < 0)) {
      throw new DataValidationError(`${label}中的 ${field} 无效。`);
    }
  }

  if (snapshot.lastFeedbackAtMs !== null) {
    assertEpochMilliseconds(snapshot.lastFeedbackAtMs, `${label}上次反馈时间`);
  }
  if (snapshot.nextReviewAtMs !== null) {
    assertEpochMilliseconds(snapshot.nextReviewAtMs, `${label}下次到期时间`);
  }
}

export class LearningHistoryRepository {
  private readonly database: AppDatabase;
  private readonly createId: () => string;

  constructor(
    database: AppDatabase,
    options: RepositoryOptions = {},
  ) {
    this.database = database;
    this.createId = resolveRepositoryOptions(options).createId;
  }

  async add(input: AddLearningHistoryInput): Promise<LearningHistory> {
    requireNonEmptyText(input.wordId, "单词 ID");
    assertEpochMilliseconds(input.feedbackOccurredAtMs, "反馈时间");

    if (!LEARNING_MODES.has(input.mode)) {
      throw new DataValidationError("学习模式无效。");
    }
    if (!LEARNING_SOURCES.has(input.source)) {
      throw new DataValidationError("学习来源无效。");
    }
    if (!FEEDBACKS.has(input.feedback)) {
      throw new DataValidationError("学习反馈无效。");
    }
    if (input.source === "group") {
      requireNonEmptyText(input.groupId, "分组学习的分组 ID");
    } else if (input.groupId !== null) {
      throw new DataValidationError("只有分组学习可以关联分组 ID。");
    }

    validateSnapshot(input.stateBefore, "反馈前状态");
    validateSnapshot(input.stateAfter, "反馈后状态");

    return runTransaction(
      this.database,
      ["words", "groups", "learningHistory"],
      "readwrite",
      async (transaction) => {
        const word = await transaction.objectStore("words").get(input.wordId);
        if (!word) {
          throw new DataNotFoundError("无法为不存在的单词保存学习历史。");
        }

        if (input.source === "group") {
          const group = await transaction
            .objectStore("groups")
            .get(input.groupId as string);
          if (!group) {
            throw new DataNotFoundError("分组学习引用了一个不存在的分组。");
          }
        }

        const history: LearningHistory = {
          id: this.createId(),
          wordId: input.wordId,
          mode: input.mode,
          source: input.source,
          groupId: input.groupId,
          feedback: input.feedback,
          feedbackOccurredAtMs: input.feedbackOccurredAtMs,
          beijingDate: toBeijingDate(input.feedbackOccurredAtMs),
          stateBefore: input.stateBefore,
          stateAfter: input.stateAfter,
        };

        await transaction.objectStore("learningHistory").add(history);
        return history;
      },
    );
  }

  async getById(id: string): Promise<LearningHistory | null> {
    return (await this.database.get("learningHistory", id)) ?? null;
  }

  async listAll(): Promise<LearningHistory[]> {
    return this.database.getAll("learningHistory");
  }

  async listForWord(wordId: string): Promise<LearningHistory[]> {
    const histories = await this.database.getAllFromIndex(
      "learningHistory",
      "byWordId",
      wordId,
    );
    return histories.sort(
      (left, right) =>
        left.feedbackOccurredAtMs - right.feedbackOccurredAtMs,
    );
  }

  async countForWord(wordId: string): Promise<number> {
    return this.database.countFromIndex(
      "learningHistory",
      "byWordId",
      wordId,
    );
  }

  async listByBeijingDate(date: string): Promise<LearningHistory[]> {
    return this.database.getAllFromIndex(
      "learningHistory",
      "byBeijingDate",
      date,
    );
  }

  async listBySourceAndDate(
    source: LearningSource,
    date: string,
  ): Promise<LearningHistory[]> {
    return this.database.getAllFromIndex(
      "learningHistory",
      "bySourceAndBeijingDate",
      [source, date],
    );
  }

  async listForGroup(groupId: string): Promise<LearningHistory[]> {
    return this.database.getAllFromIndex(
      "learningHistory",
      "byGroupId",
      groupId,
    );
  }
}

