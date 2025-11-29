"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Calculator, Package, Settings, Moon, Sun } from "lucide-react";
import { useTheme } from "@/contexts/ThemeContext";

// ナビゲーション項目
const navigationItems = [
  {
    id: "cost",
    label: "Recipe Costing",
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
  const { theme, toggleTheme } = useTheme();

  // 現在のページに応じたタイトルを取得
  const getPageTitle = () => {
    const currentItem = navigationItems.find(
      (item) => pathname === item.href || pathname.startsWith(item.href + "/")
    );
    return currentItem ? currentItem.label : "Food Costing";
  };

  const isDark = theme === "dark";

  return (
    <div
      className={`h-full flex transition-colors duration-300 ${
        isDark ? "bg-slate-900" : "bg-gray-50"
      }`}
    >
      {/* ナビゲーションバー（左側270px固定、スライドアウト効果） */}
      <div
        className={`w-0 xl:w-[270px] h-full shadow-lg flex flex-col border-r transition-[width,transform] duration-300 ease-in-out transform -translate-x-full xl:translate-x-0 overflow-hidden ${
          isDark ? "bg-slate-800 border-slate-700" : "bg-white border-gray-200"
        }`}
        style={{ flexShrink: 0 }}
      >
        {/* ロゴ・アプリ名 */}
        <div className="p-6">
          <div className="flex items-center gap-3">
            <img
              src="/app_icon.png"
              alt="Food Costing"
              width={32}
              height={32}
              className="object-contain flex-shrink-0"
            />
            <h1
              className={`text-2xl font-bold transition-colors ${
                isDark ? "text-slate-100" : "text-gray-900"
              }`}
            >
              Food Costing
            </h1>
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
                      ? "text-blue-600 font-semibold dark:text-blue-400"
                      : isDark
                      ? "text-slate-300 hover:text-blue-400"
                      : "text-gray-600 hover:text-blue-700"
                  }`}
                  style={{
                    backgroundColor: isDark ? "#1e293b" : "white",
                    transition:
                      "background-color 0.2s ease, border-radius 0.2s ease, color 0.2s ease",
                    borderRadius: "8px",
                    padding: "8px 16px",
                    margin: "2px 0",
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.backgroundColor = isDark
                      ? "#334155"
                      : "#dbeafe";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.backgroundColor = isDark
                      ? "#1e293b"
                      : "white";
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

        {/* テーマ切り替えスイッチ（ナビゲーションバーの下の方） */}
        <div className="px-4 pb-6">
          <button
            onClick={toggleTheme}
            className={`w-full flex items-center justify-center space-x-3 px-4 py-3 rounded-lg transition-colors ${
              isDark
                ? "bg-slate-700 hover:bg-slate-600 text-slate-200"
                : "bg-gray-100 hover:bg-gray-200 text-gray-700"
            }`}
            aria-label="Toggle theme"
          >
            {isDark ? (
              <>
                <Sun className="h-5 w-5" />
                <span className="text-sm font-medium">Light Mode</span>
              </>
            ) : (
              <>
                <Moon className="h-5 w-5" />
                <span className="text-sm font-medium">Dark Mode</span>
              </>
            )}
          </button>
        </div>
      </div>

      {/* コンテンツエリア（右側残り全スペース、スムーズ拡張） */}
      <div className="flex-1 flex flex-col transition-all duration-300 ease-in-out">
        {/* ヘッダー（上部90px） */}
        <header
          className={`h-[90px] shadow-sm border-b px-8 flex items-center transition-colors ${
            isDark
              ? "bg-slate-800 border-slate-700"
              : "bg-white border-gray-200"
          }`}
          style={{ paddingLeft: "30px" }}
        >
          <div className="flex items-center space-x-4">
            <h1
              className={`text-2xl font-bold transition-colors ${
                isDark ? "text-slate-100" : "text-gray-900"
              }`}
            >
              {getPageTitle()}
            </h1>
          </div>
        </header>

        {/* メインコンテンツ（下部残りスペース） */}
        <main
          className={`flex-1 overflow-y-auto transition-colors ${
            isDark ? "bg-slate-900" : "bg-gray-50"
          }`}
          style={{ scrollbarGutter: "stable" }}
        >
          {children}
        </main>
      </div>
    </div>
  );
}
