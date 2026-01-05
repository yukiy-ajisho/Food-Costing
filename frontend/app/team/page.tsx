"use client";

import { useState, useEffect } from "react";
import { apiRequest } from "@/lib/api";
import { useTheme } from "@/contexts/ThemeContext";
import { useTenant } from "@/contexts/TenantContext";
import { Edit, Save, X, Trash2, User, UserPlus, Mail } from "lucide-react";

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

export default function TeamPage() {
  const { theme } = useTheme();
  const { selectedTenantId } = useTenant();
  // Phase 1a: すべてのテナントの情報を表示
  const [tenantsWithMembers, setTenantsWithMembers] = useState<
    TenantWithMembers[]
  >([]);
  const [loading, setLoading] = useState(true);
  const [editingTenantId, setEditingTenantId] = useState<string | null>(null);
  const [editedTenantNames, setEditedTenantNames] = useState<
    Map<string, string>
  >(new Map());
  const [savingTenantIds, setSavingTenantIds] = useState<Set<string>>(
    new Set()
  );
  const [showInviteForm, setShowInviteForm] = useState<Map<string, boolean>>(
    new Map()
  );
  const [inviteEmail, setInviteEmail] = useState<Map<string, string>>(
    new Map()
  );
  const [inviteRole, setInviteRole] = useState<Map<string, "manager" | "staff">>(
    new Map()
  );
  const [sendingInvite, setSendingInvite] = useState<Set<string>>(new Set());
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [loadingInvitations, setLoadingInvitations] = useState(false);

  const isDark = theme === "dark";

  // テナント情報とメンバー一覧を取得
  useEffect(() => {
    // selectedTenantIdが設定されるまで待つ（テナント選択の変更を検知するため）
    if (!selectedTenantId) return;

    const fetchTeamData = async () => {
      try {
        setLoading(true);

        // 選択されたテナントの情報とメンバー一覧を取得
        const [tenantDetail, membersData] = await Promise.all([
          apiRequest<{
            id: string;
            name: string;
            type: string;
            created_at: string;
            role: string;
          }>(`/tenants/${selectedTenantId}`),
          apiRequest<{ members: TenantMember[] }>(
            `/tenants/${selectedTenantId}/members`
          ),
        ]);

        const tenantWithMembers = {
          ...tenantDetail,
          members: membersData.members || [],
        };

        setTenantsWithMembers([tenantWithMembers]);

        // 編集用のテナント名を初期化
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
  }, [selectedTenantId]);

  // 招待一覧を取得する関数
  const fetchInvitations = async () => {
    if (!selectedTenantId) return;

    try {
      setLoadingInvitations(true);
      const data = await apiRequest<{ invitations: Invitation[] }>("/invite");
      setInvitations(data.invitations || []);
    } catch (error) {
      console.error("Failed to fetch invitations:", error);
      // 403エラー（Adminでない場合）は無視
      const apiError = error as { status?: number };
      if (apiError?.status !== 403) {
        setInvitations([]);
      }
    } finally {
      setLoadingInvitations(false);
    }
  };

  // 招待一覧を取得（Adminのみ、選択されたテナント）
  useEffect(() => {
    fetchInvitations();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedTenantId]);

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
            : tenant
        )
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
    newRole: "admin" | "manager" | "staff"
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
                  m.user_id === userId ? { ...m, role: newRole } : m
                ),
              }
            : tenant
        )
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
            : tenant
        )
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
      await apiRequest("/invite", {
        method: "POST",
        body: JSON.stringify({
          email: email.trim(),
          role,
          tenant_id: tenantId,
        }),
      });

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

  if (loading) {
    return (
      <div className="p-8">
        <div className="flex items-center justify-center h-64">
          <div className="text-lg">Loading...</div>
        </div>
      </div>
    );
  }

  if (tenantsWithMembers.length === 0) {
    return (
      <div className="p-8">
        <div className="flex items-center justify-center h-64">
          <div className="text-lg">No tenants found</div>
        </div>
      </div>
    );
  }

  return (
    <div className="p-8">
      <div className="max-w-4xl mx-auto space-y-8">
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
                      {showInviteForm.get(tenant.id) ? "Cancel" : "Invite Member"}
                    </button>
                  )}
                </div>
                {isAdmin && showInviteForm.get(tenant.id) && (
                  <div
                    className={`mb-6 p-4 rounded-lg ${
                      isDark ? "bg-slate-700" : "bg-gray-50"
                    }`}
                  >
                    <h3 className="text-lg font-medium mb-4">Send Invitation</h3>
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
                              e.target.value as "manager" | "staff"
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
                                member.member_since
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
                                      | "staff"
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
                                    isDark
                                      ? "text-slate-100"
                                      : "text-gray-900"
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
                                    invitation.created_at
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
