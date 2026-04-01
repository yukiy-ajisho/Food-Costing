"use client";

import {
  createContext,
  useContext,
  useState,
  useEffect,
  useMemo,
  useCallback,
  ReactNode,
} from "react";
import { usePathname } from "next/navigation";
import { apiRequest } from "@/lib/api";
import { useCompany } from "@/contexts/CompanyContext";

export interface Tenant {
  id: string;
  name: string;
  type: string;
  created_at: string;
  role: string;
  company_id: string | null;
  company_name: string | null;
}

interface TenantContextType {
  selectedTenantId: string | null;
  tenants: Tenant[];
  setSelectedTenantId: (tenantId: string | null) => void;
  loading: boolean;
  addTenant: (tenant: Tenant) => void;
  refreshTenants: () => void;
}

const TenantContext = createContext<TenantContextType | undefined>(undefined);

export function TenantProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { selectedCompanyId, loading: companyLoading } = useCompany();

  // 常に null で初期化（SSR とクライア初回ペイントを一致させハイドレーションずれを防ぐ）。
  // localStorage は tenants 取得後の Effect 内で復元する。
  const [selectedTenantId, setSelectedTenantIdState] = useState<string | null>(
    null,
  );
  const [allTenants, setAllTenants] = useState<Tenant[]>([]);
  const [loading, setLoading] = useState(true);

  // 複数タブ間の同期
  useEffect(() => {
    if (typeof window === "undefined") return;

    const handleStorageChange = (e: StorageEvent) => {
      if (e.key === "selectedTenantId") {
        const newTenantId = e.newValue;
        if (newTenantId !== selectedTenantId) {
          setSelectedTenantIdState(newTenantId);
        }
      }
    };

    window.addEventListener("storage", handleStorageChange);
    return () => window.removeEventListener("storage", handleStorageChange);
  }, [selectedTenantId]);

  const fetchTenants = useCallback(async () => {
    try {
      const data = await apiRequest<{ tenants: Tenant[] }>("/tenants");
      setAllTenants(data.tenants ?? []);
    } catch (error) {
      console.error("Failed to fetch tenants:", error);
    } finally {
      setLoading(false);
    }
  }, []);

  // /tenants は Provider マウント時のみ取得。
  // pathname を依存に含めるとルート遷移のたびに再取得 → allTenants 更新 →
  // バリデーション Effect が走り、選択テナントが先頭に戻ることがある。
  useEffect(() => {
    if (pathname === "/join") {
      setLoading(false);
      return;
    }
    void fetchTenants();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- マウント時のみ。pathname は初回のガード用
  }, [fetchTenants]);

  // selectedCompanyId でフィルターしたテナント一覧
  const tenants = useMemo(() => {
    if (!selectedCompanyId) return allTenants;
    return allTenants.filter((t) => t.company_id === selectedCompanyId);
  }, [allTenants, selectedCompanyId]);

  // 会社 / テナント一覧に合わせて selectedTenantId を検証。localStorage の復元もここで行う。
  useEffect(() => {
    if (companyLoading) return;
    if (tenants.length === 0) return;

    const existsInFiltered = (id: string | null | undefined) =>
      id != null && tenants.some((t) => t.id === id);

    if (existsInFiltered(selectedTenantId)) {
      return;
    }

    let storedId: string | null = null;
    try {
      storedId = localStorage.getItem("selectedTenantId");
    } catch {
      // プライベートモード等
    }

    if (storedId && existsInFiltered(storedId)) {
      setSelectedTenantIdState(storedId);
      return;
    }

    const firstId = tenants[0]!.id;
    setSelectedTenantIdState(firstId);
    try {
      localStorage.setItem("selectedTenantId", firstId);
    } catch {
      // プライベートモード等
    }
  }, [tenants, companyLoading, selectedTenantId]);

  const setSelectedTenantId = (tenantId: string | null) => {
    setSelectedTenantIdState(tenantId);
    if (typeof window !== "undefined") {
      try {
        if (tenantId) {
          localStorage.setItem("selectedTenantId", tenantId);
        } else {
          localStorage.removeItem("selectedTenantId");
        }
      } catch {
        // プライベートモード等
      }
    }
  };

  const addTenant = (tenant: Tenant) => {
    setAllTenants((prev) => [...prev, tenant]);
  };

  const refreshTenants = useCallback(() => {
    fetchTenants();
  }, [fetchTenants]);

  return (
    <TenantContext.Provider
      value={{
        selectedTenantId,
        tenants,
        setSelectedTenantId,
        loading,
        addTenant,
        refreshTenants,
      }}
    >
      {children}
    </TenantContext.Provider>
  );
}

export function useTenant() {
  const context = useContext(TenantContext);
  if (context === undefined) {
    throw new Error("useTenant must be used within a TenantProvider");
  }
  return context;
}
