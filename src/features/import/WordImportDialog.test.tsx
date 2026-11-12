import {
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { deleteDB } from "idb";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import * as XLSX from "xlsx";

import {
  closeDatabase,
  createRepositories,
  openDatabase,
  type AppDatabase,
  type Repositories,
} from "../../data";
import { WordImportDialog } from "./WordImportDialog";
import { WordImportService } from "./wordImportService";

let database: AppDatabase;
let repositories: Repositories;
let service: WordImportService;
let databaseName: string;
let currentTime: number;
let sequence: number;
let databaseSequence = 0;

beforeEach(async () => {
  databaseSequence += 1;
  databaseName = `cet6-import-dialog-test-${databaseSequence}`;
  currentTime = Date.UTC(2026, 0, 1, 4, 0, 0);
  sequence = 0;
  database = await openDatabase({ name: databaseName });
  repositories = createRepositories(database, {
    now: () => currentTime,
    createId: () => {
      sequence += 1;
      return `dialog-id-${sequence}`;
    },
  });
  service = new WordImportService(repositories);
});

afterEach(async () => {
  closeDatabase(database);
  await deleteDB(databaseName);
});

function fileFromBuffer(
  name: string,
  buffer: ArrayBuffer,
  type = "text/csv",
): File {
  const file = new File([buffer], name, { type });
  Object.defineProperty(file, "arrayBuffer", {
    value: async () => buffer,
  });
  return file;
}

function csvFile(name: string, text: string): File {
  return fileFromBuffer(name, new TextEncoder().encode(text).buffer);
}

function xlsxFile(
  name: string,
  sheets: Array<{ name: string; rows: unknown[][] }>,
): File {
  const workbook = XLSX.utils.book_new();
  for (const sheet of sheets) {
    XLSX.utils.book_append_sheet(
      workbook,
      XLSX.utils.aoa_to_sheet(sheet.rows),
      sheet.name,
    );
  }
  const output = XLSX.write(workbook, {
    bookType: "xlsx",
    type: "array",
  }) as ArrayBuffer | ArrayBufferView;
  const buffer = ArrayBuffer.isView(output)
    ? (output.buffer.slice(
        output.byteOffset,
        output.byteOffset + output.byteLength,
      ) as ArrayBuffer)
    : output;
  return fileFromBuffer(
    name,
    buffer,
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  );
}

function renderDialog() {
  const onClose = vi.fn();
  const onCompleted = vi.fn();
  render(
    <WordImportDialog
      onClose={onClose}
      onCompleted={onCompleted}
      service={service}
    />,
  );
  return { onClose, onCompleted };
}

async function upload(file: File) {
  fireEvent.change(
    screen.getByLabelText("选择导入文件"),
    {
      target: { files: [file] },
    },
  );
}

describe("CSV 导入界面", () => {
  it("完成选择、映射、预览、确认和结果流程", async () => {
    const { onCompleted } = renderDialog();
    await upload(csvFile("words.csv", "英文,中文含义\nabandon,放弃"));

    expect(
      await screen.findByRole("combobox", { name: "CSV 英文单词列" }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "生成预览" }));
    expect(
      await screen.findByText(/文件内冲突/),
    ).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "下一步：确认导入" }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "确认并导入" }),
    );

    expect(
      await screen.findByText("文件已处理完成，所有写入在同一事务中提交。"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("新增", { selector: "dt" }).nextElementSibling,
    ).toHaveTextContent("1");
    expect(onCompleted).toHaveBeenCalledWith(
      "导入完成：新增 1，更新 0。",
    );
    await expect(repositories.words.list()).resolves.toHaveLength(1);
  });

  it("取消导入不会写入数据", async () => {
    renderDialog();
    await upload(csvFile("cancel.csv", "英文,中文含义\nabandon,放弃"));
    await screen.findByRole("combobox", { name: "CSV 英文单词列" });

    fireEvent.click(screen.getByRole("button", { name: "取消导入" }));

    await expect(repositories.words.list()).resolves.toEqual([]);
  });

  it("已有冲突可选择全部更新并保留学习状态", async () => {
    const word = await repositories.words.create({
      displayWord: "Abandon",
      chineseMeaning: "放弃",
    });
    const state = await repositories.reviewStates.create(word.id);
    renderDialog();
    await upload(
      csvFile("update.csv", "英文,中文含义\nabandon,遗弃"),
    );
    await screen.findByRole("combobox", { name: "CSV 英文单词列" });
    fireEvent.click(screen.getByRole("button", { name: "生成预览" }));
    await screen.findByText("已有单词释义冲突");
    fireEvent.click(
      screen.getByRole("button", { name: "全部更新释义" }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "下一步：确认导入" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "确认并导入" }));

    await screen.findByText("导入结果");
    await expect(repositories.words.getById(word.id)).resolves.toMatchObject({
      displayWord: "Abandon",
      chineseMeaning: "遗弃",
      normalizedWord: "abandon",
    });
    await expect(
      repositories.reviewStates.getByWordId(word.id),
    ).resolves.toEqual(state);
  });
});

describe("Excel 工作表选择", () => {
  it("只导入用户选中的工作表", async () => {
    renderDialog();
    await upload(
      xlsxFile("select.xlsx", [
        {
          name: "基础词",
          rows: [
            ["英文", "中文含义"],
            ["study", "学习"],
          ],
        },
        {
          name: "进阶词",
          rows: [
            ["英文", "中文含义"],
            ["coherent", "连贯的"],
          ],
        },
      ]),
    );

    fireEvent.click(
      await screen.findByRole("checkbox", { name: /基础词/ }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "下一步：确认列" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "生成预览" }));
    await screen.findByText("基础词 · 第 2 行");
    fireEvent.click(
      screen.getByRole("button", { name: "下一步：确认导入" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "确认并导入" }));
    await screen.findByText("导入结果");

    const words = await repositories.words.list();
    expect(words.map((word) => word.normalizedWord)).toEqual(["study"]);
  });

  it("可选择多个不同列结构的工作表并分别映射", async () => {
    renderDialog();
    await upload(
      xlsxFile("multi.xlsx", [
        {
          name: "基础词",
          rows: [
            ["英文", "中文含义"],
            ["study", "学习"],
          ],
        },
        {
          name: "进阶词",
          rows: [
            ["词性", "单词", "释义", "备注"],
            ["形容词", "coherent", "连贯的", "忽略"],
          ],
        },
      ]),
    );

    fireEvent.click(
      await screen.findByRole("checkbox", { name: /基础词/ }),
    );
    fireEvent.click(
      screen.getByRole("checkbox", { name: /进阶词/ }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "下一步：确认列" }),
    );

    expect(
      screen.getByRole("combobox", { name: "基础词 英文单词列" }),
    ).toHaveValue("0");
    expect(
      screen.getByRole("combobox", { name: "进阶词 英文单词列" }),
    ).toHaveValue("1");
    expect(
      screen.getByRole("combobox", { name: "进阶词 中文释义列" }),
    ).toHaveValue("2");
    fireEvent.click(screen.getByRole("button", { name: "生成预览" }));

    expect(
      await screen.findByText("进阶词 · 第 2 行"),
    ).toBeInTheDocument();
  });

  it("文件内多释义必须选择后才能继续", async () => {
    renderDialog();
    await upload(
      csvFile(
        "conflict.csv",
        "英文,中文含义\nabandon,放弃\nabandon,遗弃",
      ),
    );
    await screen.findByRole("combobox", { name: "CSV 英文单词列" });
    fireEvent.click(screen.getByRole("button", { name: "生成预览" }));

    const nextButton = await screen.findByRole("button", {
      name: "下一步：确认导入",
    });
    expect(nextButton).toBeDisabled();
    expect(
      screen.getByText(/还有 1 个文件内冲突单词未选择/),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("radio", { name: "遗弃" }));
    expect(nextButton).toBeEnabled();
  });

  it("同时存在文件内和已有词库冲突时逐项确定最终释义", async () => {
    const word = await repositories.words.create({
      displayWord: "Abandon",
      chineseMeaning: "放弃；抛弃",
    });
    renderDialog();
    await upload(
      csvFile(
        "both-conflicts.csv",
        "英文,中文含义\nabandon,放弃\nabandon,遗弃",
      ),
    );
    await screen.findByRole("combobox", { name: "CSV 英文单词列" });
    fireEvent.click(screen.getByRole("button", { name: "生成预览" }));
    await screen.findByText("已有单词释义冲突");

    fireEvent.click(screen.getByRole("radio", { name: "遗弃" }));
    fireEvent.click(
      screen.getByRole("radio", { name: "更新为选定释义" }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "下一步：确认导入" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "确认并导入" }));

    await screen.findByText("导入结果");
    await expect(repositories.words.getById(word.id)).resolves.toMatchObject({
      displayWord: "Abandon",
      chineseMeaning: "遗弃",
    });
  });

  it("不支持的文件类型显示明确错误", async () => {
    renderDialog();
    await upload(
      fileFromBuffer(
        "words.txt",
        new TextEncoder().encode("word,meaning").buffer,
        "text/plain",
      ),
    );

    expect(
      await screen.findByRole("alert"),
    ).toHaveTextContent("不支持此文件类型");
  });
});

