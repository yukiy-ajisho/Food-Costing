"use client";

import { createContext, useContext, useState, useEffect, ReactNode } from "react";
import { apiRequest } from "@/lib/api";

interface Tenant {
  id: string;
  name: string;
  type: "restaurant" | "vendor";
  created_at?: string;
  role?: "admin" | "manager" | "staff"; // ユーザーがそのテナントで持つ役割
}

interface TenantContextType {
  currentTenant: Tenant | null;
  tenants: Tenant[];
  loading: boolean;
  // Phase 2までテナント選択UIは不要。setCurrentTenantはPhase 2でCedarベースの選択UI実装時に使用
  setCurrentTenant: (tenant: Tenant | null) => void;
  refreshTenants: () => Promise<void>;
}

const TenantContext = createContext<TenantContextType | undefined>(undefined);

const TENANT_STORAGE_KEY = "current_tenant_id";

export function TenantProvider({ children }: { children: ReactNode }) {
  const [currentTenant, setCurrentTenantState] = useState<Tenant | null>(null);
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [loading, setLoading] = useState(true);

  // ローカルストレージから現在のテナントIDを読み込む
  useEffect(() => {
    const loadStoredTenant = () => {
      if (typeof window === "undefined") return;

      const storedTenantId = localStorage.getItem(TENANT_STORAGE_KEY);
      if (storedTenantId) {
        // テナント一覧が読み込まれた後、保存されたIDでテナントを設定
        const tenant = tenants.find((t) => t.id === storedTenantId);
        if (tenant) {
          setCurrentTenantState(tenant);
        }
      }
    };

    if (tenants.length > 0) {
      loadStoredTenant();
    }
  }, [tenants]);

  // テナント一覧を取得
  const refreshTenants = async () => {
    try {
      setLoading(true);

      // ユーザーが属するテナント一覧を取得
      // 注意: テナント一覧取得時はtenantIdを渡さない（nullを明示的に渡す）
      const data = await apiRequest<{ tenants: Tenant[] }>("/tenants", {}, null);
      setTenants(data.tenants || []);

      // テナントが1つ以上ある場合、最初のテナントを選択
      if (data.tenants && data.tenants.length > 0) {
        const storedTenantId = localStorage.getItem(TENANT_STORAGE_KEY);
        const tenantToSelect =
          data.tenants.find((t: Tenant) => t.id === storedTenantId) ||
          data.tenants[0];
        setCurrentTenantState(tenantToSelect);
        localStorage.setItem(TENANT_STORAGE_KEY, tenantToSelect.id);
      }
    } catch (error) {
      console.error("Error fetching tenants:", error);
      setTenants([]);
      setCurrentTenantState(null);
    } finally {
      setLoading(false);
    }
  };

  // 初回マウント時にテナント一覧を取得
  useEffect(() => {
    refreshTenants();
  }, []);

  // 現在のテナントを設定（ローカルストレージにも保存）
  const setCurrentTenant = (tenant: Tenant | null) => {
    setCurrentTenantState(tenant);
    if (tenant) {
      localStorage.setItem(TENANT_STORAGE_KEY, tenant.id);
    } else {
      localStorage.removeItem(TENANT_STORAGE_KEY);
    }
  };

  return (
    <TenantContext.Provider
      value={{
        currentTenant,
        tenants,
        loading,
        setCurrentTenant,
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

