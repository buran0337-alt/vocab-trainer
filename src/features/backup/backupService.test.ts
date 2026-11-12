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
  type DatabaseSnapshot,
  type Repositories,
} from "../../data";
import { LearningSessionService } from "../learning/learningSessionService";
import { BackupService, parseBackupText } from "./backupService";
import { BACKUP_FORMAT_ID, type VocabularyBackup } from "./backupFormat";

let database: AppDatabase;
let repositories: Repositories;
let backupService: BackupService;
let learningService: LearningSessionService;
let databaseName: string;
let sequence: number;
let databaseSequence = 0;
const NOW = Date.UTC(2026, 0, 1, 4, 0, 40);

beforeEach(async () => {
  databaseSequence += 1;
  databaseName = `cet6-backup-service-test-${databaseSequence}`;
  sequence = 0;
  database = await openDatabase({ name: databaseName });
  repositories = createRepositories(database, {
    now: () => NOW,
    createId: () => {
      sequence += 1;
      return `backup-test-${sequence}`;
    },
  });
  backupService = new BackupService(repositories);
  learningService = new LearningSessionService(repositories, {
    createId: () => {
      sequence += 1;
      return `backup-submission-${sequence}`;
    },
  });
});

afterEach(async () => {
  vi.restoreAllMocks();
  closeDatabase(database);
  await deleteDB(databaseName);
});

async function seedAllData() {
  await repositories.settings.create(20);
  const word = await repositories.words.create({
    displayWord: "backup-special",
    chineseMeaning: "备份；特殊字符 & < >\n第二行",
  });
  const group = await repositories.groups.create("备份分组");
  await repositories.wordGroups.add(word.id, group.id);
  await learningService.submitFeedback(
    learningService.createSubmission({
      wordId: word.id,
      mode: "english-to-chinese",
      feedback: "fuzzy",
      feedbackAtMs: NOW,
    }),
  );
  return { word, group };
}

async function snapshotJson(): Promise<string> {
  return JSON.stringify(await repositories.backup.readSnapshot());
}

function backupFile(backup: VocabularyBackup, name = "backup.json") {
  return new File([JSON.stringify(backup)], name, {
    type: "application/json",
  });
}

describe("完整备份", () => {
  it("导出七个数据集合且不修改当前数据", async () => {
    await seedAllData();
    const before = await snapshotJson();

    const exported = await backupService.createExport(NOW);
    const parsed = parseBackupText(exported.json);

    expect(exported.fileName).toMatch(
      /^cet6-vocabulary-backup-\d{8}-\d{6}\.json$/,
    );
    expect(parsed.format).toBe(BACKUP_FORMAT_ID);
    expect(parsed.data.words).toHaveLength(1);
    expect(parsed.data.groups).toHaveLength(1);
    expect(parsed.data.wordGroups).toHaveLength(1);
    expect(parsed.data.reviewStates).toHaveLength(1);
    expect(parsed.data.learningHistory).toHaveLength(1);
    expect(parsed.data.dailyTasks).toHaveLength(1);
    expect(parsed.data.settings).toHaveLength(1);
    expect(await snapshotJson()).toBe(before);
  });

  it("读取带 UTF-8 BOM 的有效 JSON 备份", async () => {
    await seedAllData();
    const exported = await backupService.createExport(NOW);

    expect(
      parseBackupText(`\uFEFF${exported.json}`).data.words,
    ).toHaveLength(1);
  });

  it("可以导出空数据库，并完整覆盖恢复为空数据", async () => {
    const emptyBackup = await backupService.createBackup(NOW);
    await seedAllData();

    await backupService.restoreFile(backupFile(emptyBackup));

    const restored = await repositories.backup.readSnapshot();
    expect(restored).toEqual({
      words: [],
      groups: [],
      wordGroups: [],
      reviewStates: [],
      learningHistory: [],
      dailyTasks: [],
      settings: [],
    });
  });
});

describe("完整覆盖恢复", () => {
  it("恢复全部业务数据并保留特殊字符与关联", async () => {
    await seedAllData();
    const backup = await backupService.createBackup(NOW);

    await repositories.backup.replaceSnapshot({
      words: [],
      groups: [],
      wordGroups: [],
      reviewStates: [],
      learningHistory: [],
      dailyTasks: [],
      settings: [],
    });
    const summary = await backupService.restoreFile(backupFile(backup));
    const restored = await repositories.backup.readSnapshot();

    expect(summary.wordCount).toBe(1);
    expect(restored.words[0].chineseMeaning).toContain(
      "特殊字符 & < >",
    );
    expect(restored.wordGroups[0].wordId).toBe(restored.words[0].id);
    expect(restored.reviewStates[0].wordId).toBe(restored.words[0].id);
    expect(restored.learningHistory[0].wordId).toBe(restored.words[0].id);
    expect(restored.settings[0].dailyBaseGoal).toBe(20);
  });

  it("非法文件在写入前失败，现有数据保持不变", async () => {
    await seedAllData();
    const before = await snapshotJson();
    const replaceSpy = vi.spyOn(
      repositories.backup,
      "replaceSnapshot",
    );
    const file = new File(["{broken json"], "broken.json", {
      type: "application/json",
    });

    await expect(backupService.restoreFile(file)).rejects.toThrow(
      "不是有效的 JSON",
    );
    expect(replaceSpy).not.toHaveBeenCalled();
    expect(await snapshotJson()).toBe(before);
  });

  it("未来版本在写入前失败，现有数据保持不变", async () => {
    await seedAllData();
    const backup = await backupService.createBackup(NOW);
    backup.backupVersion = 2;
    const before = await snapshotJson();

    await expect(
      backupService.restoreFile(backupFile(backup)),
    ).rejects.toThrow("高于当前");
    expect(await snapshotJson()).toBe(before);
  });

  it("覆盖事务中途写入失败时回滚全部旧数据", async () => {
    await seedAllData();
    const before = await snapshotJson();
    const current = await repositories.backup.readSnapshot();
    const invalid: DatabaseSnapshot = {
      ...current,
      words: [
        ...current.words,
        {
          ...current.words[0],
          id: "duplicate-normalized-word",
        },
      ],
    };

    await expect(
      repositories.backup.replaceSnapshot(invalid),
    ).rejects.toThrow();
    expect(await snapshotJson()).toBe(before);
  });
});
