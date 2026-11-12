import { NavLink, Outlet } from "react-router-dom";

const navigationItems = [
  { to: "/", label: "今日", end: true },
  { to: "/learn", label: "学习" },
  { to: "/weak", label: "薄弱" },
  { to: "/inspect", label: "检验" },
  { to: "/words", label: "单词库" },
  { to: "/groups", label: "分组" },
  { to: "/stats", label: "统计" },
  { to: "/settings", label: "设置" },
];

export function AppLayout() {
  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">
        跳到主要内容
      </a>

      <header className="site-header">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">
            C6
          </span>
          <div>
            <p className="brand-title">CET-6 Vocabulary Trainer</p>
            <p className="brand-subtitle">个人词汇记忆工作台</p>
          </div>
        </div>

        <nav className="main-nav" aria-label="主要导航">
          {navigationItems.map((item) => (
            <NavLink
              className={({ isActive }) =>
                isActive ? "nav-link nav-link-active" : "nav-link"
              }
              end={item.end}
              key={item.to}
              to={item.to}
            >
              {item.label}
            </NavLink>
          ))}
        </nav>
      </header>

      <main className="main-content" id="main-content">
        <Outlet />
      </main>

      <footer className="site-footer">
        <p>数据将保存在当前浏览器的 IndexedDB 中。</p>
        <p>阶段 12：功能与质量验收已完成，等待最终确认。</p>
      </footer>
    </div>
  );
}
