import { normalizeGroupName } from "../normalization";
import {
  DataConflictError,
  DataNotFoundError,
} from "../errors";
import { MAX_GROUP_NAME_LENGTH } from "../constants";
import { runTransaction, type AppDatabase } from "../database";
import type { RepositoryOptions } from "../repositoryOptions";
import { resolveRepositoryOptions } from "../repositoryOptions";
import type { Group } from "../types";
import {
  assertMaximumTextLength,
  requireNonEmptyText,
} from "../validation";

function validateGroupName(name: string): string {
  const normalizedName = normalizeGroupName(name);
  requireNonEmptyText(normalizedName, "分组名称");
  assertMaximumTextLength(
    normalizedName,
    MAX_GROUP_NAME_LENGTH,
    "分组名称",
  );
  return normalizedName;
}

export class GroupRepository {
  private readonly database: AppDatabase;
  private readonly now: () => number;
  private readonly createId: () => string;

  constructor(
    database: AppDatabase,
    options: RepositoryOptions = {},
  ) {
    this.database = database;
    const resolved = resolveRepositoryOptions(options);
    this.now = resolved.now;
    this.createId = resolved.createId;
  }

  async create(name: string): Promise<Group> {
    const normalizedName = validateGroupName(name);

    return runTransaction(
      this.database,
      ["groups"],
      "readwrite",
      async (transaction) => {
        const groups = transaction.objectStore("groups");
        const existing = await groups.index("byName").get(normalizedName);

        if (existing) {
          throw new DataConflictError("分组名称已经存在。");
        }

        const timestamp = this.now();
        const group: Group = {
          id: this.createId(),
          name: normalizedName,
          createdAtMs: timestamp,
          updatedAtMs: timestamp,
        };

        await groups.add(group);
        return group;
      },
    );
  }

  async getById(id: string): Promise<Group | null> {
    return (await this.database.get("groups", id)) ?? null;
  }

  async getByName(name: string): Promise<Group | null> {
    return (
      (await this.database.getFromIndex(
        "groups",
        "byName",
        normalizeGroupName(name),
      )) ?? null
    );
  }

  async list(): Promise<Group[]> {
    const groups = await this.database.getAll("groups");
    return groups.sort(
      (left, right) =>
        left.createdAtMs - right.createdAtMs ||
        left.id.localeCompare(right.id),
    );
  }

  async update(id: string, name: string): Promise<Group> {
    const normalizedName = validateGroupName(name);

    return runTransaction(
      this.database,
      ["groups"],
      "readwrite",
      async (transaction) => {
        const groups = transaction.objectStore("groups");
        const current = await groups.get(id);

        if (!current) {
          throw new DataNotFoundError("没有找到要修改的分组。");
        }

        const conflicting = await groups.index("byName").get(normalizedName);
        if (conflicting && conflicting.id !== id) {
          throw new DataConflictError("修改后的分组名称已经存在。");
        }

        const updated: Group = {
          ...current,
          name: normalizedName,
          updatedAtMs: this.now(),
        };

        await groups.put(updated);
        return updated;
      },
    );
  }

  async delete(id: string): Promise<void> {
    return runTransaction(
      this.database,
      ["groups", "wordGroups"],
      "readwrite",
      async (transaction) => {
        const groups = transaction.objectStore("groups");
        const existing = await groups.get(id);

        if (!existing) {
          throw new DataNotFoundError("没有找到要删除的分组。");
        }

        const associations = transaction.objectStore("wordGroups");
        const associationKeys = await associations
          .index("byGroupId")
          .getAllKeys(id);
        await Promise.all(
          associationKeys.map((key) => associations.delete(key)),
        );
        await groups.delete(id);
      },
    );
  }
}

