"use client";

import {
  createContext,
  useContext,
  useState,
  useEffect,
  ReactNode,
} from "react";
import { usePathname } from "next/navigation";
import { apiRequest } from "@/lib/api";

export interface Company {
  id: string;
  company_name: string;
  role?: string;
}

interface CompanyContextType {
  companies: Company[];
  selectedCompanyId: string | null;
  setSelectedCompanyId: (companyId: string | null) => void;
  loading: boolean;
  addCompany: (company: Company) => void;
}

const CompanyContext = createContext<CompanyContextType | undefined>(undefined);

export function CompanyProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname();

  // 常に null で初期化（SSR とクライア初回ペイントを一致させハイドレーションずれを防ぐ）。
  // localStorage からの復元は fetchCompanies 内で行う。
  const [selectedCompanyId, setSelectedCompanyIdState] = useState<
    string | null
  >(null);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [loading, setLoading] = useState(true);

  // 複数タブ間の同期
  useEffect(() => {
    if (typeof window === "undefined") return;

    const handleStorageChange = (e: StorageEvent) => {
      if (e.key === "selectedCompanyId") {
        const newId = e.newValue;
        if (newId !== selectedCompanyId) {
          setSelectedCompanyIdState(newId);
        }
      }
    };

    window.addEventListener("storage", handleStorageChange);
    return () => window.removeEventListener("storage", handleStorageChange);
  }, [selectedCompanyId]);

  // 会社一覧を取得
  useEffect(() => {
    if (pathname === "/join") {
      setLoading(false);
      return;
    }

    const fetchCompanies = async () => {
      try {
        const data = await apiRequest<{ companies: Company[] }>("/companies");
        const list = data.companies ?? [];
        setCompanies(list);

        if (list.length === 0) return;

        // 1社のみ、または localStorage に保存済みの選択が無効な場合は先頭を自動選択
        const storedId =
          typeof window !== "undefined"
            ? localStorage.getItem("selectedCompanyId")
            : null;
        const storedExists = storedId
          ? list.some((c) => c.id === storedId)
          : false;

        if (storedId && storedExists) {
          setSelectedCompanyIdState(storedId);
        } else {
          const firstId = list[0].id;
          setSelectedCompanyIdState(firstId);
          try {
            localStorage.setItem("selectedCompanyId", firstId);
          } catch {
            // プライベートモード等
          }
        }
      } catch (error) {
        console.error("Failed to fetch companies:", error);
      } finally {
        setLoading(false);
      }
    };

    fetchCompanies();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  const setSelectedCompanyId = (companyId: string | null) => {
    setSelectedCompanyIdState(companyId);
    if (typeof window !== "undefined") {
      try {
        if (companyId) {
          localStorage.setItem("selectedCompanyId", companyId);
        } else {
          localStorage.removeItem("selectedCompanyId");
        }
      } catch {
        // プライベートモード等
      }
    }
  };

  const addCompany = (company: Company) => {
    setCompanies((prev) => [...prev, company]);
  };

  return (
    <CompanyContext.Provider
      value={{
        companies,
        selectedCompanyId,
        setSelectedCompanyId,
        loading,
        addCompany,
      }}
    >
      {children}
    </CompanyContext.Provider>
  );
}

export function useCompany() {
  const context = useContext(CompanyContext);
  if (context === undefined) {
    throw new Error("useCompany must be used within a CompanyProvider");
  }
  return context;
}
