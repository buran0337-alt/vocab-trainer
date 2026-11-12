import {
  assertEpochMilliseconds,
  DataNotFoundError,
  type Feedback,
  type Group,
  type LearningHistory,
  type Repositories,
  type ReviewState,
  type Word,
  type WordGroup,
} from "../../data";
import type { RepositoryOptions } from "../../data/repositoryOptions";
import { LearningSessionService } from "../learning/learningSessionService";

export interface GroupSummary {
  group: Group;
  wordCount: number;
  startedCount: number;
  unstartedCount: number;
  groupHistoryCount: number;
}

export interface GroupWordView {
  word: Word;
  association: WordGroup;
  reviewState: ReviewState | null;
  groupHistoryCount: number;
  learningStatus: "due" | "new" | "scheduled";
}

export interface GroupDetail {
  summary: GroupSummary;
  words: GroupWordView[];
  availableWords: Word[];
}

function wordStatus(
  state: ReviewState | null,
  atMs: number,
): GroupWordView["learningStatus"] {
  if (!state) {
    return "new";
  }
  if (
    state.nextReviewAtMs !== null &&
    state.nextReviewAtMs <= atMs
  ) {
    return "due";
  }
  return "scheduled";
}

export class GroupLibraryService {
  private readonly repositories: Repositories;
  private readonly learningSessions: LearningSessionService;

  constructor(
    repositories: Repositories,
    options: RepositoryOptions = {},
  ) {
    this.repositories = repositories;
    this.learningSessions = new LearningSessionService(repositories, options);
  }

  async list(): Promise<GroupSummary[]> {
    const groups = await this.repositories.groups.list();
    return Promise.all(groups.map((group) => this.getSummary(group)));
  }

  async getSummary(group: Group): Promise<GroupSummary> {
    const [members, histories] = await Promise.all([
      this.repositories.wordGroups.listForGroup(group.id),
      this.repositories.learningHistory.listForGroup(group.id),
    ]);
    const states = await Promise.all(
      members.map((member) =>
        this.repositories.reviewStates.getByWordId(member.wordId),
      ),
    );
    const startedCount = states.filter(Boolean).length;

    return {
      group,
      wordCount: members.length,
      startedCount,
      unstartedCount: members.length - startedCount,
      groupHistoryCount: histories.length,
    };
  }

  async getDetail(
    groupId: string,
    atMs: number,
  ): Promise<GroupDetail> {
    assertEpochMilliseconds(atMs, "分组查看时间");
    const group = await this.repositories.groups.getById(groupId);
    if (!group) {
      throw new DataNotFoundError("没有找到指定分组。");
    }

    const [words, states, histories, allWords] = await Promise.all([
      this.repositories.wordGroups.getWordsForGroup(groupId),
      this.repositories.reviewStates.listAll(),
      this.repositories.learningHistory.listForGroup(groupId),
      this.repositories.words.list(),
    ]);
    const members = await this.repositories.wordGroups.listForGroup(
      groupId,
    );
    const associationByWordId = new Map(
      members.map((association) => [
        association.wordId,
        association,
      ]),
    );
    const stateByWordId = new Map(
      states.map((state) => [state.wordId, state]),
    );
    const historyCountByWord = new Map<string, number>();
    for (const history of histories) {
      historyCountByWord.set(
        history.wordId,
        (historyCountByWord.get(history.wordId) ?? 0) + 1,
      );
    }

    const sortedWords = words
      .map((word) => {
        const reviewState = stateByWordId.get(word.id) ?? null;
        return {
          word,
          association: associationByWordId.get(word.id) as WordGroup,
          reviewState,
          groupHistoryCount: historyCountByWord.get(word.id) ?? 0,
          learningStatus: wordStatus(reviewState, atMs),
        };
      })
      .sort((left, right) => {
        const rank = { due: 0, new: 1, scheduled: 2 };
        return (
          rank[left.learningStatus] - rank[right.learningStatus] ||
          left.word.displayWord.localeCompare(right.word.displayWord)
        );
      });
    const groupWordIds = new Set(words.map((word) => word.id));
    const availableWords = allWords.filter(
      (word) => !groupWordIds.has(word.id),
    );
    const startedCount = sortedWords.filter(
      (item) => item.reviewState !== null,
    ).length;

    return {
      summary: {
        group,
        wordCount: words.length,
        startedCount,
        unstartedCount: words.length - startedCount,
        groupHistoryCount: histories.length,
      },
      words: sortedWords,
      availableWords,
    };
  }

  async create(name: string): Promise<Group> {
    return this.repositories.groups.create(name);
  }

  async rename(groupId: string, name: string): Promise<Group> {
    return this.repositories.groups.update(groupId, name);
  }

  async delete(groupId: string): Promise<void> {
    await this.repositories.groups.delete(groupId);
  }

  async addWords(
    groupId: string,
    wordIds: string[],
  ): Promise<WordGroup[]> {
    return this.repositories.wordGroups.addMany(wordIds, groupId);
  }

  async removeWord(groupId: string, wordId: string): Promise<boolean> {
    return this.repositories.wordGroups.remove(wordId, groupId);
  }

  createGroupSubmission(input: {
    wordId: string;
    groupId: string;
    feedback: Feedback;
    feedbackAtMs: number;
  }) {
    return this.learningSessions.createSubmission({
      wordId: input.wordId,
      mode: "english-to-chinese",
      feedback: input.feedback,
      feedbackAtMs: input.feedbackAtMs,
      source: "group",
      groupId: input.groupId,
    });
  }

  async submitGroupFeedback(
    submission: ReturnType<GroupLibraryService["createGroupSubmission"]>,
  ) {
    return this.learningSessions.submitFeedback(submission);
  }

  async countGroupHistories(groupId: string): Promise<number> {
    const histories: LearningHistory[] =
      await this.repositories.learningHistory.listForGroup(groupId);
    return histories.length;
  }
}

