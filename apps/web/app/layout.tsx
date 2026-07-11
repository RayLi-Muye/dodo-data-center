import "@dodo/ui/styles.css";
import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";

import { SiteHeader } from "../components/site-header";
import "./globals.css";

export const metadata: Metadata = {
  description: "公开 Dota 2 账号比赛分析与当前版本百科。",
  title: { default: "Dodo 数据中心", template: "%s · Dodo" },
};

export const viewport: Viewport = {
  initialScale: 1,
  themeColor: "#101419",
  viewportFit: "cover",
  width: "device-width",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="zh-CN">
      <head>
        <link crossOrigin="anonymous" href="https://fonts.gstatic.com" rel="preconnect" />
        <link crossOrigin="anonymous" href="https://cdn.cloudflare.steamstatic.com" rel="preconnect" />
        <link
          href="https://fonts.googleapis.com/css2?family=Noto+Sans+SC:wght@400;500;600&family=Saira+Condensed:wght@500;600;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>
        <a className="skip-link" href="#main-content">跳到主要内容</a>
        <SiteHeader />
        <main id="main-content">{children}</main>
        <footer className="site-footer">
          <span>DODO / PUBLIC DATA MVP</span>
          <span>统计仅描述已导入且合格的公开比赛</span>
        </footer>
      </body>
    </html>
  );
}
