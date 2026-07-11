import { StatusNotice } from "@dodo/ui";
import Link from "next/link";

import { DodoApiError } from "../lib/api";

type StatePresentation = {
  detail: string;
  retryable: boolean;
  title: string;
  tone: "neutral" | "warning" | "danger";
};

function presentationFor(error: unknown): StatePresentation {
  if (!(error instanceof DodoApiError)) {
    return { detail: "页面发生未预期错误。返回首页重新进入；若问题持续，请检查数据服务日志。", retryable: false, title: "页面读取失败", tone: "danger" };
  }
  const code = error.payload?.error.code;
  switch (code) {
    case "HISTORY_PRIVATE":
      return { detail: "该玩家关闭了公开比赛历史。Dodo 不会绕过隐私设置；可在 Dota 客户端开放公开比赛数据后再查询。", retryable: false, title: "比赛历史未公开", tone: "warning" };
    case "PROFILE_PRIVATE":
      return { detail: "该 Steam 资料目前不可见，因此无法建立账号概览。你仍可查询英雄、物品与地图百科。", retryable: false, title: "玩家资料未公开", tone: "warning" };
    case "SOURCE_RATE_LIMITED":
      return { detail: "上游数据源已触发限流。本次不是空数据，请等待片刻后重新读取此资源。", retryable: true, title: "数据源正在限流", tone: "warning" };
    case "SOURCE_UNAVAILABLE":
      return { detail: "上游数据源暂时不可用。已有数据不会被当作完整结果展示，请稍后重新读取此资源。", retryable: true, title: "数据源暂时离线", tone: "danger" };
    case "SYNC_IN_PROGRESS":
      return { detail: "账号数据正在同步。同步完成前不会用空列表代替真实结果。", retryable: true, title: "正在同步公开比赛", tone: "neutral" };
    case "PARSE_PENDING":
      return { detail: "候选比赛仍在等待解析，暂时不足以生成可信统计。稍后可重新读取此资源。", retryable: true, title: "比赛等待解析", tone: "neutral" };
    case "NOT_FOUND":
      return { detail: "没有找到对应记录。请检查 ID，或返回首页查询另一个公开账号。", retryable: false, title: "记录不存在", tone: "warning" };
    case "INVALID_ACCOUNT_ID":
    case "UNSUPPORTED_ACCOUNT_REFERENCE":
    case "VALIDATION_ERROR":
      return { detail: "输入未通过账号服务校验。请从首页选择正确账号类型后重新查询。", retryable: false, title: "账号格式不受支持", tone: "warning" };
    case "INTERNAL_ERROR":
    default:
      return { detail: error.message || "数据响应无法读取，请确认 API 服务已经启动后重新读取此资源。", retryable: true, title: error.kind === "unavailable" ? "无法连接数据服务" : "数据读取失败", tone: "danger" };
  }
}

export function DataState({ error, retryHref }: { error: unknown; retryHref?: string }) {
  const state = presentationFor(error);
  const syncing = error instanceof DodoApiError && error.payload?.error.code === "SYNC_IN_PROGRESS";
  const retryResource = state.retryable && retryHref;
  return (
    <StatusNotice
      action={<Link className="text-action" href={retryResource || "/"}>{retryResource ? (syncing ? "刷新同步状态" : "重新读取此资源") : "返回首页"}</Link>}
      detail={state.detail}
      title={state.title}
      tone={state.tone}
    />
  );
}

export function EmptyState({ detail, title }: { detail: string; title: string }) {
  return (
    <div className="empty-state">
      <span aria-hidden="true">∅</span>
      <div>
        <h3>{title}</h3>
        <p>{detail}</p>
      </div>
    </div>
  );
}
