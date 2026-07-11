import "@dodo/ui/styles.css";
import type { Metadata, Viewport } from "next";
import { Noto_Sans_SC, Saira_Condensed } from "next/font/google";
import type { ReactNode } from "react";

import { SiteHeader } from "../components/site-header";
import "./globals.css";

const notoSansSc = Noto_Sans_SC({
  display: "swap",
  subsets: ["latin"],
  variable: "--font-noto-sans-sc",
  weight: ["400", "500", "600"],
});

const sairaCondensed = Saira_Condensed({
  display: "swap",
  subsets: ["latin"],
  variable: "--font-saira-condensed",
  weight: ["500", "600", "700"],
});

export const preferredRegion = "hnd1";

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
    <html className={`${notoSansSc.variable} ${sairaCondensed.variable}`} lang="zh-CN">
      <head>
        <link crossOrigin="anonymous" href="https://cdn.cloudflare.steamstatic.com" rel="preconnect" />
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
