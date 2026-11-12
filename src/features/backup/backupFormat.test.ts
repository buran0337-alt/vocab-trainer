import { describe, expect, it } from "vitest";

import { DataValidationError } from "../../data";
import {
  BACKUP_FORMAT_ID,
  MAX_BACKUP_FILE_BYTES,
  validateBackupDocument,
  type VocabularyBackup,
} from "./backupFormat";
import { assertBackupFileSize } from "./backupService";

const EXPORTED_AT = Date.UTC(2026, 0, 1, 4, 0, 40);

function validBackup(): VocabularyBackup {
  return {
    format: BACKUP_FORMAT_ID,
    backupVersion: 1,
    databaseVersion: 1,
    exportedAtMs: EXPORTED_AT,
    data: {
      words: [
        {
          id: "word-1",
          displayWord: 'Study "special" \\ line',
          normalizedWord: 'study "special" \\ line',
          chineseMeaning: "学习；研究\n保留特殊字符 & < >",
          createdAtMs: EXPORTED_AT - 10_000,
          updatedAtMs: EXPORTED_AT,
        },
      ],
      groups: [
        {
          id: "group-1",
          name: "CET-6 特殊 & <组>",
          createdAtMs: EXPORTED_AT - 10_000,
          updatedAtMs: EXPORTED_AT,
        },
      ],
      wordGroups: [
        {
          id: "association-1",
          wordId: "word-1",
          groupId: "group-1",
          createdAtMs: EXPORTED_AT,
        },
      ],
      reviewStates: [
        {
          wordId: "word-1",
          ef: 2.5,
          consecutiveSuccesses: 1,
          consecutiveForgets: 0,
          weakScore: 0,
          intervalMinutes: 1_440,
          lastFeedbackAtMs: EXPORTED_AT,
          nextReviewAtMs: EXPORTED_AT + 86_400_000,
          createdAtMs: EXPORTED_AT - 10_000,
          updatedAtMs: EXPORTED_AT,
        },
      ],
      learningHistory: [
        {
          id: "history-1",
          wordId: "word-1",
          mode: "english-to-chinese",
          source: "group",
          groupId: "group-1",
          feedback: "remembered",
          feedbackOccurredAtMs: EXPORTED_AT,
          beijingDate: "2026-01-01",
          stateBefore: null,
          stateAfter: {
            ef: 2.6,
            consecutiveSuccesses: 1,
            consecutiveForgets: 0,
            weakScore: 0,
            intervalMinutes: 1_440,
            lastFeedbackAtMs: EXPORTED_AT,
            nextReviewAtMs: EXPORTED_AT + 86_400_000,
          },
        },
      ],
      dailyTasks: [
        {
          beijingDate: "2026-01-01",
          baseGoal: 2,
          carryoverTasks: 1,
          nominalTaskCount: 3,
          effectiveTaskCount: 1,
          completedCount: 1,
          completedGlobalNewWordIds: ["word-1"],
          completedGlobalReviewWordIds: [],
          createdAtMs: EXPORTED_AT,
          updatedAtMs: EXPORTED_AT,
        },
      ],
      settings: [
        {
          id: "app-settings",
          dailyBaseGoal: 20,
          timeZone: "Asia/Shanghai",
          createdAtMs: EXPORTED_AT,
          updatedAtMs: EXPORTED_AT,
        },
      ],
    },
  };
}

function clonedBackup(): Record<string, unknown> {
  return JSON.parse(JSON.stringify(validBackup())) as Record<
    string,
    unknown
  >;
}

function backupData(
  backup: Record<string, unknown>,
): Record<string, unknown> {
  return backup.data as Record<string, unknown>;
}

describe("备份格式校验", () => {
  it("接受完整备份并原样保留特殊字符", () => {
    const validated = validateBackupDocument(validBackup());

    expect(validated.data.words[0].chineseMeaning).toContain(
      "特殊字符 & < >",
    );
    expect(validated.data.groups[0].name).toBe("CET-6 特殊 & <组>");
    expect(validated.data.learningHistory).toHaveLength(1);
  });

  it("接受所有集合均为空的完整备份", () => {
    const backup = validBackup();
    backup.data = {
      words: [],
      groups: [],
      wordGroups: [],
      reviewStates: [],
      learningHistory: [],
      dailyTasks: [],
      settings: [],
    };

    expect(validateBackupDocument(backup).data).toEqual(backup.data);
  });

  it.each([
    ["缺少单词集合", (backup: Record<string, unknown>) => {
      delete backupData(backup).words;
    }],
    ["单词字段类型错误", (backup: Record<string, unknown>) => {
      (backupData(backup).words as Array<Record<string, unknown>>)[0]
        .chineseMeaning = 123;
    }],
    ["单词主键重复", (backup: Record<string, unknown>) => {
      const words = backupData(backup).words as Array<Record<string, unknown>>;
      words.push({
        ...words[0],
        displayWord: "Other",
        normalizedWord: "other",
      });
    }],
    ["标准化形式不一致", (backup: Record<string, unknown>) => {
      (backupData(backup).words as Array<Record<string, unknown>>)[0]
        .normalizedWord = "wrong";
    }],
    ["分组关联缺单词", (backup: Record<string, unknown>) => {
      (backupData(backup).wordGroups as Array<Record<string, unknown>>)[0]
        .wordId = "missing-word";
    }],
    ["复习状态缺单词", (backup: Record<string, unknown>) => {
      (backupData(backup).reviewStates as Array<Record<string, unknown>>)[0]
        .wordId = "missing-word";
    }],
    ["学习历史缺单词", (backup: Record<string, unknown>) => {
      (backupData(backup).learningHistory as Array<Record<string, unknown>>)[0]
        .wordId = "missing-word";
    }],
    ["历史北京日期不一致", (backup: Record<string, unknown>) => {
      (backupData(backup).learningHistory as Array<Record<string, unknown>>)[0]
        .beijingDate = "2026-01-02";
    }],
    ["每日任务计数不一致", (backup: Record<string, unknown>) => {
      (backupData(backup).dailyTasks as Array<Record<string, unknown>>)[0]
        .nominalTaskCount = 99;
    }],
  ])("拒绝%s", (_name, mutate) => {
    const backup = clonedBackup();
    mutate(backup);

    expect(() => validateBackupDocument(backup)).toThrow(
      DataValidationError,
    );
  });

  it("拒绝未来版本、旧版本和非本应用格式", () => {
    const future = clonedBackup();
    future.backupVersion = 2;
    const futureDatabase = clonedBackup();
    futureDatabase.databaseVersion = 2;
    const old = clonedBackup();
    old.databaseVersion = 0;
    const wrongFormat = clonedBackup();
    wrongFormat.format = "other-app";

    expect(() => validateBackupDocument(future)).toThrow("高于当前");
    expect(() => validateBackupDocument(futureDatabase)).toThrow(
      "高于当前",
    );
    expect(() => validateBackupDocument(old)).toThrow("不兼容");
    expect(() => validateBackupDocument(wrongFormat)).toThrow(
      "不是 CET-6",
    );
  });

  it("检查空文件大小和超过上限的文件大小", () => {
    expect(() => assertBackupFileSize(0)).toThrow("为空");
    expect(() =>
      assertBackupFileSize(MAX_BACKUP_FILE_BYTES + 1),
    ).toThrow("25 MB");
  });

  it("允许学习历史保留已删除分组的来源 ID", () => {
    const backup = clonedBackup();
    backupData(backup).groups = [];
    backupData(backup).wordGroups = [];

    expect(
      validateBackupDocument(backup).data.learningHistory[0].groupId,
    ).toBe("group-1");
  });
});
