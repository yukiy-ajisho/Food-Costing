"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Calculator, Package, Settings } from "lucide-react";

// ナビゲーション項目
const navigationItems = [
  {
    id: "cost",
    label: "Cost",
    icon: Calculator,
    href: "/cost",
  },
  {
    id: "items",
    label: "Items",
    icon: Package,
    href: "/items",
  },
  {
    id: "settings",
    label: "Settings",
    icon: Settings,
    href: "/settings",
  },
];

// レイアウトコンテンツコンポーネント
export function Layout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  // 現在のページに応じたタイトルを取得
  const getPageTitle = () => {
    const currentItem = navigationItems.find(
      (item) => pathname === item.href || pathname.startsWith(item.href + "/")
    );
    return currentItem ? currentItem.label : "Food Costing";
  };

  return (
    <div className="h-screen flex bg-gray-50">
      {/* ナビゲーションバー（左側270px固定、スライドアウト効果） */}
      <div className="w-0 xl:w-[270px] h-screen bg-white shadow-lg flex flex-col border-r border-gray-200 transition-[width,transform] duration-300 ease-in-out transform -translate-x-full xl:translate-x-0 overflow-hidden">
        {/* ロゴ・アプリ名 */}
        <div className="p-6">
          <div className="flex items-center" style={{ gap: "8px" }}>
            <h1 className="text-2xl font-bold text-gray-900">Food Costing</h1>
          </div>
        </div>

        {/* ナビゲーション項目 */}
        <nav
          className="flex-1 px-4 pb-4 overflow-hidden"
          style={{ paddingTop: "32px" }}
        >
          <div className="flex flex-col h-full" style={{ gap: "12px" }}>
            {navigationItems.map((item) => {
              const IconComponent = item.icon;
              const isActive =
                pathname === item.href || pathname.startsWith(item.href + "/");
              return (
                <Link
                  key={item.id}
                  href={item.href}
                  className={`w-full flex items-center space-x-8 px-12 py-8 text-left transition-colors border-0 no-underline ${
                    isActive
                      ? "text-blue-700 font-semibold"
                      : "text-gray-600 hover:text-blue-700"
                  }`}
                  style={{
                    backgroundColor: "white",
                    transition:
                      "background-color 0.2s ease, border-radius 0.2s ease",
                    borderRadius: "8px",
                    color: isActive ? "#1d4ed8" : "#6b7280",
                    padding: "8px 16px",
                    margin: "2px 0",
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.backgroundColor = "#dbeafe";
                    e.currentTarget.style.color = "#1d4ed8";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.backgroundColor = "white";
                    e.currentTarget.style.color = isActive
                      ? "#1d4ed8"
                      : "#6b7280";
                  }}
                >
                  <IconComponent
                    className="h-6 w-6"
                    style={{ height: "24px", width: "24px" }}
                  />
                  <span className="text-lg" style={{ fontSize: "18px" }}>
                    {item.label}
                  </span>
                </Link>
              );
            })}
          </div>
        </nav>
      </div>

      {/* コンテンツエリア（右側残り全スペース、スムーズ拡張） */}
      <div className="flex-1 flex flex-col transition-all duration-300 ease-in-out">
        {/* ヘッダー（上部90px） */}
        <header
          className="h-[90px] bg-white shadow-sm border-b border-gray-200 px-8 flex items-center"
          style={{ paddingLeft: "30px" }}
        >
          <div className="flex items-center space-x-4">
            <h1 className="text-2xl font-bold text-gray-900">
              {getPageTitle()}
            </h1>
          </div>
        </header>

        {/* メインコンテンツ（下部残りスペース） */}
        <main
          className="flex-1 overflow-y-auto bg-gray-50"
          style={{ scrollbarGutter: "stable" }}
        >
          {children}
        </main>
      </div>
    </div>
  );
}
