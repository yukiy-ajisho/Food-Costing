"use client";

import { createContext, useContext, useState, useEffect, ReactNode } from "react";
import { usePathname } from "next/navigation";
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
  const pathname = usePathname();
  
  // LocalStorageから選択されたテナントIDを同期的に読み込む（SSR対応）
  const [selectedTenantId, setSelectedTenantIdState] = useState<string | null>(() => {
    if (typeof window !== "undefined") {
      return localStorage.getItem("selectedTenantId");
    }
    return null;
  });
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [loading, setLoading] = useState(true);

  // 複数タブ間の同期: storageイベントをリッスン
  useEffect(() => {
    if (typeof window === "undefined") return;

    const handleStorageChange = (e: StorageEvent) => {
      // storageイベントは他のタブでの変更のみ発火する
      if (e.key === "selectedTenantId") {
        const newTenantId = e.newValue;
        if (newTenantId !== selectedTenantId) {
          setSelectedTenantIdState(newTenantId);
        }
      }
    };

    window.addEventListener("storage", handleStorageChange);
    return () => {
      window.removeEventListener("storage", handleStorageChange);
    };
  }, [selectedTenantId]);

  // テナント一覧を取得（selectedTenantIdが設定された後、または初回ロード時）
  useEffect(() => {
    // /joinページではAPIリクエストをスキップ（未認証ユーザーが使用するため）
    if (pathname === "/join") {
      setLoading(false);
      return;
    }

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
              try {
                localStorage.setItem("selectedTenantId", firstTenantId);
              } catch (error) {
                // プライベートモードなどでlocalStorageが使用できない場合
                console.warn("Failed to save selectedTenantId to localStorage:", error);
              }
            }
          } else {
            // 選択されているが、テナント一覧に存在しない場合は最初のテナントを設定
            const tenantExists = data.tenants.some((t) => t.id === selectedTenantId);
            if (!tenantExists) {
              const firstTenantId = data.tenants[0].id;
              setSelectedTenantIdState(firstTenantId);
              if (typeof window !== "undefined") {
                try {
                  localStorage.setItem("selectedTenantId", firstTenantId);
                } catch (error) {
                  // プライベートモードなどでlocalStorageが使用できない場合
                  console.warn("Failed to save selectedTenantId to localStorage:", error);
                }
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
  }, [selectedTenantId, pathname]); // selectedTenantIdとpathnameに依存

  // 選択されたテナントIDを設定（LocalStorageにも保存）
  const setSelectedTenantId = (tenantId: string | null) => {
    setSelectedTenantIdState(tenantId);
    if (typeof window !== "undefined") {
      try {
        if (tenantId) {
          localStorage.setItem("selectedTenantId", tenantId);
        } else {
          localStorage.removeItem("selectedTenantId");
        }
        // 同じタブ内ではReact Contextが自動的に変更を通知するため、カスタムイベントは不要
        // storageイベントは他のタブでの変更を検知するために使用される
      } catch (error) {
        // プライベートモードなどでlocalStorageが使用できない場合
        console.warn("Failed to save selectedTenantId to localStorage:", error);
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

