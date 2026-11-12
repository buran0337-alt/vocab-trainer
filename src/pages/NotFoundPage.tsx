import { Link } from "react-router-dom";

import { EmptyState } from "../components/EmptyState";
import { PageHeader } from "../components/PageHeader";

export function NotFoundPage() {
  return (
    <>
      <PageHeader
        eyebrow="404"
        title="页面不存在"
        description="这个地址没有对应的页面。"
      />
      <EmptyState
        title="返回今日页面"
        description="使用下面的链接回到应用首页。"
        action={
          <Link className="primary-link" to="/">
            返回首页
          </Link>
        }
      />
    </>
  );
}
