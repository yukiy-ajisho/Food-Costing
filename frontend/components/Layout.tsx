"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Moon,
  Sun,
  Users,
  Menu,
  Shield,
  Award,
  Utensils,
  ChevronDown,
  ChevronRight,
  Inbox,
} from "lucide-react";
import { useTheme } from "@/contexts/ThemeContext";
import { UserProfile } from "./UserProfile";
import { CompanySelector } from "./CompanySelector";
import { TenantSelector } from "./TenantSelector";
import { useState, useEffect, useMemo } from "react";
import { apiRequest } from "@/lib/api";
import { documentInboxAPI } from "@/lib/api/document-inbox";
import { useCompany } from "@/contexts/CompanyContext";

/**
 * サイドバー親行: 2行ラベル(text-sm leading-tight)+h-5アイコン+py-2 を収容。
 * 畳み・展開で行高が変わらないように最低高を固定し、items-center でアイコン縦位置を統一。
 */
const SIDEBAR_NAV_ROW_MIN = "min-h-14";
const SIDEBAR_NAV_ROW_ALIGN = `${SIDEBAR_NAV_ROW_MIN} flex items-center gap-2`;

/** Food costing / License 直下のサブリンク用（親より詰めて同じ密度に揃える） */
const SIDEBAR_SUB_NAV_ROW_MIN = "min-h-11";
const SIDEBAR_SUB_NAV_ROW_ALIGN = `${SIDEBAR_SUB_NAV_ROW_MIN} flex items-center gap-2`;

/** 外側クリップ用の幅（内側レイアウト幅と一致） */
const SIDEBAR_COLLAPSED_PX = 64;
const SIDEBAR_EXPANDED_PX = 178;

/** Recipes / Items / History / Settings / Vendors いずれかのパスか */
function isFoodCostingPath(pathname: string): boolean {
  return (
    pathname.startsWith("/cost") ||
    pathname.startsWith("/items") ||
    pathname.startsWith("/history") ||
    pathname.startsWith("/settings") ||
    pathname.startsWith("/vendors")
  );
}

// Food costing サブメニュー
const foodCostingSubItems = [
  { id: "cost", label: "Recipes", href: "/cost" },
  { id: "items", label: "Items", href: "/items" },
  { id: "history", label: "History", href: "/history" },
  { id: "vendors", label: "Vendors", href: "/vendors" },
  { id: "settings", label: "Settings", href: "/settings" },
];

// Team（単体リンク）
const teamNavItem = {
  id: "team",
  label: "Team",
  icon: Users,
  href: "/team",
} as const;

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
  const { companies, selectedCompanyId } = useCompany();
  const canAccessDocumentBox = useMemo(() => {
    if (!selectedCompanyId) return false;
    const role = companies.find((c) => c.id === selectedCompanyId)?.role;
    return role === "company_admin" || role === "company_director";
  }, [companies, selectedCompanyId]);
  const { theme, toggleTheme } = useTheme();
  const [sidebarMode, setSidebarMode] = useState<"compact" | "full">("compact");
  const [isHovered, setIsHovered] = useState(false);
  const [isSystemAdmin, setIsSystemAdmin] = useState(false);
  const [licenseExpanded, setLicenseExpanded] = useState(false);
  const [foodCostingExpanded, setFoodCostingExpanded] = useState(false);
  const [pendingCount, setPendingCount] = useState(0);

  const isFoodCostingSectionActive = isFoodCostingPath(pathname);

  const isLicenseSectionActive =
    pathname.startsWith("/employee-requirements") ||
    pathname.startsWith("/tenant-requirements") ||
    pathname.startsWith("/company-requirements");

  // License 配下にいるときは開く／それ以外では閉じる（他ページ選択時はサブも畳む）
  useEffect(() => {
    setLicenseExpanded(
      pathname.startsWith("/employee-requirements") ||
        pathname.startsWith("/tenant-requirements") ||
        pathname.startsWith("/company-requirements"),
    );
  }, [pathname]);

  // Food costing 配下にいるときは開く／それ以外では閉じる
  useEffect(() => {
    setFoodCostingExpanded(isFoodCostingPath(pathname));
  }, [pathname]);

  // Document Box: 未承認件数（会社オフィサーのみ）
  useEffect(() => {
    if (pathname === "/join") return;
    if (!canAccessDocumentBox) {
      setPendingCount(0);
      return;
    }
    documentInboxAPI
      .forDocumentBox()
      .then((rows) => setPendingCount(rows.length))
      .catch(() => {
        setPendingCount(0);
      });
  }, [pathname, canAccessDocumentBox]);

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
    if (pathname.startsWith("/document-box")) return "Document Box";
    const foodItem = foodCostingSubItems.find(
      (item) => pathname === item.href || pathname.startsWith(item.href + "/"),
    );
    if (foodItem) return foodItem.label;
    if (
      pathname === teamNavItem.href ||
      pathname.startsWith(teamNavItem.href + "/")
    )
      return teamNavItem.label;
    return "Food Costing";
  };

  // サイドバーの表示モードを切り替え
  const toggleSidebarMode = () => {
    setSidebarMode((prev) => (prev === "compact" ? "full" : "compact"));
  };

  // サイドバーの実際の表示状態を決定
  // コンパクトモード時のみホバーで一時的に開く
  const isSidebarExpanded =
    sidebarMode === "full" || (sidebarMode === "compact" && isHovered);

  // 外側だけ幅アニメ。内側は常に SIDEBAR_EXPANDED_PX でレイアウトし overflow で切る
  const sidebarWidth = isSidebarExpanded
    ? `${SIDEBAR_EXPANDED_PX}px`
    : `${SIDEBAR_COLLAPSED_PX}px`;

  const isDark = theme === "dark";
  const TeamNavIcon = teamNavItem.icon;

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

        {/* 右側：Company / Tenant セレクターとユーザープロファイル */}
        <div className="flex items-center space-x-4">
          <CompanySelector />
          {!pathname.startsWith("/employee-requirements") &&
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

        {/* サイドバー：外側は block のクリップ窓。内側は常に展開幅でレイアウト。
            コンパクト時はラベル・シェブロンは isSidebarExpanded で非表示（アイコンのみ）。 */}
        <div
          className={`h-full min-w-0 shrink-0 shadow-lg border-r overflow-hidden transition-[width] duration-300 ease-in-out ${
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
          <div
            className="flex h-full min-h-0 flex-col overflow-hidden"
            style={{
              width: SIDEBAR_EXPANDED_PX,
              minWidth: SIDEBAR_EXPANDED_PX,
              maxWidth: SIDEBAR_EXPANDED_PX,
            }}
          >
          {/* ナビゲーション項目 */}
          <nav className="flex-1 min-h-0 min-w-0 px-3 pb-3 overflow-hidden pt-6">
            <div className="flex min-h-0 min-w-0 flex-col h-full gap-2">
              {/* Food costing（クリックで開閉、サブで Recipes / Items / History / Settings） */}
              <div className="flex flex-col gap-0">
                <button
                  type="button"
                  onClick={() => setFoodCostingExpanded((e) => !e)}
                  className={`w-full ${SIDEBAR_NAV_ROW_ALIGN} px-3 py-2 text-left transition-colors border-0 rounded-md cursor-pointer ${
                    isFoodCostingSectionActive
                      ? isDark
                        ? "text-blue-400 font-semibold"
                        : "text-blue-700 font-semibold"
                      : isDark
                        ? "text-slate-300 hover:text-blue-400"
                        : "text-gray-600 hover:text-blue-700"
                  }`}
                  style={{
                    backgroundColor: isDark ? "#1e293b" : "white",
                    color: isFoodCostingSectionActive
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
                    e.currentTarget.style.color = isFoodCostingSectionActive
                      ? isDark
                        ? "#60a5fa"
                        : "#1d4ed8"
                      : isDark
                        ? "#cbd5e1"
                        : "#6b7280";
                  }}
                >
                  <Utensils className="h-5 w-5 shrink-0" />
                  {isSidebarExpanded && (
                    <>
                      <span className="text-sm leading-tight text-left flex-1 min-w-0">
                        Food
                        <br />
                        Costing
                      </span>
                      {foodCostingExpanded ? (
                        <ChevronDown className="h-4 w-4 shrink-0" />
                      ) : (
                        <ChevronRight className="h-4 w-4 shrink-0" />
                      )}
                    </>
                  )}
                </button>
                {isSidebarExpanded &&
                  foodCostingExpanded &&
                  foodCostingSubItems.map((sub) => {
                    const isActive =
                      pathname === sub.href ||
                      pathname.startsWith(sub.href + "/");
                    return (
                      <Link
                        key={sub.id}
                        href={sub.href}
                        className={`w-full ${SIDEBAR_SUB_NAV_ROW_ALIGN} pl-9 pr-3 py-1.5 text-left transition-colors border-0 no-underline rounded-md text-sm ${
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

              {/* Team */}
              <Link
                key={teamNavItem.id}
                href={teamNavItem.href}
                className={`w-full ${SIDEBAR_NAV_ROW_ALIGN} px-3 py-2 text-left transition-colors border-0 no-underline rounded-md ${
                  pathname === teamNavItem.href ||
                  pathname.startsWith(teamNavItem.href + "/")
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
                    pathname === teamNavItem.href ||
                    pathname.startsWith(teamNavItem.href + "/")
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
                  const teamActive =
                    pathname === teamNavItem.href ||
                    pathname.startsWith(teamNavItem.href + "/");
                  e.currentTarget.style.backgroundColor = isDark
                    ? "#1e293b"
                    : "white";
                  e.currentTarget.style.color = teamActive
                    ? isDark
                      ? "#60a5fa"
                      : "#1d4ed8"
                    : isDark
                      ? "#cbd5e1"
                      : "#6b7280";
                }}
              >
                <TeamNavIcon className="h-5 w-5 shrink-0" />
                {isSidebarExpanded && (
                  <span className="text-sm whitespace-nowrap">
                    {teamNavItem.label}
                  </span>
                )}
              </Link>

              {canAccessDocumentBox ? (
                <Link
                  href="/document-box"
                  className={`w-full ${SIDEBAR_NAV_ROW_ALIGN} px-3 py-2 text-left transition-colors border-0 no-underline rounded-md`}
                  style={{
                    backgroundColor: isDark ? "#1e293b" : "white",
                    transition:
                      "background-color 0.2s ease, border-radius 0.2s ease, color 0.2s ease",
                    color: pathname.startsWith("/document-box")
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
                    e.currentTarget.style.color = pathname.startsWith(
                      "/document-box"
                    )
                      ? isDark
                        ? "#60a5fa"
                        : "#1d4ed8"
                      : isDark
                        ? "#cbd5e1"
                        : "#6b7280";
                  }}
                >
                  <div className="relative shrink-0">
                    <Inbox className="h-5 w-5" />
                    {pendingCount > 0 && (
                      <span className="absolute -top-1.5 -right-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-red-500 text-[10px] font-bold text-white leading-none">
                        {pendingCount > 9 ? "9+" : pendingCount}
                      </span>
                    )}
                  </div>
                  {isSidebarExpanded && (
                    <span className="text-sm whitespace-nowrap">
                      Document Box
                    </span>
                  )}
                </Link>
              ) : null}

              {/* License & certification（クリックで開閉、サブの Requirements で遷移） */}
              <div className="flex flex-col gap-0">
                <button
                  type="button"
                  onClick={() => setLicenseExpanded((e) => !e)}
                  className={`w-full ${SIDEBAR_NAV_ROW_ALIGN} px-3 py-2 text-left transition-colors border-0 rounded-md cursor-pointer ${
                    isLicenseSectionActive
                      ? isDark
                        ? "text-blue-400 font-semibold"
                        : "text-blue-700 font-semibold"
                      : isDark
                        ? "text-slate-300 hover:text-blue-400"
                        : "text-gray-600 hover:text-blue-700"
                  }`}
                  style={{
                    backgroundColor: isDark ? "#1e293b" : "white",
                    color: isLicenseSectionActive
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
                    e.currentTarget.style.color = isLicenseSectionActive
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
                      <span className="text-sm leading-tight text-left flex-1 min-w-0">
                        <span className="whitespace-nowrap">License &</span>
                        <br />
                        certification
                      </span>
                      {licenseExpanded ? (
                        <ChevronDown className="h-4 w-4 shrink-0" />
                      ) : (
                        <ChevronRight className="h-4 w-4 shrink-0" />
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
                        className={`w-full ${SIDEBAR_SUB_NAV_ROW_ALIGN} pl-9 pr-3 py-1.5 text-left transition-colors border-0 no-underline rounded-md text-sm ${
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
                  className={`w-full ${SIDEBAR_NAV_ROW_ALIGN} px-3 py-2 text-left transition-colors border-0 no-underline rounded-md ${
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
              className={`w-full ${SIDEBAR_NAV_ROW_ALIGN} justify-start px-3 py-2 rounded-md transition-colors ${
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
