"use client";

import { useState, useEffect } from "react";
import { apiRequest } from "@/lib/api";
import { useTheme } from "@/contexts/ThemeContext";
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
} from "lucide-react";

interface TenantMember {
  user_id: string;
  role: "admin" | "manager" | "staff";
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
  role: "manager" | "staff";
  tenant_id: string;
  status: "pending" | "accepted" | "expired" | "canceled";
  email_status?: "delivered" | "failed" | null;
  created_at: string;
  expires_at: string;
}

interface Company {
  id: string;
  company_name: string;
  role?: string;
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
  // Company 階層（Team ではヘッダーのテナントセレクターを使わず、ページ内でテナントを選択する）
  const [companies, setCompanies] = useState<Company[]>([]);
  const [selectedCompanyId, setSelectedCompanyId] = useState<string | null>(null);
  const [companyTenants, setCompanyTenants] = useState<
    { id: string; name: string; type: string; created_at?: string }[]
  >([]);
  const [loadingCompanies, setLoadingCompanies] = useState(true);
  const [showCreateCompanyModal, setShowCreateCompanyModal] = useState(false);
  const [newCompanyName, setNewCompanyName] = useState("");
  const [creatingCompany, setCreatingCompany] = useState(false);
  // Team ページ内でのテナント選択（ヘッダーとは連動しない）
  const [teamSelectedTenantId, setTeamSelectedTenantId] = useState<string | null>(null);
  // 選択中テナントの情報を表示
  const [tenantsWithMembers, setTenantsWithMembers] = useState<
    TenantWithMembers[]
  >([]);
  const [loading, setLoading] = useState(true);
  const [editingTenantId, setEditingTenantId] = useState<string | null>(null);
  const [editedTenantNames, setEditedTenantNames] = useState<
    Map<string, string>
  >(new Map());
  const [savingTenantIds, setSavingTenantIds] = useState<Set<string>>(
    new Set(),
  );
  const [showInviteForm, setShowInviteForm] = useState<Map<string, boolean>>(
    new Map(),
  );
  const [inviteEmail, setInviteEmail] = useState<Map<string, string>>(
    new Map(),
  );
  const [inviteRole, setInviteRole] = useState<
    Map<string, "manager" | "staff">
  >(new Map());
  const [sendingInvite, setSendingInvite] = useState<Set<string>>(new Set());
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
  const isAdminOfAnyCompany = companies.some(
    (c) => c.role === "company_admin",
  );

  // 会社一覧を取得
  const fetchCompanies = async () => {
    try {
      const data = await apiRequest<{ companies: Company[] }>("/companies");
      setCompanies(data.companies ?? []);
    } catch (e) {
      console.error("Failed to fetch companies:", e);
      setCompanies([]);
    } finally {
      setLoadingCompanies(false);
    }
  };

  useEffect(() => {
    fetchCompanies();
  }, []);

  // 選択した会社に属するテナント一覧を取得（Select tenant の候補として使用）
  useEffect(() => {
    if (!selectedCompanyId) {
      setCompanyTenants([]);
      setTeamSelectedTenantId(null);
      return;
    }
    const fetchCompanyTenants = async () => {
      try {
        const data = await apiRequest<{
          tenants: { id: string; name: string; type: string; created_at?: string }[];
        }>(`/companies/${selectedCompanyId}/tenants`);
        setCompanyTenants(data.tenants ?? []);
      } catch (e) {
        console.error("Failed to fetch company tenants:", e);
        setCompanyTenants([]);
      }
    };
    fetchCompanyTenants();
  }, [selectedCompanyId]);

  // 会社を切り替えたらテナント選択をリセット
  useEffect(() => {
    if (!selectedCompanyId) {
      setTeamSelectedTenantId(null);
      return;
    }
    setTeamSelectedTenantId(null);
  }, [selectedCompanyId]);

  // 選択会社のテナント一覧が入ったら、未選択なら先頭を選択（Select tenant は選択会社配下のみ表示するため）
  useEffect(() => {
    if (
      selectedCompanyId &&
      companyTenants.length > 0 &&
      (teamSelectedTenantId === null ||
        !companyTenants.some((t) => t.id === teamSelectedTenantId))
    ) {
      setTeamSelectedTenantId(companyTenants[0].id);
    }
    if (selectedCompanyId && companyTenants.length === 0) {
      setTeamSelectedTenantId(null);
    }
  }, [selectedCompanyId, companyTenants, teamSelectedTenantId]);

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
          }>(`/tenants/${teamSelectedTenantId}`),
          apiRequest<{ members: TenantMember[] }>(
            `/tenants/${teamSelectedTenantId}/members`,
          ),
        ]);

        const tenantWithMembers = {
          ...tenantDetail,
          members: membersData.members || [],
        };

        setTenantsWithMembers([tenantWithMembers]);

        const namesMap = new Map<string, string>();
        namesMap.set(tenantWithMembers.id, tenantWithMembers.name);
        setEditedTenantNames(namesMap);
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
      setCompanies((prev) => [...prev, company]);
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

      setCompanyTenants((prev) => [
        ...prev,
        {
          id: newTenant.id,
          name: newTenant.name,
          type: newTenant.type,
          created_at: newTenant.created_at,
        },
      ]);
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
      alert(apiError.details || apiError.error || "Failed to cancel invitation");
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

  // テナント名を保存
  const handleSaveTenantName = async (tenantId: string) => {
    const editedName = editedTenantNames.get(tenantId);
    if (!editedName || !editedName.trim()) return;

    try {
      setSavingTenantIds((prev) => new Set(prev).add(tenantId));
      const updatedTenant = await apiRequest<{
        id: string;
        name: string;
        type: string;
        created_at: string;
      }>(`/tenants/${tenantId}`, {
        method: "PUT",
        body: JSON.stringify({ name: editedName.trim() }),
      });

      // テナント情報を更新
      setTenantsWithMembers((prev) =>
        prev.map((tenant) =>
          tenant.id === tenantId
            ? { ...tenant, name: updatedTenant.name }
            : tenant,
        ),
      );
      setEditingTenantId(null);
    } catch (error) {
      console.error("Failed to update tenant name:", error);
      alert("Failed to update tenant name");
    } finally {
      setSavingTenantIds((prev) => {
        const next = new Set(prev);
        next.delete(tenantId);
        return next;
      });
    }
  };

  // メンバーの役割を変更
  const handleChangeMemberRole = async (
    tenantId: string,
    userId: string,
    newRole: "admin" | "manager" | "staff",
  ) => {
    try {
      await apiRequest(`/tenants/${tenantId}/members/${userId}/role`, {
        method: "PUT",
        body: JSON.stringify({ role: newRole }),
      });

      // メンバー一覧を更新
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
    } catch (error) {
      console.error("Failed to change member role:", error);
      alert("Failed to change member role");
    }
  };

  // メンバーを削除
  const handleRemoveMember = async (tenantId: string, userId: string) => {
    if (
      !confirm("Are you sure you want to remove this member from the tenant?")
    ) {
      return;
    }

    try {
      await apiRequest(`/tenants/${tenantId}/members/${userId}`, {
        method: "DELETE",
      });

      // メンバー一覧を更新
      setTenantsWithMembers((prev) =>
        prev.map((tenant) =>
          tenant.id === tenantId
            ? {
                ...tenant,
                members: tenant.members.filter((m) => m.user_id !== userId),
              }
            : tenant,
        ),
      );
    } catch (error) {
      console.error("Failed to remove member:", error);
      alert("Failed to remove member");
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

  if (loadingCompanies) {
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
        {/* Company 階層: 会社一覧・選択・会社配下テナント一覧・テナント追加 */}
        <div
          className={`p-6 rounded-lg ${
            isDark ? "bg-slate-800" : "bg-white"
          }`}
        >
          <h2 className="text-xl font-semibold mb-4 flex items-center gap-2">
            <Building2 className="h-5 w-5" />
            Companies
          </h2>
          {loadingCompanies ? (
            <div
              className={
                isDark ? "text-slate-400" : "text-gray-500"
              }
            >
              Loading...
            </div>
          ) : companies.length === 0 ? (
            <div className="space-y-4">
              <p
                className={
                  isDark ? "text-slate-300" : "text-gray-600"
                }
              >
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
            <div className="space-y-4">
              <div className="flex flex-wrap items-center gap-2">
                <label
                  className={`text-sm font-medium ${
                    isDark ? "text-slate-300" : "text-gray-700"
                  }`}
                >
                  Select company:
                </label>
                <select
                  value={selectedCompanyId ?? ""}
                  onChange={(e) =>
                    setSelectedCompanyId(
                      e.target.value ? e.target.value : null,
                    )
                  }
                  className={`px-3 py-2 rounded border ${
                    isDark
                      ? "bg-slate-600 border-slate-500 text-slate-200"
                      : "bg-white border-gray-300 text-gray-900"
                  }`}
                >
                  <option value="">—</option>
                  {companies.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.company_name}
                    </option>
                  ))}
                </select>
                {!isAdminOfAnyCompany && (
                  <button
                    onClick={() => setShowCreateCompanyModal(true)}
                    className={`flex items-center gap-1 px-3 py-2 rounded-lg text-sm ${
                      isDark
                        ? "bg-slate-600 hover:bg-slate-700 text-slate-200"
                        : "bg-gray-200 hover:bg-gray-300 text-gray-700"
                    }`}
                  >
                    <Plus className="h-4 w-4" />
                    New company
                  </button>
                )}
              </div>
              {selectedCompanyId && (
                <div className="mt-4 space-y-2">
                  <div className="flex items-center justify-between">
                    <span
                      className={`text-sm font-medium ${
                        isDark ? "text-slate-300" : "text-gray-700"
                      }`}
                    >
                      Tenants under this company
                    </span>
                    <button
                      onClick={() => setShowCreateTenantModal(true)}
                      className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium ${
                        isDark
                          ? "bg-blue-600 hover:bg-blue-700 text-white"
                          : "bg-blue-500 hover:bg-blue-600 text-white"
                      }`}
                    >
                      <Plus className="h-4 w-4" />
                      Add Tenant
                    </button>
                  </div>
                  {companyTenants.length === 0 ? (
                    <p
                      className={`text-sm ${
                        isDark ? "text-slate-400" : "text-gray-500"
                      }`}
                    >
                      No tenants yet. Click &quot;Add Tenant&quot; to create one.
                    </p>
                  ) : (
                    <ul
                      className={`list-disc list-inside space-y-1 text-sm ${
                        isDark ? "text-slate-300" : "text-gray-700"
                      }`}
                    >
                      {companyTenants.map((t) => (
                        <li key={t.id}>
                          {t.name}{" "}
                          <span className="capitalize opacity-80">
                            ({t.type})
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                  {/* Company directors: members + invitations */}
                  <div className="mt-6 pt-4 border-t border-slate-600/50 space-y-4">
                    <h3
                      className={`text-sm font-semibold ${
                        isDark ? "text-slate-300" : "text-gray-700"
                      }`}
                    >
                      Company directors
                    </h3>
                    {loadingCompanyMembers ? (
                      <p
                        className={`text-sm ${
                          isDark ? "text-slate-400" : "text-gray-500"
                        }`}
                      >
                        Loading members...
                      </p>
                    ) : (
                      <ul
                        className={`text-sm space-y-1 ${
                          isDark ? "text-slate-300" : "text-gray-700"
                        }`}
                      >
                        {companyMembers.length === 0 ? (
                          <li>No members</li>
                        ) : (
                          companyMembers.map((m) => (
                            <li key={m.user_id}>
                              {m.display_name || m.email || m.user_id}{" "}
                              <span
                                className={`text-xs ${
                                  isDark ? "text-slate-500" : "text-gray-500"
                                }`}
                              >
                                ({m.role === "company_admin" ? "Admin" : "Director"})
                              </span>
                            </li>
                          ))
                        )}
                      </ul>
                    )}
                    {loadingCompanyInvitations ? (
                      <p
                        className={`text-sm ${
                          isDark ? "text-slate-400" : "text-gray-500"
                        }`}
                      >
                        Loading invitations...
                      </p>
                    ) : (
                      <>
                        <div className="flex items-center justify-between gap-2">
                          <span
                            className={`text-sm ${
                              isDark ? "text-slate-400" : "text-gray-600"
                            }`}
                          >
                            Pending invitations
                          </span>
                          {!showInviteDirectorForm ? (
                            <button
                              onClick={() => setShowInviteDirectorForm(true)}
                              className={`flex items-center gap-1 px-3 py-1.5 rounded text-sm font-medium ${
                                isDark
                                  ? "bg-blue-600 hover:bg-blue-700 text-white"
                                  : "bg-blue-500 hover:bg-blue-600 text-white"
                              }`}
                            >
                              <UserPlus className="h-4 w-4" />
                              Invite director
                            </button>
                          ) : null}
                        </div>
                        {showInviteDirectorForm ? (
                          <div className="flex flex-wrap items-center gap-2">
                            <input
                              type="email"
                              value={inviteDirectorEmail}
                              onChange={(e) =>
                                setInviteDirectorEmail(e.target.value)}
                              placeholder="Email address"
                              className={`px-3 py-2 rounded border text-sm ${
                                isDark
                                  ? "bg-slate-600 border-slate-500 text-slate-200"
                                  : "bg-white border-gray-300 text-gray-900"
                              }`}
                              disabled={sendingInviteDirector}
                            />
                            <button
                              onClick={handleInviteDirector}
                              disabled={
                                sendingInviteDirector ||
                                !inviteDirectorEmail.trim()
                              }
                              className={`px-3 py-2 rounded text-sm font-medium ${
                                isDark
                                  ? "bg-blue-600 hover:bg-blue-700 text-white disabled:bg-slate-600"
                                  : "bg-blue-500 hover:bg-blue-600 text-white disabled:bg-gray-400"
                              }`}
                            >
                              {sendingInviteDirector ? "Sending..." : "Send"}
                            </button>
                            <button
                              onClick={() => {
                                setShowInviteDirectorForm(false);
                                setInviteDirectorEmail("");
                              }}
                              disabled={sendingInviteDirector}
                              className={`px-3 py-2 rounded text-sm ${
                                isDark
                                  ? "bg-slate-600 hover:bg-slate-700 text-slate-200"
                                  : "bg-gray-200 hover:bg-gray-300 text-gray-700"
                              }`}
                            >
                              Cancel
                            </button>
                          </div>
                        ) : null}
                        {companyInvitations.filter(
                          (i) => i.status === "pending",
                        ).length === 0 ? (
                          <p
                            className={`text-sm ${
                              isDark ? "text-slate-500" : "text-gray-500"
                            }`}
                          >
                            No pending invitations.
                          </p>
                        ) : (
                          <ul
                            className={`text-sm space-y-1 ${
                              isDark ? "text-slate-300" : "text-gray-700"
                            }`}
                          >
                            {companyInvitations
                              .filter((i) => i.status === "pending")
                              .map((inv) => (
                                <li
                                  key={inv.id}
                                  className="flex items-center gap-2"
                                >
                                  <Mail className="h-4 w-4 shrink-0" />
                                  {inv.email} — expires{" "}
                                  {new Date(inv.expires_at).toLocaleDateString()}
                                  <button
                                    onClick={() =>
                                      handleCancelCompanyInvitation(inv.id)}
                                    className={`p-1 rounded ${
                                      isDark
                                        ? "hover:bg-slate-600 text-red-300"
                                        : "hover:bg-gray-200 text-red-600"
                                    }`}
                                    title="Cancel invitation"
                                  >
                                    <X className="h-4 w-4" />
                                  </button>
                                </li>
                              ))}
                          </ul>
                        )}
                      </>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {!selectedCompanyId ? (
          <div
            className={`p-6 rounded-lg text-center ${
              isDark ? "bg-slate-800 text-slate-300" : "bg-white text-gray-600"
            }`}
          >
            Select a company above to manage tenant members.
          </div>
        ) : companyTenants.length === 0 ? (
          <div
            className={`p-6 rounded-lg text-center ${
              isDark ? "bg-slate-800 text-slate-300" : "bg-white text-gray-600"
            }`}
          >
            No tenants in this company. Add a tenant above to manage members.
          </div>
        ) : (
          <>
            {/* Team ページ内のテナントセレクター（選択した会社に属するテナントのみ表示） */}
            <div
              className={`p-6 rounded-lg ${
                isDark ? "bg-slate-800" : "bg-white"
              }`}
            >
              <h2 className="text-xl font-semibold mb-4">Manage tenant members</h2>
              <div className="flex flex-wrap items-center gap-2">
                <label
                  className={`text-sm font-medium ${
                    isDark ? "text-slate-300" : "text-gray-700"
                  }`}
                >
                  Select tenant:
                </label>
                <select
                  value={teamSelectedTenantId ?? ""}
                  onChange={(e) =>
                    setTeamSelectedTenantId(
                      e.target.value ? e.target.value : null,
                    )
                  }
                  className={`px-3 py-2 rounded border ${
                    isDark
                      ? "bg-slate-600 border-slate-500 text-slate-200"
                      : "bg-white border-gray-300 text-gray-900"
                  }`}
                >
                  {companyTenants.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {loading && teamSelectedTenantId ? (
              <div className="flex items-center justify-center h-32">
                <div className="text-lg">Loading tenant...</div>
              </div>
            ) : null}

            {!loading && teamSelectedTenantId && tenantsWithMembers.length === 0 ? (
              <div className="flex items-center justify-center h-32">
                <div className="text-lg">No tenant data</div>
              </div>
            ) : null}
          </>
        )}

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

        {tenantsWithMembers.map((tenant) => {
          const isAdmin = tenant.role === "admin";
          const isEditing = editingTenantId === tenant.id;
          const editedName = editedTenantNames.get(tenant.id) || tenant.name;
          const isSaving = savingTenantIds.has(tenant.id);

          return (
            <div key={tenant.id} className="space-y-6">
              {/* テナント情報セクション */}
              <div
                className={`p-6 rounded-lg ${
                  isDark ? "bg-slate-800" : "bg-white"
                }`}
              >
                <h2 className="text-xl font-semibold mb-4">{tenant.name}</h2>
                <div className="space-y-4">
                  <div>
                    <label
                      className={`text-sm font-medium ${
                        isDark ? "text-slate-300" : "text-gray-700"
                      }`}
                    >
                      Name
                    </label>
                    {isEditing ? (
                      <div className="flex items-center gap-2 mt-1">
                        <input
                          type="text"
                          value={editedName}
                          onChange={(e) => {
                            const newMap = new Map(editedTenantNames);
                            newMap.set(tenant.id, e.target.value);
                            setEditedTenantNames(newMap);
                          }}
                          className={`flex-1 px-3 py-2 rounded border ${
                            isDark
                              ? "bg-slate-700 border-slate-600 text-slate-200"
                              : "bg-white border-gray-300 text-gray-900"
                          }`}
                          disabled={isSaving}
                        />
                        <button
                          onClick={() => handleSaveTenantName(tenant.id)}
                          disabled={isSaving}
                          className="p-2 text-green-600 hover:text-green-700"
                        >
                          <Save className="h-5 w-5" />
                        </button>
                        <button
                          onClick={() => {
                            setEditingTenantId(null);
                            const newMap = new Map(editedTenantNames);
                            newMap.set(tenant.id, tenant.name);
                            setEditedTenantNames(newMap);
                          }}
                          disabled={isSaving}
                          className="p-2 text-gray-600 hover:text-gray-700"
                        >
                          <X className="h-5 w-5" />
                        </button>
                      </div>
                    ) : (
                      <div className="flex items-center gap-2 mt-1">
                        <span
                          className={`text-lg ${
                            isDark ? "text-slate-100" : "text-gray-900"
                          }`}
                        >
                          {tenant.name}
                        </span>
                        {isAdmin && (
                          <button
                            onClick={() => setEditingTenantId(tenant.id)}
                            className="p-1 text-gray-600 hover:text-gray-700"
                          >
                            <Edit className="h-4 w-4" />
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                  <div>
                    <label
                      className={`text-sm font-medium ${
                        isDark ? "text-slate-300" : "text-gray-700"
                      }`}
                    >
                      Type
                    </label>
                    <div
                      className={`mt-1 text-lg capitalize ${
                        isDark ? "text-slate-100" : "text-gray-900"
                      }`}
                    >
                      {tenant.type}
                    </div>
                  </div>
                  <div>
                    <label
                      className={`text-sm font-medium ${
                        isDark ? "text-slate-300" : "text-gray-700"
                      }`}
                    >
                      Your Role
                    </label>
                    <div
                      className={`mt-1 capitalize ${
                        isDark ? "text-slate-100" : "text-gray-900"
                      }`}
                    >
                      {tenant.role}
                    </div>
                  </div>
                  {tenant.created_at && (
                    <div>
                      <label
                        className={`text-sm font-medium ${
                          isDark ? "text-slate-300" : "text-gray-700"
                        }`}
                      >
                        Created
                      </label>
                      <div
                        className={`mt-1 ${
                          isDark ? "text-slate-100" : "text-gray-900"
                        }`}
                      >
                        {new Date(tenant.created_at).toLocaleDateString()}
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* チームメンバーセクション */}
              <div
                className={`p-6 rounded-lg ${
                  isDark ? "bg-slate-800" : "bg-white"
                }`}
              >
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-xl font-semibold">
                    Team Members ({tenant.members.length})
                  </h2>
                  {isAdmin && (
                    <button
                      onClick={() => {
                        const newMap = new Map(showInviteForm);
                        newMap.set(tenant.id, !newMap.get(tenant.id));
                        setShowInviteForm(newMap);
                        // フォームを開く際にデフォルト値を設定
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
                  )}
                </div>
                {isAdmin && showInviteForm.get(tenant.id) && (
                  <div
                    className={`mb-6 p-4 rounded-lg ${
                      isDark ? "bg-slate-700" : "bg-gray-50"
                    }`}
                  >
                    <h3 className="text-lg font-medium mb-4">
                      Send Invitation
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
                              e.target.value as "manager" | "staff",
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
                          <option value="manager">Manager</option>
                          <option value="staff">Staff</option>
                        </select>
                      </div>
                      <div className="flex items-center gap-2">
                        <button
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
                                isDark ? "text-slate-100" : "text-gray-900"
                              }`}
                            >
                              {member.name || member.email || "User"}
                            </div>
                            {member.email && (
                              <div
                                className={`text-sm ${
                                  isDark ? "text-slate-400" : "text-gray-500"
                                }`}
                              >
                                {member.email}
                              </div>
                            )}
                            <div
                              className={`text-xs mt-1 ${
                                isDark ? "text-slate-400" : "text-gray-500"
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
                          {isAdmin && (
                            <>
                              <select
                                value={member.role}
                                onChange={(e) =>
                                  handleChangeMemberRole(
                                    tenant.id,
                                    member.user_id,
                                    e.target.value as
                                      | "admin"
                                      | "manager"
                                      | "staff",
                                  )
                                }
                                className={`px-3 py-2 rounded border ${
                                  isDark
                                    ? "bg-slate-600 border-slate-500 text-slate-200"
                                    : "bg-white border-gray-300 text-gray-900"
                                }`}
                              >
                                <option value="admin">Admin</option>
                                <option value="manager">Manager</option>
                                <option value="staff">Staff</option>
                              </select>
                              <button
                                onClick={() =>
                                  handleRemoveMember(tenant.id, member.user_id)
                                }
                                className="p-2 text-red-600 hover:text-red-700"
                                title="Remove member"
                              >
                                <Trash2 className="h-5 w-5" />
                              </button>
                            </>
                          )}
                          {!isAdmin && (
                            <span
                              className={`px-3 py-1 rounded text-sm font-medium capitalize ${
                                member.role === "admin"
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

              {/* 招待一覧セクション（Adminのみ） */}
              {isAdmin && (
                <div
                  className={`p-6 rounded-lg ${
                    isDark ? "bg-slate-800" : "bg-white"
                  }`}
                >
                  <h2 className="text-xl font-semibold mb-4">
                    Invitations ({invitations.length})
                  </h2>
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
                        const displayStatus = getDisplayStatus(invitation);
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
                                    isDark ? "text-slate-100" : "text-gray-900"
                                  }`}
                                >
                                  {invitation.email}
                                </div>
                                <div
                                  className={`text-sm mt-1 ${
                                    isDark ? "text-slate-400" : "text-gray-500"
                                  }`}
                                >
                                  Role:{" "}
                                  <span className="capitalize">
                                    {invitation.role}
                                  </span>
                                </div>
                                <div
                                  className={`text-xs mt-1 ${
                                    isDark ? "text-slate-400" : "text-gray-500"
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
  );
}
