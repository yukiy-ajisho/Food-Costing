"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Calculator,
  Package,
  Settings,
  Moon,
  Sun,
  Users,
  Menu,
  Shield,
} from "lucide-react";
import { useTheme } from "@/contexts/ThemeContext";
import { UserProfile } from "./UserProfile";
import { TenantSelector } from "./TenantSelector";
import { useState, useEffect } from "react";
import { apiRequest } from "@/lib/api";

// ナビゲーション項目
const navigationItems = [
  {
    id: "cost",
    label: "Recipes",
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
    id: "team",
    label: "Team",
    icon: Users,
    href: "/team",
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
  const [sidebarMode, setSidebarMode] = useState<"compact" | "full">("compact");
  const [isHovered, setIsHovered] = useState(false);
  const [isSystemAdmin, setIsSystemAdmin] = useState(false);

  // System Adminチェック
  useEffect(() => {
    const checkSystemAdmin = async () => {
      try {
        const data = await apiRequest<{ is_system_admin: boolean }>("/me");
        setIsSystemAdmin(data.is_system_admin);
      } catch (error) {
        console.error("Failed to fetch user info:", error);
      }
    };
    checkSystemAdmin();
  }, []);

  // 現在のページに応じたタイトルを取得
  const getPageTitle = () => {
    const currentItem = navigationItems.find(
      (item) => pathname === item.href || pathname.startsWith(item.href + "/")
    );
    return currentItem ? currentItem.label : "Food Costing";
  };

  // サイドバーの表示モードを切り替え
  const toggleSidebarMode = () => {
    setSidebarMode((prev) => (prev === "compact" ? "full" : "compact"));
  };

  // サイドバーの実際の表示状態を決定
  // コンパクトモード時のみホバーで一時的に開く
  const isSidebarExpanded =
    sidebarMode === "full" || (sidebarMode === "compact" && isHovered);

  // サイドバーの幅を決定
  const sidebarWidth = isSidebarExpanded ? "178px" : "64px";

  const isDark = theme === "dark";

  return (
    <div
      className={`h-full flex flex-col transition-colors duration-300 ${
        isDark ? "bg-slate-900" : "bg-gray-50"
      }`}
    >
      {/* ヘッダー（上部90px、左端まで） */}
      <header
        className={`h-[90px] shadow-sm border-b px-8 flex items-center justify-between transition-colors ${
          isDark ? "bg-slate-800 border-slate-700" : "bg-white border-gray-200"
        }`}
        style={{ paddingLeft: "30px" }}
      >
        {/* 左側：アプリアイコン + 名前、ハンバーガーメニュー、ページタイトル */}
        <div className="flex items-center space-x-4">
          {/* アプリアイコン + 名前 */}
          <div className="flex items-center gap-2">
            <img
              src="/app_icon.png"
              alt="Food Costing"
              width={32}
              height={32}
              className="object-contain shrink-0"
            />
            <h1
              className={`text-lg font-bold transition-colors ${
                isDark ? "text-slate-100" : "text-gray-900"
              }`}
            >
              Food Costing
            </h1>
          </div>

          {/* ハンバーガーメニュー */}
          <button
            onClick={toggleSidebarMode}
            className={`p-2 rounded-md transition-colors ${
              isDark
                ? "text-slate-300 hover:text-blue-400 hover:bg-slate-700"
                : "text-gray-600 hover:text-blue-700 hover:bg-blue-50"
            }`}
            title={
              sidebarMode === "compact" ? "Expand sidebar" : "Collapse sidebar"
            }
          >
            <Menu className="h-5 w-5" />
          </button>

          {/* ページタイトル */}
          <h2
            className={`text-xl font-bold transition-colors ${
              isDark ? "text-slate-100" : "text-gray-900"
            }`}
          >
            {getPageTitle()}
          </h2>
        </div>

        {/* 右側：テナント選択とユーザープロファイル */}
        <div className="flex items-center space-x-4">
          <TenantSelector />
          <UserProfile />
        </div>
      </header>

      {/* メインコンテンツエリア（ヘッダーの下） */}
      <div className="flex-1 flex overflow-hidden relative">
        {/* 左端ホバー領域（サイドバーがコンパクトモードの時のみ有効） */}
        {sidebarMode === "compact" && (
          <div
            className="absolute left-0 top-0 bottom-0 w-[10px] z-10"
            onMouseEnter={() => setIsHovered(true)}
            onMouseLeave={() => setIsHovered(false)}
          />
        )}

        {/* サイドバー（左側、ヘッダーの下から） */}
        <div
          className={`h-full shadow-lg flex flex-col border-r transition-all duration-300 ease-in-out overflow-hidden ${
            isDark
              ? "bg-slate-800 border-slate-700"
              : "bg-white border-gray-200"
          }`}
          style={{
            width: sidebarWidth,
          }}
          onMouseEnter={() => {
            if (sidebarMode === "compact") {
              setIsHovered(true);
            }
          }}
          onMouseLeave={() => {
            if (sidebarMode === "compact") {
              setIsHovered(false);
            }
          }}
        >
          {/* ナビゲーション項目 */}
          <nav className="flex-1 px-3 pb-3 overflow-hidden pt-6">
            <div className="flex flex-col h-full gap-2">
              {navigationItems.map((item) => {
                const IconComponent = item.icon;
                const isActive =
                  pathname === item.href ||
                  pathname.startsWith(item.href + "/");

                return (
                  <Link
                    key={item.id}
                    href={item.href}
                    className={`w-full flex items-center gap-2 px-3 py-2 text-left transition-colors border-0 no-underline rounded-md ${
                      isActive
                        ? isDark
                          ? "text-blue-400 font-semibold"
                          : "text-blue-700 font-semibold"
                        : isDark
                        ? "text-slate-300 hover:text-blue-400"
                        : "text-gray-600 hover:text-blue-700"
                    }`}
                    style={{
                      backgroundColor: isDark ? "#1e293b" : "white",
                      transition:
                        "background-color 0.2s ease, border-radius 0.2s ease, color 0.2s ease",
                      color: isActive
                        ? isDark
                          ? "#60a5fa"
                          : "#1d4ed8"
                        : isDark
                        ? "#cbd5e1"
                        : "#6b7280",
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.backgroundColor = isDark
                        ? "#334155"
                        : "#dbeafe";
                      e.currentTarget.style.color = isDark
                        ? "#60a5fa"
                        : "#1d4ed8";
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.backgroundColor = isDark
                        ? "#1e293b"
                        : "white";
                      e.currentTarget.style.color = isActive
                        ? isDark
                          ? "#60a5fa"
                          : "#1d4ed8"
                        : isDark
                        ? "#cbd5e1"
                        : "#6b7280";
                    }}
                  >
                    <IconComponent className="h-5 w-5 shrink-0" />
                    {isSidebarExpanded && (
                      <span className="text-sm whitespace-nowrap">
                        {item.label}
                      </span>
                    )}
                  </Link>
                );
              })}

              {/* System Admin Panel Link */}
              {isSystemAdmin && (
                <Link
                  href="/admin"
                  className={`w-full flex items-center gap-2 px-3 py-2 text-left transition-colors border-0 no-underline rounded-md ${
                    pathname === "/admin"
                      ? isDark
                        ? "text-blue-400 font-semibold"
                        : "text-blue-700 font-semibold"
                      : isDark
                      ? "text-slate-300 hover:text-blue-400"
                      : "text-gray-600 hover:text-blue-700"
                  }`}
                  style={{
                    backgroundColor: isDark ? "#1e293b" : "white",
                    transition:
                      "background-color 0.2s ease, border-radius 0.2s ease, color 0.2s ease",
                    color:
                      pathname === "/admin"
                        ? isDark
                          ? "#60a5fa"
                          : "#1d4ed8"
                        : isDark
                        ? "#cbd5e1"
                        : "#6b7280",
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.backgroundColor = isDark
                      ? "#334155"
                      : "#dbeafe";
                    e.currentTarget.style.color = isDark ? "#60a5fa" : "#1d4ed8";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.backgroundColor = isDark
                      ? "#1e293b"
                      : "white";
                    e.currentTarget.style.color =
                      pathname === "/admin"
                        ? isDark
                          ? "#60a5fa"
                          : "#1d4ed8"
                        : isDark
                        ? "#cbd5e1"
                        : "#6b7280";
                  }}
                >
                  <Shield className="h-5 w-5 shrink-0" />
                  {isSidebarExpanded && (
                    <span className="text-sm whitespace-nowrap">Admin Panel</span>
                  )}
                </Link>
              )}
            </div>
          </nav>

          {/* テーマ切り替えスイッチ（サイドバーの下の方） */}
          <div className="px-3 pb-3">
            <button
              onClick={toggleTheme}
              className={`w-full flex items-center justify-center gap-2 px-3 py-2 rounded-md transition-colors ${
                isDark
                  ? "bg-slate-700 hover:bg-slate-600 text-slate-200"
                  : "bg-gray-100 hover:bg-gray-200 text-gray-700"
              }`}
              aria-label="Toggle theme"
            >
              {isDark ? (
                <>
                  <Sun className="h-5 w-5 shrink-0" />
                  {isSidebarExpanded && (
                    <span className="text-sm font-medium">Light Mode</span>
                  )}
                </>
              ) : (
                <>
                  <Moon className="h-5 w-5 shrink-0" />
                  {isSidebarExpanded && (
                    <span className="text-sm font-medium">Dark Mode</span>
                  )}
                </>
              )}
            </button>
          </div>
        </div>

        {/* コンテンツエリア（右側残り全スペース） */}
        <div className="flex-1 flex flex-col transition-all duration-300 ease-in-out overflow-hidden">
          {/* メインコンテンツ */}
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
    </div>
  );
}
