import Link from "next/link";

const navigation = [
  { href: "/players/123456789", label: "账号" },
  { href: "/heroes", label: "英雄" },
  { href: "/items", label: "物品" },
  { href: "/map", label: "地图" },
  { href: "/patches", label: "更新" },
];

export function SiteHeader() {
  return (
    <header className="site-header">
      <div className="site-header__inner">
        <Link className="wordmark" href="/" aria-label="Dodo 数据中心首页">
          <span className="wordmark__mark" aria-hidden="true">
            <i />
            <i />
            <i />
          </span>
          <span>DODO</span>
          <small>DATA CENTER</small>
        </Link>
        <nav aria-label="主导航">
          {navigation.map((item) => (
            <Link href={item.href} key={item.href}>
              {item.label}
            </Link>
          ))}
        </nav>
        <span className="site-header__live">
          <i aria-hidden="true" />
          MVP / LIVE DATA
        </span>
      </div>
    </header>
  );
}
