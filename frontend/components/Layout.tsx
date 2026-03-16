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
  Award,
  ChevronDown,
  ChevronRight,
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

// License & certification のサブメニュー
const licenseSubItems = [
  {
    id: "employee-requirements",
    label: "Employee Requirements",
    href: "/employee-requirements",
  },
  {
    id: "tenant-requirements",
    label: "Tenant Requirements",
    href: "/tenant-requirements",
  },
  {
    id: "company-requirements",
    label: "Company Requirements",
    href: "/company-requirements",
  },
];

// レイアウトコンテンツコンポーネント
export function Layout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { theme, toggleTheme } = useTheme();
  const [sidebarMode, setSidebarMode] = useState<"compact" | "full">("compact");
  const [isHovered, setIsHovered] = useState(false);
  const [isSystemAdmin, setIsSystemAdmin] = useState(false);
  const [licenseExpanded, setLicenseExpanded] = useState(false);

  // License & certification 配下のページにいる場合は親を開いた状態に
  useEffect(() => {
    if (
      pathname.startsWith("/employee-requirements") ||
      pathname.startsWith("/tenant-requirements") ||
      pathname.startsWith("/company-requirements")
    )
      setLicenseExpanded(true);
  }, [pathname]);

  // System Adminチェック
  useEffect(() => {
    // /joinページではAPIリクエストをスキップ（未認証ユーザーが使用するため）
    if (pathname === "/join") {
      return;
    }

    const checkSystemAdmin = async () => {
      try {
        const data = await apiRequest<{ is_system_admin: boolean }>("/me");
        setIsSystemAdmin(data.is_system_admin);
      } catch (error) {
        console.error("Failed to fetch user info:", error);
      }
    };
    checkSystemAdmin();
  }, [pathname]);

  // 現在のページに応じたタイトルを取得
  const getPageTitle = () => {
    if (pathname.startsWith("/employee-requirements"))
      return "Employee Requirements";
    if (pathname.startsWith("/tenant-requirements"))
      return "Tenant Requirements";
    if (pathname.startsWith("/company-requirements"))
      return "Company Requirements";
    const currentItem = navigationItems.find(
      (item) => pathname === item.href || pathname.startsWith(item.href + "/"),
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
        className={`relative z-100 h-[90px] shadow-sm border-b px-8 flex items-center justify-between transition-colors ${
          isDark ? "bg-slate-800 border-slate-700" : "bg-white border-gray-200"
        }`}
        style={{ paddingLeft: "30px" }}
      >
        {/* 左側：アプリアイコン + 名前、ハンバーガーメニュー、ページタイトル */}
        <div className="flex items-center space-x-4">
          {/* アプリアイコン + 名前（クリックで Recipes へ） */}
          <Link
            href="/cost"
            className="flex items-center gap-2 rounded-md transition-opacity hover:opacity-80 focus:outline-none"
            aria-label="Go to Recipes"
          >
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
          </Link>

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

        {/* 右側：テナント選択とユーザープロファイル（License & certification 配下ではテナント非表示） */}
        <div className="flex items-center space-x-4">
          {!pathname.startsWith("/employee-requirements") &&
            !pathname.startsWith("/tenant-requirements") &&
            !pathname.startsWith("/company-requirements") && <TenantSelector />}
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

              {/* License & certification（クリックで開閉、サブの Requirements で遷移） */}
              <div className="flex flex-col gap-0">
                <button
                  type="button"
                  onClick={() => setLicenseExpanded((e) => !e)}
                  className={`w-full flex items-center gap-2 px-3 py-2 text-left transition-colors border-0 rounded-md cursor-pointer ${
                    licenseExpanded
                      ? isDark
                        ? "text-blue-400 font-semibold"
                        : "text-blue-700 font-semibold"
                      : isDark
                        ? "text-slate-300 hover:text-blue-400"
                        : "text-gray-600 hover:text-blue-700"
                  }`}
                  style={{
                    backgroundColor: isDark ? "#1e293b" : "white",
                    color: licenseExpanded
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
                    e.currentTarget.style.color = licenseExpanded
                      ? isDark
                        ? "#60a5fa"
                        : "#1d4ed8"
                      : isDark
                        ? "#cbd5e1"
                        : "#6b7280";
                  }}
                >
                  <Award className="h-5 w-5 shrink-0" />
                  {isSidebarExpanded && (
                    <>
                      <span className="text-sm whitespace-nowrap">
                        License & certification
                      </span>
                      {licenseExpanded ? (
                        <ChevronDown className="h-4 w-4 ml-auto shrink-0" />
                      ) : (
                        <ChevronRight className="h-4 w-4 ml-auto shrink-0" />
                      )}
                    </>
                  )}
                </button>
                {isSidebarExpanded &&
                  licenseExpanded &&
                  licenseSubItems.map((sub) => {
                    const isActive =
                      pathname === sub.href ||
                      pathname.startsWith(sub.href + "/");
                    return (
                      <Link
                        key={sub.id}
                        href={sub.href}
                        className={`w-full flex items-center gap-2 pl-9 pr-3 py-2 text-left transition-colors border-0 no-underline rounded-md text-sm ${
                          isActive ? "font-semibold" : ""
                        }`}
                        style={{
                          backgroundColor: isDark ? "#1e293b" : "white",
                          color: isActive
                            ? isDark
                              ? "#60a5fa"
                              : "#1d4ed8"
                            : isDark
                              ? "#94a3b8"
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
                              ? "#94a3b8"
                              : "#6b7280";
                        }}
                      >
                        {sub.label}
                      </Link>
                    );
                  })}
              </div>

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
                    e.currentTarget.style.color = isDark
                      ? "#60a5fa"
                      : "#1d4ed8";
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
                    <span className="text-sm whitespace-nowrap">
                      Admin Panel
                    </span>
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
