import {
  DataValidationError,
  MAX_DAILY_GOAL,
  MIN_DAILY_GOAL,
  type DailyTask,
} from "../../data";

export interface DailyTaskCountsInput {
  baseGoal: number;
  carryoverTasks: number;
  availableNewWordCount: number;
  completedGlobalNewWordIds: readonly string[];
  completedGlobalReviewWordIds: readonly string[];
}

export interface DailyTaskCounts {
  nominalTaskCount: number;
  effectiveTaskCount: number;
  completedCount: number;
  completedReviewCount: number;
  totalCompletedCount: number;
  remainingTaskCount: number;
  goalAchieved: boolean;
}

export interface DailyTaskSnapshotInput extends DailyTaskCountsInput {
  beijingDate: string;
  existingTask: DailyTask | null;
  updatedAtMs: number;
}

function assertDailyGoal(value: number): void {
  if (
    !Number.isInteger(value) ||
    value < MIN_DAILY_GOAL ||
    value > MAX_DAILY_GOAL
  ) {
    throw new DataValidationError(
      `每日基础目标必须是 ${MIN_DAILY_GOAL}–${MAX_DAILY_GOAL} 的整数。`,
    );
  }
}

function uniqueIds(ids: readonly string[]): string[] {
  return Array.from(new Set(ids));
}

export function calculateDailyTaskCounts(
  input: DailyTaskCountsInput,
): DailyTaskCounts {
  assertDailyGoal(input.baseGoal);
  if (
    !Number.isSafeInteger(input.carryoverTasks) ||
    input.carryoverTasks < 0
  ) {
    throw new DataValidationError("累计结转任务必须是非负整数。");
  }
  if (
    !Number.isSafeInteger(input.availableNewWordCount) ||
    input.availableNewWordCount < 0
  ) {
    throw new DataValidationError("可安排新词数必须是非负整数。");
  }

  const completedGlobalNewWordIds = uniqueIds(
    input.completedGlobalNewWordIds,
  );
  const completedGlobalReviewWordIds = uniqueIds(
    input.completedGlobalReviewWordIds,
  );
  const nominalTaskCount =
    input.baseGoal + input.carryoverTasks;
  const effectiveTaskCount = Math.min(
    nominalTaskCount,
    input.availableNewWordCount +
      completedGlobalNewWordIds.length,
  );
  const completedCount = completedGlobalNewWordIds.length;
  const completedReviewCount =
    completedGlobalReviewWordIds.length;

  return {
    nominalTaskCount,
    effectiveTaskCount,
    completedCount,
    completedReviewCount,
    totalCompletedCount:
      completedCount + completedReviewCount,
    remainingTaskCount: Math.max(
      0,
      effectiveTaskCount - completedCount,
    ),
    goalAchieved: completedCount >= effectiveTaskCount,
  };
}

export function createDailyTaskSnapshot(
  input: DailyTaskSnapshotInput,
): DailyTask {
  const counts = calculateDailyTaskCounts(input);
  const completedGlobalNewWordIds = uniqueIds(
    input.completedGlobalNewWordIds,
  );
  const completedGlobalReviewWordIds = uniqueIds(
    input.completedGlobalReviewWordIds,
  );

  return {
    beijingDate: input.beijingDate,
    baseGoal: input.baseGoal,
    carryoverTasks: input.carryoverTasks,
    nominalTaskCount: counts.nominalTaskCount,
    effectiveTaskCount: counts.effectiveTaskCount,
    completedCount: counts.completedCount,
    completedGlobalNewWordIds,
    completedGlobalReviewWordIds,
    createdAtMs:
      input.existingTask?.createdAtMs ?? input.updatedAtMs,
    updatedAtMs: input.updatedAtMs,
  };
}

export function getOutstandingTasks(task: DailyTask): number {
  return Math.max(0, task.effectiveTaskCount - task.completedCount);
}

