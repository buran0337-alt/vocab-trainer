import {
  assertEpochMilliseconds,
  DataValidationError,
  type Feedback,
  type LearningHistory,
  type LearningMode,
  type LearningSource,
  type Repositories,
  type ReviewState,
  type ReviewStateSnapshot,
  type Word,
} from "../../data";
import {
  resolveRepositoryOptions,
  type RepositoryOptions,
} from "../../data/repositoryOptions";
import { DailyProgressService } from "../daily/dailyProgressService";
import {
  applyReviewFeedback,
  createInitialReviewStateValues,
  type ReviewStateValues,
} from "../review/reviewAlgorithm";

export interface LearningCard {
  word: Word;
  reviewState: ReviewState | null;
  kind: "review" | "new";
}

export interface FeedbackSubmission {
  submissionId: string;
  wordId: string;
  mode: LearningMode;
  feedback: Feedback;
  feedbackAtMs: number;
  source: LearningSource;
  groupId: string | null;
}

function snapshot(state: ReviewStateValues): ReviewStateSnapshot {
  return {
    ef: state.ef,
    consecutiveSuccesses: state.consecutiveSuccesses,
    consecutiveForgets: state.consecutiveForgets,
    weakScore: state.weakScore,
    intervalMinutes: state.intervalMinutes,
    lastFeedbackAtMs: state.lastFeedbackAtMs,
    nextReviewAtMs: state.nextReviewAtMs,
  };
}

export class LearningSessionService {
  private readonly repositories: Repositories;
  private readonly createId: () => string;
  private readonly dailyProgress: DailyProgressService;

  constructor(
    repositories: Repositories,
    options: RepositoryOptions = {},
  ) {
    this.repositories = repositories;
    this.createId = resolveRepositoryOptions(options).createId;
    this.dailyProgress = new DailyProgressService(repositories);
  }

  async loadRound(atMs: number): Promise<LearningCard[]> {
    assertEpochMilliseconds(atMs, "学习队列时间");
    const [progress, words, states] = await Promise.all([
      this.dailyProgress.getToday(atMs),
      this.repositories.words.list(),
      this.repositories.reviewStates.listAll(),
    ]);
    const wordsById = new Map(words.map((word) => [word.id, word]));
    const stateByWordId = new Map(
      states.map((state) => [state.wordId, state]),
    );

    const dueStates = states
      .filter(
        (state) =>
          state.nextReviewAtMs !== null &&
          state.nextReviewAtMs <= atMs &&
          wordsById.has(state.wordId),
      )
      .sort(
        (left, right) =>
          (left.nextReviewAtMs as number) -
            (right.nextReviewAtMs as number) ||
          left.wordId.localeCompare(right.wordId),
      );
    const seen = new Set<string>();
    const cards: LearningCard[] = [];

    for (const state of dueStates) {
      if (seen.has(state.wordId)) {
        continue;
      }
      seen.add(state.wordId);
      cards.push({
        word: wordsById.get(state.wordId) as Word,
        reviewState: state,
        kind: "review",
      });
    }

    let remainingNewTasks = progress.remainingTaskCount;
    for (const word of words) {
      if (remainingNewTasks <= 0) {
        break;
      }
      if (stateByWordId.has(word.id) || seen.has(word.id)) {
        continue;
      }
      seen.add(word.id);
      cards.push({ word, reviewState: null, kind: "new" });
      remainingNewTasks -= 1;
    }

    return cards;
  }

  createSubmission(input: {
    wordId: string;
    mode: LearningMode;
    feedback: Feedback;
    feedbackAtMs: number;
    source?: LearningSource;
    groupId?: string | null;
  }): FeedbackSubmission {
    assertEpochMilliseconds(input.feedbackAtMs, "反馈时间");
    return {
      submissionId: this.createId(),
      wordId: input.wordId,
      mode: input.mode,
      feedback: input.feedback,
      feedbackAtMs: input.feedbackAtMs,
      source: input.source ?? "global",
      groupId: input.groupId ?? null,
    };
  }

  async submitFeedback(
    submission: FeedbackSubmission,
  ): Promise<{
    history: LearningHistory;
    reviewState: ReviewState;
    idempotentReplay: boolean;
  }> {
    if (
      submission.mode !== "english-to-chinese" &&
      submission.mode !== "chinese-to-english"
    ) {
      throw new DataValidationError("学习模式无效。");
    }

    if (submission.source === "group" && !submission.groupId) {
      throw new DataValidationError("分组学习缺少分组 ID。");
    }
    if (
      submission.source !== "group" &&
      submission.groupId !== null
    ) {
      throw new DataValidationError("只有分组学习可以关联分组 ID。");
    }
    const currentState =
      await this.repositories.reviewStates.getByWordId(submission.wordId);
    if (
      currentState === null &&
      !(await this.repositories.words.getById(submission.wordId))
    ) {
      throw new DataValidationError("找不到要学习的单词。");
    }

    const stateValues: ReviewStateValues =
      currentState === null
        ? createInitialReviewStateValues()
        : {
            ef: currentState.ef,
            consecutiveSuccesses: currentState.consecutiveSuccesses,
            consecutiveForgets: currentState.consecutiveForgets,
            weakScore: currentState.weakScore,
            intervalMinutes: currentState.intervalMinutes,
            lastFeedbackAtMs: currentState.lastFeedbackAtMs,
            nextReviewAtMs: currentState.nextReviewAtMs,
          };
    const calculated = applyReviewFeedback({
      state: stateValues,
      feedback: submission.feedback,
      feedbackAtMs: submission.feedbackAtMs,
    });
    const nextReviewState: ReviewState = {
      wordId: submission.wordId,
      ef: calculated.ef,
      consecutiveSuccesses: calculated.consecutiveSuccesses,
      consecutiveForgets: calculated.consecutiveForgets,
      weakScore: calculated.weakScore,
      intervalMinutes: calculated.intervalMinutes,
      lastFeedbackAtMs: calculated.lastFeedbackAtMs,
      nextReviewAtMs: calculated.nextReviewAtMs,
      createdAtMs: currentState?.createdAtMs ?? submission.feedbackAtMs,
      updatedAtMs: submission.feedbackAtMs,
    };
    const history: LearningHistory = {
      id: submission.submissionId,
      wordId: submission.wordId,
      mode: submission.mode,
      source: submission.source,
      groupId: submission.groupId,
      feedback: submission.feedback,
      feedbackOccurredAtMs: submission.feedbackAtMs,
      beijingDate: calculated.beijingDate,
      stateBefore: currentState === null ? null : snapshot(currentState),
      stateAfter: snapshot(calculated),
    };
    const taskUpdate =
      submission.source !== "group"
        ? this.dailyProgress.createFeedbackTaskUpdate(
            await this.dailyProgress.getToday(submission.feedbackAtMs),
            submission.wordId,
            submission.source === "global" && currentState === null,
            submission.feedbackAtMs,
          )
        : null;

    return this.repositories.learningSessions.commitFeedback({
      history,
      nextReviewState,
      expectedReviewState: currentState,
      nextDailyTask: taskUpdate?.nextTask ?? null,
      expectedDailyTask: taskUpdate?.expectedTask ?? null,
    });
  }
}

