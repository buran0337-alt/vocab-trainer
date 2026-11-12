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
} from "vitest";

import {
  closeDatabase,
  createRepositories,
  openDatabase,
  type AppDatabase,
  type Repositories,
} from "../../data";
import { WordInspectionPage } from "../../pages/WordInspectionPage";
import { WordInspectionService } from "./wordInspectionService";

let database: AppDatabase;
let repositories: Repositories;
let service: WordInspectionService;
let databaseName: string;
let sequence: number;
let databaseSequence = 0;
const NOW = Date.UTC(2026, 0, 1, 4, 0, 40);

beforeEach(async () => {
  databaseSequence += 1;
  databaseName = `cet6-inspection-page-test-${databaseSequence}`;
  sequence = 0;
  database = await openDatabase({ name: databaseName });
  repositories = createRepositories(database, {
    now: () => NOW,
    createId: () => {
      sequence += 1;
      return `inspect-page-id-${sequence}`;
    },
  });
  service = new WordInspectionService({
    listWords: () => repositories.words.list(),
    listGroups: () => repositories.groups.list(),
    listGroupWords: (groupId) =>
      repositories.wordGroups.getWordsForGroup(groupId),
  });
});

afterEach(async () => {
  closeDatabase(database);
  await deleteDB(databaseName);
});

function renderInspection() {
  return render(
    <MemoryRouter>
      <WordInspectionPage service={service} />
    </MemoryRouter>,
  );
}

function wordToggle(word: string): HTMLElement {
  const button = screen
    .getAllByRole("button")
    .find((candidate) => candidate.textContent.includes(word));
  if (!button) throw new Error(`没有找到单词按钮：${word}`);
  return button;
}

describe("单词检验页面", () => {
  it("默认只显示英文，可同时独立展开多个中文释义", async () => {
    await repositories.words.create({
      displayWord: "alpha",
      chineseMeaning: "阿尔法；第一个",
    });
    await repositories.words.create({
      displayWord: "beta",
      chineseMeaning: "贝塔；第二个",
    });
    renderInspection();

    expect(await screen.findByText("alpha")).toBeInTheDocument();
    expect(screen.getByText("beta")).toBeInTheDocument();
    expect(screen.queryByText("阿尔法；第一个")).not.toBeInTheDocument();
    expect(screen.queryByText("贝塔；第二个")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "记住了" }),
    ).not.toBeInTheDocument();

    fireEvent.click(wordToggle("alpha"));
    fireEvent.click(wordToggle("beta"));
    expect(screen.getByText("阿尔法；第一个")).toBeInTheDocument();
    expect(screen.getByText("贝塔；第二个")).toBeInTheDocument();

    fireEvent.click(wordToggle("alpha"));
    expect(screen.queryByText("阿尔法；第一个")).not.toBeInTheDocument();
    expect(screen.getByText("贝塔；第二个")).toBeInTheDocument();
  });

  it("支持全部词库、指定分组、搜索和排序", async () => {
    const alpha = await repositories.words.create({
      displayWord: "alpha",
      chineseMeaning: "阿尔法",
    });
    const beta = await repositories.words.create({
      displayWord: "beta",
      chineseMeaning: "贝塔",
    });
    await repositories.words.create({
      displayWord: "gamma",
      chineseMeaning: "伽马",
    });
    const group = await repositories.groups.create("检验分组");
    await repositories.wordGroups.addMany(
      [alpha.id, beta.id],
      group.id,
    );
    renderInspection();
    await screen.findByText("alpha");
    await screen.findByText("gamma");

    fireEvent.change(screen.getByLabelText("浏览范围"), {
      target: { value: group.id },
    });
    await waitFor(() => {
      expect(screen.queryByText("gamma")).not.toBeInTheDocument();
      expect(screen.getByText("alpha")).toBeInTheDocument();
    });
    expect(screen.getByText("alpha")).toBeInTheDocument();
    expect(screen.getByText("beta")).toBeInTheDocument();

    fireEvent.change(screen.getByRole("searchbox"), {
      target: { value: "贝塔" },
    });
    expect(screen.queryByText("alpha")).not.toBeInTheDocument();
    expect(screen.getByText("beta")).toBeInTheDocument();

    fireEvent.change(screen.getByRole("searchbox"), {
      target: { value: "" },
    });
    fireEvent.change(screen.getByLabelText("排序"), {
      target: { value: "alphabetical-desc" },
    });
    const toggles = screen
      .getAllByRole("button")
      .filter((button) => button.classList.contains("inspection-toggle"));
    expect(toggles.map((button) => button.textContent)).toEqual([
      expect.stringContaining("beta"),
      expect.stringContaining("alpha"),
    ]);
  });

  it("查看与筛选前后不改变复习状态、历史或每日任务", async () => {
    const word = await repositories.words.create({
      displayWord: "readonly",
      chineseMeaning: "只读释义",
    });
    const group = await repositories.groups.create("只读");
    await repositories.wordGroups.add(word.id, group.id);
    await repositories.reviewStates.create(word.id);
    await repositories.learningHistory.add({
      wordId: word.id,
      mode: "english-to-chinese",
      source: "group",
      groupId: group.id,
      feedback: "fuzzy",
      feedbackOccurredAtMs: NOW,
      stateBefore: null,
      stateAfter: null,
    });
    await repositories.dailyTasks.create({
      beijingDate: "2026-01-01",
      baseGoal: 5,
      carryoverTasks: 0,
      nominalTaskCount: 5,
      effectiveTaskCount: 1,
      completedCount: 0,
      completedGlobalNewWordIds: [],
      completedGlobalReviewWordIds: [],
    });
    const before = await dataSnapshot();
    const view = renderInspection();
    await screen.findByText("readonly");
    fireEvent.click(wordToggle("readonly"));
    expect(screen.getByText("只读释义")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("浏览范围"), {
      target: { value: group.id },
    });
    await waitFor(() => {
      expect(screen.getByText("readonly")).toBeInTheDocument();
    });
    expect(await dataSnapshot()).toEqual(before);

    view.unmount();
    renderInspection();
    expect(await screen.findByText("readonly")).toBeInTheDocument();
    expect(screen.queryByText("只读释义")).not.toBeInTheDocument();
  });

  it("空分组显示当前范围没有单词", async () => {
    const group = await repositories.groups.create("空分组");
    renderInspection();
    await screen.findByLabelText("浏览范围");
    await waitFor(() => {
      expect(
        screen.queryByText("正在读取检验词汇…"),
      ).not.toBeInTheDocument();
    });
    fireEvent.change(screen.getByLabelText("浏览范围"), {
      target: { value: group.id },
    });

    expect(
      await screen.findByRole("heading", {
        level: 2,
        name: "当前范围没有单词",
      }),
    ).toBeInTheDocument();
  });
});

async function dataSnapshot() {
  return {
    states: await repositories.reviewStates.listAll(),
    histories: await repositories.learningHistory.listByBeijingDate(
      "2026-01-01",
    ),
    tasks: await repositories.dailyTasks.list(),
  };
}

