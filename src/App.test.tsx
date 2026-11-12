import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";

import { AppRoutes } from "./App";

const pages = [
  { path: "/", heading: "今天的学习" },
  { path: "/learn", heading: "单词学习" },
  { path: "/weak", heading: "薄弱词强化" },
  { path: "/inspect", heading: "单词检验" },
  { path: "/words", heading: "单词库" },
  { path: "/groups", heading: "自定义分组" },
  { path: "/stats", heading: "学习统计" },
  { path: "/settings", heading: "设置与数据" },
];

describe("应用页面骨架", () => {
  it.each(pages)("可以打开 $path", ({ path, heading }) => {
    render(
      <MemoryRouter initialEntries={[path]}>
        <AppRoutes />
      </MemoryRouter>,
    );

    expect(
      screen.getByRole("heading", { level: 1, name: heading }),
    ).toBeInTheDocument();
  });

  it("提供八个主要导航入口", () => {
    render(
      <MemoryRouter initialEntries={["/"]}>
        <AppRoutes />
      </MemoryRouter>,
    );

    const navigation = screen.getByRole("navigation", { name: "主要导航" });

    expect(navigation).toBeInTheDocument();
    expect(within(navigation).getAllByRole("link")).toHaveLength(8);
  });

  it("未知地址显示明确的空页面", () => {
    render(
      <MemoryRouter initialEntries={["/not-found"]}>
        <AppRoutes />
      </MemoryRouter>,
    );

    expect(
      screen.getByRole("heading", { level: 1, name: "页面不存在" }),
    ).toBeInTheDocument();
  });
});
