import { StatusNotice } from "@dodo/ui";
import Link from "next/link";

export default function NotFound() {
  return (
    <div className="page-shell page-shell--state">
      <StatusNotice
        action={<Link className="text-action" href="/">返回数据中心</Link>}
        detail="这个页面或记录不存在。检查地址中的 ID，或从百科列表重新进入。"
        title="没有找到记录"
        tone="warning"
      />
    </div>
  );
}
