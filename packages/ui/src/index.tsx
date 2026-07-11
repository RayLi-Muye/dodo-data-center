import type { ReactNode } from "react";

type SectionProps = {
  children: ReactNode;
  className?: string;
  eyebrow?: string;
  title: string;
  trailing?: ReactNode;
};

export function DataSection({ children, className = "", eyebrow, title, trailing }: SectionProps) {
  return (
    <section className={`dodo-section ${className}`.trim()}>
      <header className="dodo-section__header">
        <div>
          {eyebrow ? <p className="dodo-eyebrow">{eyebrow}</p> : null}
          <h2>{title}</h2>
        </div>
        {trailing ? <div className="dodo-section__trailing">{trailing}</div> : null}
      </header>
      {children}
    </section>
  );
}

type StatusTone = "neutral" | "positive" | "warning" | "danger";

export function StatusNotice({
  action,
  detail,
  title,
  tone = "neutral",
}: {
  action?: ReactNode;
  detail: ReactNode;
  title: string;
  tone?: StatusTone;
}) {
  return (
    <section className={`dodo-status dodo-status--${tone}`} role={tone === "danger" ? "alert" : "status"}>
      <span className="dodo-status__signal" aria-hidden="true" />
      <div className="dodo-status__body">
        <h2>{title}</h2>
        <div>{detail}</div>
      </div>
      {action ? <div className="dodo-status__action">{action}</div> : null}
    </section>
  );
}

export function OutcomeBadge({ win }: { win: boolean }) {
  return (
    <span className={`dodo-outcome dodo-outcome--${win ? "win" : "loss"}`}>
      <span aria-hidden="true">{win ? "↑" : "↓"}</span>
      {win ? "胜利" : "失利"}
    </span>
  );
}

export function MetaLine({
  coverageRate,
  sampleSize,
  sources,
  updatedAt,
}: {
  coverageRate?: number;
  sampleSize?: number;
  sources: string[];
  updatedAt: string;
}) {
  return (
    <dl className="dodo-meta-line">
      {typeof sampleSize === "number" ? (
        <div>
          <dt>样本</dt>
          <dd>{sampleSize.toLocaleString("zh-CN")}</dd>
        </div>
      ) : null}
      {typeof coverageRate === "number" ? (
        <div>
          <dt>覆盖</dt>
          <dd>{Math.round(coverageRate * 100)}%</dd>
        </div>
      ) : null}
      <div>
        <dt>来源</dt>
        <dd>{sources.join(" · ")}</dd>
      </div>
      <div>
        <dt>更新</dt>
        <dd>{new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium", timeZone: "UTC" }).format(new Date(updatedAt))}</dd>
      </div>
    </dl>
  );
}
