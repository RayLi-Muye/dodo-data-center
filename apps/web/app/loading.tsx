export default function Loading() {
  return (
    <div className="page-shell" aria-busy="true" aria-label="正在读取 Dota 数据">
      <div className="skeleton skeleton--title" />
      <div className="skeleton-grid">
        <div className="skeleton skeleton--wide" />
        <div className="skeleton" />
        <div className="skeleton" />
      </div>
      <span className="sr-only">正在读取公开比赛与百科资料…</span>
    </div>
  );
}
