import {
  BACKUP_FORMAT_VERSION,
  DATABASE_VERSION,
  DataValidationError,
  MAX_DAILY_GOAL,
  MAX_GROUP_NAME_LENGTH,
  MAX_MEANING_LENGTH,
  MAX_WORD_DISPLAY_LENGTH,
  MINIMUM_EF,
  MIN_DAILY_GOAL,
  normalizeEnglishWord,
  normalizeGroupName,
  isBeijingDate,
  toBeijingDate,
  type AppSettings,
  type DailyTask,
  type DatabaseSnapshot,
  type Feedback,
  type Group,
  type LearningHistory,
  type LearningMode,
  type LearningSource,
  type ReviewState,
  type ReviewStateSnapshot,
  type Word,
  type WordGroup,
} from "../../data";

export const BACKUP_FORMAT_ID = "cet6-vocabulary-trainer-backup";
export const MAX_BACKUP_FILE_BYTES = 25 * 1024 * 1024;

export interface VocabularyBackup {
  format: typeof BACKUP_FORMAT_ID;
  backupVersion: number;
  databaseVersion: number;
  exportedAtMs: number;
  data: DatabaseSnapshot;
}

export interface BackupSummary {
  exportedAtMs: number;
  databaseVersion: number;
  wordCount: number;
  groupCount: number;
  associationCount: number;
  reviewStateCount: number;
  learningHistoryCount: number;
  dailyTaskCount: number;
  settingsCount: number;
}

type UnknownRecord = Record<string, unknown>;

const MODES = new Set<LearningMode>([
  "english-to-chinese",
  "chinese-to-english",
]);
const SOURCES = new Set<LearningSource>(["global", "group", "weak"]);
const FEEDBACKS = new Set<Feedback>([
  "forgotten",
  "fuzzy",
  "remembered",
]);

function record(value: unknown, path: string): UnknownRecord {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value)
  ) {
    throw new DataValidationError(`${path} 必须是对象。`);
  }
  return value as UnknownRecord;
}

function array(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) {
    throw new DataValidationError(`${path} 必须是数组。`);
  }
  return value;
}

function nonEmptyString(value: unknown, path: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new DataValidationError(`${path} 必须是非空字符串。`);
  }
  return value;
}

function stringWithMaximum(
  value: unknown,
  maximum: number,
  path: string,
): string {
  const text = nonEmptyString(value, path);
  if (Array.from(text).length > maximum) {
    throw new DataValidationError(
      `${path} 不能超过 ${maximum} 个字符。`,
    );
  }
  return text;
}

function nonNegativeInteger(value: unknown, path: string): number {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < 0
  ) {
    throw new DataValidationError(`${path} 必须是非负整数。`);
  }
  return value;
}

function positiveIntegerOrNull(
  value: unknown,
  path: string,
): number | null {
  if (value === null) return null;
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value <= 0
  ) {
    throw new DataValidationError(`${path} 必须是正整数或 null。`);
  }
  return value;
}

function timestampOrNull(
  value: unknown,
  path: string,
): number | null {
  if (value === null) return null;
  return timestamp(value, path);
}

function timestamp(value: unknown, path: string): number {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    Number.isNaN(new Date(value).getTime())
  ) {
    throw new DataValidationError(`${path} 必须是有效毫秒时间戳整数。`);
  }
  return value;
}

function enumValue<T extends string>(
  value: unknown,
  allowed: ReadonlySet<T>,
  path: string,
): T {
  if (typeof value !== "string" || !allowed.has(value as T)) {
    throw new DataValidationError(`${path} 的值无效。`);
  }
  return value as T;
}

function uniqueStringArray(value: unknown, path: string): string[] {
  const values = array(value, path).map((item, index) =>
    nonEmptyString(item, `${path}[${index}]`),
  );
  if (new Set(values).size !== values.length) {
    throw new DataValidationError(`${path} 中存在重复 ID。`);
  }
  return values;
}

function uniqueKey(
  seen: Set<string>,
  value: string,
  path: string,
): void {
  if (seen.has(value)) {
    throw new DataValidationError(`${path} 的主键重复：${value}`);
  }
  seen.add(value);
}

function efValue(value: unknown, path: string): number {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < MINIMUM_EF
  ) {
    throw new DataValidationError(
      `${path} 必须是大于或等于 ${MINIMUM_EF} 的有限数字。`,
    );
  }
  const scaled = value * 100;
  if (Math.abs(scaled - Math.round(scaled)) > 1e-8) {
    throw new DataValidationError(`${path} 必须保留两位小数。`);
  }
  return value;
}

function parseSnapshot(
  value: unknown,
  path: string,
): ReviewStateSnapshot | null {
  if (value === null) return null;
  const item = record(value, path);
  return {
    ef:
      item.ef === null ? null : efValue(item.ef, `${path}.ef`),
    consecutiveSuccesses:
      item.consecutiveSuccesses === null
        ? null
        : nonNegativeInteger(
            item.consecutiveSuccesses,
            `${path}.consecutiveSuccesses`,
          ),
    consecutiveForgets:
      item.consecutiveForgets === null
        ? null
        : nonNegativeInteger(
            item.consecutiveForgets,
            `${path}.consecutiveForgets`,
          ),
    weakScore:
      item.weakScore === null
        ? null
        : nonNegativeInteger(item.weakScore, `${path}.weakScore`),
    intervalMinutes:
      item.intervalMinutes === null
        ? null
        : positiveIntegerOrNull(
            item.intervalMinutes,
            `${path}.intervalMinutes`,
          ),
    lastFeedbackAtMs: timestampOrNull(
      item.lastFeedbackAtMs,
      `${path}.lastFeedbackAtMs`,
    ),
    nextReviewAtMs: timestampOrNull(
      item.nextReviewAtMs,
      `${path}.nextReviewAtMs`,
    ),
  };
}

function parseWords(value: unknown): Word[] {
  const keys = new Set<string>();
  const normalizedWords = new Set<string>();
  return array(value, "data.words").map((entry, index) => {
    const path = `data.words[${index}]`;
    const item = record(entry, path);
    const id = nonEmptyString(item.id, `${path}.id`);
    uniqueKey(keys, id, `${path}.id`);
    const displayWord = stringWithMaximum(
      item.displayWord,
      MAX_WORD_DISPLAY_LENGTH,
      `${path}.displayWord`,
    );
    const normalizedWord = nonEmptyString(
      item.normalizedWord,
      `${path}.normalizedWord`,
    );
    if (normalizedWord !== normalizeEnglishWord(displayWord)) {
      throw new DataValidationError(
        `${path}.normalizedWord 与英文显示形式不一致。`,
      );
    }
    if (normalizedWords.has(normalizedWord)) {
      throw new DataValidationError(
        `data.words 中存在标准化后重复的单词：${normalizedWord}`,
      );
    }
    normalizedWords.add(normalizedWord);
    return {
      id,
      displayWord,
      normalizedWord,
      chineseMeaning: stringWithMaximum(
        item.chineseMeaning,
        MAX_MEANING_LENGTH,
        `${path}.chineseMeaning`,
      ),
      createdAtMs: timestamp(item.createdAtMs, `${path}.createdAtMs`),
      updatedAtMs: timestamp(item.updatedAtMs, `${path}.updatedAtMs`),
    };
  });
}

function parseGroups(value: unknown): Group[] {
  const keys = new Set<string>();
  const names = new Set<string>();
  return array(value, "data.groups").map((entry, index) => {
    const path = `data.groups[${index}]`;
    const item = record(entry, path);
    const id = nonEmptyString(item.id, `${path}.id`);
    uniqueKey(keys, id, `${path}.id`);
    const name = stringWithMaximum(
      item.name,
      MAX_GROUP_NAME_LENGTH,
      `${path}.name`,
    );
    if (name !== normalizeGroupName(name)) {
      throw new DataValidationError(
        `${path}.name 不能包含首尾空格。`,
      );
    }
    if (names.has(name)) {
      throw new DataValidationError(`data.groups 中存在重复名称：${name}`);
    }
    names.add(name);
    return {
      id,
      name,
      createdAtMs: timestamp(item.createdAtMs, `${path}.createdAtMs`),
      updatedAtMs: timestamp(item.updatedAtMs, `${path}.updatedAtMs`),
    };
  });
}

function parseWordGroups(value: unknown): WordGroup[] {
  const keys = new Set<string>();
  const pairs = new Set<string>();
  return array(value, "data.wordGroups").map((entry, index) => {
    const path = `data.wordGroups[${index}]`;
    const item = record(entry, path);
    const id = nonEmptyString(item.id, `${path}.id`);
    uniqueKey(keys, id, `${path}.id`);
    const wordId = nonEmptyString(item.wordId, `${path}.wordId`);
    const groupId = nonEmptyString(item.groupId, `${path}.groupId`);
    const pair = `${wordId}\u0000${groupId}`;
    if (pairs.has(pair)) {
      throw new DataValidationError(
        `${path} 重复关联同一单词和分组。`,
      );
    }
    pairs.add(pair);
    return {
      id,
      wordId,
      groupId,
      createdAtMs: timestamp(item.createdAtMs, `${path}.createdAtMs`),
    };
  });
}

function parseReviewStates(value: unknown): ReviewState[] {
  const keys = new Set<string>();
  return array(value, "data.reviewStates").map((entry, index) => {
    const path = `data.reviewStates[${index}]`;
    const item = record(entry, path);
    const wordId = nonEmptyString(item.wordId, `${path}.wordId`);
    uniqueKey(keys, wordId, `${path}.wordId`);
    return {
      wordId,
      ef: efValue(item.ef, `${path}.ef`),
      consecutiveSuccesses: nonNegativeInteger(
        item.consecutiveSuccesses,
        `${path}.consecutiveSuccesses`,
      ),
      consecutiveForgets: nonNegativeInteger(
        item.consecutiveForgets,
        `${path}.consecutiveForgets`,
      ),
      weakScore: nonNegativeInteger(
        item.weakScore,
        `${path}.weakScore`,
      ),
      intervalMinutes: positiveIntegerOrNull(
        item.intervalMinutes,
        `${path}.intervalMinutes`,
      ),
      lastFeedbackAtMs: timestampOrNull(
        item.lastFeedbackAtMs,
        `${path}.lastFeedbackAtMs`,
      ),
      nextReviewAtMs: timestampOrNull(
        item.nextReviewAtMs,
        `${path}.nextReviewAtMs`,
      ),
      createdAtMs: timestamp(item.createdAtMs, `${path}.createdAtMs`),
      updatedAtMs: timestamp(item.updatedAtMs, `${path}.updatedAtMs`),
    };
  });
}

function parseLearningHistory(value: unknown): LearningHistory[] {
  const keys = new Set<string>();
  return array(value, "data.learningHistory").map((entry, index) => {
    const path = `data.learningHistory[${index}]`;
    const item = record(entry, path);
    const id = nonEmptyString(item.id, `${path}.id`);
    uniqueKey(keys, id, `${path}.id`);
    const mode = enumValue(item.mode, MODES, `${path}.mode`);
    const source = enumValue(item.source, SOURCES, `${path}.source`);
    const groupId =
      item.groupId === null
        ? null
        : nonEmptyString(item.groupId, `${path}.groupId`);
    if (source === "group" && groupId === null) {
      throw new DataValidationError(
        `${path}.groupId 必须关联分组学习来源。`,
      );
    }
    if (source !== "group" && groupId !== null) {
      throw new DataValidationError(
        `${path}.groupId 只能是 null 或分组来源 ID。`,
      );
    }
    const feedbackOccurredAtMs = timestamp(
      item.feedbackOccurredAtMs,
      `${path}.feedbackOccurredAtMs`,
    );
    const beijingDate = nonEmptyString(
      item.beijingDate,
      `${path}.beijingDate`,
    );
    if (!isBeijingDate(beijingDate)) {
      throw new DataValidationError(
        `${path}.beijingDate 必须是有效 YYYY-MM-DD。`,
      );
    }
    if (beijingDate !== toBeijingDate(feedbackOccurredAtMs)) {
      throw new DataValidationError(
        `${path}.beijingDate 与反馈时间的北京时间不一致。`,
      );
    }
    return {
      id,
      wordId: nonEmptyString(item.wordId, `${path}.wordId`),
      mode,
      source,
      groupId,
      feedback: enumValue(
        item.feedback,
        FEEDBACKS,
        `${path}.feedback`,
      ),
      feedbackOccurredAtMs,
      beijingDate,
      stateBefore: parseSnapshot(
        item.stateBefore,
        `${path}.stateBefore`,
      ),
      stateAfter: parseSnapshot(
        item.stateAfter,
        `${path}.stateAfter`,
      ),
    };
  });
}

function parseDailyTasks(value: unknown): DailyTask[] {
  const keys = new Set<string>();
  return array(value, "data.dailyTasks").map((entry, index) => {
    const path = `data.dailyTasks[${index}]`;
    const item = record(entry, path);
    const beijingDate = nonEmptyString(
      item.beijingDate,
      `${path}.beijingDate`,
    );
    uniqueKey(keys, beijingDate, `${path}.beijingDate`);
    const baseGoal = nonNegativeInteger(
      item.baseGoal,
      `${path}.baseGoal`,
    );
    if (baseGoal < MIN_DAILY_GOAL || baseGoal > MAX_DAILY_GOAL) {
      throw new DataValidationError(
        `${path}.baseGoal 必须在 ${MIN_DAILY_GOAL}–${MAX_DAILY_GOAL} 之间。`,
      );
    }
    const carryoverTasks = nonNegativeInteger(
      item.carryoverTasks,
      `${path}.carryoverTasks`,
    );
    const nominalTaskCount = nonNegativeInteger(
      item.nominalTaskCount,
      `${path}.nominalTaskCount`,
    );
    if (nominalTaskCount !== baseGoal + carryoverTasks) {
      throw new DataValidationError(
        `${path}.nominalTaskCount 与基础目标和结转量不一致。`,
      );
    }
    const effectiveTaskCount = nonNegativeInteger(
      item.effectiveTaskCount,
      `${path}.effectiveTaskCount`,
    );
    if (effectiveTaskCount > nominalTaskCount) {
      throw new DataValidationError(
        `${path}.effectiveTaskCount 不能大于名义任务量。`,
      );
    }
    const completedGlobalNewWordIds = uniqueStringArray(
      item.completedGlobalNewWordIds,
      `${path}.completedGlobalNewWordIds`,
    );
    const completedGlobalReviewWordIds = uniqueStringArray(
      item.completedGlobalReviewWordIds,
      `${path}.completedGlobalReviewWordIds`,
    );
    const completedCount = nonNegativeInteger(
      item.completedCount,
      `${path}.completedCount`,
    );
    if (completedCount !== completedGlobalNewWordIds.length) {
      throw new DataValidationError(
        `${path}.completedCount 与新词完成 ID 数量不一致。`,
      );
    }
    return {
      beijingDate,
      baseGoal,
      carryoverTasks,
      nominalTaskCount,
      effectiveTaskCount,
      completedCount,
      completedGlobalNewWordIds,
      completedGlobalReviewWordIds,
      createdAtMs: timestamp(item.createdAtMs, `${path}.createdAtMs`),
      updatedAtMs: timestamp(item.updatedAtMs, `${path}.updatedAtMs`),
    };
  });
}

function parseSettings(value: unknown): AppSettings[] {
  const items = array(value, "data.settings");
  if (items.length > 1) {
    throw new DataValidationError("data.settings 最多只能包含一个设置记录。");
  }

  return items.map((entry, index) => {
    const path = `data.settings[${index}]`;
    const item = record(entry, path);
    if (item.id !== "app-settings") {
      throw new DataValidationError(`${path}.id 必须是 app-settings。`);
    }
    const dailyBaseGoal = nonNegativeInteger(
      item.dailyBaseGoal,
      `${path}.dailyBaseGoal`,
    );
    if (
      dailyBaseGoal < MIN_DAILY_GOAL ||
      dailyBaseGoal > MAX_DAILY_GOAL
    ) {
      throw new DataValidationError(
        `${path}.dailyBaseGoal 必须在 ${MIN_DAILY_GOAL}–${MAX_DAILY_GOAL} 之间。`,
      );
    }
    if (item.timeZone !== "Asia/Shanghai") {
      throw new DataValidationError(
        `${path}.timeZone 必须是 Asia/Shanghai。`,
      );
    }
    return {
      id: "app-settings",
      dailyBaseGoal,
      timeZone: "Asia/Shanghai",
      createdAtMs: timestamp(item.createdAtMs, `${path}.createdAtMs`),
      updatedAtMs: timestamp(item.updatedAtMs, `${path}.updatedAtMs`),
    };
  });
}

function assertRelationships(snapshot: DatabaseSnapshot): void {
  const wordIds = new Set(snapshot.words.map((word) => word.id));
  const groupIds = new Set(snapshot.groups.map((group) => group.id));

  snapshot.wordGroups.forEach((association, index) => {
    if (!wordIds.has(association.wordId)) {
      throw new DataValidationError(
        `data.wordGroups[${index}] 引用了不存在的单词。`,
      );
    }
    if (!groupIds.has(association.groupId)) {
      throw new DataValidationError(
        `data.wordGroups[${index}] 引用了不存在的分组。`,
      );
    }
  });
  snapshot.reviewStates.forEach((state, index) => {
    if (!wordIds.has(state.wordId)) {
      throw new DataValidationError(
        `data.reviewStates[${index}] 引用了不存在的单词。`,
      );
    }
  });
  snapshot.learningHistory.forEach((history, index) => {
    if (!wordIds.has(history.wordId)) {
      throw new DataValidationError(
        `data.learningHistory[${index}] 引用了不存在的单词。`,
      );
    }
  });
}

export function validateBackupDocument(value: unknown): VocabularyBackup {
  const top = record(value, "备份文件");
  if (top.format !== BACKUP_FORMAT_ID) {
    throw new DataValidationError("不是 CET-6 Vocabulary Trainer 备份文件。");
  }
  const backupVersion = nonNegativeInteger(
    top.backupVersion,
    "backupVersion",
  );
  if (backupVersion > BACKUP_FORMAT_VERSION) {
    throw new DataValidationError("备份格式版本高于当前应用支持版本。");
  }
  if (backupVersion !== BACKUP_FORMAT_VERSION) {
    throw new DataValidationError("备份格式版本不兼容当前应用。");
  }
  const databaseVersion = nonNegativeInteger(
    top.databaseVersion,
    "databaseVersion",
  );
  if (databaseVersion > DATABASE_VERSION) {
    throw new DataValidationError("备份数据库版本高于当前应用支持版本。");
  }
  if (databaseVersion !== DATABASE_VERSION) {
    throw new DataValidationError("备份数据库版本不兼容当前应用。");
  }
  const exportedAtMs = timestamp(top.exportedAtMs, "exportedAtMs");
  const data = record(top.data, "data");
  const snapshot: DatabaseSnapshot = {
    words: parseWords(data.words),
    groups: parseGroups(data.groups),
    wordGroups: parseWordGroups(data.wordGroups),
    reviewStates: parseReviewStates(data.reviewStates),
    learningHistory: parseLearningHistory(data.learningHistory),
    dailyTasks: parseDailyTasks(data.dailyTasks),
    settings: parseSettings(data.settings),
  };
  assertRelationships(snapshot);

  return {
    format: BACKUP_FORMAT_ID,
    backupVersion,
    databaseVersion,
    exportedAtMs,
    data: snapshot,
  };
}

export function summarizeBackup(
  backup: VocabularyBackup,
): BackupSummary {
  return {
    exportedAtMs: backup.exportedAtMs,
    databaseVersion: backup.databaseVersion,
    wordCount: backup.data.words.length,
    groupCount: backup.data.groups.length,
    associationCount: backup.data.wordGroups.length,
    reviewStateCount: backup.data.reviewStates.length,
    learningHistoryCount: backup.data.learningHistory.length,
    dailyTaskCount: backup.data.dailyTasks.length,
    settingsCount: backup.data.settings.length,
  };
}
