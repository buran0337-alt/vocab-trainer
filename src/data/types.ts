/**
 * All instant timestamps are Unix epoch milliseconds.
 * Calendar attribution uses a separate `YYYY-MM-DD` Beijing date.
 */
export interface Word {
  id: string;
  displayWord: string;
  normalizedWord: string;
  chineseMeaning: string;
  createdAtMs: number;
  updatedAtMs: number;
}

export interface Group {
  id: string;
  name: string;
  createdAtMs: number;
  updatedAtMs: number;
}

export interface WordGroup {
  id: string;
  wordId: string;
  groupId: string;
  createdAtMs: number;
}

export interface ReviewState {
  wordId: string;
  ef: number;
  consecutiveSuccesses: number;
  consecutiveForgets: number;
  weakScore: number;
  intervalMinutes: number | null;
  lastFeedbackAtMs: number | null;
  nextReviewAtMs: number | null;
  createdAtMs: number;
  updatedAtMs: number;
}

export type LearningMode = "english-to-chinese" | "chinese-to-english";
export type LearningSource = "global" | "group" | "weak";
export type Feedback = "forgotten" | "fuzzy" | "remembered";

/**
 * A nullable snapshot field represents information that did not exist at that
 * point in history. It must not be replaced with zero or a fabricated date.
 */
export interface ReviewStateSnapshot {
  ef: number | null;
  consecutiveSuccesses: number | null;
  consecutiveForgets: number | null;
  weakScore: number | null;
  intervalMinutes: number | null;
  lastFeedbackAtMs: number | null;
  nextReviewAtMs: number | null;
}

export interface LearningHistory {
  id: string;
  wordId: string;
  mode: LearningMode;
  source: LearningSource;
  groupId: string | null;
  feedback: Feedback;
  feedbackOccurredAtMs: number;
  beijingDate: string;
  stateBefore: ReviewStateSnapshot | null;
  stateAfter: ReviewStateSnapshot | null;
}

export interface DailyTask {
  beijingDate: string;
  baseGoal: number;
  carryoverTasks: number;
  nominalTaskCount: number;
  effectiveTaskCount: number;
  completedCount: number;
  completedGlobalNewWordIds: string[];
  completedGlobalReviewWordIds: string[];
  createdAtMs: number;
  updatedAtMs: number;
}

export interface AppSettings {
  id: string;
  dailyBaseGoal: number;
  timeZone: "Asia/Shanghai";
  createdAtMs: number;
  updatedAtMs: number;
}

