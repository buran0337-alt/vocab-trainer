import type { AppDatabase } from "../database";
import type { RepositoryOptions } from "../repositoryOptions";
import { resolveRepositoryOptions } from "../repositoryOptions";
import { BackupRepository } from "./backupRepository";
import { DailyTaskRepository } from "./dailyTaskRepository";
import { DailyProgressRepository } from "./dailyProgressRepository";
import { GroupRepository } from "./groupRepository";
import { LearningSessionRepository } from "./learningSessionRepository";
import { LearningHistoryRepository } from "./learningHistoryRepository";
import { ReviewStateRepository } from "./reviewStateRepository";
import { SettingsRepository } from "./settingsRepository";
import { WordGroupRepository } from "./wordGroupRepository";
import { WordRepository } from "./wordRepository";

export interface Repositories {
  backup: BackupRepository;
  words: WordRepository;
  groups: GroupRepository;
  wordGroups: WordGroupRepository;
  reviewStates: ReviewStateRepository;
  learningHistory: LearningHistoryRepository;
  learningSessions: LearningSessionRepository;
  dailyTasks: DailyTaskRepository;
  dailyProgress: DailyProgressRepository;
  settings: SettingsRepository;
}

export function createRepositories(
  database: AppDatabase,
  options: RepositoryOptions = {},
): Repositories {
  const resolved = resolveRepositoryOptions(options);
  const sharedOptions: RepositoryOptions = {
    now: resolved.now,
    createId: resolved.createId,
  };

  return {
    backup: new BackupRepository(database),
    words: new WordRepository(database, sharedOptions),
    groups: new GroupRepository(database, sharedOptions),
    wordGroups: new WordGroupRepository(database, sharedOptions),
    reviewStates: new ReviewStateRepository(database, sharedOptions),
    learningHistory: new LearningHistoryRepository(database, sharedOptions),
    learningSessions: new LearningSessionRepository(database),
    dailyTasks: new DailyTaskRepository(database, sharedOptions),
    dailyProgress: new DailyProgressRepository(database, sharedOptions),
    settings: new SettingsRepository(database, sharedOptions),
  };
}

export { DailyTaskRepository } from "./dailyTaskRepository";
export { BackupRepository } from "./backupRepository";
export { DailyProgressRepository } from "./dailyProgressRepository";
export { GroupRepository } from "./groupRepository";
export { LearningHistoryRepository } from "./learningHistoryRepository";
export { LearningSessionRepository } from "./learningSessionRepository";
export { ReviewStateRepository } from "./reviewStateRepository";
export { SettingsRepository } from "./settingsRepository";
export { WordGroupRepository } from "./wordGroupRepository";
export { WordRepository } from "./wordRepository";
export type {
  CreateDailyTaskInput,
  DailyTaskChanges,
} from "./dailyTaskRepository";
export { validateDailyTaskRecord } from "./dailyTaskRepository";
export type { AddLearningHistoryInput } from "./learningHistoryRepository";
export type {
  CommitLearningFeedbackInput,
  CommitLearningFeedbackResult,
} from "./learningSessionRepository";
export type { ReviewStateChanges } from "./reviewStateRepository";
export type {
  CreateWordInput,
  UpdateWordInput,
  WordImportAction,
  WordImportBatchResult,
} from "./wordRepository";

