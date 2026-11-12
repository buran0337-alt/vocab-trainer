import {
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { deleteDB } from "idb";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import {
  closeDatabase,
  createRepositories,
  DataOperationError,
  openDatabase,
  type AppDatabase,
  type Repositories,
  type ReviewState,
} from "../../data";
import { LearnPage } from "../../pages/LearnPage";
import type {
  FeedbackSubmission,
  LearningCard,
} from "./learningSessionService";
import { LearningSessionService } from "./learningSessionService";

let database: AppDatabase;
let repositories: Repositories;
let service: LearningSessionService;
let databaseName: string;
let currentTime: number;
let sequence: number;
let databaseSequence = 0;

beforeEach(async () => {
  databaseSequence += 1;
  databaseName = `cet6-learn-page-test-${databaseSequence}`;
  currentTime = Date.UTC(2026, 0, 1, 4, 0, 40);
  sequence = 0;
  database = await openDatabase({ name: databaseName });
  repositories = createRepositories(database, {
    now: () => currentTime,
    createId: () => {
      sequence += 1;
      return `page-word-id-${sequence}`;
    },
  });
  await repositories.settings.create(999);
  service = new LearningSessionService(repositories, {
    createId: () => {
      sequence += 1;
      return `feedback-id-${sequence}`;
    },
  });
});

afterEach(async () => {
  closeDatabase(database);
  await deleteDB(databaseName);
});

function renderLearn() {
  return render(
    <MemoryRouter>
      <LearnPage now={() => currentTime} service={service} />
    </MemoryRouter>,
  );
}

async function chooseMode(label: "英译中" | "中译英") {
  fireEvent.click(screen.getByRole("button", { name: new RegExp(label) }));
}

describe("学习模式与答案显示", () => {
  it("英译中先隐藏完整中文释义，显示答案后提供三档反馈", async () => {
    await repositories.words.create({
      displayWord: "Abandon",
      chineseMeaning: "放弃；抛弃",
    });
    renderLearn();
    await chooseMode("英译中");

    expect(
      await screen.findByRole("heading", {
        level: 2,
        name: "Abandon",
      }),
    ).toBeInTheDocument();
    expect(screen.queryByText("放弃；抛弃")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "忘记了" }),
    ).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "显示答案" }));
    expect(screen.getByText("放弃；抛弃")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "忘记了" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "模糊" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "记住了" })).toBeInTheDocument();
  });

  it("中译英先显示完整释义并隐藏英文答案", async () => {
    const word = await repositories.words.create({
      displayWord: "Brittle",
      chineseMeaning: "脆弱的；易碎的",
    });
    renderLearn();
    await chooseMode("中译英");

    expect(
      await screen.findByRole("heading", {
        level: 2,
        name: "脆弱的；易碎的",
      }),
    ).toBeInTheDocument();
    expect(screen.queryByText("Brittle")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "显示答案" }));
    expect(screen.getByText("Brittle")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "模糊" }));
    expect(
      await screen.findByRole("heading", {
        level: 2,
        name: "本轮学习完成",
      }),
    ).toBeInTheDocument();
    await expect(
      repositories.reviewStates.getByWordId(word.id),
    ).resolves.toMatchObject({
      ef: 2.36,
      consecutiveSuccesses: 0,
      intervalMinutes: 1_440,
    });
  });

  it("读取队列时显示加载状态，空结果进入空状态", async () => {
    const deferredLoad: {
      resolve?: (cards: LearningCard[]) => void;
    } = {};
    vi.spyOn(service, "loadRound").mockImplementation(
      () =>
        new Promise((resolve) => {
          deferredLoad.resolve = resolve;
        }),
    );
    renderLearn();
    await chooseMode("英译中");

    expect(
      screen.getByText("正在准备本轮学习…"),
    ).toBeInTheDocument();
    deferredLoad.resolve?.([]);

    expect(
      await screen.findByRole("heading", {
        level: 2,
        name: "暂时没有可学习的单词",
      }),
    ).toBeInTheDocument();
  });

  it("三档反馈均可提交并各自进入下一题", async () => {
    await repositories.words.create({
      displayWord: "first",
      chineseMeaning: "第一",
    });
    await repositories.words.create({
      displayWord: "second",
      chineseMeaning: "第二",
    });
    await repositories.words.create({
      displayWord: "third",
      chineseMeaning: "第三",
    });
    renderLearn();
    await chooseMode("英译中");

    for (const feedback of ["忘记了", "模糊", "记住了"]) {
      await screen.findByRole("button", { name: "显示答案" });
      fireEvent.click(screen.getByRole("button", { name: "显示答案" }));
      fireEvent.click(screen.getByRole("button", { name: feedback }));
      if (feedback !== "记住了") {
        await waitFor(() => {
          expect(
            screen.getByRole("button", { name: "显示答案" }),
          ).toBeInTheDocument();
        });
      }
    }

    expect(
      await screen.findByRole("heading", {
        level: 2,
        name: "本轮学习完成",
      }),
    ).toBeInTheDocument();
    await expect(
      repositories.learningHistory.listByBeijingDate("2026-01-01"),
    ).resolves.toHaveLength(3);
  });

  it("空词库显示无可学习单词", async () => {
    renderLearn();
    await chooseMode("英译中");

    expect(
      await screen.findByRole("heading", {
        level: 2,
        name: "暂时没有可学习的单词",
      }),
    ).toBeInTheDocument();
  });

  it("加载失败显示错误并允许重新加载", async () => {
    vi.spyOn(service, "loadRound").mockRejectedValueOnce(
      new Error("模拟加载失败"),
    );
    renderLearn();
    await chooseMode("英译中");

    expect(
      await screen.findByRole("heading", {
        level: 2,
        name: "无法加载学习内容",
      }),
    ).toBeInTheDocument();
    expect(screen.getByText("模拟加载失败")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "重新加载" }),
    ).toBeInTheDocument();
  });
});

describe("反馈持久化安全", () => {
  it("反馈成功后更新状态、写入历史并进入下一题", async () => {
    const first = await repositories.words.create({
      displayWord: "first",
      chineseMeaning: "第一",
    });
    await repositories.words.create({
      displayWord: "second",
      chineseMeaning: "第二",
    });
    renderLearn();
    await chooseMode("英译中");
    await screen.findByRole("heading", { level: 2, name: "first" });
    fireEvent.click(screen.getByRole("button", { name: "显示答案" }));
    fireEvent.click(screen.getByRole("button", { name: "记住了" }));

    expect(
      await screen.findByRole("heading", { level: 2, name: "second" }),
    ).toBeInTheDocument();
    const state = await repositories.reviewStates.getByWordId(first.id);
    expect(state).toMatchObject({
      ef: 2.6,
      consecutiveSuccesses: 1,
      intervalMinutes: 1_440,
    });
    await expect(
      repositories.learningHistory.countForWord(first.id),
    ).resolves.toBe(1);
  });

  it("保存失败不进入下一题，使用同一提交 ID 重试只写一条历史", async () => {
    const word = await repositories.words.create({
      displayWord: "retry",
      chineseMeaning: "重试",
    });
    const originalCommit =
      repositories.learningSessions.commitFeedback.bind(
        repositories.learningSessions,
      );
    const commitSpy = vi
      .spyOn(repositories.learningSessions, "commitFeedback")
      .mockRejectedValueOnce(new DataOperationError("模拟保存失败"));
    renderLearn();
    await chooseMode("英译中");
    await screen.findByRole("heading", { level: 2, name: "retry" });
    fireEvent.click(screen.getByRole("button", { name: "显示答案" }));
    fireEvent.click(screen.getByRole("button", { name: "模糊" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "保存失败：模拟保存失败",
    );
    expect(
      screen.getByRole("heading", { level: 2, name: "retry" }),
    ).toBeInTheDocument();
    await expect(
      repositories.learningHistory.countForWord(word.id),
    ).resolves.toBe(0);

    commitSpy.mockImplementation(originalCommit);
    fireEvent.click(screen.getByRole("button", { name: "重试保存" }));
    expect(
      await screen.findByRole("heading", {
        level: 2,
        name: "本轮学习完成",
      }),
    ).toBeInTheDocument();

    const calls = commitSpy.mock.calls;
    expect(calls).toHaveLength(2);
    expect(calls[0][0].history.id).toBe(calls[1][0].history.id);
    await expect(
      repositories.learningHistory.countForWord(word.id),
    ).resolves.toBe(1);
  });

  it("快速连续点击只调用一次持久化服务", async () => {
    await repositories.words.create({
      displayWord: "rapid",
      chineseMeaning: "快速",
    });
    const deferredSave: { release?: () => void } = {};
    const originalSubmit = service.submitFeedback.bind(service);
    const submitSpy = vi
      .spyOn(service, "submitFeedback")
      .mockImplementation(
        (submission: FeedbackSubmission) =>
          new Promise((resolve, reject) => {
            deferredSave.release = () => {
              void originalSubmit(submission).then(resolve, reject);
            };
          }),
      );
    renderLearn();
    await chooseMode("英译中");
    await screen.findByRole("heading", { level: 2, name: "rapid" });
    fireEvent.click(screen.getByRole("button", { name: "显示答案" }));
    const button = screen.getByRole("button", { name: "记住了" });

    fireEvent.click(button);
    fireEvent.click(button);
    fireEvent.click(button);

    expect(submitSpy).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("status")).toHaveTextContent(
      "正在保存本次反馈",
    );
    deferredSave.release?.();
    expect(
      await screen.findByRole("heading", {
        level: 2,
        name: "本轮学习完成",
      }),
    ).toBeInTheDocument();
  });

  it("刷新后已保存的复习状态仍然存在", async () => {
    const word = await repositories.words.create({
      displayWord: "persistent",
      chineseMeaning: "持久",
    });
    const view = renderLearn();
    await chooseMode("英译中");
    await screen.findByRole("heading", { level: 2, name: "persistent" });
    fireEvent.click(screen.getByRole("button", { name: "显示答案" }));
    fireEvent.click(screen.getByRole("button", { name: "记住了" }));
    await screen.findByRole("heading", {
      level: 2,
      name: "本轮学习完成",
    });

    view.unmount();
    renderLearn();
    const state = await repositories.reviewStates.getByWordId(word.id);
    expect(state).toMatchObject({
      ef: 2.6,
      consecutiveSuccesses: 1,
      intervalMinutes: 1_440,
    });
    await chooseMode("英译中");
    expect(
      await screen.findByRole("heading", {
        level: 2,
        name: "暂时没有可学习的单词",
      }),
    ).toBeInTheDocument();
  });

  it("学习记录保存反馈前后的状态快照", async () => {
    const word = await repositories.words.create({
      displayWord: "snapshot",
      chineseMeaning: "快照",
    });
    await repositories.reviewStates.create(word.id);
    await repositories.reviewStates.update(word.id, {
      nextReviewAtMs: currentTime - 1,
    });
    const dueState = (await repositories.reviewStates.getByWordId(
      word.id,
    )) as ReviewState;
    renderLearn();
    await chooseMode("英译中");
    await screen.findByRole("heading", { level: 2, name: "snapshot" });
    fireEvent.click(screen.getByRole("button", { name: "显示答案" }));
    fireEvent.click(screen.getByRole("button", { name: "模糊" }));
    await screen.findByRole("heading", {
      level: 2,
      name: "本轮学习完成",
    });

    const [history] = await repositories.learningHistory.listForWord(word.id);
    expect(history.stateBefore).toEqual(snapshot(dueState));
    expect(history.stateAfter).toMatchObject({
      ef: 2.36,
      consecutiveSuccesses: 0,
      consecutiveForgets: 0,
      weakScore: 1,
      intervalMinutes: 1_440,
    });
  });
});

function snapshot(state: ReviewState) {
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

