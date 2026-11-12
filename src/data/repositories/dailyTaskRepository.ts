import {
  DataConflictError,
  DataNotFoundError,
  DataValidationError,
} from "../errors";
import { runTransaction, type AppDatabase } from "../database";
import {
  MAX_DAILY_GOAL,
  MIN_DAILY_GOAL,
} from "../constants";
import type { RepositoryOptions } from "../repositoryOptions";
import { resolveRepositoryOptions } from "../repositoryOptions";
import type { DailyTask } from "../types";
import { isBeijingDate } from "../time";
import {
  assertUniqueIds,
  requireNonNegativeInteger,
} from "../validation";

export interface CreateDailyTaskInput {
  beijingDate: string;
  baseGoal: number;
  carryoverTasks: number;
  nominalTaskCount: number;
  effectiveTaskCount: number;
  completedCount: number;
  completedGlobalNewWordIds: readonly string[];
  completedGlobalReviewWordIds: readonly string[];
}

export type DailyTaskChanges = Partial<
  Omit<
    CreateDailyTaskInput,
    "beijingDate" | "completedGlobalNewWordIds" | "completedGlobalReviewWordIds"
  > & {
    completedGlobalNewWordIds: readonly string[];
    completedGlobalReviewWordIds: readonly string[];
  }
>;

function validateDailyGoal(value: number): void {
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

function validateTaskInput(input: CreateDailyTaskInput): void {
  if (!isBeijingDate(input.beijingDate)) {
    throw new DataValidationError("每日任务日期必须是有效的 YYYY-MM-DD。");
  }

  validateDailyGoal(input.baseGoal);
  requireNonNegativeInteger(input.carryoverTasks, "累计结转任务量");
  requireNonNegativeInteger(input.nominalTaskCount, "名义任务量");
  requireNonNegativeInteger(input.effectiveTaskCount, "有效任务量");
  requireNonNegativeInteger(input.completedCount, "已完成任务量");
  assertUniqueIds(
    input.completedGlobalNewWordIds,
    "当日已完成全局新词",
  );
  assertUniqueIds(
    input.completedGlobalReviewWordIds,
    "当日已完成全局复习",
  );
}

export function validateDailyTaskRecord(task: DailyTask): void {
  validateTaskInput(task);
  if (!Number.isInteger(task.createdAtMs) || task.createdAtMs < 0) {
    throw new DataValidationError("每日任务创建时间无效。");
  }
  if (!Number.isInteger(task.updatedAtMs) || task.updatedAtMs < 0) {
    throw new DataValidationError("每日任务更新时间无效。");
  }
}

export class DailyTaskRepository {
  private readonly database: AppDatabase;
  private readonly now: () => number;

  constructor(
    database: AppDatabase,
    options: RepositoryOptions = {},
  ) {
    this.database = database;
    this.now = resolveRepositoryOptions(options).now;
  }

  async create(input: CreateDailyTaskInput): Promise<DailyTask> {
    validateTaskInput(input);

    return runTransaction(
      this.database,
      ["dailyTasks"],
      "readwrite",
      async (transaction) => {
        const tasks = transaction.objectStore("dailyTasks");
        const existing = await tasks.get(input.beijingDate);
        if (existing) {
          throw new DataConflictError("该北京日期的每日任务已经存在。");
        }

        const timestamp = this.now();
        const task: DailyTask = {
          beijingDate: input.beijingDate,
          baseGoal: input.baseGoal,
          carryoverTasks: input.carryoverTasks,
          nominalTaskCount: input.nominalTaskCount,
          effectiveTaskCount: input.effectiveTaskCount,
          completedCount: input.completedCount,
          completedGlobalNewWordIds: [...input.completedGlobalNewWordIds],
          completedGlobalReviewWordIds: [
            ...input.completedGlobalReviewWordIds,
          ],
          createdAtMs: timestamp,
          updatedAtMs: timestamp,
        };

        await tasks.add(task);
        return task;
      },
    );
  }

  async getByDate(date: string): Promise<DailyTask | null> {
    if (!isBeijingDate(date)) {
      throw new DataValidationError("每日任务日期格式无效。");
    }
    return (await this.database.get("dailyTasks", date)) ?? null;
  }

  async list(): Promise<DailyTask[]> {
    const tasks = await this.database.getAll("dailyTasks");
    return tasks.sort((left, right) =>
      left.beijingDate.localeCompare(right.beijingDate),
    );
  }

  async update(
    date: string,
    changes: DailyTaskChanges,
  ): Promise<DailyTask> {
    if (!isBeijingDate(date)) {
      throw new DataValidationError("每日任务日期格式无效。");
    }

    return runTransaction(
      this.database,
      ["dailyTasks"],
      "readwrite",
      async (transaction) => {
        const tasks = transaction.objectStore("dailyTasks");
        const current = await tasks.get(date);
        if (!current) {
          throw new DataNotFoundError("没有找到要更新的每日任务。");
        }

        const candidate: CreateDailyTaskInput = {
          beijingDate: date,
          baseGoal: changes.baseGoal ?? current.baseGoal,
          carryoverTasks:
            changes.carryoverTasks ?? current.carryoverTasks,
          nominalTaskCount:
            changes.nominalTaskCount ?? current.nominalTaskCount,
          effectiveTaskCount:
            changes.effectiveTaskCount ?? current.effectiveTaskCount,
          completedCount:
            changes.completedCount ?? current.completedCount,
          completedGlobalNewWordIds:
            changes.completedGlobalNewWordIds ??
            current.completedGlobalNewWordIds,
          completedGlobalReviewWordIds:
            changes.completedGlobalReviewWordIds ??
            current.completedGlobalReviewWordIds,
        };
        validateTaskInput(candidate);

        const updated: DailyTask = {
          ...current,
          ...candidate,
          completedGlobalNewWordIds: [
            ...candidate.completedGlobalNewWordIds,
          ],
          completedGlobalReviewWordIds: [
            ...candidate.completedGlobalReviewWordIds,
          ],
          createdAtMs: current.createdAtMs,
          updatedAtMs: this.now(),
        };

        await tasks.put(updated);
        return updated;
      },
    );
  }
}

