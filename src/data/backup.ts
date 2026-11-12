import type {
  AppSettings,
  DailyTask,
  Group,
  LearningHistory,
  ReviewState,
  Word,
  WordGroup,
} from "./types";

export interface DatabaseSnapshot {
  words: Word[];
  groups: Group[];
  wordGroups: WordGroup[];
  reviewStates: ReviewState[];
  learningHistory: LearningHistory[];
  dailyTasks: DailyTask[];
  settings: AppSettings[];
}
