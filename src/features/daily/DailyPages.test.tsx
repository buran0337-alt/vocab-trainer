import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
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
  openDatabase,
  type AppDatabase,
  type Repositories,
} from "../../data";
import { HomePage } from "../../pages/HomePage";
import { SettingsPage } from "../../pages/SettingsPage";
import { StatsPage } from "../../pages/StatsPage";
import { LearningAnalyticsService } from "../analytics/learningAnalyticsService";
import { LearningSessionService } from "../learning/learningSessionService";
import { BackupService } from "../backup/backupService";
import { DailyProgressService } from "./dailyProgressService";

let database: AppDatabase;
let repositories: Repositories;
let dailyService: DailyProgressService;
let analyticsService: LearningAnalyticsService;
let backupService: BackupService;
let learningService: LearningSessionService;
let databaseName: string;
let sequence: number;
let databaseSequence = 0;
const FIXED_NOW = Date.UTC(2026, 0, 1, 4, 0, 40);
const clock = () => FIXED_NOW;

beforeEach(async () => {
  databaseSequence += 1;
  databaseName = `cet6-daily-pages-test-${databaseSequence}`;
  sequence = 0;
  database = await openDatabase({ name: databaseName });
  repositories = createRepositories(database, {
    now: clock,
    createId: () => {
      sequence += 1;
      return `daily-page-id-${sequence}`;
    },
  });
  dailyService = new DailyProgressService(repositories);
  analyticsService = new LearningAnalyticsService(repositories);
  backupService = new BackupService(repositories);
  learningService = new LearningSessionService(repositories, {
    createId: () => {
      sequence += 1;
      return `daily-page-feedback-${sequence}`;
    },
  });
});

afterEach(async () => {
  vi.restoreAllMocks();
  closeDatabase(database);
  await deleteDB(databaseName);
});

function renderHome() {
  return render(
    <MemoryRouter>
      <HomePage now={clock} service={dailyService} />
    </MemoryRouter>,
  );
}

function renderStats() {
  return render(
    <MemoryRouter>
      <StatsPage
        now={clock}
        service={analyticsService}
      />
    </MemoryRouter>,
  );
}

function renderSettings() {
  return render(
    <MemoryRouter>
      <SettingsPage
        backupService={backupService}
        now={clock}
        service={dailyService}
      />
    </MemoryRouter>,
  );
}

async function createWords(count: number): Promise<string[]> {
  const ids: string[] = [];
  for (let index = 0; index < count; index += 1) {
    const word = await repositories.words.create({
      displayWord: `dashboard-word-${index + sequence}`,
      chineseMeaning: `统计释义-${index + sequence}`,
    });
    ids.push(word.id);
  }
  return ids;
}

function metric(label: string): HTMLElement {
  const article = screen.getByText(label).closest("article");
  if (!article) {
    throw new Error(`没有找到统计卡片：${label}`);
  }
  return article;
}

describe("首页每日进度", () => {
  it("未设置目标时提示设置且不安排新词", async () => {
    await createWords(3);
    renderHome();

    expect(
      await screen.findByRole("heading", {
        level: 2,
        name: "还没有设置每日基础目标",
      }),
    ).toBeInTheDocument();
    expect(within(metric("有效任务")).getByText("0")).toBeInTheDocument();
  });

  it("展示基础目标、任务、完成、复习和剩余数量", async () => {
    const ids = await createWords(3);
    await dailyService.updateBaseGoal(5, FIXED_NOW);
    for (const wordId of ids.slice(0, 2)) {
      await learningService.submitFeedback(
        learningService.createSubmission({
          wordId,
          mode: "english-to-chinese",
          feedback: "remembered",
          feedbackAtMs: FIXED_NOW,
        }),
      );
    }
    renderHome();

    await screen.findByRole("heading", {
      level: 2,
      name: "2 / 3 个新词",
    });
    expect(within(metric("基础目标")).getByText("5")).toBeInTheDocument();
    expect(within(metric("有效任务")).getByText("3")).toBeInTheDocument();
    expect(within(metric("新词完成")).getByText("2")).toBeInTheDocument();
    expect(within(metric("复习完成")).getByText("0")).toBeInTheDocument();
    expect(within(metric("剩余新词")).getByText("1")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "开始学习" })).toBeInTheDocument();
  });
});

describe("统计页", () => {
  it("展示真实词库、今日与最近 7 天数据", async () => {
    const dashboardSpy = vi.spyOn(
      analyticsService,
      "getDashboard",
    );
    const ids = await createWords(2);
    await dailyService.updateBaseGoal(2, FIXED_NOW);
    await learningService.submitFeedback(
      learningService.createSubmission({
        wordId: ids[0],
        mode: "english-to-chinese",
        feedback: "forgotten",
        feedbackAtMs: FIXED_NOW,
      }),
    );
    renderStats();

    await screen.findByRole("heading", { level: 2, name: "学习趋势" });
    expect(within(metric("总单词数")).getByText("2")).toBeInTheDocument();
    expect(
      within(metric("累计学习单词")).getByText("1"),
    ).toBeInTheDocument();
    expect(
      within(metric("今日新词完成")).getByText("1"),
    ).toBeInTheDocument();
    expect(within(metric("当前薄弱词")).getByText("1")).toBeInTheDocument();
    expect(
      screen.getByText(/2025-12-26 至 2026-01-01/),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("img", { name: /每日学习趋势/ }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("img", { name: "共 1 条反馈" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("img", { name: "每日薄弱词数量趋势" }),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "近 30 天" }));
    expect(
      screen.getByText(/2025-12-03 至 2026-01-01/),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "全部历史" }));
    expect(
      screen.getByText(/2026-01-01 至 2026-01-01/),
    ).toBeInTheDocument();
    expect(dashboardSpy).toHaveBeenCalledTimes(1);
  });

  it("空数据展示零值指标和明确空状态", async () => {
    renderStats();

    expect(
      await screen.findByRole("heading", {
        level: 2,
        name: "还没有学习数据",
      }),
    ).toBeInTheDocument();
    expect(within(metric("累计学习单词")).getByText("0")).toBeInTheDocument();
    expect(within(metric("当前薄弱词")).getByText("0")).toBeInTheDocument();
    expect(screen.getByText("还没有自定义分组。")).toBeInTheDocument();
  });
});

describe("每日目标设置页", () => {
  it("首次设置目标后立即生成今日有效任务", async () => {
    await createWords(3);
    renderSettings();
    const input = await screen.findByLabelText(
      "每天计划学习的新词数",
    );
    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: "保存目标" }),
      ).toBeEnabled();
    });
    fireEvent.change(input, { target: { value: "2" } });
    fireEvent.click(screen.getByRole("button", { name: "保存目标" }));

    expect(
      await screen.findByText(
        "每日基础目标已保存，并已立即应用到今日任务。",
      ),
    ).toBeInTheDocument();
    await expect(repositories.settings.get()).resolves.toMatchObject({
      dailyBaseGoal: 2,
    });
    await expect(
      repositories.dailyTasks.getByDate("2026-01-01"),
    ).resolves.toMatchObject({
      baseGoal: 2,
      effectiveTaskCount: 2,
    });
  });

  it("拒绝超出 0–999 的目标且不修改设置", async () => {
    renderSettings();
    const input = await screen.findByLabelText(
      "每天计划学习的新词数",
    );
    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: "保存目标" }),
      ).toBeEnabled();
    });
    fireEvent.change(input, { target: { value: "1000" } });
    fireEvent.click(screen.getByRole("button", { name: "保存目标" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "0–999",
    );
    await expect(repositories.settings.get()).resolves.toBeNull();
  });

  it("设置 0 后保留历史完成数量", async () => {
    const ids = await createWords(2);
    await dailyService.updateBaseGoal(2, FIXED_NOW);
    await learningService.submitFeedback(
      learningService.createSubmission({
        wordId: ids[0],
        mode: "english-to-chinese",
        feedback: "remembered",
        feedbackAtMs: FIXED_NOW,
      }),
    );
    renderSettings();
    const input = await screen.findByLabelText(
      "每天计划学习的新词数",
    );
    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: "保存目标" }),
      ).toBeEnabled();
      expect(input).toHaveValue(2);
    });
    fireEvent.change(input, { target: { value: "0" } });
    fireEvent.click(screen.getByRole("button", { name: "保存目标" }));

    await screen.findByText(
      "每日基础目标已保存，并已立即应用到今日任务。",
    );
    await expect(
      repositories.dailyTasks.getByDate("2026-01-01"),
    ).resolves.toMatchObject({
      baseGoal: 0,
      completedCount: 1,
      effectiveTaskCount: 0,
    });
  });
});

