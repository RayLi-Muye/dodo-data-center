import type { MatchDetail } from "@dodo/contracts";

import {
  stratzEnrichmentPresentation,
  stratzEnrichmentReasonLabel,
} from "../lib/match-detail";
import { formatUtc } from "../lib/format";

const qualityLabel = (quality: MatchDetail["stratzEnrichment"]["resultQuality"]): string =>
  quality === "complete" ? "完整响应" : quality === "partial" ? "部分响应" : "无结果";

const attemptTimeLabel = (timestamp: string | null, empty: string): string =>
  timestamp === null ? empty : `UTC ${formatUtc(timestamp)}`;

export function MatchEnrichmentStatus({ match }: { match: MatchDetail }) {
  const state = match.stratzEnrichment;
  const presentation = stratzEnrichmentPresentation(state);
  const stratzWasWritten = match.enrichmentSources.includes("stratz");

  return (
    <section
      aria-labelledby="match-enrichment-title"
      className={`match-enrichment-status match-enrichment-status--${presentation.tone}`}
    >
      <header>
        <span aria-hidden="true" className="match-enrichment-status__signal" />
        <div>
          <small>MATCH ENRICHMENT</small>
          <h2 id="match-enrichment-title">{presentation.title}</h2>
          <p>{presentation.detail}</p>
        </div>
      </header>
      <dl>
        <div><dt>尝试次数</dt><dd>{state.attemptCount}</dd></div>
        <div><dt>上次尝试</dt><dd>{attemptTimeLabel(state.lastAttemptAt, "尚无")}</dd></div>
        <div><dt>下次尝试</dt><dd>{attemptTimeLabel(state.nextAttemptAt, "未安排")}</dd></div>
        <div><dt>结果质量</dt><dd>{qualityLabel(state.resultQuality)}</dd></div>
        <div><dt>原因</dt><dd>{stratzEnrichmentReasonLabel(state.reasonCode)}</dd></div>
        <div><dt>已写入来源</dt><dd>{stratzWasWritten ? "STRATZ" : "无 STRATZ 写入"}</dd></div>
      </dl>
      <p className="match-enrichment-status__note">
        “已写入来源”只表示字段已成功持久化，不代表增强流程完整，也不代表拥有完整回放数据。
      </p>
    </section>
  );
}
