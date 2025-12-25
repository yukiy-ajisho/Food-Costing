"use client";

import { useState, useEffect } from "react";
import { apiRequest } from "@/lib/api";
import { useTheme } from "@/contexts/ThemeContext";
import { Edit, Save, X, Trash2, User } from "lucide-react";

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

export default function TeamPage() {
  const { theme } = useTheme();
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

  const isDark = theme === "dark";

  // テナント情報とメンバー一覧を取得
  useEffect(() => {
    const fetchTeamData = async () => {
      try {
        setLoading(true);

        // ユーザーが属するすべてのテナントを取得
        const tenantsData = await apiRequest<{
          tenants: Array<{
            id: string;
            name: string;
            type: string;
            created_at: string;
            role: string;
          }>;
        }>("/tenants");

        if (tenantsData.tenants && tenantsData.tenants.length > 0) {
          // すべてのテナントに対して、情報とメンバー一覧を並列取得
          const tenantsWithMembersData = await Promise.all(
            tenantsData.tenants.map(async (tenant) => {
              const [tenantDetail, membersData] = await Promise.all([
                apiRequest<{
                  id: string;
                  name: string;
                  type: string;
                  created_at: string;
                  role: string;
                }>(`/tenants/${tenant.id}`),
                apiRequest<{ members: TenantMember[] }>(
                  `/tenants/${tenant.id}/members`
                ),
              ]);

              return {
                ...tenantDetail,
                members: membersData.members || [],
              };
            })
          );

          setTenantsWithMembers(tenantsWithMembersData);

          // 編集用のテナント名を初期化
          const namesMap = new Map<string, string>();
          tenantsWithMembersData.forEach((tenant) => {
            namesMap.set(tenant.id, tenant.name);
          });
          setEditedTenantNames(namesMap);
        }
      } catch (error) {
        console.error("Failed to fetch team data:", error);
      } finally {
        setLoading(false);
      }
    };

    fetchTeamData();
  }, []);

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
                <h2 className="text-xl font-semibold mb-4">
                  Team Members ({tenant.members.length})
                </h2>
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
            </div>
          );
        })}
      </div>
    </div>
  );
}
