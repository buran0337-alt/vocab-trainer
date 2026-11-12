import {
  type Feedback,
  type LearningHistory,
  type Repositories,
  type ReviewState,
  type Word,
} from "../../data";
import type { RepositoryOptions } from "../../data/repositoryOptions";
import {
  LearningSessionService,
  type FeedbackSubmission,
} from "../learning/learningSessionService";

export interface WeakWordItem {
  word: Word;
  reviewState: ReviewState;
  weakScore: number;
  historyCount: number;
  lastLearnedAtMs: number;
}

export function weakScoreIncrement(feedback: Feedback): number {
  if (feedback === "forgotten") return 3;
  if (feedback === "fuzzy") return 1;
  return 0;
}

export function calculateHistoryWeakScore(
  histories: readonly Pick<LearningHistory, "feedback">[],
): number {
  return histories.reduce(
    (score, history) =>
      score + weakScoreIncrement(history.feedback),
    0,
  );
}

function latestHistoryTime(
  histories: readonly Pick<LearningHistory, "feedbackOccurredAtMs">[],
): number {
  return histories.reduce(
    (latest, history) =>
      Math.max(latest, history.feedbackOccurredAtMs),
    Number.NEGATIVE_INFINITY,
  );
}

export function sortWeakWordItems(
  items: readonly WeakWordItem[],
): WeakWordItem[] {
  return [...items].sort(
    (left, right) =>
      right.weakScore - left.weakScore ||
      right.reviewState.consecutiveForgets -
        left.reviewState.consecutiveForgets ||
      left.reviewState.ef - right.reviewState.ef ||
      left.lastLearnedAtMs - right.lastLearnedAtMs ||
      left.word.displayWord.localeCompare(right.word.displayWord, "en") ||
      left.word.id.localeCompare(right.word.id),
  );
}

export function buildWeakWordItems(
  words: readonly Word[],
  states: readonly ReviewState[],
  histories: readonly LearningHistory[],
): WeakWordItem[] {
  const wordsById = new Map(words.map((word) => [word.id, word]));
  const statesByWordId = new Map(
    states.map((state) => [state.wordId, state]),
  );
  const historiesByWordId = new Map<string, LearningHistory[]>();

  for (const history of histories) {
    if (!wordsById.has(history.wordId)) continue;
    const wordHistories = historiesByWordId.get(history.wordId) ?? [];
    wordHistories.push(history);
    historiesByWordId.set(history.wordId, wordHistories);
  }

  const items: WeakWordItem[] = [];
  for (const [wordId, wordHistories] of historiesByWordId) {
    const weakScore = calculateHistoryWeakScore(wordHistories);
    if (weakScore <= 0) continue;

    const state = statesByWordId.get(wordId);
    if (!state) continue;
    items.push({
      word: wordsById.get(wordId) as Word,
      reviewState: state,
      weakScore,
      historyCount: wordHistories.length,
      lastLearnedAtMs: latestHistoryTime(wordHistories),
    });
  }

  return sortWeakWordItems(items);
}

export class WeakWordService {
  private readonly repositories: Repositories;
  private readonly learningSessions: LearningSessionService;

  constructor(
    repositories: Repositories,
    options: RepositoryOptions = {},
  ) {
    this.repositories = repositories;
    this.learningSessions = new LearningSessionService(
      repositories,
      options,
    );
  }

  async list(): Promise<WeakWordItem[]> {
    const [words, states, histories] = await Promise.all([
      this.repositories.words.list(),
      this.repositories.reviewStates.listAll(),
      this.repositories.learningHistory.listAll(),
    ]);
    return buildWeakWordItems(words, states, histories);
  }

  async count(): Promise<number> {
    return (await this.list()).length;
  }

  createSubmission(input: {
    wordId: string;
    feedback: Feedback;
    feedbackAtMs: number;
  }): FeedbackSubmission {
    return this.learningSessions.createSubmission({
      wordId: input.wordId,
      mode: "english-to-chinese",
      feedback: input.feedback,
      feedbackAtMs: input.feedbackAtMs,
      source: "weak",
      groupId: null,
    });
  }

  async submitFeedback(submission: FeedbackSubmission) {
    return this.learningSessions.submitFeedback(submission);
  }
}
