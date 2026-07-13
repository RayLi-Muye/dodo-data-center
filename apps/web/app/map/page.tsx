import { mapFeatureTypeSchema, type MapFeature } from "@dodo/contracts";
import { DataSection, MetaLine } from "@dodo/ui";
import Link from "next/link";

import { DataState, EmptyState } from "../../components/data-state";
import { PageHeading } from "../../components/page-heading";
import { api, settle } from "../../lib/api";
import { parseGeometry, svgPoints, svgPolygonPath } from "../../lib/geometry";

const featureLabels = {
  lane: "兵线",
  tower: "防御塔",
  tormentor: "痛苦魔方",
  twin_gate: "双生之门",
  watcher: "观测者",
  wisdom_rune: "智慧神符",
  outpost: "前哨",
  shop: "商店",
  roshan: "肉山巢穴",
  rune: "神符点",
  lotus_pool: "莲花池",
  neutral_camp: "野怪营地",
  landmark: "地标",
} as const satisfies Record<MapFeature["type"], string>;

const featureTypes = [
  "lane",
  "tower",
  "tormentor",
  "twin_gate",
  "watcher",
  "wisdom_rune",
  "outpost",
  "shop",
  "roshan",
  "rune",
  "lotus_pool",
  "neutral_camp",
  "landmark",
] as const satisfies readonly MapFeature["type"][];

const formatVerifiedAt = (value: string): string => new Intl.DateTimeFormat("zh-CN", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "UTC",
}).format(new Date(value));

const sourceLinkLabel = (url: string, index: number): string => {
  const source = new URL(url);
  return `来源 ${String(index + 1).padStart(2, "0")} · ${source.hostname}`;
};

function MapGeometry({ features, maxY, minY }: { features: MapFeature[]; maxY: number; minY: number }) {
  const invertY = maxY + minY;
  return (
    <g transform={`translate(0 ${invertY}) scale(1 -1)`}>
      {features.map((feature) => {
        const geometry = parseGeometry(feature.geometry);
        if (geometry.kind === "point") {
          return (
            <g className={`map-feature map-feature--${feature.type}`} key={feature.id}>
              <title>{feature.localizedName}</title>
              <circle cx={geometry.point[0]} cy={geometry.point[1]} r="2.2" />
              <circle className="map-feature__core" cx={geometry.point[0]} cy={geometry.point[1]} r="0.8" />
            </g>
          );
        }
        if (geometry.kind === "line") {
          return <polyline className={`map-feature map-feature--${feature.type}`} key={feature.id} points={svgPoints(geometry.points)}><title>{feature.localizedName}</title></polyline>;
        }
        return <path className={`map-feature map-feature--${feature.type}`} d={svgPolygonPath(geometry.rings)} fillRule="evenodd" key={feature.id}><title>{feature.localizedName}</title></path>;
      })}
    </g>
  );
}

export default async function MapPage({ searchParams }: { searchParams: Promise<{ type?: string }> }) {
  const query = await searchParams;
  const parsedType = mapFeatureTypeSchema.safeParse(query.type);
  const activeType = parsedType.success ? parsedType.data : undefined;
  const result = await settle(api.map());
  if (!result.ok) {
    return <div className="page-shell"><PageHeading eyebrow="ENCYCLOPEDIA / MAP" lead="版本化静态地点与地图结构。" title="当前地图" /><DataState error={result.error} retryHref="/map" /></div>;
  }
  const map = result.value;
  const features = activeType ? map.data.features.filter((feature) => feature.type === activeType) : map.data.features;
  const activeExclusion = activeType
    ? map.data.coverage.exclusions.find((exclusion) => exclusion.type === activeType)
    : undefined;
  const width = map.data.bounds.maxX - map.data.bounds.minX;
  const height = map.data.bounds.maxY - map.data.bounds.minY;

  return (
    <div className="page-shell map-page">
      <PageHeading
        eyebrow={`MAP / ${map.data.id}`}
        lead="按已审计的 Source 2 世界坐标绘制静态地点；不显示或复制官方地图贴图，也不提供地形、路线、实时位置或热图。"
        title={`当前地图 · ${map.data.patch}`}
      />
      <nav className="map-filter" aria-label="地图地点类型">
        <Link aria-current={!activeType ? "page" : undefined} href="/map">全部地点</Link>
        {featureTypes.map((type) => <Link aria-current={activeType === type ? "page" : undefined} href={`/map?type=${type}`} key={type}>{featureLabels[type]}</Link>)}
      </nav>

      <div className="map-layout">
        <DataSection className="map-layout__canvas" eyebrow={map.data.coordinateSystem} title="结构化地图示意">
          <div className="map-frame">
            <svg
              aria-label={`${map.data.patch} 地图，显示 ${features.length} 个地点要素`}
              preserveAspectRatio="xMidYMid meet"
              role="img"
              viewBox={`${map.data.bounds.minX} ${map.data.bounds.minY} ${width} ${height}`}
            >
              <rect className="map-coordinate-field" height={height} width={width} x={map.data.bounds.minX} y={map.data.bounds.minY} />
              <MapGeometry features={features} maxY={map.data.bounds.maxY} minY={map.data.bounds.minY} />
            </svg>
            <span className="map-corner map-corner--radiant">RADIANT</span>
            <span className="map-corner map-corner--dire">DIRE</span>
            <span className="map-frame__scope">坐标底板 · 无地形贴图</span>
          </div>
        </DataSection>

        <DataSection className="map-layout__legend" eyebrow="FEATURE INDEX" title={activeType ? featureLabels[activeType] : "地点图例"}>
          {features.length === 0 ? (
            <EmptyState
              detail={activeExclusion
                ? `当前快照明确排除${featureLabels[activeExclusion.type]}：${activeExclusion.reason}`
                : "当前地图快照没有这一类地点。切换到全部地点继续查看。"}
              title={activeExclusion ? "此类型未纳入快照" : "没有地点要素"}
            />
          ) : (
            <ol className="map-feature-list">
              {features.map((feature, index) => (
                <li key={feature.id}>
                  <span className={`map-feature-list__marker map-feature-list__marker--${feature.type}`} aria-hidden="true" />
                  <div>
                    <small>{String(index + 1).padStart(2, "0")} / {featureLabels[feature.type]}</small>
                    <strong>{feature.localizedName}</strong>
                    <p>{feature.description || "当前快照没有地点说明。"}</p>
                    {feature.type === "roshan" ? <p className="map-feature-list__scope">该坐标表示 pit / spawner（巢穴或生成点），不是肉山的实时位置。</p> : null}
                  </div>
                </li>
              ))}
            </ol>
          )}
          <div className="map-legend-notice">示意图只呈现 API 返回的结构化 geometry，不补画未经来源验证的地点、地形或通行路线。</div>
        </DataSection>
      </div>

      <div className="map-evidence-grid">
        <DataSection
          className="map-coverage"
          eyebrow="COVERAGE"
          title={map.data.quality === "complete" ? "完整快照范围" : "部分快照范围"}
          trailing={<span className={`map-quality map-quality--${map.data.quality}`}>{map.data.quality === "complete" ? "✓ COMPLETE" : "△ PARTIAL"}</span>}
        >
          <div className="map-coverage__body">
            <div>
              <h3>已纳入类型</h3>
              <ul className="map-coverage__types">
                {map.data.coverage.includedTypes.map((type) => <li key={type}>{featureLabels[type]}</li>)}
              </ul>
            </div>
            <div>
              <h3>明确排除</h3>
              {map.data.coverage.exclusions.length > 0 ? (
                <ul className="map-exclusion-list">
                  {map.data.coverage.exclusions.map((exclusion) => (
                    <li key={exclusion.type}><strong>{featureLabels[exclusion.type]}</strong><span>{exclusion.reason}</span></li>
                  ))}
                </ul>
              ) : <p className="map-coverage__complete">当前审计范围没有声明排除项。</p>}
            </div>
          </div>
        </DataSection>

        <DataSection className="map-provenance" eyebrow="PROVENANCE" title="快照修订证据">
          <dl className="map-audit-grid">
            <div><dt>Steam 应用</dt><dd>App {map.data.sourceRevision.appId}</dd></div>
            <div><dt>Build ID</dt><dd>{map.data.sourceRevision.buildId}</dd></div>
            <div><dt>Depot manifest</dt><dd>{map.data.sourceRevision.depotManifestId}</dd></div>
            <div><dt>提取器</dt><dd>{map.data.sourceRevision.extractor} · v{map.data.sourceRevision.extractorVersion}</dd></div>
            <div className="map-audit-grid__wide"><dt>资源路径</dt><dd>{map.data.sourceRevision.resourcePath}</dd></div>
            <div className="map-audit-grid__wide"><dt>资源 SHA-256</dt><dd>{map.data.sourceRevision.resourceSha256}</dd></div>
            <div className="map-audit-grid__wide"><dt>快照 SHA-256</dt><dd>{map.data.sourceRevision.snapshotSha256}</dd></div>
            <div className="map-audit-grid__wide"><dt>人工复核</dt><dd>{formatVerifiedAt(map.data.verifiedAt)} UTC</dd></div>
          </dl>
          <div className="map-source-group">
            <h3>可追溯来源</h3>
            <ul className="map-source-links">
              <li><a href={map.data.sourceSnapshot} rel="noreferrer" target="_blank">不可变快照清单 ↗</a></li>
              {map.data.sourceUrls.map((url, index) => (
                <li key={`${url}-${index}`}><a href={url} rel="noreferrer" target="_blank">{sourceLinkLabel(url, index)} ↗</a></li>
              ))}
            </ul>
          </div>
        </DataSection>
      </div>

      <MetaLine sources={map.meta.sources} updatedAt={map.meta.updatedAt} />
    </div>
  );
}
