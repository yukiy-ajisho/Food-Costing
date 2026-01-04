"use client";

import { createContext, useContext, useState, useEffect, ReactNode } from "react";
import { apiRequest } from "@/lib/api";

interface Tenant {
  id: string;
  name: string;
  type: string;
  created_at: string;
  role: string;
}

interface TenantContextType {
  selectedTenantId: string | null;
  tenants: Tenant[];
  setSelectedTenantId: (tenantId: string | null) => void;
  loading: boolean;
}

const TenantContext = createContext<TenantContextType | undefined>(undefined);

export function TenantProvider({ children }: { children: ReactNode }) {
  const [selectedTenantId, setSelectedTenantIdState] = useState<string | null>(null);
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [loading, setLoading] = useState(true);

  // LocalStorageから選択されたテナントIDを読み込む
  useEffect(() => {
    if (typeof window !== "undefined") {
      const savedTenantId = localStorage.getItem("selectedTenantId");
      if (savedTenantId) {
        setSelectedTenantIdState(savedTenantId);
      }
    }
  }, []);

  // テナント一覧を取得（初回ロード時のみ）
  useEffect(() => {
    const fetchTenants = async () => {
      try {
        const data = await apiRequest<{
          tenants: Tenant[];
        }>("/tenants");
        setTenants(data.tenants || []);

        // テナントが取得できた後、選択されたテナントIDが設定されていない場合は最初のテナントを設定
        // または、選択されたテナントIDがテナント一覧に存在しない場合も最初のテナントを設定
        if (data.tenants && data.tenants.length > 0) {
          if (!selectedTenantId) {
            // 選択されていない場合は最初のテナントを設定
            const firstTenantId = data.tenants[0].id;
            setSelectedTenantIdState(firstTenantId);
            if (typeof window !== "undefined") {
              localStorage.setItem("selectedTenantId", firstTenantId);
            }
          } else {
            // 選択されているが、テナント一覧に存在しない場合は最初のテナントを設定
            const tenantExists = data.tenants.some((t) => t.id === selectedTenantId);
            if (!tenantExists) {
              const firstTenantId = data.tenants[0].id;
              setSelectedTenantIdState(firstTenantId);
              if (typeof window !== "undefined") {
                localStorage.setItem("selectedTenantId", firstTenantId);
              }
            }
          }
        }
      } catch (error) {
        console.error("Failed to fetch tenants:", error);
      } finally {
        setLoading(false);
      }
    };

    fetchTenants();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // 初回ロード時のみ実行

  // 選択されたテナントIDを設定（LocalStorageにも保存）
  const setSelectedTenantId = (tenantId: string | null) => {
    setSelectedTenantIdState(tenantId);
    if (typeof window !== "undefined") {
      if (tenantId) {
        localStorage.setItem("selectedTenantId", tenantId);
      } else {
        localStorage.removeItem("selectedTenantId");
      }
    }
  };

  return (
    <TenantContext.Provider
      value={{
        selectedTenantId,
        tenants,
        setSelectedTenantId,
        loading,
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

