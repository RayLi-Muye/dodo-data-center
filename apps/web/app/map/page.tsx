import { mapFeatureTypeSchema, type MapFeature } from "@dodo/contracts";
import { DataSection, MetaLine } from "@dodo/ui";
import Link from "next/link";

import { DataState, EmptyState } from "../../components/data-state";
import { PageHeading } from "../../components/page-heading";
import { api, settle } from "../../lib/api";
import { parseGeometry, svgPoints } from "../../lib/geometry";

const featureLabels = {
  lane: "兵线",
  landmark: "地标",
  lotus_pool: "莲花池",
  neutral_camp: "野怪营地",
  outpost: "前哨",
  roshan: "肉山",
  rune: "符点",
  shop: "商店",
  tower: "防御塔",
} as const;

const featureTypes = ["lane", "tower", "outpost", "shop", "roshan", "rune", "lotus_pool", "neutral_camp", "landmark"] as const;

function MapGeometry({ features, maxY, minY }: { features: MapFeature[]; maxY: number; minY: number }) {
  const invertY = maxY + minY;
  return (
    <g transform={`translate(0 ${invertY}) scale(1 -1)`}>
      {features.map((feature) => {
        const geometry = parseGeometry(feature.geometry);
        if (!geometry) return null;
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
        return <polygon className={`map-feature map-feature--${feature.type}`} key={feature.id} points={svgPoints(geometry.points)}><title>{feature.localizedName}</title></polygon>;
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
  const width = map.data.bounds.maxX - map.data.bounds.minX;
  const height = map.data.bounds.maxY - map.data.bounds.minY;

  return (
    <div className="page-shell map-page">
      <PageHeading
        eyebrow={`MAP / ${map.data.id}`}
        lead="根据当前版本的结构化 geometry 绘制静态示意；不包含眼位、死亡、移动或推荐路线热图。"
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
              <rect className="map-terrain" height={height} width={width} x={map.data.bounds.minX} y={map.data.bounds.minY} />
              <MapGeometry features={features} maxY={map.data.bounds.maxY} minY={map.data.bounds.minY} />
            </svg>
            <span className="map-corner map-corner--radiant">RADIANT</span>
            <span className="map-corner map-corner--dire">DIRE</span>
          </div>
        </DataSection>

        <DataSection className="map-layout__legend" eyebrow="FEATURE INDEX" title={activeType ? featureLabels[activeType] : "地点图例"}>
          {features.length === 0 ? (
            <EmptyState detail="当前地图快照没有这一类地点。切换到全部地点继续查看。" title="没有地点要素" />
          ) : (
            <ol className="map-feature-list">
              {features.map((feature, index) => (
                <li key={feature.id}>
                  <span className={`map-feature-list__marker map-feature-list__marker--${feature.type}`} aria-hidden="true" />
                  <div><small>{String(index + 1).padStart(2, "0")} / {featureLabels[feature.type]}</small><strong>{feature.localizedName}</strong><p>{feature.description || "当前快照没有地点说明。"}</p></div>
                </li>
              ))}
            </ol>
          )}
          <div className="map-legend-notice">示意图只呈现 API 返回的结构化 geometry，不补画未经来源验证的游戏地点。</div>
        </DataSection>
      </div>

      <MetaLine sources={map.meta.sources} updatedAt={map.meta.updatedAt} />
      <p className="source-snapshot">来源快照：{map.data.sourceSnapshot} · 校验时间 {map.data.verifiedAt}</p>
    </div>
  );
}
