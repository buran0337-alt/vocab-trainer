import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
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
import { WordsPage } from "../../pages/WordsPage";
import { WordLibraryService } from "./wordLibraryService";

let database: AppDatabase;
let repositories: Repositories;
let service: WordLibraryService;
let databaseName: string;
let currentTime: number;
let sequence: number;
let databaseSequence = 0;

beforeEach(async () => {
  databaseSequence += 1;
  databaseName = `cet6-words-page-test-${databaseSequence}`;
  currentTime = Date.UTC(2026, 0, 1, 4, 0, 0);
  sequence = 0;
  database = await openDatabase({ name: databaseName });
  repositories = createRepositories(database, {
    now: () => currentTime,
    createId: () => {
      sequence += 1;
      return `page-id-${sequence}`;
    },
  });
  service = new WordLibraryService(repositories);
});

afterEach(async () => {
  closeDatabase(database);
  await deleteDB(databaseName);
});

async function renderLibrary() {
  const result = render(<WordsPage service={service} />);
  await screen.findByText("单词总数");
  await waitFor(() => {
    expect(screen.queryByText("正在读取本地词库…")).not.toBeInTheDocument();
  });
  return result;
}

function getWordCard(displayWord: string): HTMLElement {
  const heading = screen.getByRole("heading", {
    level: 2,
    name: displayWord,
  });
  const card = heading.closest("article");

  if (!card) {
    throw new Error("没有找到单词卡片。");
  }

  return card;
}

function fillWordForm(displayWord: string, chineseMeaning: string) {
  fireEvent.change(
    screen.getByRole("textbox", { name: /英文单词/ }),
    {
    target: { value: displayWord },
    },
  );
  fireEvent.change(
    screen.getByRole("textbox", { name: /中文释义/ }),
    {
      target: { value: chineseMeaning },
    },
  );
}

async function seedLearnedWord(): Promise<Word> {
  const word = await repositories.words.create({
    displayWord: "Abandon",
    chineseMeaning: "放弃",
  });
  await repositories.reviewStates.create(word.id);
  await repositories.learningHistory.add({
    wordId: word.id,
    mode: "english-to-chinese",
    source: "global",
    groupId: null,
    feedback: "fuzzy",
    feedbackOccurredAtMs: currentTime,
    stateBefore: null,
    stateAfter: null,
  });
  return word;
}

describe("单词库空状态与添加", () => {
  it("空词库显示友好提示", async () => {
    await renderLibrary();

    expect(
      await screen.findByRole("heading", {
        level: 2,
        name: "词库目前为空",
      }),
    ).toBeInTheDocument();
    expect(screen.getAllByText("0")).not.toHaveLength(0);
  });

  it("空字段显示明确错误且不写入数据库", async () => {
    await renderLibrary();
    fireEvent.click(screen.getByRole("button", { name: "添加单词" }));
    fireEvent.click(screen.getByRole("button", { name: "保存单词" }));

    expect(await screen.findByText("英文单词不能为空。")).toBeInTheDocument();
    expect(screen.getByText("中文释义不能为空。")).toBeInTheDocument();
    await expect(repositories.words.list()).resolves.toEqual([]);
  });

  it("正常添加后立即显示并写入 IndexedDB", async () => {
    await renderLibrary();
    fireEvent.click(screen.getByRole("button", { name: "添加单词" }));
    fillWordForm("Abandon", "放弃；抛弃");
    fireEvent.click(screen.getByRole("button", { name: "保存单词" }));

    expect(
      await screen.findByRole("heading", { level: 2, name: "Abandon" }),
    ).toBeInTheDocument();
    expect(screen.getByText("放弃；抛弃")).toBeInTheDocument();
    await expect(repositories.words.list()).resolves.toHaveLength(1);
    expect(screen.getByText("已添加单词 Abandon。")).toHaveTextContent(
      "已添加单词 Abandon",
    );
  });

  it("长度限制在表单和实际写入数据层同时生效", async () => {
    const longWord = "a".repeat(101);
    const longMeaning = "释".repeat(2001);

    await renderLibrary();
    fireEvent.click(screen.getByRole("button", { name: "添加单词" }));
    fillWordForm(longWord, longMeaning);
    fireEvent.click(screen.getByRole("button", { name: "保存单词" }));

    expect(
      await screen.findByText("英文单词不能超过 100 个字符。"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("中文释义不能超过 2000 个字符。"),
    ).toBeInTheDocument();
    await expect(repositories.words.list()).resolves.toEqual([]);
  });
});

describe("单词搜索", () => {
  it("可按英文或中文即时筛选，并显示无匹配空状态", async () => {
    await repositories.words.create({
      displayWord: "alpha",
      chineseMeaning: "第一个",
    });
    await repositories.words.create({
      displayWord: "beta",
      chineseMeaning: "第二个",
    });
    await renderLibrary();
    const input = screen.getByRole("searchbox", { name: "搜索" });

    fireEvent.change(input, { target: { value: "BETA" } });
    expect(screen.getByRole("heading", { level: 2, name: "beta" })).toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { level: 2, name: "alpha" }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("当前显示 1 / 2");

    fireEvent.change(input, { target: { value: "第一" } });
    expect(
      screen.getByRole("heading", { level: 2, name: "alpha" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { level: 2, name: "beta" }),
    ).not.toBeInTheDocument();

    fireEvent.change(input, { target: { value: "不存在" } });
    expect(
      screen.getByRole("heading", {
        level: 2,
        name: "没有匹配的单词",
      }),
    ).toBeInTheDocument();
  });
});

describe("重复添加与释义冲突", () => {
  it("大小写和全半角重复不创建第二条记录", async () => {
    await repositories.words.create({
      displayWord: "ＡＢＣ",
      chineseMeaning: "字母",
    });
    await renderLibrary();

    fireEvent.click(screen.getByRole("button", { name: "添加单词" }));
    fillWordForm(" abc ", "字母");
    fireEvent.click(screen.getByRole("button", { name: "保存单词" }));

    expect(
      await screen.findByText("该单词和释义均已存在，原记录保持不变。"),
    ).toBeInTheDocument();
    const words = await repositories.words.list();
    expect(words).toHaveLength(1);
    expect(words[0].displayWord).toBe("ＡＢＣ");
  });

  it("释义冲突默认保留，只有明确更新才修改释义", async () => {
    const word = await seedLearnedWord();
    const stateBefore = await repositories.reviewStates.getByWordId(word.id);
    await renderLibrary();

    fireEvent.click(screen.getByRole("button", { name: "添加单词" }));
    fillWordForm(" abandon ", "放弃；抛弃");
    fireEvent.click(screen.getByRole("button", { name: "保存单词" }));

    expect(
      await screen.findByRole("heading", {
        level: 2,
        name: "发现释义冲突",
      }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "保留原释义" }));

    expect(
      await screen.findByText("已保留原释义，未修改单词或学习状态。"),
    ).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.queryByText("正在读取本地词库…")).not.toBeInTheDocument();
    });
    await expect(repositories.words.getById(word.id)).resolves.toMatchObject({
      displayWord: "Abandon",
      chineseMeaning: "放弃",
    });
    await expect(
      repositories.reviewStates.getByWordId(word.id),
    ).resolves.toEqual(stateBefore);

    fireEvent.click(screen.getByRole("button", { name: "添加单词" }));
    fillWordForm("Abandon", "放弃；抛弃");
    fireEvent.click(screen.getByRole("button", { name: "保存单词" }));
    await screen.findByRole("heading", {
      level: 2,
      name: "发现释义冲突",
    });
    fireEvent.click(
      screen.getByRole("button", { name: "更新为本次释义" }),
    );

    await waitFor(async () => {
      await expect(repositories.words.getById(word.id)).resolves.toMatchObject({
        chineseMeaning: "放弃；抛弃",
      });
    });
    await expect(
      repositories.reviewStates.getByWordId(word.id),
    ).resolves.toEqual(stateBefore);
  });
});

describe("编辑和详情", () => {
  it("手动修改英文大小写后显示新输入并返回详情摘要", async () => {
    const word = await seedLearnedWord();
    await renderLibrary();
    const card = getWordCard("Abandon");
    expect(within(card).getByText(/已学习 1 次/)).toBeInTheDocument();

    fireEvent.click(within(card).getByRole("button", { name: "编辑" }));
    fillWordForm("abandon", "放弃；抛弃");
    fireEvent.click(screen.getByRole("button", { name: "保存单词" }));

    expect(
      await screen.findByRole("heading", { level: 2, name: "abandon" }),
    ).toBeInTheDocument();
    await expect(repositories.words.getById(word.id)).resolves.toMatchObject({
      displayWord: "abandon",
      normalizedWord: "abandon",
      chineseMeaning: "放弃；抛弃",
    });

    const updatedCard = getWordCard("abandon");
    fireEvent.click(
      within(updatedCard).getByRole("button", { name: "查看详情" }),
    );
    expect(screen.getByText("EF")).toBeInTheDocument();
    expect(screen.getByText("2.50")).toBeInTheDocument();
    expect(screen.getByText("学习次数")).toBeInTheDocument();
  });

  it("修改释义保留复习状态和学习历史", async () => {
    const word = await seedLearnedWord();
    const group = await repositories.groups.create("保留关联");
    await repositories.wordGroups.add(word.id, group.id);
    const state = await repositories.reviewStates.getByWordId(word.id);
    const historyCount =
      await repositories.learningHistory.countForWord(word.id);
    await renderLibrary();

    const card = getWordCard("Abandon");
    fireEvent.click(within(card).getByRole("button", { name: "编辑" }));
    fillWordForm("Abandon", "放弃；遗弃");
    fireEvent.click(screen.getByRole("button", { name: "保存单词" }));

    await waitFor(async () => {
      await expect(repositories.words.getById(word.id)).resolves.toMatchObject({
        chineseMeaning: "放弃；遗弃",
      });
    });
    await expect(
      repositories.reviewStates.getByWordId(word.id),
    ).resolves.toEqual(state);
    await expect(
      repositories.learningHistory.countForWord(word.id),
    ).resolves.toBe(historyCount);
    await expect(
      repositories.wordGroups.getByPair(word.id, group.id),
    ).resolves.not.toBeNull();
  });

  it("编辑为已有单词的标准化形式时显示冲突且双方数据不变", async () => {
    const first = await repositories.words.create({
      displayWord: "study",
      chineseMeaning: "学习",
    });
    await repositories.words.create({
      displayWord: "studies",
      chineseMeaning: "研究",
    });
    await repositories.reviewStates.create(first.id);
    await repositories.learningHistory.add({
      wordId: first.id,
      mode: "english-to-chinese",
      source: "global",
      groupId: null,
      feedback: "remembered",
      feedbackOccurredAtMs: currentTime,
      stateBefore: null,
      stateAfter: null,
    });
    await renderLibrary();

    const card = getWordCard("study");
    fireEvent.click(within(card).getByRole("button", { name: "编辑" }));
    fillWordForm(" Studies ", "新的学习释义");
    fireEvent.click(screen.getByRole("button", { name: "保存单词" }));

    expect(
      await screen.findByRole("alert"),
    ).toHaveTextContent("修改后的英文单词与已有单词冲突");
    await expect(repositories.words.getById(first.id)).resolves.toMatchObject({
      displayWord: "study",
      chineseMeaning: "学习",
    });
    await expect(
      repositories.learningHistory.countForWord(first.id),
    ).resolves.toBe(1);
    await expect(
      repositories.words.getByNormalizedWord("studies"),
    ).resolves.toMatchObject({ displayWord: "studies" });
  });
});

describe("删除、刷新和长内容", () => {
  it("删除前展示完整影响，取消不改数据，确认后清理全部关联数据", async () => {
    const word = await seedLearnedWord();
    const group = await repositories.groups.create("阅读词汇");
    await repositories.wordGroups.add(word.id, group.id);
    const view = await renderLibrary();
    let card = getWordCard("Abandon");

    fireEvent.click(within(card).getByRole("button", { name: "删除" }));
    expect(
      screen.getByText(/即将删除/),
    ).toHaveTextContent("Abandon");
    expect(
      screen.getByText("该单词的全部学习历史将被清理。"),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "取消" }));

    await expect(repositories.words.getById(word.id)).resolves.not.toBeNull();
    card = getWordCard("Abandon");
    fireEvent.click(within(card).getByRole("button", { name: "删除" }));
    fireEvent.click(screen.getByRole("button", { name: "确认删除" }));

    expect(
      await screen.findByRole("heading", {
        level: 2,
        name: "词库目前为空",
      }),
    ).toBeInTheDocument();
    await expect(repositories.words.getById(word.id)).resolves.toBeNull();
    await expect(
      repositories.wordGroups.listForWord(word.id),
    ).resolves.toEqual([]);
    await expect(
      repositories.reviewStates.getByWordId(word.id),
    ).resolves.toBeNull();
    await expect(
      repositories.learningHistory.countForWord(word.id),
    ).resolves.toBe(0);
    await expect(repositories.groups.getById(group.id)).resolves.not.toBeNull();

    view.unmount();
    await renderLibrary();
    expect(
      await screen.findByRole("heading", {
        level: 2,
        name: "词库目前为空",
      }),
    ).toBeInTheDocument();
  });

  it("添加和编辑结果在重新挂载页面后仍然存在", async () => {
    const firstRender = await renderLibrary();
    fireEvent.click(screen.getByRole("button", { name: "添加单词" }));
    fillWordForm("Persistent", "持久的");
    fireEvent.click(screen.getByRole("button", { name: "保存单词" }));
    await screen.findByRole("heading", {
      level: 2,
      name: "Persistent",
    });

    let card = getWordCard("Persistent");
    fireEvent.click(within(card).getByRole("button", { name: "编辑" }));
    fillWordForm("Persistent", "持久的；持续的");
    fireEvent.click(screen.getByRole("button", { name: "保存单词" }));
    await screen.findByText("持久的；持续的");
    firstRender.unmount();

    await renderLibrary();
    card = getWordCard("Persistent");
    expect(within(card).getByText("持久的；持续的")).toBeInTheDocument();
  });

  it("长单词和长释义保存后不截断文本内容", async () => {
    const longWord = `${"a".repeat(96)}wxyz`;
    const longMeaning = "很长的释义。".repeat(200);
    await renderLibrary();

    fireEvent.click(screen.getByRole("button", { name: "添加单词" }));
    fillWordForm(longWord, longMeaning);
    fireEvent.click(screen.getByRole("button", { name: "保存单词" }));

    expect(
      await screen.findByRole("heading", { level: 2, name: longWord }),
    ).toBeInTheDocument();
    expect(screen.getByText(longMeaning)).toBeInTheDocument();
    const stored = await repositories.words.getByNormalizedWord(longWord);
    expect(stored?.displayWord).toBe(longWord);
    expect(stored?.chineseMeaning).toBe(longMeaning);
  });
});

