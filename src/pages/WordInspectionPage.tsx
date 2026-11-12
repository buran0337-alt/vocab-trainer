import {
  useEffect,
  useMemo,
  useState,
} from "react";

import { DataValidationError, type Word } from "../data";
import { getRepositories } from "../data/client";
import { EmptyState } from "../components/EmptyState";
import { PageHeader } from "../components/PageHeader";
import {
  filterAndSortInspectionWords,
  WordInspectionService,
  type InspectionSnapshot,
  type InspectionSort,
} from "../features/inspection/wordInspectionService";

interface WordInspectionPageProps {
  service?: WordInspectionService;
}

function errorMessage(error: unknown): string {
  if (error instanceof DataValidationError || error instanceof Error) {
    return error.message;
  }
  return "读取单词检验数据失败。";
}

export function WordInspectionPage({
  service: providedService,
}: WordInspectionPageProps) {
  const [openedService, setOpenedService] =
    useState<WordInspectionService | null>(null);
  const service = providedService ?? openedService;
  const [snapshot, setSnapshot] = useState<InspectionSnapshot | null>(null);
  const [range, setRange] = useState("all");
  const [query, setQuery] = useState("");
  const [sort, setSort] =
    useState<InspectionSort>("alphabetical-asc");
  const [expandedIds, setExpandedIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    if (providedService) return;
    let active = true;
    getRepositories()
      .then((repositories) => {
        if (active) {
          setOpenedService(
            new WordInspectionService({
              listWords: () => repositories.words.list(),
              listGroups: () => repositories.groups.list(),
              listGroupWords: (groupId) =>
                repositories.wordGroups.getWordsForGroup(groupId),
            }),
          );
        }
      })
      .catch((loadError: unknown) => {
        if (active) {
          setError(errorMessage(loadError));
          setIsLoading(false);
        }
      });
    return () => {
      active = false;
    };
  }, [providedService]);

  useEffect(() => {
    if (!service) return;
    let active = true;
    service
      .load(range === "all" ? null : range)
      .then((nextSnapshot) => {
        if (active) {
          setSnapshot(nextSnapshot);
          setIsLoading(false);
        }
      })
      .catch((loadError: unknown) => {
        if (active) {
          setError(errorMessage(loadError));
          setIsLoading(false);
        }
      });
    return () => {
      active = false;
    };
  }, [range, reloadToken, service]);

  const visibleWords = useMemo(
    () =>
      snapshot
        ? filterAndSortInspectionWords(snapshot.words, query, sort)
        : [],
    [query, snapshot, sort],
  );

  const toggleWord = (word: Word) => {
    setExpandedIds((current) => {
      const next = new Set(current);
      if (next.has(word.id)) next.delete(word.id);
      else next.add(word.id);
      return next;
    });
  };

  return (
    <>
      <PageHeader
        eyebrow="独立浏览"
        title="单词检验"
        description="只看单词、检验自己是否认识，再展开中文释义。这里不会记录学习结果，也不会改变复习进度。"
      />

      <section className="inspection-toolbar" aria-label="单词检验筛选">
        <label>
          <span>浏览范围</span>
          <select
            onChange={(event) => {
              setIsLoading(true);
              setError(null);
              setRange(event.target.value);
              setExpandedIds(new Set());
            }}
            value={range}
          >
            <option value="all">全部词库</option>
            {snapshot?.groups.map((group) => (
              <option key={group.id} value={group.id}>
                {group.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>搜索</span>
          <input
            onChange={(event) => setQuery(event.target.value)}
            placeholder="英文或中文释义"
            type="search"
            value={query}
          />
        </label>
        <label>
          <span>排序</span>
          <select
            onChange={(event) =>
              setSort(event.target.value as InspectionSort)
            }
            value={sort}
          >
            <option value="alphabetical-asc">英文 A → Z</option>
            <option value="alphabetical-desc">英文 Z → A</option>
            <option value="created-desc">最近添加</option>
          </select>
        </label>
      </section>

      <p className="inspection-summary" role="status">
        当前显示 {visibleWords.length} 个单词
      </p>

      {error ? (
        <section className="notice-card">
          <h2>无法加载检验词汇</h2>
          <p>{error}</p>
          <button
            className="primary-button"
            onClick={() => {
              setIsLoading(true);
              setError(null);
              setReloadToken((current) => current + 1);
            }}
            type="button"
          >
            重新加载
          </button>
        </section>
      ) : null}

      {isLoading && !error ? (
        <p className="loading-state" role="status">
          正在读取检验词汇…
        </p>
      ) : null}

      {!isLoading && !error && snapshot?.words.length === 0 ? (
        <EmptyState
          title="当前范围没有单词"
          description={
            range === "all"
              ? "词库为空。请先手动添加或导入单词。"
              : "这个分组还没有成员，可以在分组页面添加。"
          }
        />
      ) : null}

      {!isLoading &&
      !error &&
      snapshot &&
      snapshot.words.length > 0 &&
      visibleWords.length === 0 ? (
        <EmptyState
          title="没有匹配的单词"
          description="可以清空搜索条件或更换浏览范围。"
        />
      ) : null}

      {!isLoading && !error && visibleWords.length > 0 ? (
        <section
          className="group-vocabulary-list inspection-word-list"
          aria-label="单词检验列表"
        >
          {visibleWords.map((word) => {
            const expanded = expandedIds.has(word.id);
            return (
              <article className="group-vocabulary-card" key={word.id}>
                <button
                  aria-expanded={expanded}
                  className="vocabulary-toggle inspection-toggle"
                  onClick={() => toggleWord(word)}
                  type="button"
                >
                  <span className="vocabulary-word">{word.displayWord}</span>
                  <span className="expand-indicator" aria-hidden="true">
                    {expanded ? "收起 ▲" : "查看中文 ▼"}
                  </span>
                </button>
                {expanded ? (
                  <div className="vocabulary-details">
                    <p className="vocabulary-meaning">
                      {word.chineseMeaning}
                    </p>
                  </div>
                ) : null}
              </article>
            );
          })}
        </section>
      ) : null}
    </>
  );
}

