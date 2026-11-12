import {
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { deleteDB } from "idb";
import { MemoryRouter } from "react-router-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
} from "vitest";

import {
  closeDatabase,
  createRepositories,
  openDatabase,
  type AppDatabase,
  type Repositories,
} from "../../data";
import { WeakWordsPage } from "../../pages/WeakWordsPage";
import { DailyProgressService } from "../daily/dailyProgressService";
import { LearningSessionService } from "../learning/learningSessionService";
import { WeakWordService } from "./weakWordService";

let database: AppDatabase;
let repositories: Repositories;
let weakService: WeakWordService;
let dailyService: DailyProgressService;
let databaseName: string;
let sequence: number;
let databaseSequence = 0;
const NOW = Date.UTC(2026, 0, 1, 4, 0, 40);

beforeEach(async () => {
  databaseSequence += 1;
  databaseName = `cet6-weak-page-test-${databaseSequence}`;
  sequence = 0;
  database = await openDatabase({ name: databaseName });
  repositories = createRepositories(database, {
    now: () => NOW,
    createId: () => {
      sequence += 1;
      return `weak-page-id-${sequence}`;
    },
  });
  await repositories.settings.create(20);
  const learningService = new LearningSessionService(repositories, {
    createId: () => {
      sequence += 1;
      return `weak-page-learning-${sequence}`;
    },
  });
  weakService = new WeakWordService(repositories, {
    createId: () => {
      sequence += 1;
      return `weak-page-feedback-${sequence}`;
    },
  });
  dailyService = new DailyProgressService(repositories);
  const word = await repositories.words.create({
    displayWord: "retry-word",
    chineseMeaning: "需要强化的完整释义",
  });
  await learningService.submitFeedback(
    learningService.createSubmission({
      wordId: word.id,
      mode: "english-to-chinese",
      feedback: "forgotten",
      feedbackAtMs: NOW,
    }),
  );
});

afterEach(async () => {
  closeDatabase(database);
  await deleteDB(databaseName);
});

function renderPage() {
  return render(
    <MemoryRouter>
      <WeakWordsPage now={() => NOW} service={weakService} />
    </MemoryRouter>,
  );
}

describe("薄弱词强化页面", () => {
  it("先隐藏答案，查看后提交反馈，快速连点只保存一次", async () => {
    renderPage();
    const word = await repositories.words.getByNormalizedWord("retry-word");
    if (!word) throw new Error("测试单词不存在。");
    const toggle = await screen.findByRole("button", {
      name: /retry-word/,
    });

    expect(
      screen.queryByText("需要强化的完整释义"),
    ).not.toBeInTheDocument();
    expect(toggle).toHaveTextContent("薄弱分 3");
    fireEvent.click(toggle);
    expect(screen.getByText("需要强化的完整释义")).toBeInTheDocument();

    const rememberButton = screen.getByRole("button", {
      name: "记住了",
    });
    fireEvent.click(rememberButton);
    fireEvent.click(rememberButton);

    expect(
      await screen.findByText(
        "薄弱词反馈已保存，并计入今日全局复习统计。",
      ),
    ).toBeInTheDocument();
    await expect(
      repositories.learningHistory.countForWord(word.id),
    ).resolves.toBe(2);
    const daily = await dailyService.getToday(NOW);
    expect(daily.task.completedGlobalReviewWordIds).toEqual([word.id]);
  });

  it("没有符合条件的学习历史时显示空状态", async () => {
    const previousDatabaseName = databaseName;
    closeDatabase(database);
    await deleteDB(previousDatabaseName);
    databaseName = `${previousDatabaseName}-empty`;
    database = await openDatabase({ name: databaseName });
    repositories = createRepositories(database, {
      now: () => NOW,
      createId: () => `empty-${sequence++}`,
    });
    weakService = new WeakWordService(repositories, {
      createId: () => `empty-feedback-${sequence++}`,
    });

    renderPage();

    expect(
      await screen.findByRole("heading", {
        level: 2,
        name: "暂时没有薄弱词",
      }),
    ).toBeInTheDocument();
  });
});
