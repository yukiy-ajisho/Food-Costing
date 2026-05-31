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
  SlidersHorizontal,
  LayoutDashboard,
  ChevronLeft,
  ChevronDown,
  ChevronRight,
  Inbox,
  Receipt,
} from "lucide-react";
import { useTheme } from "@/contexts/ThemeContext";
import { UserProfile } from "./UserProfile";
import { CompanySelector } from "./CompanySelector";
import { TenantSelector } from "./TenantSelector";
import { useState, useEffect, useMemo } from "react";
import { apiRequest } from "@/lib/api";
import { documentInboxAPI } from "@/lib/api/document-inbox";
import { useCompany } from "@/contexts/CompanyContext";
import { useTenant } from "@/contexts/TenantContext";
import { userRequirementsAPI } from "@/lib/api/reminder/user-requirements";
import { mappingUserRequirementsAPI } from "@/lib/api/reminder/mapping-user-requirements";
import { userRequirementAssignmentsAPI } from "@/lib/api/reminder/user-requirement-assignments";
import { tenantRequirementsAPI } from "@/lib/api/reminder/tenant-requirements";
import { tenantRequirementValueTypesAPI } from "@/lib/api/reminder/tenant-requirement-value-types";
import { tenantRequirementRealDataAPI } from "@/lib/api/reminder/tenant-requirement-real-data";
import { companyRequirementsAPI } from "@/lib/api/reminder/company-requirements";
import { companyRequirementValueTypesAPI } from "@/lib/api/reminder/company-requirement-value-types";
import { companyRequirementRealDataAPI } from "@/lib/api/reminder/company-requirement-real-data";

/**
 * サイドバー親行: 2行ラベル(text-sm leading-tight)+h-5アイコン+py-2 を収容。
 * 畳み・展開で行高が変わらないように最低高を固定し、items-center でアイコン縦位置を統一。
 */
const SIDEBAR_NAV_ROW_MIN = "min-h-14";
const SIDEBAR_NAV_ROW_ALIGN = `${SIDEBAR_NAV_ROW_MIN} flex items-center gap-2`;
const SIDEBAR_TEAM_NAV_ROW_ALIGN = "min-h-9 flex items-center gap-2";

/** Food costing / Documents 直下のサブリンク用（親より詰めて同じ密度に揃える） */
const SIDEBAR_SUB_NAV_ROW_MIN = "min-h-11";
const SIDEBAR_SUB_NAV_ROW_ALIGN = `${SIDEBAR_SUB_NAV_ROW_MIN} flex items-center gap-2`;
const FOOD_COSTING_SUB_NAV_ROW_ALIGN = "min-h-8 flex items-center gap-2";
/** 親行: ラベル直後に chevron（flex-1 で右端に押し出さない） */
const SIDEBAR_NAV_LABEL_CHEVRON = "flex min-w-0 items-center gap-0.5";

/** 外側クリップ用の幅（内側レイアウト幅と一致） */
const SIDEBAR_COLLAPSED_PX = 64;
/** 親行ラベル「Food Costing」を1行で収める最小幅（icon+gap+chevron+px-3 込み） */
const SIDEBAR_EXPANDED_PX = 178;

const SIDEBAR_MODE_STORAGE_KEY = "food_costing_sidebar_mode";
const SIDEBAR_ALERTS_ENABLED_KEY = "food_costing_sidebar_alerts_enabled";

function todayYmd(): string {
  return new Date().toISOString().slice(0, 10);
}

function addDays(dateYmd: string, days: number): string {
  const d = new Date(`${dateYmd}T12:00:00`);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function addMonths(dateYmd: string, months: number): string {
  const d = new Date(`${dateYmd}T12:00:00`);
  d.setMonth(d.getMonth() + months);
  return d.toISOString().slice(0, 10);
}

function addYears(dateYmd: string, years: number): string {
  const d = new Date(`${dateYmd}T12:00:00`);
  const origMonth = d.getMonth();
  d.setFullYear(d.getFullYear() + years);
  if (d.getMonth() !== origMonth) d.setDate(0);
  return d.toISOString().slice(0, 10);
}

/** Recipes / Items / History / Settings / Vendors いずれかのパスか */
function isFoodCostingPath(pathname: string): boolean {
  return (
    pathname.startsWith("/cost") ||
    pathname.startsWith("/recipe-cost-report") ||
    pathname.startsWith("/items") ||
    pathname.startsWith("/history") ||
    pathname.startsWith("/labor") ||
    pathname.startsWith("/food-costing/settings") ||
    pathname.startsWith("/vendors")
  );
}

function isDashboardPath(pathname: string): boolean {
  return pathname.startsWith("/dashboard");
}

function isInvoicingPath(pathname: string): boolean {
  return pathname.startsWith("/invoicing");
}

// Food costing サブメニュー
const foodCostingSubItems = [
  { id: "cost", label: "Recipes", href: "/cost" },
  { id: "items", label: "Items", href: "/items" },
  { id: "history", label: "History", href: "/history" },
  { id: "vendors", label: "Vendors", href: "/vendors" },
  { id: "labor", label: "Labor", href: "/labor" },
  {
    id: "recipe-cost-report",
    label: "Pricing",
    href: "/cost/recipe-cost-report",
  },
  { id: "settings", label: "Settings", href: "/food-costing/settings" },
];

function isRecipeCostReportPath(pathname: string): boolean {
  return (
    pathname.startsWith("/cost/recipe-cost-report") ||
    pathname.startsWith("/recipe-cost-report")
  );
}

function isFoodCostingSubItemActive(href: string, pathname: string): boolean {
  if (pathname === href) return true;
  if (!pathname.startsWith(`${href}/`)) return false;
  if (href === "/cost") return pathname === "/cost";
  return true;
}

function isTeamPath(pathname: string): boolean {
  return (
    pathname === "/team" ||
    pathname.startsWith("/team/company") ||
    pathname.startsWith("/team/tenant")
  );
}

function isSidebarSettingsPath(pathname: string): boolean {
  return pathname.startsWith("/settings");
}

// Team サブメニュー
const teamSubItems = [
  { id: "team-company", label: "Company", href: "/team/company" },
  { id: "team-tenant", label: "Tenant", href: "/team/tenant" },
] as const;

// Team（親メニュー）
const teamNavItem = {
  id: "team",
  label: "Team",
  icon: Users,
} as const;

// Documents のサブメニュー
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
  const {
    companies,
    selectedCompanyId,
    loading: companyLoading,
  } = useCompany();
  const { selectedTenantId, tenants, loading: tenantLoading } = useTenant();
  const canAccessDocumentBox = useMemo(() => {
    if (!selectedCompanyId) return false;
    const role = companies.find((c) => c.id === selectedCompanyId)?.role;
    return role === "company_admin" || role === "company_director";
  }, [companies, selectedCompanyId]);
  const canAccessInvoicing = useMemo(() => {
    if (!selectedCompanyId) return false;
    const companyRole = companies.find((c) => c.id === selectedCompanyId)?.role;
    if (companyRole === "company_admin" || companyRole === "company_director") {
      return true;
    }
    if (!selectedTenantId) return false;
    const tenantRole = tenants.find((t) => t.id === selectedTenantId)?.role;
    return tenantRole === "admin" || tenantRole === "director";
  }, [companies, selectedCompanyId, selectedTenantId, tenants]);
  const { theme, toggleTheme } = useTheme();
  const [sidebarMode, setSidebarMode] = useState<"compact" | "full">("compact");
  const [isHovered, setIsHovered] = useState(false);
  const [isSystemAdmin, setIsSystemAdmin] = useState(false);
  const [licenseExpanded, setLicenseExpanded] = useState(false);
  const [foodCostingExpanded, setFoodCostingExpanded] = useState(false);
  const [teamExpanded, setTeamExpanded] = useState(false);
  const [pendingCount, setPendingCount] = useState(0);
  const [sidebarAlertsEnabled, setSidebarAlertsEnabled] = useState(true);
  const [licenseOverdueCounts, setLicenseOverdueCounts] = useState<{
    employee: number;
    tenant: number;
    company: number;
  }>({ employee: 0, tenant: 0, company: 0 });

  const isFoodCostingSectionActive = isFoodCostingPath(pathname);
  const isDashboardActive = isDashboardPath(pathname);
  const isInvoicingActive = isInvoicingPath(pathname);

  const isLicenseSectionActive =
    pathname.startsWith("/employee-requirements") ||
    pathname.startsWith("/tenant-requirements") ||
    pathname.startsWith("/company-requirements");
  const isTeamSectionActive = isTeamPath(pathname);
  const isSidebarSettingsActive = isSidebarSettingsPath(pathname);

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

  // Team 配下にいるときは開く／それ以外では閉じる
  useEffect(() => {
    setTeamExpanded(isTeamPath(pathname));
  }, [pathname]);

  // サイドバー表示モード（ハンバーガー）をブラウザに永続化
  useEffect(() => {
    try {
      const raw = localStorage.getItem(SIDEBAR_MODE_STORAGE_KEY);
      if (raw === "compact" || raw === "full") {
        setSidebarMode(raw);
      }
    } catch {
      /* ignore quota / private mode */
    }
  }, []);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(SIDEBAR_ALERTS_ENABLED_KEY);
      if (raw === "false") setSidebarAlertsEnabled(false);
      else setSidebarAlertsEnabled(true);
    } catch {
      setSidebarAlertsEnabled(true);
    }

    const onStorage = (e: StorageEvent) => {
      if (e.key !== SIDEBAR_ALERTS_ENABLED_KEY) return;
      setSidebarAlertsEnabled(e.newValue !== "false");
    };
    const onLocalSettingChange = () => {
      try {
        const raw = localStorage.getItem(SIDEBAR_ALERTS_ENABLED_KEY);
        setSidebarAlertsEnabled(raw !== "false");
      } catch {
        setSidebarAlertsEnabled(true);
      }
    };
    window.addEventListener("storage", onStorage);
    window.addEventListener(
      "sidebar-alert-settings-changed",
      onLocalSettingChange,
    );
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener(
        "sidebar-alert-settings-changed",
        onLocalSettingChange,
      );
    };
  }, []);

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

  // Documents: overdue counts for sidebar indicators
  useEffect(() => {
    if (pathname === "/join") return;
    let cancelled = false;

    const calcEmployeeOverdue = async (): Promise<number> => {
      if (!selectedCompanyId) return 0;
      const requirements = await userRequirementsAPI.getAll(selectedCompanyId);
      if (requirements.length === 0) return 0;

      const [{ members }, rows, { assignments }] = await Promise.all([
        apiRequest<{
          members: {
            user_id: string;
            hire_date?: string | null;
          }[];
        }>(
          `/reminder-members?company_id=${encodeURIComponent(selectedCompanyId)}`,
        ),
        mappingUserRequirementsAPI.getMappings({
          user_requirement_ids: requirements.map((r) => r.id),
        }),
        userRequirementAssignmentsAPI.getAssignments({
          user_requirement_ids: requirements.map((r) => r.id),
        }),
      ]);

      const people = members ?? [];
      if (people.length === 0) return 0;
      const userIdSet = new Set(people.map((m) => m.user_id));
      const hireDateByUser = new Map(
        people.map((m) => [m.user_id, m.hire_date ?? null]),
      );

      const mappingByUserReq = new Map<
        string,
        { issuedDate: string | null; deadline: string | null }
      >();
      for (const row of rows) {
        if (!userIdSet.has(row.user_id)) continue;
        mappingByUserReq.set(`${row.user_id}:${row.user_requirement_id}`, {
          issuedDate: row.issued_date ?? null,
          deadline: row.specific_date ?? null,
        });
      }

      const assignedByUserReq = new Set<string>();
      for (const a of assignments ?? []) {
        if (!userIdSet.has(a.user_id)) continue;
        if (a.is_currently_assigned) {
          assignedByUserReq.add(`${a.user_id}:${a.user_requirement_id}`);
        }
      }

      const today = todayYmd();
      let overdue = 0;
      for (const person of people) {
        for (const req of requirements) {
          const key = `${person.user_id}:${req.id}`;
          if (!assignedByUserReq.has(key)) continue;
          const entry = mappingByUserReq.get(key) ?? {
            issuedDate: null,
            deadline: null,
          };

          let expiration: string | null = null;
          if (!req.auto) {
            expiration = entry.deadline;
            if (!expiration) {
              if (req.firstDueOnDate) {
                expiration = req.firstDueOnDate;
              } else if ((req.firstDueDate ?? 0) > 0) {
                const hireDate = hireDateByUser.get(person.user_id);
                if (hireDate) expiration = addDays(hireDate, req.firstDueDate!);
              }
            }
          } else if (entry.issuedDate && (req.validityPeriod ?? 0) > 0) {
            const unit = req.validityPeriodUnit ?? "years";
            if (unit === "months") {
              expiration = addMonths(entry.issuedDate, req.validityPeriod!);
            } else if (unit === "days") {
              expiration = addDays(entry.issuedDate, req.validityPeriod!);
            } else {
              expiration = addYears(entry.issuedDate, req.validityPeriod!);
            }
          } else if (req.firstDueOnDate) {
            expiration = req.firstDueOnDate;
          } else if ((req.firstDueDate ?? 0) > 0) {
            const hireDate = hireDateByUser.get(person.user_id);
            if (hireDate) expiration = addDays(hireDate, req.firstDueDate!);
          }

          if (expiration && expiration <= today) overdue += 1;
        }
      }
      return overdue;
    };

    const calcTenantOverdue = async (): Promise<number> => {
      if (!selectedTenantId) return 0;
      const [requirements, valueTypes] = await Promise.all([
        tenantRequirementsAPI.getAll(selectedTenantId),
        tenantRequirementValueTypesAPI.getAll(),
      ]);
      if (requirements.length === 0) return 0;

      const rows = await tenantRequirementRealDataAPI.getByRequirementIds(
        requirements.map((r) => r.id),
      );
      const nameById = new Map(valueTypes.map((vt) => [vt.id, vt.name]));
      const maxGroupByReq = new Map<string, number>();
      for (const row of rows) {
        const prev = maxGroupByReq.get(row.tenant_requirement_id);
        if (prev == null || row.group_key > prev) {
          maxGroupByReq.set(row.tenant_requirement_id, row.group_key);
        }
      }
      const entryByReq = new Map<
        string,
        {
          dueDate: string | null;
          validityValue: string | null;
          validityUnit: "years" | "months" | "days" | null;
          estimatedDueDate: string | null;
        }
      >();
      for (const req of requirements) {
        entryByReq.set(req.id, {
          dueDate: null,
          validityValue: null,
          validityUnit: null,
          estimatedDueDate: null,
        });
      }
      for (const row of rows) {
        if (maxGroupByReq.get(row.tenant_requirement_id) !== row.group_key)
          continue;
        const entry = entryByReq.get(row.tenant_requirement_id);
        if (!entry) continue;
        const name = nameById.get(row.type_id);
        if (name === "Due date") entry.dueDate = row.value ?? null;
        else if (name === "Validity duration (years)") {
          entry.validityValue = row.value ?? null;
          entry.validityUnit = "years";
        } else if (name === "Validity duration (months)") {
          entry.validityValue = row.value ?? null;
          entry.validityUnit = "months";
        } else if (name === "Validity duration (days)") {
          entry.validityValue = row.value ?? null;
          entry.validityUnit = "days";
        } else if (name === "Estimated specific due date") {
          entry.estimatedDueDate = row.value ?? null;
        } else if (
          name === "Estimated due date based on validity duration" &&
          entry.estimatedDueDate == null
        ) {
          entry.estimatedDueDate = row.value ?? null;
        }
      }
      const today = todayYmd();
      let overdue = 0;
      for (const req of requirements) {
        const entry = entryByReq.get(req.id);
        if (!entry) continue;
        let expiration = entry.estimatedDueDate;
        if (
          !expiration &&
          entry.dueDate &&
          entry.validityValue &&
          entry.validityUnit
        ) {
          const n = parseInt(entry.validityValue, 10);
          if (Number.isInteger(n) && n > 0) {
            expiration =
              entry.validityUnit === "years"
                ? addYears(entry.dueDate, n)
                : entry.validityUnit === "months"
                  ? addMonths(entry.dueDate, n)
                  : addDays(entry.dueDate, n);
          }
        }
        if (expiration && expiration <= today) overdue += 1;
      }
      return overdue;
    };

    const calcCompanyOverdue = async (): Promise<number> => {
      if (!selectedCompanyId) return 0;
      const [requirements, valueTypes] = await Promise.all([
        companyRequirementsAPI.getAll(selectedCompanyId),
        companyRequirementValueTypesAPI.getAll(),
      ]);
      if (requirements.length === 0) return 0;

      const rows = await companyRequirementRealDataAPI.getByRequirementIds(
        requirements.map((r) => r.id),
      );
      const nameById = new Map(valueTypes.map((vt) => [vt.id, vt.name]));
      const maxGroupByReq = new Map<string, number>();
      for (const row of rows) {
        const prev = maxGroupByReq.get(row.company_requirement_id);
        if (prev == null || row.group_key > prev) {
          maxGroupByReq.set(row.company_requirement_id, row.group_key);
        }
      }
      const entryByReq = new Map<
        string,
        {
          dueDate: string | null;
          validityValue: string | null;
          validityUnit: "years" | "months" | "days" | null;
          estimatedDueDate: string | null;
        }
      >();
      for (const req of requirements) {
        entryByReq.set(req.id, {
          dueDate: null,
          validityValue: null,
          validityUnit: null,
          estimatedDueDate: null,
        });
      }
      for (const row of rows) {
        if (maxGroupByReq.get(row.company_requirement_id) !== row.group_key)
          continue;
        const entry = entryByReq.get(row.company_requirement_id);
        if (!entry) continue;
        const name = nameById.get(row.type_id);
        if (name === "Due date") entry.dueDate = row.value ?? null;
        else if (name === "Validity duration (years)") {
          entry.validityValue = row.value ?? null;
          entry.validityUnit = "years";
        } else if (name === "Validity duration (months)") {
          entry.validityValue = row.value ?? null;
          entry.validityUnit = "months";
        } else if (name === "Validity duration (days)") {
          entry.validityValue = row.value ?? null;
          entry.validityUnit = "days";
        } else if (name === "Estimated specific due date") {
          entry.estimatedDueDate = row.value ?? null;
        } else if (
          name === "Estimated due date based on validity duration" &&
          entry.estimatedDueDate == null
        ) {
          entry.estimatedDueDate = row.value ?? null;
        }
      }
      const today = todayYmd();
      let overdue = 0;
      for (const req of requirements) {
        const entry = entryByReq.get(req.id);
        if (!entry) continue;
        let expiration = entry.estimatedDueDate;
        if (
          !expiration &&
          entry.dueDate &&
          entry.validityValue &&
          entry.validityUnit
        ) {
          const n = parseInt(entry.validityValue, 10);
          if (Number.isInteger(n) && n > 0) {
            expiration =
              entry.validityUnit === "years"
                ? addYears(entry.dueDate, n)
                : entry.validityUnit === "months"
                  ? addMonths(entry.dueDate, n)
                  : addDays(entry.dueDate, n);
          }
        }
        if (expiration && expiration <= today) overdue += 1;
      }
      return overdue;
    };

    void Promise.all([
      calcEmployeeOverdue().catch(() => 0),
      calcTenantOverdue().catch(() => 0),
      calcCompanyOverdue().catch(() => 0),
    ]).then(([employee, tenant, company]) => {
      if (cancelled) return;
      setLicenseOverdueCounts({ employee, tenant, company });
    });

    return () => {
      cancelled = true;
    };
  }, [pathname, selectedCompanyId, selectedTenantId]);

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
    if (pathname.startsWith("/document-box")) return "Upload Box";
    if (pathname.startsWith("/invoicing")) return "Invoicing";
    if (pathname.startsWith("/dashboard")) return "Dashboard";
    if (pathname.startsWith("/settings")) return "Settings";
    if (pathname.startsWith("/cost/recipe-cost-report")) return "Pricing";
    const foodItem = foodCostingSubItems.find((item) =>
      isFoodCostingSubItemActive(item.href, pathname),
    );
    if (foodItem) return foodItem.label;
    const teamItem = teamSubItems.find(
      (item) => pathname === item.href || pathname.startsWith(item.href + "/"),
    );
    if (teamItem) return teamItem.label;
    if (pathname === "/team") return teamNavItem.label;
    return "Food Costing";
  };

  // サイドバーの表示モードを切り替え
  const toggleSidebarMode = () => {
    setSidebarMode((prev) => {
      const next = prev === "compact" ? "full" : "compact";
      try {
        localStorage.setItem(SIDEBAR_MODE_STORAGE_KEY, next);
      } catch {
        /* ignore */
      }
      return next;
    });
  };

  // サイドバーの実際の表示状態を決定
  // コンパクトモード時のみホバーで一時的に開く
  const isSidebarExpanded =
    sidebarMode === "full" || (sidebarMode === "compact" && isHovered);
  const hasDocumentPending = pendingCount > 0;
  const licenseTotalOverdue =
    licenseOverdueCounts.employee +
    licenseOverdueCounts.tenant +
    licenseOverdueCounts.company;
  const showSidebarAlerts = sidebarAlertsEnabled;
  const showDocumentBoxNav = companyLoading || canAccessDocumentBox;
  const showInvoicingNav = companyLoading || tenantLoading || canAccessInvoicing;

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
      {/* ヘッダー（上部64px、左端まで） */}
      <header
        className={`relative z-100 h-[64px] shadow-sm border-b px-8 flex items-center justify-between transition-colors [&_a]:cursor-pointer [&_button:not(:disabled)]:cursor-pointer [&_button:disabled]:cursor-not-allowed [&_select:not(:disabled)]:cursor-pointer ${
          isDark ? "bg-slate-800 border-slate-700" : "bg-white border-gray-200"
        }`}
        style={{ paddingLeft: "30px" }}
      >
        {/* 左側：アプリアイコン + 名前、ハンバーガーメニュー、ページタイトル */}
        <div className="flex items-center space-x-4">
          {/* アプリアイコン + 名前（クリックで Dashboard へ） */}
          <Link
            href="/dashboard"
            className="flex items-center gap-2 rounded-md transition-opacity hover:opacity-80 focus:outline-none"
            aria-label="Go to Dashboard"
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
            className={`inline-flex items-center gap-0 rounded-md p-2 transition-colors ${
              sidebarMode === "compact" ? "justify-center" : "justify-start"
            } ${
              isDark
                ? "text-slate-300 hover:text-blue-400 hover:bg-slate-700"
                : "text-black hover:text-blue-900 hover:bg-blue-50"
            }`}
            title={
              sidebarMode === "compact" ? "Expand sidebar" : "Collapse sidebar"
            }
          >
            {sidebarMode === "full" && (
              <ChevronLeft className="h-4 w-4 -mr-1" />
            )}
            {sidebarMode === "compact" ? (
              <svg
                viewBox="0 0 24 24"
                className="h-5 w-7"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <line x1="2" y1="6" x2="22" y2="6" />
                <line x1="2" y1="12" x2="22" y2="12" />
                <line x1="2" y1="18" x2="22" y2="18" />
              </svg>
            ) : (
              <Menu className="h-5 w-5" />
            )}
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
                <Link
                  href="/dashboard"
                  className={`w-full ${SIDEBAR_NAV_ROW_ALIGN} px-3 py-2 text-left transition-colors border-0 no-underline rounded-md ${
                    isDashboardActive
                      ? isDark
                        ? "text-blue-400 font-semibold"
                        : "text-blue-700 font-semibold"
                      : isDark
                        ? "text-slate-300 hover:text-blue-400"
                        : "text-black hover:text-blue-900"
                  }`}
                  style={{
                    backgroundColor: isDark ? "#1e293b" : "white",
                    transition:
                      "background-color 0.2s ease, border-radius 0.2s ease, color 0.2s ease",
                    color: isDashboardActive
                      ? isDark
                        ? "#60a5fa"
                        : "#1d4ed8"
                      : isDark
                        ? "#cbd5e1"
                        : "#000000",
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
                    e.currentTarget.style.color = isDashboardActive
                      ? isDark
                        ? "#60a5fa"
                        : "#1d4ed8"
                      : isDark
                        ? "#cbd5e1"
                        : "#000000";
                  }}
                >
                  <LayoutDashboard className="h-5 w-5 shrink-0" />
                  {isSidebarExpanded && (
                    <span className="text-sm whitespace-nowrap">Dashboard</span>
                  )}
                </Link>

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
                          : "text-black hover:text-blue-900"
                    }`}
                    style={{
                      backgroundColor: isDark ? "#1e293b" : "white",
                      color: isFoodCostingSectionActive
                        ? isDark
                          ? "#60a5fa"
                          : "#1d4ed8"
                        : isDark
                          ? "#cbd5e1"
                          : "#000000",
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
                          : "#000000";
                    }}
                  >
                    <Utensils className="h-5 w-5 shrink-0" />
                    {isSidebarExpanded && (
                      <span className={SIDEBAR_NAV_LABEL_CHEVRON}>
                        <span className="text-sm whitespace-nowrap">
                          Food Costing
                        </span>
                        {foodCostingExpanded ? (
                          <ChevronDown className="h-4 w-4 shrink-0" />
                        ) : (
                          <ChevronRight className="h-4 w-4 shrink-0" />
                        )}
                      </span>
                    )}
                  </button>
                  {isSidebarExpanded &&
                    foodCostingExpanded &&
                    foodCostingSubItems.map((sub) => {
                      const isActive = isFoodCostingSubItemActive(
                        sub.href,
                        pathname,
                      );
                      return (
                        <Link
                          key={sub.id}
                          href={sub.href}
                          className={`w-[calc(100%-2.5rem)] ml-10 ${FOOD_COSTING_SUB_NAV_ROW_ALIGN} pl-2 pr-3 py-0.5 text-left transition-colors border-0 no-underline rounded-md text-sm ${
                            isActive ? "font-semibold" : ""
                          }`}
                          style={{
                            backgroundColor: isActive
                              ? isDark
                                ? "#334155"
                                : "#dbeafe"
                              : isDark
                                ? "#1e293b"
                                : "white",
                            color: isActive
                              ? isDark
                                ? "#60a5fa"
                                : "#1d4ed8"
                              : isDark
                                ? "#94a3b8"
                                : "#000000",
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
                            e.currentTarget.style.backgroundColor = isActive
                              ? isDark
                                ? "#334155"
                                : "#dbeafe"
                              : isDark
                                ? "#1e293b"
                                : "white";
                            e.currentTarget.style.color = isActive
                              ? isDark
                                ? "#60a5fa"
                                : "#1d4ed8"
                              : isDark
                                ? "#94a3b8"
                                : "#000000";
                          }}
                        >
                          {sub.label}
                        </Link>
                      );
                    })}
                </div>

                {/* Team（クリックで開閉、サブの Company / Tenant で遷移） */}
                <div className="flex flex-col gap-0">
                  <button
                    type="button"
                    onClick={() => setTeamExpanded((e) => !e)}
                    className={`w-full ${SIDEBAR_TEAM_NAV_ROW_ALIGN} px-3 py-1 text-left transition-colors border-0 rounded-md cursor-pointer ${
                      isTeamSectionActive
                        ? isDark
                          ? "text-blue-400 font-semibold"
                          : "text-blue-700 font-semibold"
                        : isDark
                          ? "text-slate-300 hover:text-blue-400"
                          : "text-black hover:text-blue-900"
                    }`}
                    style={{
                      backgroundColor: isDark ? "#1e293b" : "white",
                      color: isTeamSectionActive
                        ? isDark
                          ? "#60a5fa"
                          : "#1d4ed8"
                        : isDark
                          ? "#cbd5e1"
                          : "#000000",
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
                      e.currentTarget.style.color = isTeamSectionActive
                        ? isDark
                          ? "#60a5fa"
                          : "#1d4ed8"
                        : isDark
                          ? "#cbd5e1"
                          : "#000000";
                    }}
                  >
                    <TeamNavIcon className="h-5 w-5 shrink-0" />
                    {isSidebarExpanded && (
                      <span className={SIDEBAR_NAV_LABEL_CHEVRON}>
                        <span className="text-sm whitespace-nowrap">
                          {teamNavItem.label}
                        </span>
                        {teamExpanded ? (
                          <ChevronDown className="h-4 w-4 shrink-0" />
                        ) : (
                          <ChevronRight className="h-4 w-4 shrink-0" />
                        )}
                      </span>
                    )}
                  </button>
                  {isSidebarExpanded &&
                    teamExpanded &&
                    teamSubItems.map((sub) => {
                      const isActive =
                        pathname === sub.href ||
                        pathname.startsWith(sub.href + "/");
                      return (
                        <Link
                          key={sub.id}
                          href={sub.href}
                          className={`w-[calc(100%-2.5rem)] ml-10 ${FOOD_COSTING_SUB_NAV_ROW_ALIGN} pl-2 pr-3 py-0.5 text-left transition-colors border-0 no-underline rounded-md text-sm ${
                            isActive ? "font-semibold" : ""
                          }`}
                          style={{
                            backgroundColor: isActive
                              ? isDark
                                ? "#334155"
                                : "#dbeafe"
                              : isDark
                                ? "#1e293b"
                                : "white",
                            color: isActive
                              ? isDark
                                ? "#60a5fa"
                                : "#1d4ed8"
                              : isDark
                                ? "#94a3b8"
                                : "#000000",
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
                            e.currentTarget.style.backgroundColor = isActive
                              ? isDark
                                ? "#334155"
                                : "#dbeafe"
                              : isDark
                                ? "#1e293b"
                                : "white";
                            e.currentTarget.style.color = isActive
                              ? isDark
                                ? "#60a5fa"
                                : "#1d4ed8"
                              : isDark
                                ? "#94a3b8"
                                : "#000000";
                          }}
                        >
                          {sub.label}
                        </Link>
                      );
                    })}
                </div>

                {showInvoicingNav ? (
                  <Link
                    href={canAccessInvoicing ? "/invoicing" : "#"}
                    className={`w-full ${SIDEBAR_NAV_ROW_ALIGN} px-3 py-2 text-left transition-colors border-0 no-underline rounded-md ${
                      isInvoicingActive
                        ? isDark
                          ? "text-blue-400 font-semibold"
                          : "text-blue-700 font-semibold"
                        : isDark
                          ? "text-slate-300 hover:text-blue-400"
                          : "text-black hover:text-blue-900"
                    }`}
                    style={{
                      backgroundColor: isDark ? "#1e293b" : "white",
                      transition:
                        "background-color 0.2s ease, border-radius 0.2s ease, color 0.2s ease",
                      color: isInvoicingActive
                        ? isDark
                          ? "#60a5fa"
                          : "#1d4ed8"
                        : isDark
                          ? "#cbd5e1"
                          : "#000000",
                    }}
                    onMouseEnter={(e) => {
                      if (!canAccessInvoicing) return;
                      e.currentTarget.style.backgroundColor = isDark
                        ? "#334155"
                        : "#dbeafe";
                      e.currentTarget.style.color = isDark
                        ? "#60a5fa"
                        : "#1d4ed8";
                    }}
                    onMouseLeave={(e) => {
                      if (!canAccessInvoicing) return;
                      e.currentTarget.style.backgroundColor = isDark
                        ? "#1e293b"
                        : "white";
                      e.currentTarget.style.color = isInvoicingActive
                        ? isDark
                          ? "#60a5fa"
                          : "#1d4ed8"
                        : isDark
                          ? "#cbd5e1"
                          : "#000000";
                    }}
                    onClick={(e) => {
                      if (!canAccessInvoicing) e.preventDefault();
                    }}
                    aria-disabled={!canAccessInvoicing}
                  >
                    <Receipt className="h-5 w-5 shrink-0" />
                    {isSidebarExpanded && (
                      <span className="text-sm whitespace-nowrap">
                        Invoicing
                      </span>
                    )}
                  </Link>
                ) : null}

                {showDocumentBoxNav ? (
                  <Link
                    href={canAccessDocumentBox ? "/document-box" : "#"}
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
                          : "#000000",
                    }}
                    onMouseEnter={(e) => {
                      if (!canAccessDocumentBox) return;
                      e.currentTarget.style.backgroundColor = isDark
                        ? "#334155"
                        : "#dbeafe";
                      e.currentTarget.style.color = isDark
                        ? "#60a5fa"
                        : "#1d4ed8";
                    }}
                    onMouseLeave={(e) => {
                      if (!canAccessDocumentBox) return;
                      e.currentTarget.style.backgroundColor = isDark
                        ? "#1e293b"
                        : "white";
                      e.currentTarget.style.color = pathname.startsWith(
                        "/document-box",
                      )
                        ? isDark
                          ? "#60a5fa"
                          : "#1d4ed8"
                        : isDark
                          ? "#cbd5e1"
                          : "#000000";
                    }}
                    onClick={(e) => {
                      if (!canAccessDocumentBox) e.preventDefault();
                    }}
                    aria-disabled={!canAccessDocumentBox}
                  >
                    <div className="relative shrink-0">
                      <Inbox className="h-5 w-5" />
                      {showSidebarAlerts && hasDocumentPending && (
                        <span className="absolute -top-0.5 -right-0.5 h-2 w-2 rounded-full bg-red-400 ring-1 ring-red-500/30 dark:bg-red-500 dark:ring-red-400/45" />
                      )}
                    </div>
                    {isSidebarExpanded && (
                      <span className="text-sm whitespace-nowrap">
                        Upload Box
                      </span>
                    )}
                  </Link>
                ) : null}

                {/* Documents（クリックで開閉、サブの Requirements で遷移） */}
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
                          : "text-black hover:text-blue-900"
                    }`}
                    style={{
                      backgroundColor: isDark ? "#1e293b" : "white",
                      color: isLicenseSectionActive
                        ? isDark
                          ? "#60a5fa"
                          : "#1d4ed8"
                        : isDark
                          ? "#cbd5e1"
                          : "#000000",
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
                          : "#000000";
                    }}
                  >
                    <span className="relative shrink-0">
                      <Award className="h-5 w-5 shrink-0" />
                      {showSidebarAlerts && licenseTotalOverdue > 0 && (
                        <span className="absolute -top-0.5 -right-0.5 h-2 w-2 rounded-full bg-red-400 ring-1 ring-red-500/30 dark:bg-red-500 dark:ring-red-400/45" />
                      )}
                    </span>
                    {isSidebarExpanded && (
                      <span className={SIDEBAR_NAV_LABEL_CHEVRON}>
                        <span className="text-sm whitespace-nowrap">
                          Documents
                        </span>
                        {licenseExpanded ? (
                          <ChevronDown className="h-4 w-4 shrink-0" />
                        ) : (
                          <ChevronRight className="h-4 w-4 shrink-0" />
                        )}
                      </span>
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
                          className={`w-[calc(100%-2.5rem)] ml-10 ${SIDEBAR_SUB_NAV_ROW_ALIGN} pl-2 pr-3 py-1.5 text-left transition-colors border-0 no-underline rounded-md text-sm ${
                            isActive ? "font-semibold" : ""
                          }`}
                          style={{
                            backgroundColor: isActive
                              ? isDark
                                ? "#334155"
                                : "#dbeafe"
                              : isDark
                                ? "#1e293b"
                                : "white",
                            color: isActive
                              ? isDark
                                ? "#60a5fa"
                                : "#1d4ed8"
                              : isDark
                                ? "#94a3b8"
                                : "#000000",
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
                            e.currentTarget.style.backgroundColor = isActive
                              ? isDark
                                ? "#334155"
                                : "#dbeafe"
                              : isDark
                                ? "#1e293b"
                                : "white";
                            e.currentTarget.style.color = isActive
                              ? isDark
                                ? "#60a5fa"
                                : "#1d4ed8"
                              : isDark
                                ? "#94a3b8"
                                : "#000000";
                          }}
                        >
                          <span className="min-w-0 flex-1 leading-tight whitespace-normal">
                            {sub.label}
                          </span>
                          {showSidebarAlerts &&
                            (sub.id === "employee-requirements"
                              ? licenseOverdueCounts.employee
                              : sub.id === "tenant-requirements"
                                ? licenseOverdueCounts.tenant
                                : licenseOverdueCounts.company) > 0 && (
                              <span className="relative -top-3 ml-1 inline-flex h-4 min-w-4 shrink-0 items-center justify-center rounded-full bg-red-400 px-1 text-[10px] font-bold leading-none text-white ring-1 ring-red-500/35 dark:bg-red-500 dark:ring-red-400/40">
                                {(sub.id === "employee-requirements"
                                  ? licenseOverdueCounts.employee
                                  : sub.id === "tenant-requirements"
                                    ? licenseOverdueCounts.tenant
                                    : licenseOverdueCounts.company) > 9
                                  ? "9+"
                                  : sub.id === "employee-requirements"
                                    ? licenseOverdueCounts.employee
                                    : sub.id === "tenant-requirements"
                                      ? licenseOverdueCounts.tenant
                                      : licenseOverdueCounts.company}
                              </span>
                            )}
                        </Link>
                      );
                    })}
                </div>

                <Link
                  href="/settings"
                  className={`w-full ${SIDEBAR_NAV_ROW_ALIGN} px-3 py-2 text-left transition-colors border-0 no-underline rounded-md ${
                    isSidebarSettingsActive
                      ? isDark
                        ? "text-blue-400 font-semibold"
                        : "text-blue-700 font-semibold"
                      : isDark
                        ? "text-slate-300 hover:text-blue-400"
                        : "text-black hover:text-blue-900"
                  }`}
                  style={{
                    backgroundColor: isDark ? "#1e293b" : "white",
                    transition:
                      "background-color 0.2s ease, border-radius 0.2s ease, color 0.2s ease",
                    color: isSidebarSettingsActive
                      ? isDark
                        ? "#60a5fa"
                        : "#1d4ed8"
                      : isDark
                        ? "#cbd5e1"
                        : "#000000",
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
                    e.currentTarget.style.color = isSidebarSettingsActive
                      ? isDark
                        ? "#60a5fa"
                        : "#1d4ed8"
                      : isDark
                        ? "#cbd5e1"
                        : "#000000";
                  }}
                >
                  <SlidersHorizontal className="h-5 w-5 shrink-0" />
                  {isSidebarExpanded && (
                    <span className="text-sm whitespace-nowrap">Settings</span>
                  )}
                </Link>

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
                          : "text-black hover:text-blue-900"
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
                            : "#000000",
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
                            : "#000000";
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
            className={`flex-1 min-h-0 transition-colors ${
              isRecipeCostReportPath(pathname)
                ? "flex flex-col overflow-hidden"
                : "overflow-y-auto"
            } ${isDark ? "bg-slate-900" : "bg-gray-50"}`}
            style={
              isRecipeCostReportPath(pathname)
                ? undefined
                : { scrollbarGutter: "stable" }
            }
          >
            {children}
          </main>
        </div>
      </div>
    </div>
  );
}
