"use client";

import { useState, useEffect, useMemo } from "react";
import { apiRequest } from "@/lib/api";
import { useTheme } from "@/contexts/ThemeContext";
import { useCompany, type Company } from "@/contexts/CompanyContext";
import { useTenant } from "@/contexts/TenantContext";
import {
  Edit,
  Save,
  X,
  Trash2,
  User,
  UserPlus,
  Mail,
  Plus,
  Building2,
  Store,
} from "lucide-react";

interface TenantMember {
  user_id: string;
  role: "admin" | "director" | "manager" | "staff";
  member_since: string;
  name?: string;
  email?: string;
  avatar_url?: string;
}

interface TenantWithMembers {
  id: string;
  name: string;
  type: string;
  created_at: string;
  role: string;
  members: TenantMember[];
}

interface Invitation {
  id: string;
  email: string;
  role: "director" | "manager" | "staff";
  tenant_id: string;
  status: "pending" | "accepted" | "expired" | "canceled";
  email_status?: "delivered" | "failed" | null;
  created_at: string;
  expires_at: string;
}

interface CompanyMemberRow {
  user_id: string;
  role: string;
  email?: string | null;
  display_name?: string | null;
}

interface CompanyInvitationRow {
  id: string;
  email: string;
  company_id: string;
  status: "pending" | "accepted" | "expired" | "canceled";
  email_status?: "delivered" | "failed" | null;
  created_at: string;
  expires_at: string;
}

export default function TeamPage() {
  const { theme } = useTheme();
  const {
    companies,
    selectedCompanyId,
    setSelectedCompanyId,
    loading: companyLoading,
    addCompany,
  } = useCompany();
  const {
    tenants: companyTenants,
    selectedTenantId: teamSelectedTenantId,
    setSelectedTenantId: setTeamSelectedTenantId,
    addTenant,
  } = useTenant();
  const [showCreateCompanyModal, setShowCreateCompanyModal] = useState(false);
  const [newCompanyName, setNewCompanyName] = useState("");
  const [creatingCompany, setCreatingCompany] = useState(false);
  // 選択中テナントの情報を表示
  const [tenantsWithMembers, setTenantsWithMembers] = useState<
    TenantWithMembers[]
  >([]);
  const [loading, setLoading] = useState(true);
  const [showInviteForm, setShowInviteForm] = useState<Map<string, boolean>>(
    new Map(),
  );
  const [inviteEmail, setInviteEmail] = useState<Map<string, string>>(
    new Map(),
  );
  const [inviteRole, setInviteRole] = useState<
    Map<string, "director" | "manager" | "staff">
  >(new Map());
  const [sendingInvite, setSendingInvite] = useState<Set<string>>(new Set());
  /** テナントごとにメンバーのロール編集モード（Edit で表示切替） */
  const [editingTenantMembers, setEditingTenantMembers] = useState<Set<string>>(
    new Set(),
  );
  const [memberRoleDrafts, setMemberRoleDrafts] = useState<
    Map<string, Map<string, TenantMember["role"]>>
  >(new Map());
  const [savingMemberEdits, setSavingMemberEdits] = useState<Set<string>>(
    new Set(),
  );
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [loadingInvitations, setLoadingInvitations] = useState(false);
  const [showCreateTenantModal, setShowCreateTenantModal] = useState(false);
  const [newTenantName, setNewTenantName] = useState("");
  const [newTenantType, setNewTenantType] = useState<"restaurant" | "vendor">(
    "restaurant",
  );
  const [creatingTenant, setCreatingTenant] = useState(false);
  // Company directors: members + invitations (when a company is selected)
  const [companyMembers, setCompanyMembers] = useState<CompanyMemberRow[]>([]);
  const [companyInvitations, setCompanyInvitations] = useState<
    CompanyInvitationRow[]
  >([]);
  const [loadingCompanyMembers, setLoadingCompanyMembers] = useState(false);
  const [loadingCompanyInvitations, setLoadingCompanyInvitations] =
    useState(false);
  const [showInviteDirectorForm, setShowInviteDirectorForm] = useState(false);
  const [inviteDirectorEmail, setInviteDirectorEmail] = useState("");
  const [sendingInviteDirector, setSendingInviteDirector] = useState(false);

  const isDark = theme === "dark";

  const selectedCompanyLabel = useMemo(() => {
    if (!selectedCompanyId) return null;
    return (
      companies.find((c) => c.id === selectedCompanyId)?.company_name ?? null
    );
  }, [companies, selectedCompanyId]);

  const tenantPayloadInSync =
    tenantsWithMembers.length > 0 &&
    tenantsWithMembers[0].id === teamSelectedTenantId;
  const selectedTenantDetail = tenantPayloadInSync
    ? tenantsWithMembers[0]
    : undefined;
  const selectedTenantDisplayName =
    selectedTenantDetail?.name ??
    companyTenants.find((t) => t.id === teamSelectedTenantId)?.name ??
    "";

  /** Team ページ: Company / Tenant で共通のセクション枠 */
  const teamSectionShell = `rounded-xl border overflow-hidden shadow-sm ${
    isDark ? "bg-slate-800/95 border-slate-600" : "bg-white border-gray-200"
  }`;
  const companyAccentBar = isDark
    ? "bg-gradient-to-r from-violet-600 to-indigo-500"
    : "bg-gradient-to-r from-violet-500 to-indigo-500";
  const tenantAccentBar = isDark
    ? "bg-gradient-to-r from-teal-600 to-emerald-600"
    : "bg-gradient-to-r from-teal-500 to-emerald-500";
  /** Invite director / New company / New tenant などプライマリの青ボタン */
  const teamPrimaryBlueButtonClass = `flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium shrink-0 ${
    isDark
      ? "bg-blue-600 hover:bg-blue-700 text-white"
      : "bg-blue-500 hover:bg-blue-600 text-white"
  }`;
  /** Edit / Cancel などセカンダリのアウトラインボタン */
  const teamOutlineActionButtonClass = `flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium shrink-0 ${
    isDark
      ? "bg-slate-600 hover:bg-slate-500 text-slate-100 border border-slate-500"
      : "bg-gray-100 hover:bg-gray-200 text-gray-800 border border-gray-200"
  }`;
  const dashedEmptyClass = `rounded-lg border-2 border-dashed p-8 text-center text-sm ${
    isDark
      ? "border-slate-600 text-slate-400 bg-slate-900/20"
      : "border-gray-300 text-gray-600 bg-gray-50/50"
  }`;

  // 選択した会社のメンバー一覧を取得
  useEffect(() => {
    if (!selectedCompanyId) {
      setCompanyMembers([]);
      return;
    }
    const fetchCompanyMembers = async () => {
      try {
        setLoadingCompanyMembers(true);
        const data = await apiRequest<{ members: CompanyMemberRow[] }>(
          `/companies/${selectedCompanyId}/members`,
        );
        setCompanyMembers(data.members ?? []);
      } catch (e) {
        console.error("Failed to fetch company members:", e);
        setCompanyMembers([]);
      } finally {
        setLoadingCompanyMembers(false);
      }
    };
    fetchCompanyMembers();
  }, [selectedCompanyId]);

  // 選択した会社の招待一覧を取得
  useEffect(() => {
    if (!selectedCompanyId) {
      setCompanyInvitations([]);
      return;
    }
    const fetchCompanyInvitations = async () => {
      try {
        setLoadingCompanyInvitations(true);
        const data = await apiRequest<{
          invitations: CompanyInvitationRow[];
        }>(`/companies/${selectedCompanyId}/invitations`);
        setCompanyInvitations(data.invitations ?? []);
      } catch (e) {
        console.error("Failed to fetch company invitations:", e);
        setCompanyInvitations([]);
      } finally {
        setLoadingCompanyInvitations(false);
      }
    };
    fetchCompanyInvitations();
  }, [selectedCompanyId]);

  // テナント情報とメンバー一覧を取得（Team ページ内の選択に基づく）
  useEffect(() => {
    if (!teamSelectedTenantId) {
      setTenantsWithMembers([]);
      setLoading(false);
      return;
    }

    const fetchTeamData = async () => {
      try {
        setLoading(true);

        const [tenantDetail, membersData] = await Promise.all([
          apiRequest<{
            id: string;
            name: string;
            type: string;
            created_at: string;
            role: string;
          }>(`/tenants/${teamSelectedTenantId}`, {}, teamSelectedTenantId),
          apiRequest<{ members: TenantMember[] }>(
            `/tenants/${teamSelectedTenantId}/members`,
            {},
            teamSelectedTenantId,
          ),
        ]);

        const tenantWithMembers = {
          ...tenantDetail,
          members: membersData.members || [],
        };

        setTenantsWithMembers([tenantWithMembers]);
      } catch (error) {
        console.error("Failed to fetch team data:", error);
      } finally {
        setLoading(false);
      }
    };

    fetchTeamData();
  }, [teamSelectedTenantId]);

  // 招待一覧を取得（選択されたテナント。API に tenantId を渡して該当テナントの招待のみ取得）
  const fetchInvitations = async () => {
    if (!teamSelectedTenantId) return;

    try {
      setLoadingInvitations(true);
      const data = await apiRequest<{ invitations: Invitation[] }>(
        "/invite",
        {},
        teamSelectedTenantId,
      );
      setInvitations(data.invitations || []);
    } catch (error) {
      console.error("Failed to fetch invitations:", error);
      const apiError = error as { status?: number };
      if (apiError?.status !== 403) {
        setInvitations([]);
      }
    } finally {
      setLoadingInvitations(false);
    }
  };

  useEffect(() => {
    fetchInvitations();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [teamSelectedTenantId]);

  // 会社を作成
  const handleCreateCompany = async () => {
    const name = newCompanyName.trim();
    if (!name) {
      alert("Company name is required");
      return;
    }
    try {
      setCreatingCompany(true);
      const company = await apiRequest<Company>("/companies", {
        method: "POST",
        body: JSON.stringify({ company_name: name }),
      });
      addCompany(company);
      setSelectedCompanyId(company.id);
      setShowCreateCompanyModal(false);
      setNewCompanyName("");
    } catch (error: unknown) {
      console.error("Failed to create company:", error);
      const apiError = error as { details?: string; error?: string };
      alert(apiError.details || apiError.error || "Failed to create company");
    } finally {
      setCreatingCompany(false);
    }
  };

  // 会社配下にテナントを作成（会社選択時のみ）
  const handleCreateTenant = async () => {
    if (!selectedCompanyId) {
      alert("Please select a company first");
      return;
    }
    if (
      !newTenantName.trim() ||
      newTenantName.length < 5 ||
      newTenantName.length > 50
    ) {
      alert("Tenant name must be between 5 and 50 characters");
      return;
    }

    try {
      setCreatingTenant(true);
      const newTenant = await apiRequest<{
        id: string;
        name: string;
        type: string;
        created_at: string;
        role: string;
      }>(`/companies/${selectedCompanyId}/tenants`, {
        method: "POST",
        body: JSON.stringify({
          name: newTenantName.trim(),
          type: newTenantType,
        }),
      });

      addTenant({
        id: newTenant.id,
        name: newTenant.name,
        type: newTenant.type,
        created_at: newTenant.created_at,
        role: newTenant.role,
        company_id: selectedCompanyId,
        company_name:
          companies.find((c) => c.id === selectedCompanyId)?.company_name ??
          null,
      });
      setTeamSelectedTenantId(newTenant.id);
      setShowCreateTenantModal(false);
      setNewTenantName("");
      setNewTenantType("restaurant");
    } catch (error: unknown) {
      console.error("Failed to create tenant:", error);
      const apiError = error as { details?: string; error?: string };
      alert(apiError.details || apiError.error || "Failed to create tenant");
    } finally {
      setCreatingTenant(false);
    }
  };

  // Director を招待（会社選択時）
  const handleInviteDirector = async () => {
    if (!selectedCompanyId) return;
    const email = inviteDirectorEmail.trim().toLowerCase();
    if (!email) {
      alert("Email is required");
      return;
    }
    try {
      setSendingInviteDirector(true);
      await apiRequest(`/companies/${selectedCompanyId}/invitations`, {
        method: "POST",
        body: JSON.stringify({ email }),
      });
      setInviteDirectorEmail("");
      setShowInviteDirectorForm(false);
      const data = await apiRequest<{
        invitations: CompanyInvitationRow[];
      }>(`/companies/${selectedCompanyId}/invitations`);
      setCompanyInvitations(data.invitations ?? []);
    } catch (error: unknown) {
      const apiError = error as { details?: string; error?: string };
      alert(apiError.details || apiError.error || "Failed to send invitation");
    } finally {
      setSendingInviteDirector(false);
    }
  };

  // 会社招待をキャンセル
  const handleCancelCompanyInvitation = async (invitationId: string) => {
    if (!selectedCompanyId) return;
    if (!confirm("Cancel this invitation?")) return;
    try {
      await apiRequest(
        `/companies/${selectedCompanyId}/invitations/${invitationId}`,
        { method: "DELETE" },
      );
      const data = await apiRequest<{
        invitations: CompanyInvitationRow[];
      }>(`/companies/${selectedCompanyId}/invitations`);
      setCompanyInvitations(data.invitations ?? []);
    } catch (error: unknown) {
      const apiError = error as { details?: string; error?: string };
      alert(
        apiError.details || apiError.error || "Failed to cancel invitation",
      );
    }
  };

  // 統合ステータスを取得する関数
  const getDisplayStatus = (invitation: Invitation): string => {
    // 最終状態を優先
    if (invitation.status === "accepted") return "accepted";
    if (invitation.status === "expired") return "expired";
    if (invitation.status === "canceled") return "canceled";

    // pendingの場合、メール配信状態を表示
    if (invitation.status === "pending") {
      if (invitation.email_status === "failed") return "failed";
      return "delivered"; // delivered または null
    }

    return "delivered"; // フォールバック
  };

  const getCompanyInvitationDisplayStatus = (
    invitation: CompanyInvitationRow,
  ): string => {
    if (invitation.status === "accepted") return "accepted";
    if (invitation.status === "expired") return "expired";
    if (invitation.status === "canceled") return "canceled";
    if (invitation.status === "pending") {
      if (invitation.email_status === "failed") return "failed";
      return "delivered";
    }
    return "delivered";
  };

  // メンバーの役割を変更（成功時 true）
  const handleChangeMemberRole = async (
    tenantId: string,
    userId: string,
    newRole: "admin" | "director" | "manager" | "staff",
  ): Promise<boolean> => {
    try {
      await apiRequest(
        `/tenants/${tenantId}/members/${userId}/role`,
        {
          method: "PUT",
          body: JSON.stringify({ role: newRole }),
        },
        tenantId,
      );

      setTenantsWithMembers((prev) =>
        prev.map((tenant) =>
          tenant.id === tenantId
            ? {
                ...tenant,
                members: tenant.members.map((m) =>
                  m.user_id === userId ? { ...m, role: newRole } : m,
                ),
              }
            : tenant,
        ),
      );
      return true;
    } catch (error) {
      console.error("Failed to change member role:", error);
      alert("Failed to change member role");
      return false;
    }
  };

  const cancelEditingTenantMembers = (tenantId: string) => {
    setEditingTenantMembers((prev) => {
      const next = new Set(prev);
      next.delete(tenantId);
      return next;
    });
    setMemberRoleDrafts((prev) => {
      const next = new Map(prev);
      next.delete(tenantId);
      return next;
    });
  };

  // メンバーを削除
  const handleRemoveMember = async (tenantId: string, userId: string) => {
    if (
      !confirm("Are you sure you want to remove this member from the tenant?")
    ) {
      return;
    }

    try {
      await apiRequest(
        `/tenants/${tenantId}/members/${userId}`,
        { method: "DELETE" },
        tenantId,
      );

      setTenantsWithMembers((prev) => {
        const next = prev.map((tenant) =>
          tenant.id === tenantId
            ? {
                ...tenant,
                members: tenant.members.filter((m) => m.user_id !== userId),
              }
            : tenant,
        );
        const t = next.find((x) => x.id === tenantId);
        if (t?.members.length === 0) {
          queueMicrotask(() => cancelEditingTenantMembers(tenantId));
        }
        return next;
      });
      setMemberRoleDrafts((prev) => {
        const draft = prev.get(tenantId);
        if (!draft) return prev;
        const nextDraft = new Map(draft);
        nextDraft.delete(userId);
        const next = new Map(prev);
        next.set(tenantId, nextDraft);
        return next;
      });
    } catch (error) {
      console.error("Failed to remove member:", error);
      alert("Failed to remove member");
    }
  };

  const beginEditingTenantMembers = (
    tenantId: string,
    members: TenantMember[],
  ) => {
    setEditingTenantMembers((prev) => new Set(prev).add(tenantId));
    setMemberRoleDrafts((prev) => {
      const next = new Map(prev);
      const draft = new Map<string, TenantMember["role"]>();
      for (const m of members) {
        draft.set(m.user_id, m.role);
      }
      next.set(tenantId, draft);
      return next;
    });
  };

  const setMemberRoleDraft = (
    tenantId: string,
    userId: string,
    role: TenantMember["role"],
  ) => {
    setMemberRoleDrafts((prev) => {
      const next = new Map(prev);
      const draft = new Map(next.get(tenantId) ?? []);
      draft.set(userId, role);
      next.set(tenantId, draft);
      return next;
    });
  };

  const saveTenantMemberEdits = async (tenantId: string) => {
    const tenant = tenantsWithMembers.find((t) => t.id === tenantId);
    const draft = memberRoleDrafts.get(tenantId);
    if (!tenant || !draft) {
      cancelEditingTenantMembers(tenantId);
      return;
    }
    setSavingMemberEdits((prev) => new Set(prev).add(tenantId));
    try {
      for (const m of tenant.members) {
        const desired = draft.get(m.user_id);
        if (desired != null && desired !== m.role) {
          const ok = await handleChangeMemberRole(tenantId, m.user_id, desired);
          if (!ok) return;
        }
      }
      cancelEditingTenantMembers(tenantId);
    } finally {
      setSavingMemberEdits((prev) => {
        const next = new Set(prev);
        next.delete(tenantId);
        return next;
      });
    }
  };

  // 招待を送信
  const handleSendInvite = async (tenantId: string) => {
    const email = inviteEmail.get(tenantId);
    const role = inviteRole.get(tenantId) || "manager";

    if (!email || !email.trim()) {
      alert("Please enter an email address");
      return;
    }

    try {
      setSendingInvite((prev) => new Set(prev).add(tenantId));
      await apiRequest(
        "/invite",
        {
          method: "POST",
          body: JSON.stringify({
            email: email.trim(),
            role,
            tenant_id: tenantId,
          }),
        },
        tenantId,
      );

      // フォームをリセット
      const newEmailMap = new Map(inviteEmail);
      newEmailMap.delete(tenantId);
      setInviteEmail(newEmailMap);

      const newRoleMap = new Map(inviteRole);
      newRoleMap.delete(tenantId);
      setInviteRole(newRoleMap);

      const newShowMap = new Map(showInviteForm);
      newShowMap.set(tenantId, false);
      setShowInviteForm(newShowMap);

      alert("Invitation sent successfully!");

      // 招待一覧を再取得
      await fetchInvitations();
    } catch (error: unknown) {
      console.error("Failed to send invitation:", error);
      const apiError = error as { details?: string; error?: string };
      alert(apiError.details || apiError.error || "Failed to send invitation");
    } finally {
      setSendingInvite((prev) => {
        const next = new Set(prev);
        next.delete(tenantId);
        return next;
      });
    }
  };

  if (companyLoading) {
    return (
      <div className="p-8">
        <div className="flex items-center justify-center h-64">
          <div className="text-lg">Loading...</div>
        </div>
      </div>
    );
  }

  return (
    <div className="p-8">
      <div className="max-w-4xl mx-auto space-y-8">
        {/* Company カードの外: 追加用アクション */}
        <div className="space-y-3">
          {companies.length > 0 ? (
            <div className="flex flex-wrap items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowCreateCompanyModal(true)}
                className={teamPrimaryBlueButtonClass}
              >
                <Plus className="h-4 w-4" />
                New company
              </button>
            </div>
          ) : null}
          {/* Company（親会社・ディレクター・配下ロケーション） */}
          <div className={teamSectionShell}>
            <div className={`h-1 w-full ${companyAccentBar}`} aria-hidden />
            <div className="p-6 space-y-6">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2 min-w-0">
              <h2
                className={`text-xl font-semibold flex items-center gap-2 shrink-0 ${
                  isDark ? "text-slate-100" : "text-gray-900"
                }`}
              >
                <Building2
                  className="h-5 w-5 shrink-0 text-violet-500"
                  aria-hidden
                />
                Company
              </h2>
              {companies.length > 0 ? (
                <div className="flex flex-1 items-center justify-end min-w-0">
                  <div className="flex items-center gap-3 min-w-0 max-w-full">
                    <div
                      className={`h-px w-10 sm:w-14 shrink-0 ${
                        isDark ? "bg-slate-600" : "bg-gray-300"
                      }`}
                      aria-hidden
                    />
                    <span
                      className={`text-lg sm:text-xl font-semibold text-center truncate max-w-[min(100%,20rem)] ${
                        selectedCompanyLabel
                          ? isDark
                            ? "text-slate-100"
                            : "text-gray-900"
                          : isDark
                            ? "text-slate-500"
                            : "text-gray-500"
                      }`}
                    >
                      {selectedCompanyLabel ?? "Select in header"}
                    </span>
                    <div
                      className={`h-px w-10 sm:w-14 shrink-0 ${
                        isDark ? "bg-slate-600" : "bg-gray-300"
                      }`}
                      aria-hidden
                    />
                  </div>
                </div>
              ) : null}
            </div>
            {companies.length === 0 ? (
              <div className="space-y-4">
                <p className={isDark ? "text-slate-300" : "text-gray-600"}>
                  Create a company to manage tenants (stores or locations).
                </p>
                <button
                  onClick={() => setShowCreateCompanyModal(true)}
                  className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium ${
                    isDark
                      ? "bg-blue-600 hover:bg-blue-700 text-white"
                      : "bg-blue-500 hover:bg-blue-600 text-white"
                  }`}
                >
                  <Plus className="h-4 w-4" />
                  Create Company
                </button>
              </div>
            ) : (
              <div className="space-y-6">
                {selectedCompanyId && (
                  <div className="space-y-6">
                    <div
                      className={`p-6 rounded-lg ${
                        isDark ? "bg-slate-800" : "bg-white"
                      }`}
                    >
                      <h2
                        className={`text-xl font-semibold mb-4 ${
                          isDark ? "text-slate-100" : "text-gray-900"
                        }`}
                      >
                        Team Members ({companyMembers.length})
                      </h2>
                      {loadingCompanyMembers ? (
                        <div
                          className={`text-center py-8 ${
                            isDark ? "text-slate-400" : "text-gray-500"
                          }`}
                        >
                          Loading...
                        </div>
                      ) : companyMembers.length === 0 ? (
                        <div
                          className={`text-center py-8 ${
                            isDark ? "text-slate-400" : "text-gray-500"
                          }`}
                        >
                          No members found
                        </div>
                      ) : (
                        <div className="space-y-4">
                          {companyMembers.map((m) => {
                            const roleText =
                              m.role === "company_admin"
                                ? "Admin"
                                : m.role === "director"
                                  ? "Director"
                                  : m.role;
                            return (
                              <div
                                key={m.user_id}
                                className={`flex items-center justify-between p-4 rounded-lg ${
                                  isDark ? "bg-slate-700" : "bg-gray-50"
                                }`}
                              >
                                <div className="flex items-center gap-4 min-w-0">
                                  <div
                                    className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 ${
                                      isDark ? "bg-slate-600" : "bg-gray-200"
                                    }`}
                                  >
                                    <User className="h-6 w-6" />
                                  </div>
                                  <div className="min-w-0">
                                    <div
                                      className={`font-medium ${
                                        isDark
                                          ? "text-slate-100"
                                          : "text-gray-900"
                                      }`}
                                    >
                                      {m.display_name || m.email || "User"}
                                    </div>
                                    {m.email && m.display_name ? (
                                      <div
                                        className={`text-sm ${
                                          isDark
                                            ? "text-slate-400"
                                            : "text-gray-500"
                                        }`}
                                      >
                                        {m.email}
                                      </div>
                                    ) : null}
                                  </div>
                                </div>
                                <div className="flex items-center gap-4 shrink-0">
                                  <span
                                    className={`px-3 py-1 rounded text-sm font-medium capitalize ${
                                      m.role === "company_admin" ||
                                      m.role === "director"
                                        ? "bg-red-100 text-red-800"
                                        : "bg-gray-100 text-gray-800"
                                    }`}
                                  >
                                    {roleText}
                                  </span>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>

                    <div
                      className={`p-6 rounded-lg ${
                        isDark ? "bg-slate-800" : "bg-white"
                      }`}
                    >
                      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
                        <h2
                          className={`text-xl font-semibold ${
                            isDark ? "text-slate-100" : "text-gray-900"
                          }`}
                        >
                          Invitations ({companyInvitations.length})
                        </h2>
                        <button
                          type="button"
                          onClick={() => {
                            if (showInviteDirectorForm) {
                              setShowInviteDirectorForm(false);
                              setInviteDirectorEmail("");
                            } else {
                              setShowInviteDirectorForm(true);
                            }
                          }}
                          className={teamPrimaryBlueButtonClass}
                        >
                          <UserPlus className="h-4 w-4" />
                          {showInviteDirectorForm
                            ? "Cancel"
                            : "Invite director"}
                        </button>
                      </div>
                      {showInviteDirectorForm ? (
                        <div
                          className={`mb-6 p-4 rounded-lg ${
                            isDark ? "bg-slate-700" : "bg-gray-50"
                          }`}
                        >
                          <h3
                            className={`text-lg font-medium mb-4 ${
                              isDark ? "text-slate-100" : "text-gray-900"
                            }`}
                          >
                            Send invitation
                          </h3>
                          <div className="flex flex-wrap items-center gap-2">
                            <input
                              type="email"
                              value={inviteDirectorEmail}
                              onChange={(e) =>
                                setInviteDirectorEmail(e.target.value)
                              }
                              placeholder="Email address"
                              className={`min-w-[200px] flex-1 px-3 py-2 rounded border text-sm ${
                                isDark
                                  ? "bg-slate-600 border-slate-500 text-slate-200"
                                  : "bg-white border-gray-300 text-gray-900"
                              }`}
                              disabled={sendingInviteDirector}
                            />
                            <button
                              type="button"
                              onClick={handleInviteDirector}
                              disabled={
                                sendingInviteDirector ||
                                !inviteDirectorEmail.trim()
                              }
                              className={`px-4 py-2 rounded-lg text-sm font-medium ${
                                isDark
                                  ? "bg-blue-600 hover:bg-blue-700 text-white disabled:bg-slate-600"
                                  : "bg-blue-500 hover:bg-blue-600 text-white disabled:bg-gray-400"
                              }`}
                            >
                              {sendingInviteDirector ? "Sending..." : "Send"}
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setShowInviteDirectorForm(false);
                                setInviteDirectorEmail("");
                              }}
                              disabled={sendingInviteDirector}
                              className={`px-4 py-2 rounded-lg text-sm font-medium ${
                                isDark
                                  ? "bg-slate-600 hover:bg-slate-700 text-slate-200"
                                  : "bg-gray-200 hover:bg-gray-300 text-gray-700"
                              }`}
                            >
                              Cancel
                            </button>
                          </div>
                        </div>
                      ) : null}
                      {loadingCompanyInvitations ? (
                        <div
                          className={`text-center py-8 ${
                            isDark ? "text-slate-400" : "text-gray-500"
                          }`}
                        >
                          Loading...
                        </div>
                      ) : companyInvitations.length === 0 ? (
                        <div
                          className={`text-center py-8 ${
                            isDark ? "text-slate-400" : "text-gray-500"
                          }`}
                        >
                          No invitations found
                        </div>
                      ) : (
                        <div className="space-y-4">
                          {companyInvitations.map((invitation) => {
                            const displayStatus =
                              getCompanyInvitationDisplayStatus(invitation);
                            return (
                              <div
                                key={invitation.id}
                                className={`flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between p-4 rounded-lg ${
                                  isDark ? "bg-slate-700" : "bg-gray-50"
                                }`}
                              >
                                <div className="flex items-center gap-4 min-w-0">
                                  <div
                                    className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 ${
                                      isDark ? "bg-slate-600" : "bg-gray-200"
                                    }`}
                                  >
                                    <Mail className="h-6 w-6" />
                                  </div>
                                  <div className="min-w-0">
                                    <div
                                      className={`font-medium ${
                                        isDark
                                          ? "text-slate-100"
                                          : "text-gray-900"
                                      }`}
                                    >
                                      {invitation.email}
                                    </div>
                                    <div
                                      className={`text-sm mt-1 ${
                                        isDark
                                          ? "text-slate-400"
                                          : "text-gray-500"
                                      }`}
                                    >
                                      Sent:{" "}
                                      {new Date(
                                        invitation.created_at,
                                      ).toLocaleDateString()}
                                    </div>
                                    <div
                                      className={`text-xs mt-1 ${
                                        isDark
                                          ? "text-slate-400"
                                          : "text-gray-500"
                                      }`}
                                    >
                                      Expires:{" "}
                                      {new Date(
                                        invitation.expires_at,
                                      ).toLocaleDateString()}
                                    </div>
                                  </div>
                                </div>
                                <div className="flex flex-wrap items-center gap-2 shrink-0 sm:justify-end">
                                  {displayStatus === "accepted" && (
                                    <span
                                      className={`px-3 py-1 rounded text-sm font-medium ${
                                        isDark
                                          ? "bg-green-900 text-green-200"
                                          : "bg-green-100 text-green-800"
                                      }`}
                                    >
                                      Accepted
                                    </span>
                                  )}
                                  {displayStatus === "expired" && (
                                    <span
                                      className={`px-3 py-1 rounded text-sm font-medium ${
                                        isDark
                                          ? "bg-gray-700 text-gray-300"
                                          : "bg-gray-100 text-gray-800"
                                      }`}
                                    >
                                      Expired
                                    </span>
                                  )}
                                  {displayStatus === "canceled" && (
                                    <span
                                      className={`px-3 py-1 rounded text-sm font-medium ${
                                        isDark
                                          ? "bg-red-900 text-red-200"
                                          : "bg-red-100 text-red-800"
                                      }`}
                                    >
                                      Canceled
                                    </span>
                                  )}
                                  {displayStatus === "failed" && (
                                    <span
                                      className={`px-3 py-1 rounded text-sm font-medium ${
                                        isDark
                                          ? "bg-red-900 text-red-200"
                                          : "bg-red-100 text-red-800"
                                      }`}
                                    >
                                      Failed
                                    </span>
                                  )}
                                  {invitation.status === "pending" ? (
                                    <button
                                      type="button"
                                      onClick={() =>
                                        handleCancelCompanyInvitation(
                                          invitation.id,
                                        )
                                      }
                                      className="p-2 text-red-600 hover:text-red-700"
                                      title="Cancel invitation"
                                    >
                                      <X className="h-5 w-5" />
                                    </button>
                                  ) : null}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>

                    <div
                      className={`p-6 rounded-lg ${
                        isDark ? "bg-slate-800" : "bg-white"
                      }`}
                    >
                      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
                        <h2
                          className={`text-xl font-semibold ${
                            isDark ? "text-slate-100" : "text-gray-900"
                          }`}
                        >
                          Tenants ({companyTenants.length})
                        </h2>
                        <button
                          type="button"
                          onClick={() => setShowCreateTenantModal(true)}
                          className={teamPrimaryBlueButtonClass}
                        >
                          <Plus className="h-4 w-4" />
                          New tenant
                        </button>
                      </div>
                      {companyTenants.length === 0 ? (
                        <div
                          className={`text-center py-8 text-sm ${
                            isDark ? "text-slate-400" : "text-gray-500"
                          }`}
                        >
                          No tenants yet. Use <strong>New tenant</strong> to
                          create one.
                        </div>
                      ) : (
                        <div className="space-y-4">
                          {companyTenants.map((t) => (
                            <div
                              key={t.id}
                              className={`flex items-center gap-4 p-4 rounded-lg ${
                                isDark ? "bg-slate-700" : "bg-gray-50"
                              }`}
                            >
                              <div
                                className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 ${
                                  isDark ? "bg-slate-600" : "bg-gray-200"
                                }`}
                                aria-hidden
                              >
                                <Store className="h-5 w-5 opacity-90" />
                              </div>
                              <div className="min-w-0">
                                <div
                                  className={`font-medium ${
                                    isDark ? "text-slate-100" : "text-gray-900"
                                  }`}
                                >
                                  {t.name}
                                </div>
                                <div
                                  className={`text-sm mt-1 capitalize ${
                                    isDark ? "text-slate-400" : "text-gray-500"
                                  }`}
                                >
                                  {t.type}
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}
            </div>
          </div>
        </div>

        {/* Tenant（店舗／ロケーションのメンバー・招待） */}
        <div className={teamSectionShell}>
          <div className={`h-1 w-full ${tenantAccentBar}`} aria-hidden />
          <div className="p-6 space-y-6">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2 min-w-0">
              <h2
                className={`text-xl font-semibold flex items-center gap-2 shrink-0 ${
                  isDark ? "text-slate-100" : "text-gray-900"
                }`}
              >
                <Store className="h-5 w-5 shrink-0 text-teal-500" aria-hidden />
                Tenant
              </h2>
              {selectedCompanyId && companyTenants.length > 0 ? (
                <div className="flex flex-1 items-center justify-end min-w-0">
                  <div className="flex items-center gap-3 min-w-0 max-w-full">
                    <div
                      className={`h-px w-10 sm:w-14 shrink-0 ${
                        isDark ? "bg-slate-600" : "bg-gray-300"
                      }`}
                      aria-hidden
                    />
                    <span
                      className={`text-lg sm:text-xl font-semibold text-center truncate max-w-[min(100%,20rem)] ${
                        teamSelectedTenantId &&
                        !(loading && !tenantPayloadInSync) &&
                        selectedTenantDisplayName
                          ? isDark
                            ? "text-slate-100"
                            : "text-gray-900"
                          : isDark
                            ? "text-slate-500"
                            : "text-gray-500"
                      }`}
                    >
                      {!teamSelectedTenantId
                        ? "Select in header"
                        : loading && !tenantPayloadInSync
                          ? "Loading…"
                          : selectedTenantDisplayName || "—"}
                    </span>
                    <div
                      className={`h-px w-10 sm:w-14 shrink-0 ${
                        isDark ? "bg-slate-600" : "bg-gray-300"
                      }`}
                      aria-hidden
                    />
                  </div>
                </div>
              ) : null}
            </div>

            {!selectedCompanyId ? (
              <div className={dashedEmptyClass}>
                <p>
                  Select a <strong>company</strong> in the{" "}
                  <strong>header</strong> first.
                </p>
              </div>
            ) : companyTenants.length === 0 ? (
              <div className={dashedEmptyClass}>
                <p>
                  This company has no tenants yet. Use{" "}
                  <strong>New tenant</strong> in the <strong>Tenants</strong>{" "}
                  section under Company above, then choose a{" "}
                  <strong>tenant</strong> in the header.
                </p>
              </div>
            ) : (
              <>
                {loading && teamSelectedTenantId ? (
                  <div
                    className={`flex items-center justify-center min-h-[8rem] rounded-lg border text-sm ${
                      isDark
                        ? "border-slate-600 text-slate-400"
                        : "border-gray-200 text-gray-500"
                    }`}
                  >
                    Loading tenant…
                  </div>
                ) : null}

                {!loading &&
                teamSelectedTenantId &&
                tenantsWithMembers.length === 0 ? (
                  <div
                    className={`flex items-center justify-center min-h-[8rem] rounded-lg border text-sm ${
                      isDark
                        ? "border-slate-600 text-slate-400"
                        : "border-gray-200 text-gray-500"
                    }`}
                  >
                    No data for this tenant yet.
                  </div>
                ) : null}
              </>
            )}

            {companyTenants.length > 0 &&
              tenantsWithMembers.map((tenant) => {
                const isAdmin =
                  tenant.role === "admin" || tenant.role === "director";

                return (
                  <div key={tenant.id} className="space-y-6">
                    {/* チームメンバーセクション */}
                    <div
                      className={`p-6 rounded-lg ${
                        isDark ? "bg-slate-800" : "bg-white"
                      }`}
                    >
                      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
                        <h2
                          className={`text-xl font-semibold ${
                            isDark ? "text-slate-100" : "text-gray-900"
                          }`}
                        >
                          Team Members ({tenant.members.length})
                        </h2>
                        {isAdmin && tenant.members.length > 0 && (
                          <div className="flex flex-wrap items-center gap-2">
                            {editingTenantMembers.has(tenant.id) ? (
                              <>
                                <button
                                  type="button"
                                  onClick={() =>
                                    void saveTenantMemberEdits(tenant.id)
                                  }
                                  disabled={savingMemberEdits.has(tenant.id)}
                                  className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium ${
                                    isDark
                                      ? "bg-green-600 hover:bg-green-700 text-white disabled:bg-slate-600"
                                      : "bg-green-600 hover:bg-green-700 text-white disabled:bg-gray-400"
                                  }`}
                                >
                                  <Save className="h-4 w-4" />
                                  {savingMemberEdits.has(tenant.id)
                                    ? "Saving…"
                                    : "Save"}
                                </button>
                                <button
                                  type="button"
                                  onClick={() =>
                                    cancelEditingTenantMembers(tenant.id)
                                  }
                                  disabled={savingMemberEdits.has(tenant.id)}
                                  className={teamOutlineActionButtonClass}
                                >
                                  Cancel
                                </button>
                              </>
                            ) : (
                              <button
                                type="button"
                                onClick={() =>
                                  beginEditingTenantMembers(
                                    tenant.id,
                                    tenant.members,
                                  )
                                }
                                className={teamOutlineActionButtonClass}
                              >
                                <Edit className="h-4 w-4" />
                                Edit
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                      {tenant.members.length === 0 ? (
                        <div
                          className={`text-center py-8 ${
                            isDark ? "text-slate-400" : "text-gray-500"
                          }`}
                        >
                          No members found
                        </div>
                      ) : (
                        <div className="space-y-4">
                          {tenant.members.map((member) => (
                            <div
                              key={member.user_id}
                              className={`flex items-center justify-between p-4 rounded-lg ${
                                isDark ? "bg-slate-700" : "bg-gray-50"
                              }`}
                            >
                              <div className="flex items-center gap-4">
                                <div
                                  className={`w-10 h-10 rounded-full flex items-center justify-center ${
                                    isDark ? "bg-slate-600" : "bg-gray-200"
                                  }`}
                                >
                                  <User className="h-6 w-6" />
                                </div>
                                <div>
                                  <div
                                    className={`font-medium ${
                                      isDark
                                        ? "text-slate-100"
                                        : "text-gray-900"
                                    }`}
                                  >
                                    {member.name || member.email || "User"}
                                  </div>
                                  {member.email && (
                                    <div
                                      className={`text-sm ${
                                        isDark
                                          ? "text-slate-400"
                                          : "text-gray-500"
                                      }`}
                                    >
                                      {member.email}
                                    </div>
                                  )}
                                  <div
                                    className={`text-xs mt-1 ${
                                      isDark
                                        ? "text-slate-400"
                                        : "text-gray-500"
                                    }`}
                                  >
                                    Member since:{" "}
                                    {new Date(
                                      member.member_since,
                                    ).toLocaleDateString()}
                                  </div>
                                </div>
                              </div>
                              <div className="flex items-center gap-4">
                                {isAdmin &&
                                editingTenantMembers.has(tenant.id) &&
                                memberRoleDrafts.has(tenant.id) ? (
                                  <>
                                    <select
                                      value={
                                        memberRoleDrafts
                                          .get(tenant.id)
                                          ?.get(member.user_id) ?? member.role
                                      }
                                      onChange={(e) =>
                                        setMemberRoleDraft(
                                          tenant.id,
                                          member.user_id,
                                          e.target
                                            .value as TenantMember["role"],
                                        )
                                      }
                                      disabled={savingMemberEdits.has(
                                        tenant.id,
                                      )}
                                      className={`px-3 py-2 rounded border ${
                                        isDark
                                          ? "bg-slate-600 border-slate-500 text-slate-200"
                                          : "bg-white border-gray-300 text-gray-900"
                                      }`}
                                    >
                                      <option value="admin">Admin</option>
                                      <option value="director">Director</option>
                                      <option value="manager">Manager</option>
                                      <option value="staff">Staff</option>
                                    </select>
                                    <button
                                      type="button"
                                      onClick={() =>
                                        handleRemoveMember(
                                          tenant.id,
                                          member.user_id,
                                        )
                                      }
                                      disabled={savingMemberEdits.has(
                                        tenant.id,
                                      )}
                                      className="p-2 text-red-600 hover:text-red-700 disabled:opacity-50"
                                      title="Remove member"
                                    >
                                      <Trash2 className="h-5 w-5" />
                                    </button>
                                  </>
                                ) : null}
                                {(!isAdmin ||
                                  !editingTenantMembers.has(tenant.id)) && (
                                  <span
                                    className={`px-3 py-1 rounded text-sm font-medium capitalize ${
                                      member.role === "admin" ||
                                      member.role === "director"
                                        ? "bg-red-100 text-red-800"
                                        : member.role === "manager"
                                          ? "bg-blue-100 text-blue-800"
                                          : "bg-gray-100 text-gray-800"
                                    }`}
                                  >
                                    {member.role}
                                  </span>
                                )}
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* 招待一覧セクション（Admin / Director のみ） */}
                    {isAdmin && (
                      <div
                        className={`p-6 rounded-lg ${
                          isDark ? "bg-slate-800" : "bg-white"
                        }`}
                      >
                        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
                          <h2
                            className={`text-xl font-semibold ${
                              isDark ? "text-slate-100" : "text-gray-900"
                            }`}
                          >
                            Invitations ({invitations.length})
                          </h2>
                          <button
                            type="button"
                            onClick={() => {
                              const newMap = new Map(showInviteForm);
                              newMap.set(tenant.id, !newMap.get(tenant.id));
                              setShowInviteForm(newMap);
                              if (!newMap.get(tenant.id)) {
                                const newEmailMap = new Map(inviteEmail);
                                newEmailMap.delete(tenant.id);
                                setInviteEmail(newEmailMap);
                                const newRoleMap = new Map(inviteRole);
                                newRoleMap.delete(tenant.id);
                                setInviteRole(newRoleMap);
                              } else {
                                const newRoleMap = new Map(inviteRole);
                                newRoleMap.set(tenant.id, "manager");
                                setInviteRole(newRoleMap);
                              }
                            }}
                            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium ${
                              isDark
                                ? "bg-blue-600 hover:bg-blue-700 text-white"
                                : "bg-blue-500 hover:bg-blue-600 text-white"
                            }`}
                          >
                            <UserPlus className="h-4 w-4" />
                            {showInviteForm.get(tenant.id)
                              ? "Cancel"
                              : "Invite Member"}
                          </button>
                        </div>
                        {showInviteForm.get(tenant.id) && (
                          <div
                            className={`mb-6 p-4 rounded-lg ${
                              isDark ? "bg-slate-700" : "bg-gray-50"
                            }`}
                          >
                            <h3
                              className={`text-lg font-medium mb-4 ${
                                isDark ? "text-slate-100" : "text-gray-900"
                              }`}
                            >
                              Send invitation
                            </h3>
                            <div className="space-y-4">
                              <div>
                                <label
                                  className={`block text-sm font-medium mb-2 ${
                                    isDark ? "text-slate-300" : "text-gray-700"
                                  }`}
                                >
                                  Email Address
                                </label>
                                <input
                                  type="email"
                                  value={inviteEmail.get(tenant.id) || ""}
                                  onChange={(e) => {
                                    const newMap = new Map(inviteEmail);
                                    newMap.set(tenant.id, e.target.value);
                                    setInviteEmail(newMap);
                                  }}
                                  placeholder="user@example.com"
                                  className={`w-full px-3 py-2 rounded border ${
                                    isDark
                                      ? "bg-slate-600 border-slate-500 text-slate-200"
                                      : "bg-white border-gray-300 text-gray-900"
                                  }`}
                                  disabled={sendingInvite.has(tenant.id)}
                                />
                              </div>
                              <div>
                                <label
                                  className={`block text-sm font-medium mb-2 ${
                                    isDark ? "text-slate-300" : "text-gray-700"
                                  }`}
                                >
                                  Role
                                </label>
                                <select
                                  value={inviteRole.get(tenant.id) || "manager"}
                                  onChange={(e) => {
                                    const newMap = new Map(inviteRole);
                                    newMap.set(
                                      tenant.id,
                                      e.target.value as
                                        | "director"
                                        | "manager"
                                        | "staff",
                                    );
                                    setInviteRole(newMap);
                                  }}
                                  className={`w-full px-3 py-2 rounded border ${
                                    isDark
                                      ? "bg-slate-600 border-slate-500 text-slate-200"
                                      : "bg-white border-gray-300 text-gray-900"
                                  }`}
                                  disabled={sendingInvite.has(tenant.id)}
                                >
                                  <option value="director">Director</option>
                                  <option value="manager">Manager</option>
                                  <option value="staff">Staff</option>
                                </select>
                              </div>
                              <div className="flex flex-wrap items-center gap-2">
                                <button
                                  type="button"
                                  onClick={() => handleSendInvite(tenant.id)}
                                  disabled={sendingInvite.has(tenant.id)}
                                  className={`px-4 py-2 rounded-lg text-sm font-medium ${
                                    isDark
                                      ? "bg-blue-600 hover:bg-blue-700 text-white disabled:bg-slate-600"
                                      : "bg-blue-500 hover:bg-blue-600 text-white disabled:bg-gray-400"
                                  }`}
                                >
                                  {sendingInvite.has(tenant.id) ? (
                                    "Sending..."
                                  ) : (
                                    <>
                                      <Mail className="h-4 w-4 inline mr-2" />
                                      Send Invitation
                                    </>
                                  )}
                                </button>
                                <button
                                  type="button"
                                  onClick={() => {
                                    const newMap = new Map(showInviteForm);
                                    newMap.set(tenant.id, false);
                                    setShowInviteForm(newMap);
                                    const newEmailMap = new Map(inviteEmail);
                                    newEmailMap.delete(tenant.id);
                                    setInviteEmail(newEmailMap);
                                    const newRoleMap = new Map(inviteRole);
                                    newRoleMap.delete(tenant.id);
                                    setInviteRole(newRoleMap);
                                  }}
                                  disabled={sendingInvite.has(tenant.id)}
                                  className={`px-4 py-2 rounded-lg text-sm font-medium ${
                                    isDark
                                      ? "bg-slate-600 hover:bg-slate-700 text-slate-200"
                                      : "bg-gray-200 hover:bg-gray-300 text-gray-700"
                                  }`}
                                >
                                  Cancel
                                </button>
                              </div>
                            </div>
                          </div>
                        )}
                        {loadingInvitations ? (
                          <div
                            className={`text-center py-8 ${
                              isDark ? "text-slate-400" : "text-gray-500"
                            }`}
                          >
                            Loading...
                          </div>
                        ) : invitations.length === 0 ? (
                          <div
                            className={`text-center py-8 ${
                              isDark ? "text-slate-400" : "text-gray-500"
                            }`}
                          >
                            No invitations found
                          </div>
                        ) : (
                          <div className="space-y-4">
                            {invitations.map((invitation) => {
                              const displayStatus =
                                getDisplayStatus(invitation);
                              return (
                                <div
                                  key={invitation.id}
                                  className={`flex items-center justify-between p-4 rounded-lg ${
                                    isDark ? "bg-slate-700" : "bg-gray-50"
                                  }`}
                                >
                                  <div className="flex items-center gap-4">
                                    <div
                                      className={`w-10 h-10 rounded-full flex items-center justify-center ${
                                        isDark ? "bg-slate-600" : "bg-gray-200"
                                      }`}
                                    >
                                      <Mail className="h-6 w-6" />
                                    </div>
                                    <div>
                                      <div
                                        className={`font-medium ${
                                          isDark
                                            ? "text-slate-100"
                                            : "text-gray-900"
                                        }`}
                                      >
                                        {invitation.email}
                                      </div>
                                      <div
                                        className={`text-sm mt-1 ${
                                          isDark
                                            ? "text-slate-400"
                                            : "text-gray-500"
                                        }`}
                                      >
                                        Role:{" "}
                                        <span className="capitalize">
                                          {invitation.role}
                                        </span>
                                      </div>
                                      <div
                                        className={`text-xs mt-1 ${
                                          isDark
                                            ? "text-slate-400"
                                            : "text-gray-500"
                                        }`}
                                      >
                                        Sent:{" "}
                                        {new Date(
                                          invitation.created_at,
                                        ).toLocaleDateString()}
                                      </div>
                                    </div>
                                  </div>
                                  <div className="flex items-center gap-4">
                                    {/* 統合ステータスのバッジ */}
                                    {displayStatus === "accepted" && (
                                      <span
                                        className={`px-3 py-1 rounded text-sm font-medium ${
                                          isDark
                                            ? "bg-green-900 text-green-200"
                                            : "bg-green-100 text-green-800"
                                        }`}
                                      >
                                        Accepted
                                      </span>
                                    )}
                                    {displayStatus === "expired" && (
                                      <span
                                        className={`px-3 py-1 rounded text-sm font-medium ${
                                          isDark
                                            ? "bg-gray-700 text-gray-300"
                                            : "bg-gray-100 text-gray-800"
                                        }`}
                                      >
                                        Expired
                                      </span>
                                    )}
                                    {displayStatus === "canceled" && (
                                      <span
                                        className={`px-3 py-1 rounded text-sm font-medium ${
                                          isDark
                                            ? "bg-red-900 text-red-200"
                                            : "bg-red-100 text-red-800"
                                        }`}
                                      >
                                        Canceled
                                      </span>
                                    )}
                                    {displayStatus === "failed" && (
                                      <span
                                        className={`px-3 py-1 rounded text-sm font-medium ${
                                          isDark
                                            ? "bg-red-900 text-red-200"
                                            : "bg-red-100 text-red-800"
                                        }`}
                                      >
                                        Failed
                                      </span>
                                    )}
                                    {/* deliveredは表示しない（正常な状態） */}
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
          </div>
        </div>

        {/* Create Company Modal */}
        {showCreateCompanyModal && (
          <div
            className={`fixed inset-0 flex items-center justify-center z-50 ${
              isDark ? "bg-black/70" : "bg-black/50"
            }`}
          >
            <div
              className={`p-6 rounded-lg max-w-md w-full mx-4 ${
                isDark ? "bg-slate-800" : "bg-white"
              }`}
            >
              <h2 className="text-xl font-semibold mb-4">Create Company</h2>
              <div className="space-y-4">
                <div>
                  <label
                    className={`block text-sm font-medium mb-2 ${
                      isDark ? "text-slate-300" : "text-gray-700"
                    }`}
                  >
                    Company Name
                  </label>
                  <input
                    type="text"
                    value={newCompanyName}
                    onChange={(e) => setNewCompanyName(e.target.value)}
                    placeholder="Enter company name"
                    className={`w-full px-3 py-2 rounded border ${
                      isDark
                        ? "bg-slate-600 border-slate-500 text-slate-200"
                        : "bg-white border-gray-300 text-gray-900"
                    }`}
                    disabled={creatingCompany}
                  />
                </div>
                <div className="flex items-center gap-2 justify-end">
                  <button
                    onClick={() => {
                      setShowCreateCompanyModal(false);
                      setNewCompanyName("");
                    }}
                    disabled={creatingCompany}
                    className={`px-4 py-2 rounded-lg text-sm font-medium ${
                      isDark
                        ? "bg-slate-600 hover:bg-slate-700 text-slate-200"
                        : "bg-gray-200 hover:bg-gray-300 text-gray-700"
                    }`}
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleCreateCompany}
                    disabled={creatingCompany || !newCompanyName.trim()}
                    className={`px-4 py-2 rounded-lg text-sm font-medium ${
                      isDark
                        ? "bg-blue-600 hover:bg-blue-700 text-white disabled:bg-slate-600"
                        : "bg-blue-500 hover:bg-blue-600 text-white disabled:bg-gray-400"
                    }`}
                  >
                    {creatingCompany ? "Creating..." : "Create Company"}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Create Tenant Modal（会社選択時のみ表示） */}
        {showCreateTenantModal && selectedCompanyId && (
          <div
            className={`fixed inset-0 flex items-center justify-center z-50 ${
              isDark ? "bg-black/70" : "bg-black/50"
            }`}
          >
            <div
              className={`p-6 rounded-lg max-w-md w-full mx-4 ${
                isDark ? "bg-slate-800" : "bg-white"
              }`}
            >
              <h2 className="text-xl font-semibold mb-4">Create New Tenant</h2>
              <div className="space-y-4">
                <div>
                  <label
                    className={`block text-sm font-medium mb-2 ${
                      isDark ? "text-slate-300" : "text-gray-700"
                    }`}
                  >
                    Tenant Name
                  </label>
                  <input
                    type="text"
                    value={newTenantName}
                    onChange={(e) => setNewTenantName(e.target.value)}
                    placeholder="Enter tenant name (5-50 characters)"
                    className={`w-full px-3 py-2 rounded border ${
                      isDark
                        ? "bg-slate-600 border-slate-500 text-slate-200"
                        : "bg-white border-gray-300 text-gray-900"
                    }`}
                    disabled={creatingTenant}
                    minLength={5}
                    maxLength={50}
                  />
                  <p
                    className={`mt-1 text-xs ${
                      isDark ? "text-slate-400" : "text-gray-500"
                    }`}
                  >
                    {newTenantName.length}/50 characters
                  </p>
                </div>
                <div>
                  <label
                    className={`block text-sm font-medium mb-2 ${
                      isDark ? "text-slate-300" : "text-gray-700"
                    }`}
                  >
                    Tenant Type
                  </label>
                  <select
                    value={newTenantType}
                    onChange={(e) =>
                      setNewTenantType(
                        e.target.value as "restaurant" | "vendor",
                      )
                    }
                    className={`w-full px-3 py-2 rounded border ${
                      isDark
                        ? "bg-slate-600 border-slate-500 text-slate-200"
                        : "bg-white border-gray-300 text-gray-900"
                    }`}
                    disabled={creatingTenant}
                  >
                    <option value="restaurant">Restaurant</option>
                    <option value="vendor">Vendor</option>
                  </select>
                </div>
                <div className="flex items-center gap-2 justify-end">
                  <button
                    onClick={() => {
                      setShowCreateTenantModal(false);
                      setNewTenantName("");
                      setNewTenantType("restaurant");
                    }}
                    disabled={creatingTenant}
                    className={`px-4 py-2 rounded-lg text-sm font-medium ${
                      isDark
                        ? "bg-slate-600 hover:bg-slate-700 text-slate-200"
                        : "bg-gray-200 hover:bg-gray-300 text-gray-700"
                    }`}
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleCreateTenant}
                    disabled={
                      creatingTenant ||
                      newTenantName.trim().length < 5 ||
                      newTenantName.trim().length > 50
                    }
                    className={`px-4 py-2 rounded-lg text-sm font-medium ${
                      isDark
                        ? "bg-blue-600 hover:bg-blue-700 text-white disabled:bg-slate-600"
                        : "bg-blue-500 hover:bg-blue-600 text-white disabled:bg-gray-400"
                    }`}
                  >
                    {creatingTenant ? "Creating..." : "Create Tenant"}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
