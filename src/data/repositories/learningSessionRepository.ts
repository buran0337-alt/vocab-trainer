import {
  DataConflictError,
  DataNotFoundError,
  DataValidationError,
} from "../errors";
import { runTransaction, type AppDatabase } from "../database";
import {
  MINIMUM_EF,
} from "../constants";
import { assertEpochMilliseconds } from "../time";
import type {
  DailyTask,
  LearningHistory,
  ReviewState,
} from "../types";
import { requireNonNegativeInteger } from "../validation";
import { validateDailyTaskRecord } from "./dailyTaskRepository";

export interface CommitLearningFeedbackInput {
  history: LearningHistory;
  nextReviewState: ReviewState;
  expectedReviewState: ReviewState | null;
  nextDailyTask: DailyTask | null;
  expectedDailyTask: DailyTask | null;
}

export interface CommitLearningFeedbackResult {
  history: LearningHistory;
  reviewState: ReviewState;
  dailyTask: DailyTask | null;
  idempotentReplay: boolean;
}

function validateReviewState(state: ReviewState): void {
  if (!Number.isFinite(state.ef) || state.ef < MINIMUM_EF) {
    throw new DataValidationError("复习状态的 EF 无效。");
  }
  requireNonNegativeInteger(
    state.consecutiveSuccesses,
    "连续成功次数",
  );
  requireNonNegativeInteger(
    state.consecutiveForgets,
    "连续忘记次数",
  );
  requireNonNegativeInteger(state.weakScore, "累计薄弱分数");
  if (
    state.intervalMinutes !== null &&
    (!Number.isInteger(state.intervalMinutes) ||
      state.intervalMinutes <= 0)
  ) {
    throw new DataValidationError("复习间隔必须是正整数或 null。");
  }
  if (state.lastFeedbackAtMs !== null) {
    assertEpochMilliseconds(state.lastFeedbackAtMs, "上次反馈时间");
  }
  if (state.nextReviewAtMs !== null) {
    assertEpochMilliseconds(state.nextReviewAtMs, "下次到期时间");
  }
  assertEpochMilliseconds(state.createdAtMs, "状态创建时间");
  assertEpochMilliseconds(state.updatedAtMs, "状态更新时间");
}

function sameStateValues(
  left: ReviewState,
  right: ReviewState,
): boolean {
  return (
    left.wordId === right.wordId &&
    left.ef === right.ef &&
    left.consecutiveSuccesses === right.consecutiveSuccesses &&
    left.consecutiveForgets === right.consecutiveForgets &&
    left.weakScore === right.weakScore &&
    left.intervalMinutes === right.intervalMinutes &&
    left.lastFeedbackAtMs === right.lastFeedbackAtMs &&
    left.nextReviewAtMs === right.nextReviewAtMs &&
    left.createdAtMs === right.createdAtMs &&
    left.updatedAtMs === right.updatedAtMs
  );
}

function sameSubmission(
  left: LearningHistory,
  right: LearningHistory,
): boolean {
  return (
    left.id === right.id &&
    left.wordId === right.wordId &&
    left.mode === right.mode &&
    left.source === right.source &&
    left.groupId === right.groupId &&
    left.feedback === right.feedback &&
    left.feedbackOccurredAtMs === right.feedbackOccurredAtMs
  );
}

function sameDailyTask(left: DailyTask, right: DailyTask): boolean {
  return (
    left.beijingDate === right.beijingDate &&
    left.baseGoal === right.baseGoal &&
    left.carryoverTasks === right.carryoverTasks &&
    left.nominalTaskCount === right.nominalTaskCount &&
    left.effectiveTaskCount === right.effectiveTaskCount &&
    left.completedCount === right.completedCount &&
    left.completedGlobalNewWordIds.join("\u0000") ===
      right.completedGlobalNewWordIds.join("\u0000") &&
    left.completedGlobalReviewWordIds.join("\u0000") ===
      right.completedGlobalReviewWordIds.join("\u0000") &&
    left.createdAtMs === right.createdAtMs &&
    left.updatedAtMs === right.updatedAtMs
  );
}

export class LearningSessionRepository {
  private readonly database: AppDatabase;

  constructor(database: AppDatabase) {
    this.database = database;
  }

  /**
   * Atomically writes one history row and the derived review state.
   * Reusing the same history ID is an idempotent retry of the same submission.
   */
  async commitFeedback(
    input: CommitLearningFeedbackInput,
  ): Promise<CommitLearningFeedbackResult> {
    validateReviewState(input.nextReviewState);

    if (input.history.wordId !== input.nextReviewState.wordId) {
      throw new DataValidationError("学习历史和复习状态的单词 ID 不一致。");
    }
    const nextDailyTask = input.nextDailyTask;
    if (
      (input.history.source === "global" ||
        input.history.source === "weak") &&
      !nextDailyTask
    ) {
      throw new DataValidationError(
        "全局或薄弱词学习反馈必须同时更新每日任务。",
      );
    }
    if (
      input.history.source === "group" &&
      (!input.history.groupId || nextDailyTask !== null)
    ) {
      throw new DataValidationError(
        "分组学习反馈必须关联分组且不能更新全局每日任务。",
      );
    }
    if (
      input.history.source !== "global" &&
      input.history.source !== "group" &&
      input.history.source !== "weak"
    ) {
      throw new DataValidationError("当前不支持此学习来源。");
    }
    if (
      input.history.source !== "group" &&
      input.history.groupId !== null
    ) {
      throw new DataValidationError(
        "只有分组学习反馈可以关联分组 ID。",
      );
    }
    if (
      nextDailyTask &&
      nextDailyTask.beijingDate !== input.history.beijingDate
    ) {
      throw new DataValidationError("学习历史和每日任务的北京日期不一致。");
    }
    if (nextDailyTask) {
      validateDailyTaskRecord(nextDailyTask);
    }

    return runTransaction(
      this.database,
      [
        "words",
        "groups",
        "wordGroups",
        "reviewStates",
        "learningHistory",
        "dailyTasks",
      ],
      "readwrite",
      async (transaction) => {
        const word = await transaction
          .objectStore("words")
          .get(input.history.wordId);
        if (!word) {
          throw new DataNotFoundError("不能为不存在的单词保存学习反馈。");
        }
        const histories = transaction.objectStore("learningHistory");
        const existingHistory = await histories.get(input.history.id);
        const currentState = await transaction
          .objectStore("reviewStates")
          .get(input.history.wordId);
        const dailyTasks = transaction.objectStore("dailyTasks");
        const currentDailyTask = nextDailyTask
          ? await dailyTasks.get(nextDailyTask.beijingDate)
          : null;

        if (existingHistory) {
          if (!sameSubmission(existingHistory, input.history)) {
            throw new DataConflictError(
              "反馈提交 ID 已用于另一次学习反馈。",
            );
          }
          if (!currentState) {
            throw new DataConflictError(
              "反馈已存在，但对应的复习状态缺失。",
            );
          }
          if (
            input.history.source !== "group" &&
            !currentDailyTask
          ) {
            throw new DataConflictError(
              "反馈已存在，但对应的每日任务缺失。",
            );
          }
          return {
            history: existingHistory,
            reviewState: currentState,
            dailyTask: currentDailyTask ?? null,
            idempotentReplay: true,
          };
        }

        if (input.history.source === "group") {
          const groupId = input.history.groupId as string;
          const group = await transaction.objectStore("groups").get(groupId);
          if (!group) {
            throw new DataNotFoundError("分组学习引用了不存在的分组。");
          }
          const membership = await transaction
            .objectStore("wordGroups")
            .index("byWordGroup")
            .get([input.history.wordId, groupId]);
          if (!membership) {
            throw new DataConflictError(
              "分组反馈引用的单词不在该分组中。",
            );
          }
        }

        const expected = input.expectedReviewState;
        if (expected === null) {
          if (currentState) {
            throw new DataConflictError(
              "复习状态已被其他操作创建，请重新加载后再提交。",
            );
          }
        } else if (!currentState || !sameStateValues(currentState, expected)) {
          throw new DataConflictError(
            "复习状态已被其他操作更新，请重新加载后再提交。",
          );
        }

        if (nextDailyTask) {
          if (input.expectedDailyTask === null) {
            if (currentDailyTask) {
              throw new DataConflictError(
                "每日任务已被其他操作创建，请重新加载后再提交。",
              );
            }
          } else if (
            !currentDailyTask ||
            !sameDailyTask(currentDailyTask, input.expectedDailyTask)
          ) {
            throw new DataConflictError(
              "每日任务已被其他操作更新，请重新加载后再提交。",
            );
          }
        }

        await histories.add(input.history);
        await transaction
          .objectStore("reviewStates")
          .put(input.nextReviewState);
        if (nextDailyTask) {
          await dailyTasks.put(nextDailyTask);
        }

        return {
          history: input.history,
          reviewState: input.nextReviewState,
          dailyTask: nextDailyTask,
          idempotentReplay: false,
        };
      },
    );
  }
}

