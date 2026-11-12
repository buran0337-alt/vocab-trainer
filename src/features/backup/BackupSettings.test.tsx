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
  openDatabase,
  type AppDatabase,
  type Repositories,
} from "../../data";
import { SettingsPage } from "../../pages/SettingsPage";
import { BackupService } from "./backupService";
import { DailyProgressService } from "../daily/dailyProgressService";

let database: AppDatabase;
let repositories: Repositories;
let backupService: BackupService;
let dailyService: DailyProgressService;
let databaseName: string;
let sequence: number;
let databaseSequence = 0;
let originalCreateObjectUrl: typeof URL.createObjectURL | undefined;
let originalRevokeObjectUrl: typeof URL.revokeObjectURL | undefined;
const NOW = Date.UTC(2026, 0, 1, 4, 0, 40);

beforeEach(async () => {
  databaseSequence += 1;
  databaseName = `cet6-backup-settings-test-${databaseSequence}`;
  sequence = 0;
  database = await openDatabase({ name: databaseName });
  repositories = createRepositories(database, {
    now: () => NOW,
    createId: () => {
      sequence += 1;
      return `backup-settings-id-${sequence}`;
    },
  });
  backupService = new BackupService(repositories);
  dailyService = new DailyProgressService(repositories);
  await repositories.settings.create(20);

  originalCreateObjectUrl = URL.createObjectURL;
  originalRevokeObjectUrl = URL.revokeObjectURL;
  Object.defineProperty(URL, "createObjectURL", {
    configurable: true,
    writable: true,
    value: vi.fn(() => "blob:test-backup"),
  });
  Object.defineProperty(URL, "revokeObjectURL", {
    configurable: true,
    writable: true,
    value: vi.fn(),
  });
});

afterEach(async () => {
  vi.restoreAllMocks();
  if (originalCreateObjectUrl) {
    URL.createObjectURL = originalCreateObjectUrl;
  } else {
    delete (URL as Partial<typeof URL>).createObjectURL;
  }
  if (originalRevokeObjectUrl) {
    URL.revokeObjectURL = originalRevokeObjectUrl;
  } else {
    delete (URL as Partial<typeof URL>).revokeObjectURL;
  }
  closeDatabase(database);
  await deleteDB(databaseName);
});

function renderSettings(refresh = vi.fn()) {
  const result = render(
    <MemoryRouter>
      <SettingsPage
        backupService={backupService}
        now={() => NOW}
        refresh={refresh}
        service={dailyService}
      />
    </MemoryRouter>,
  );
  return { ...result, refresh };
}

async function selectBackupFile(file: File) {
  const input = await screen.findByLabelText("选择备份文件");
  fireEvent.change(input, { target: { files: [file] } });
}

describe("设置页完整备份与恢复", () => {
  it("点击后生成 JSON 下载，不修改当前数据", async () => {
    const word = await repositories.words.create({
      displayWord: "export-word",
      chineseMeaning: "导出单词",
    });
    const clickSpy = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(function (this: HTMLAnchorElement) {
        expect(this.download).toMatch(
          /^cet6-vocabulary-backup-\d{8}-\d{6}\.json$/,
        );
      });
    renderSettings();

    fireEvent.click(
      screen.getByRole("button", { name: "导出完整备份" }),
    );

    expect(
      await screen.findByText("完整备份已生成并开始下载。"),
    ).toBeInTheDocument();
    expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith(
      "blob:test-backup",
    );
    expect(clickSpy).toHaveBeenCalledTimes(1);
    await expect(repositories.words.getById(word.id)).resolves.toEqual(word);
  });

  it("先校验并展示摘要，勾选确认后用备份完整覆盖并请求刷新", async () => {
    const originalWord = await repositories.words.create({
      displayWord: "original-word",
      chineseMeaning: "备份内单词",
    });
    const exportFile = await backupService.createExport(NOW);
    const extraWord = await repositories.words.create({
      displayWord: "extra-word",
      chineseMeaning: "应被覆盖的单词",
    });
    await repositories.settings.updateDailyBaseGoal(30);
    const { refresh } = renderSettings();

    await selectBackupFile(
      new File([exportFile.json], "restore.json", {
        type: "application/json",
      }),
    );

    expect(
      await screen.findByRole("heading", {
        level: 3,
        name: "待恢复文件摘要",
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/当前数据将被备份内容完整替换/),
    ).toHaveTextContent("建议先");
    expect(
      screen.getByRole("button", { name: "确认完整覆盖恢复" }),
    ).toBeDisabled();

    fireEvent.click(
      screen.getByRole("checkbox", {
        name: /我已了解此操作会完整覆盖当前数据/,
      }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "确认完整覆盖恢复" }),
    );

    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
    await expect(
      repositories.words.getById(originalWord.id),
    ).resolves.toMatchObject({ displayWord: "original-word" });
    await expect(
      repositories.words.getById(extraWord.id),
    ).resolves.toBeNull();
    await expect(repositories.settings.get()).resolves.toMatchObject({
      dailyBaseGoal: 20,
    });
  });

  it("未来版本文件被拒绝，原数据与页面提示保持不变", async () => {
    const word = await repositories.words.create({
      displayWord: "keep-current",
      chineseMeaning: "当前数据",
    });
    const backup = await backupService.createBackup(NOW);
    backup.backupVersion = 2;
    renderSettings();

    await selectBackupFile(
      new File([JSON.stringify(backup)], "future.json", {
        type: "application/json",
      }),
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "高于当前",
    );
    await expect(repositories.words.getById(word.id)).resolves.toEqual(word);
    expect(
      screen.queryByRole("heading", {
        level: 3,
        name: "待恢复文件摘要",
      }),
    ).not.toBeInTheDocument();
  });
});
