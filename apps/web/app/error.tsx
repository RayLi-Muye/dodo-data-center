"use client";

import { StatusNotice } from "@dodo/ui";

export default function ErrorPage({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="page-shell page-shell--state">
      <StatusNotice
        action={<button className="text-action" onClick={reset} type="button">重新读取页面</button>}
        detail="页面渲染发生异常，已导入数据不会因此被清空。可重新读取，或返回首页查询其他内容。"
        title="页面渲染失败"
        tone="danger"
      />
    </div>
  );
}
