import type { Group, Word } from "../../data";

export interface WordInspectionDataPort {
  listWords: () => Promise<Word[]>;
  listGroups: () => Promise<Group[]>;
  listGroupWords: (groupId: string) => Promise<Word[]>;
}

export type InspectionSort = "alphabetical-asc" | "alphabetical-desc" | "created-desc";

export interface InspectionSnapshot {
  groups: Group[];
  words: Word[];
}

export function filterAndSortInspectionWords(
  words: readonly Word[],
  query: string,
  sort: InspectionSort,
): Word[] {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const filtered = normalizedQuery
    ? words.filter(
        (word) =>
          word.displayWord.toLocaleLowerCase().includes(normalizedQuery) ||
          word.chineseMeaning.toLocaleLowerCase().includes(normalizedQuery),
      )
    : [...words];

  return filtered.sort((left, right) => {
    if (sort === "created-desc") {
      return (
        right.createdAtMs - left.createdAtMs ||
        left.displayWord.localeCompare(right.displayWord)
      );
    }
    const alphabetical = left.displayWord.localeCompare(
      right.displayWord,
      "en",
    );
    return sort === "alphabetical-asc"
      ? alphabetical || left.id.localeCompare(right.id)
      : -alphabetical || left.id.localeCompare(right.id);
  });
}

export class WordInspectionService {
  private readonly data: WordInspectionDataPort;

  constructor(data: WordInspectionDataPort) {
    this.data = data;
  }

  async load(
    groupId: string | null,
  ): Promise<InspectionSnapshot> {
    const [groups, words] = await Promise.all([
      this.data.listGroups(),
      groupId === null
        ? this.data.listWords()
        : this.data.listGroupWords(groupId),
    ]);

    return { groups, words };
  }
}

