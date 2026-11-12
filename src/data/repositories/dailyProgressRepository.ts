import { runTransaction, type AppDatabase } from "../database";
import {
  BEIJING_TIME_ZONE,
  MAX_DAILY_GOAL,
  MIN_DAILY_GOAL,
  SETTINGS_SINGLETON_ID,
} from "../constants";
import { DataValidationError } from "../errors";
import type { RepositoryOptions } from "../repositoryOptions";
import { resolveRepositoryOptions } from "../repositoryOptions";
import type { AppSettings, DailyTask } from "../types";
import { validateDailyTaskRecord } from "./dailyTaskRepository";

export class DailyProgressRepository {
  private readonly database: AppDatabase;
  private readonly now: () => number;

  constructor(
    database: AppDatabase,
    options: RepositoryOptions = {},
  ) {
    this.database = database;
    this.now = resolveRepositoryOptions(options).now;
  }

  async saveTask(task: DailyTask): Promise<DailyTask> {
    validateDailyTaskRecord(task);
    return runTransaction(
      this.database,
      ["dailyTasks"],
      "readwrite",
      async (transaction) => {
        await transaction.objectStore("dailyTasks").put(task);
        return task;
      },
    );
  }

  async saveGoalAndTask(
    dailyBaseGoal: number,
    task: DailyTask,
  ): Promise<{ settings: AppSettings; task: DailyTask }> {
    if (
      !Number.isInteger(dailyBaseGoal) ||
      dailyBaseGoal < MIN_DAILY_GOAL ||
      dailyBaseGoal > MAX_DAILY_GOAL
    ) {
      throw new DataValidationError(
        `每日基础目标必须是 ${MIN_DAILY_GOAL}–${MAX_DAILY_GOAL} 的整数。`,
      );
    }
    validateDailyTaskRecord(task);

    return runTransaction(
      this.database,
      ["settings", "dailyTasks"],
      "readwrite",
      async (transaction) => {
        const settingsStore = transaction.objectStore("settings");
        const taskStore = transaction.objectStore("dailyTasks");
        const currentSettings = await settingsStore.get(
          SETTINGS_SINGLETON_ID,
        );
        const timestamp = this.now();
        const settings: AppSettings = currentSettings
          ? {
              ...currentSettings,
              dailyBaseGoal,
              timeZone: BEIJING_TIME_ZONE,
              updatedAtMs: timestamp,
            }
          : {
              id: SETTINGS_SINGLETON_ID,
              dailyBaseGoal,
              timeZone: BEIJING_TIME_ZONE,
              createdAtMs: timestamp,
              updatedAtMs: timestamp,
            };

        await settingsStore.put(settings);
        await taskStore.put(task);
        return { settings, task };
      },
    );
  }
}

