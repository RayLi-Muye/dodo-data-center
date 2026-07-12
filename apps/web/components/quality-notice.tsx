export function QualityNotice({
  label,
  quality,
  showComplete = false,
}: {
  label: string;
  quality: "complete" | "partial" | "stale";
  showComplete?: boolean;
}) {
  if (quality === "complete" && !showComplete) return null;
  const title = quality === "complete"
    ? `${label}数据完整`
    : `${label}${quality === "partial" ? "仅包含部分数据" : "数据可能已过期"}`;
  const detail = quality === "complete"
    ? "本次接口操作返回 complete；来源与更新时间以页面标注为准。"
    : quality === "partial"
      ? "按实际样本展示，不将缺失记录视为零。"
      : "保留当前结果，同时显示接口返回的更新时间。";
  return (
    <div className={`module-quality module-quality--${quality}`} role="status">
      <span aria-hidden="true">{quality === "complete" ? "✓" : quality === "partial" ? "△" : "◷"}</span>
      <p>
        <strong>{title}</strong>
        <span>{detail}</span>
      </p>
    </div>
  );
}
