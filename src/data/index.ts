export {
  BACKUP_FORMAT_VERSION,
  BEIJING_TIME_ZONE,
  DATABASE_NAME,
  DATABASE_VERSION,
  INITIAL_EF,
  MAX_GROUP_NAME_LENGTH,
  MAX_DAILY_GOAL,
  MAX_MEANING_LENGTH,
  MAX_WORD_DISPLAY_LENGTH,
  MINIMUM_EF,
  MIN_DAILY_GOAL,
} from "./constants";
export {
  closeDatabase,
  DATABASE_MIGRATIONS,
  openDatabase,
  runTransaction,
  type AppDatabase,
  type AppDatabaseSchema,
  type AppStoreName,
  type DatabaseMigration,
  type DatabaseMigrations,
  type OpenDatabaseOptions,
} from "./database";
export type { DatabaseSnapshot } from "./backup";
export {
  DatabaseOpenError,
  DataConflictError,
  DataNotFoundError,
  DataOperationError,
  DataValidationError,
  VocabularyDataError,
  type DataErrorCode,
} from "./errors";
export {
  normalizeEnglishWord,
  normalizeGroupName,
} from "./normalization";
export {
  createRepositories,
  BackupRepository,
  DailyTaskRepository,
  DailyProgressRepository,
  GroupRepository,
  LearningHistoryRepository,
  LearningSessionRepository,
  ReviewStateRepository,
  SettingsRepository,
  WordGroupRepository,
  WordRepository,
  type AddLearningHistoryInput,
  type CommitLearningFeedbackInput,
  type CommitLearningFeedbackResult,
  type CreateDailyTaskInput,
  type CreateWordInput,
  type DailyTaskChanges,
  type Repositories,
  type ReviewStateChanges,
  type UpdateWordInput,
  type WordImportAction,
  type WordImportBatchResult,
} from "./repositories";
export {
  assertEpochMilliseconds,
  ceilEpochMillisecondsToMinute,
  isBeijingDate,
  shiftBeijingDate,
  toBeijingDate,
} from "./time";
export {
  assertMaximumTextLength,
  textLength,
} from "./validation";
export type {
  AppSettings,
  DailyTask,
  Feedback,
  Group,
  LearningHistory,
  LearningMode,
  LearningSource,
  ReviewState,
  ReviewStateSnapshot,
  Word,
  WordGroup,
} from "./types";

