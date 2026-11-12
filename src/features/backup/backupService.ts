import {
  BACKUP_FORMAT_VERSION,
  DATABASE_VERSION,
  DataValidationError,
  type DatabaseSnapshot,
  type Repositories,
} from "../../data";
import {
  BACKUP_FORMAT_ID,
  MAX_BACKUP_FILE_BYTES,
  summarizeBackup,
  validateBackupDocument,
  type BackupSummary,
  type VocabularyBackup,
} from "./backupFormat";

export interface BackupExport {
  backup: VocabularyBackup;
  fileName: string;
  json: string;
}

export interface BackupSelection {
  file: File;
  backup: VocabularyBackup;
  summary: BackupSummary;
}

function backupFileTimestamp(epochMilliseconds: number): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(epochMilliseconds));
  const part = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((item) => item.type === type)?.value ?? "";
  return (
    `${part("year")}${part("month")}${part("day")}` +
    `-${part("hour")}${part("minute")}${part("second")}`
  );
}

export function assertBackupFileSize(size: number): void {
  if (!Number.isSafeInteger(size) || size < 0) {
    throw new DataValidationError("无法读取备份文件大小。");
  }
  if (size === 0) {
    throw new DataValidationError("备份文件为空。");
  }
  if (size > MAX_BACKUP_FILE_BYTES) {
    throw new DataValidationError(
      `备份文件不能超过 ${MAX_BACKUP_FILE_BYTES / 1024 / 1024} MB。`,
    );
  }
}

export function parseBackupText(text: string): VocabularyBackup {
  const jsonText = text.replace(/^\uFEFF/, "");
  if (jsonText.trim().length === 0) {
    throw new DataValidationError("备份文件为空。");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    throw new DataValidationError("备份文件不是有效的 JSON。");
  }
  return validateBackupDocument(parsed);
}

export class BackupService {
  private readonly repositories: Repositories;

  constructor(repositories: Repositories) {
    this.repositories = repositories;
  }

  async createBackup(
    exportedAtMs = Date.now(),
  ): Promise<VocabularyBackup> {
    const data: DatabaseSnapshot =
      await this.repositories.backup.readSnapshot();
    const candidate = {
      format: BACKUP_FORMAT_ID,
      backupVersion: BACKUP_FORMAT_VERSION,
      databaseVersion: DATABASE_VERSION,
      exportedAtMs,
      data,
    };
    return validateBackupDocument(candidate);
  }

  async createExport(
    exportedAtMs = Date.now(),
  ): Promise<BackupExport> {
    const backup = await this.createBackup(exportedAtMs);
    return {
      backup,
      fileName:
        `cet6-vocabulary-backup-${backupFileTimestamp(exportedAtMs)}` +
        ".json",
      json: `${JSON.stringify(backup, null, 2)}\n`,
    };
  }

  async inspectFile(file: File): Promise<BackupSelection> {
    assertBackupFileSize(file.size);
    let text: string;
    try {
      text = await file.text();
    } catch {
      throw new DataValidationError("无法读取备份文件内容。");
    }
    const backup = parseBackupText(text);
    return {
      file,
      backup,
      summary: summarizeBackup(backup),
    };
  }

  async restoreFile(file: File): Promise<BackupSummary> {
    const selection = await this.inspectFile(file);
    await this.repositories.backup.replaceSnapshot(
      selection.backup.data,
    );
    return selection.summary;
  }
}
