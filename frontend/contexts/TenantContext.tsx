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

  const [selectedTenantId, setSelectedTenantIdState] = useState<string | null>(
    () => {
      if (typeof window !== "undefined") {
        return localStorage.getItem("selectedTenantId");
      }
      return null;
    }
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

  // 会社が変わったとき、または tenants が変わったとき → selectedTenantId を検証・リセット
  useEffect(() => {
    // CompanyContext がまだ読み込み中なら待つ
    if (companyLoading) return;
    if (tenants.length === 0) return;

    const existsInFiltered = tenants.some((t) => t.id === selectedTenantId);
    if (!existsInFiltered) {
      const firstId = tenants[0].id;
      setSelectedTenantIdState(firstId);
      try {
        localStorage.setItem("selectedTenantId", firstId);
      } catch {
        // プライベートモード等
      }
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
