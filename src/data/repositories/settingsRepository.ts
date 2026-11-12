import {
  DataConflictError,
  DataNotFoundError,
  DataValidationError,
} from "../errors";
import { runTransaction, type AppDatabase } from "../database";
import {
  BEIJING_TIME_ZONE,
  MAX_DAILY_GOAL,
  MIN_DAILY_GOAL,
  SETTINGS_SINGLETON_ID,
} from "../constants";
import type { RepositoryOptions } from "../repositoryOptions";
import { resolveRepositoryOptions } from "../repositoryOptions";
import type { AppSettings } from "../types";

function validateDailyBaseGoal(value: number): void {
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

export class SettingsRepository {
  private readonly database: AppDatabase;
  private readonly now: () => number;

  constructor(
    database: AppDatabase,
    options: RepositoryOptions = {},
  ) {
    this.database = database;
    this.now = resolveRepositoryOptions(options).now;
  }

  async get(): Promise<AppSettings | null> {
    return (
      (await this.database.get("settings", SETTINGS_SINGLETON_ID)) ?? null
    );
  }

  async create(dailyBaseGoal: number): Promise<AppSettings> {
    validateDailyBaseGoal(dailyBaseGoal);

    return runTransaction(
      this.database,
      ["settings"],
      "readwrite",
      async (transaction) => {
        const settingsStore = transaction.objectStore("settings");
        const existing = await settingsStore.get(SETTINGS_SINGLETON_ID);
        if (existing) {
          throw new DataConflictError("应用设置已经存在。");
        }

        const timestamp = this.now();
        const settings: AppSettings = {
          id: SETTINGS_SINGLETON_ID,
          dailyBaseGoal,
          timeZone: BEIJING_TIME_ZONE,
          createdAtMs: timestamp,
          updatedAtMs: timestamp,
        };

        await settingsStore.add(settings);
        return settings;
      },
    );
  }

  async updateDailyBaseGoal(dailyBaseGoal: number): Promise<AppSettings> {
    validateDailyBaseGoal(dailyBaseGoal);

    return runTransaction(
      this.database,
      ["settings"],
      "readwrite",
      async (transaction) => {
        const settingsStore = transaction.objectStore("settings");
        const current = await settingsStore.get(SETTINGS_SINGLETON_ID);
        if (!current) {
          throw new DataNotFoundError("尚未创建应用设置。");
        }

        const updated: AppSettings = {
          ...current,
          dailyBaseGoal,
          timeZone: BEIJING_TIME_ZONE,
          updatedAtMs: this.now(),
        };

        await settingsStore.put(updated);
        return updated;
      },
    );
  }
}

