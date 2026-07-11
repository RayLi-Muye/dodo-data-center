import type { DataStatus, OperationMeta } from "@dodo/contracts";
import { MetaLine } from "@dodo/ui";

import { formatUtc } from "../lib/format";

export function DataStatusPanel({ data, meta }: { data: DataStatus; meta: OperationMeta }) {
  return (
    <div className="data-status-panel">
      <div className="data-status-panel__summary">
        <span className={`service-state service-state--${data.status}`}><i aria-hidden="true" />{data.status === "ready" ? "数据链路就绪" : data.status === "degraded" ? "部分链路降级" : "数据链路离线"}</span>
        <p>最新比赛水位 <strong>{data.latestMatchAt ? formatUtc(data.latestMatchAt) : "尚无水位"}</strong></p>
      </div>
      <ul className="provider-list">
        {data.providers.map((provider) => (
          <li key={provider.source}>
            <span className={`provider-dot provider-dot--${provider.status}`} aria-hidden="true" />
            <strong>{provider.source}</strong>
            <span>{provider.message ?? "运行正常"}</span>
            <time dateTime={provider.checkedAt}>{formatUtc(provider.checkedAt)}</time>
          </li>
        ))}
      </ul>
      <MetaLine sources={meta.sources} updatedAt={meta.updatedAt} />
    </div>
  );
}
