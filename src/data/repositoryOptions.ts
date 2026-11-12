export interface RepositoryOptions {
  now?: () => number;
  createId?: () => string;
}

export interface ResolvedRepositoryOptions {
  now: () => number;
  createId: () => string;
}

function defaultCreateId(): string {
  if (
    typeof globalThis.crypto === "undefined" ||
    typeof globalThis.crypto.randomUUID !== "function"
  ) {
    throw new Error("当前浏览器不支持安全随机 ID 生成。");
  }

  return globalThis.crypto.randomUUID();
}

export function resolveRepositoryOptions(
  options: RepositoryOptions = {},
): ResolvedRepositoryOptions {
  return {
    now: options.now ?? Date.now,
    createId: options.createId ?? defaultCreateId,
  };
}

