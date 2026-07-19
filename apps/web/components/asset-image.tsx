"use client";

import { useState } from "react";

import { dotaAssetUrl, type DotaAssetKind } from "../lib/assets";

export function AssetImage({
  alt,
  className = "",
  kind,
  name,
  priority = false,
}: {
  alt: string;
  className?: string;
  kind: DotaAssetKind;
  name: string;
  priority?: boolean;
}) {
  const [failed, setFailed] = useState(false);
  const src = dotaAssetUrl(name, kind);
  const dimensions = kind === "hero"
    ? { height: 144, width: 256 }
    : kind === "item"
      ? { height: 64, width: 96 }
      : { height: 128, width: 128 };

  if (!src || failed) {
    return (
      <span className={`asset-image asset-image--${kind} asset-fallback asset-fallback--${kind} ${className}`.trim()} role="img" aria-label={`${alt} 图片不可用`}>
        {alt.slice(0, 2).toUpperCase()}
      </span>
    );
  }

  return (
    <img
      alt={alt}
      className={`asset-image asset-image--${kind} ${className}`.trim()}
      decoding="async"
      fetchPriority={priority ? "high" : "auto"}
      height={dimensions.height}
      loading={priority ? "eager" : "lazy"}
      onError={() => setFailed(true)}
      src={src}
      width={dimensions.width}
    />
  );
}
