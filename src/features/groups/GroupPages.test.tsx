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
} from "vitest";

import {
  closeDatabase,
  createRepositories,
  openDatabase,
  type AppDatabase,
  type Repositories,
  type Word,
} from "../../data";
import { GroupDetailPage } from "../../pages/GroupDetailPage";
import { GroupsPage } from "../../pages/GroupsPage";
import { DailyProgressService } from "../daily/dailyProgressService";
import { GroupLibraryService } from "./groupLibraryService";

let database: AppDatabase;
let repositories: Repositories;
let service: GroupLibraryService;
let dailyService: DailyProgressService;
let databaseName: string;
let sequence: number;
let databaseSequence = 0;
const NOW = Date.UTC(2026, 0, 1, 4, 0, 40);
const clock = () => NOW;

beforeEach(async () => {
  databaseSequence += 1;
  databaseName = `cet6-group-pages-test-${databaseSequence}`;
  sequence = 0;
  database = await openDatabase({ name: databaseName });
  repositories = createRepositories(database, {
    now: clock,
    createId: () => {
      sequence += 1;
      return `group-page-id-${sequence}`;
    },
  });
  service = new GroupLibraryService(repositories, {
    createId: () => {
      sequence += 1;
      return `group-page-feedback-${sequence}`;
    },
  });
  dailyService = new DailyProgressService(repositories);
});

afterEach(async () => {
  closeDatabase(database);
  await deleteDB(databaseName);
});

async function createWord(displayWord: string): Promise<Word> {
  return repositories.words.create({
    displayWord,
    chineseMeaning: `${displayWord} 的完整中文释义`,
  });
}

async function renderGroups() {
  const result = render(
    <MemoryRouter>
      <GroupsPage service={service} />
    </MemoryRouter>,
  );
  await waitFor(() => {
    expect(screen.queryByText("正在读取分组…")).not.toBeInTheDocument();
  });
  return result;
}

async function renderGroupDetail(groupId: string) {
  const result = render(
    <MemoryRouter>
      <GroupDetailPage
        groupId={groupId}
        now={clock}
        service={service}
      />
    </MemoryRouter>,
  );
  await waitFor(() => {
    expect(
      screen.queryByText("正在读取分组词汇…"),
    ).not.toBeInTheDocument();
  });
  return result;
}

function getGroupCard(name: string): HTMLElement {
  const heading = screen.getByRole("heading", { level: 2, name });
  const card = heading.closest("article");
  if (!card) throw new Error("没有找到分组卡片。");
  return card;
}

function getWordToggle(word: string): HTMLElement {
  const button = screen
    .getAllByRole("button")
    .find((candidate) => candidate.textContent.includes(word));
  if (!button) throw new Error(`没有找到单词 ${word} 的展开按钮。`);
  return button;
}

describe("分组管理页面", () => {
  it("空状态可以创建分组，并允许大小写不同的名称", async () => {
    await renderGroups();
    expect(
      await screen.findByRole("heading", {
        level: 2,
        name: "还没有分组",
      }),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "创建第一个分组" }));
    fireEvent.change(screen.getByLabelText("分组名称"), {
      target: { value: "Review" },
    });
    fireEvent.click(screen.getByRole("button", { name: "保存分组" }));
    expect(
      await screen.findByRole("heading", { level: 2, name: "Review" }),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "创建分组" }));
    fireEvent.change(screen.getByLabelText("分组名称"), {
      target: { value: "review" },
    });
    fireEvent.click(screen.getByRole("button", { name: "保存分组" }));
    expect(
      await screen.findByRole("heading", { level: 2, name: "review" }),
    ).toBeInTheDocument();
  });

  it("重命名分组并阻止去空格后的重复名称", async () => {
    await service.create("原名");
    await service.create("已存在");
    await renderGroups();
    let card = await screen.findByText("原名");
    card = card.closest("article") as HTMLElement;
    fireEvent.click(within(card).getByRole("button", { name: "重命名" }));
    fireEvent.change(screen.getByLabelText("分组名称"), {
      target: { value: "新名称" },
    });
    fireEvent.click(screen.getByRole("button", { name: "保存分组" }));
    expect(
      await screen.findByRole("heading", { level: 2, name: "新名称" }),
    ).toBeInTheDocument();

    card = getGroupCard("新名称");
    fireEvent.click(within(card).getByRole("button", { name: "重命名" }));
    fireEvent.change(screen.getByLabelText("分组名称"), {
      target: { value: " 已存在 " },
    });
    fireEvent.click(screen.getByRole("button", { name: "保存分组" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("已经存在");
  });

  it("删除非空分组显示数量，确认后保留单词和学习进度", async () => {
    const word = await createWord("preserved");
    const group = await service.create("有单词的分组");
    await service.addWords(group.id, [word.id]);
    const state = await repositories.reviewStates.create(word.id);
    await renderGroups();

    const card = getGroupCard("有单词的分组");
    fireEvent.click(within(card).getByRole("button", { name: "删除" }));
    expect(
      screen.getByText(/这个分组包含/),
    ).toHaveTextContent("1");
    fireEvent.click(
      screen.getByRole("button", { name: "确认删除分组" }),
    );

    expect(
      await screen.findByRole("heading", {
        level: 2,
        name: "还没有分组",
      }),
    ).toBeInTheDocument();
    await expect(repositories.words.getById(word.id)).resolves.not.toBeNull();
    await expect(
      repositories.reviewStates.getByWordId(word.id),
    ).resolves.toEqual(state);
  });
});

describe("分组批量浏览与反馈", () => {
  it("同时展示多个单词，点击后独立展开和收起且不改变学习数据", async () => {
    const first = await createWord("alpha");
    const second = await createWord("beta");
    const group = await service.create("批量浏览");
    await service.addWords(group.id, [first.id, second.id]);
    await renderGroupDetail(group.id);

    const firstToggle = await screen.findByRole("button", {
      name: /alpha/,
    });
    const secondToggle = screen.getByRole("button", { name: /beta/ });
    expect(firstToggle).toHaveAttribute("aria-expanded", "false");
    expect(secondToggle).toHaveAttribute("aria-expanded", "false");

    fireEvent.click(firstToggle);
    expect(screen.getByText(/alpha 的完整中文释义/)).toBeInTheDocument();
    expect(screen.queryByText(/beta 的完整中文释义/)).not.toBeInTheDocument();
    fireEvent.click(secondToggle);
    expect(screen.getByText(/beta 的完整中文释义/)).toBeInTheDocument();

    fireEvent.click(firstToggle);
    expect(screen.queryByText(/alpha 的完整中文释义/)).not.toBeInTheDocument();
    expect(screen.getByText(/beta 的完整中文释义/)).toBeInTheDocument();
    await expect(repositories.reviewStates.listAll()).resolves.toEqual([]);
    await expect(
      repositories.learningHistory.countForWord(first.id),
    ).resolves.toBe(0);
    await expect(
      repositories.learningHistory.countForWord(second.id),
    ).resolves.toBe(0);
  });

  it("可批量添加和移除成员，刷新后关系保持", async () => {
    const [alpha, beta] = await Promise.all([
      createWord("alpha-add"),
      createWord("beta-add"),
    ]);
    const group = await service.create("成员管理");
    const view = await renderGroupDetail(group.id);
    await screen.findByRole("heading", { level: 1, name: "成员管理" });
    fireEvent.click(screen.getByRole("button", { name: "添加单词" }));
    fireEvent.click(
      screen.getByRole("checkbox", { name: /alpha-add/ }),
    );
    fireEvent.click(
      screen.getByRole("checkbox", { name: /beta-add/ }),
    );
    fireEvent.click(screen.getByRole("button", { name: "添加 2 个单词" }));

    await screen.findByRole("button", { name: /alpha-add/ });
    expect(
      screen.getByRole("button", { name: /beta-add/ }),
    ).toBeInTheDocument();
    view.unmount();
    await renderGroupDetail(group.id);
    await screen.findByRole("button", { name: /alpha-add/ });

    fireEvent.click(getWordToggle("alpha-add"));
    fireEvent.click(
      screen.getByRole("button", { name: "从分组移除" }),
    );
    await waitFor(async () => {
      await expect(
        repositories.wordGroups.getByPair(alpha.id, group.id),
      ).resolves.toBeNull();
    });
    await expect(repositories.words.getById(alpha.id)).resolves.not.toBeNull();
    await expect(repositories.words.getById(beta.id)).resolves.not.toBeNull();
  });

  it("分组反馈更新共享状态，但每日全局任务仍为零", async () => {
    const word = await createWord("feedback-word");
    const group = await service.create("反馈组");
    await service.addWords(group.id, [word.id]);
    const before = await dailyService.getToday(NOW);
    await renderGroupDetail(group.id);
    const toggle = await screen.findByRole("button", {
      name: /feedback-word/,
    });
    fireEvent.click(toggle);
    fireEvent.click(screen.getByRole("button", { name: "记住了" }));

    expect(
      await screen.findByText("分组反馈已保存，不会计入全局每日任务。"),
    ).toBeInTheDocument();
    const state = await repositories.reviewStates.getByWordId(word.id);
    expect(state).toMatchObject({
      ef: 2.6,
      consecutiveSuccesses: 1,
      intervalMinutes: 1_440,
    });
    const histories =
      await repositories.learningHistory.listForGroup(group.id);
    expect(histories).toHaveLength(1);
    expect(histories[0]).toMatchObject({
      source: "group",
      groupId: group.id,
      wordId: word.id,
    });
    const after = await dailyService.getToday(NOW);
    expect(after.task.completedGlobalNewWordIds).toEqual([]);
    expect(after.task.completedGlobalReviewWordIds).toEqual([]);
    expect(after.totalCompletedCount).toBe(before.totalCompletedCount);
  });
});

