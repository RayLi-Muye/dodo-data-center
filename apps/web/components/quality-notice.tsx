export function QualityNotice({
  label,
  quality,
}: {
  label: string;
  quality: "complete" | "partial" | "stale";
}) {
  if (quality === "complete") return null;
  return (
    <div className={`module-quality module-quality--${quality}`} role="status">
      <span aria-hidden="true">{quality === "partial" ? "△" : "◷"}</span>
      <p>
        <strong>{label}{quality === "partial" ? "仅包含部分数据" : "数据可能已过期"}</strong>
        <span>{quality === "partial" ? "按实际样本展示，不将缺失记录视为零。" : "保留当前结果，同时显示其更新时间。"}</span>
      </p>
    </div>
  );
}
