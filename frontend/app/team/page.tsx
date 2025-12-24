"use client";

import { useState, useEffect } from "react";
import { useTenant } from "@/contexts/TenantContext";
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

export default function TeamPage() {
  const { theme } = useTheme();
  const { currentTenant, setCurrentTenant } = useTenant();
  const [members, setMembers] = useState<TenantMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [isEditingTenantName, setIsEditingTenantName] = useState(false);
  const [editedTenantName, setEditedTenantName] = useState("");
  const [isSavingTenantName, setIsSavingTenantName] = useState(false);

  const isDark = theme === "dark";

  // テナント情報とメンバー一覧を取得
  useEffect(() => {
    const fetchTeamData = async () => {
      if (!currentTenant) {
        setLoading(false);
        return;
      }

      try {
        setLoading(true);

        // テナント情報を取得（最新の情報を取得）
        const tenantData = await apiRequest<{
          id: string;
          name: string;
          type: string;
          created_at: string;
          role: string;
        }>(`/tenants/${currentTenant.id}`, {}, currentTenant.id);

        // テナント情報を更新（変更がある場合のみ）
        const updatedTenant = {
          id: tenantData.id,
          name: tenantData.name,
          type: tenantData.type as "restaurant" | "vendor",
          created_at: tenantData.created_at,
          role: tenantData.role as "admin" | "manager" | "staff",
        };

        // 変更がある場合のみ更新（無限ループを防ぐ）
        if (
          currentTenant.name !== updatedTenant.name ||
          currentTenant.role !== updatedTenant.role
        ) {
          setCurrentTenant(updatedTenant);
        }
        setEditedTenantName(tenantData.name);

        // メンバー一覧を取得
        const membersData = await apiRequest<{ members: TenantMember[] }>(
          `/tenants/${currentTenant.id}/members`,
          {},
          currentTenant.id
        );
        setMembers(membersData.members || []);
      } catch (error) {
        console.error("Failed to fetch team data:", error);
      } finally {
        setLoading(false);
      }
    };

    fetchTeamData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentTenant?.id]);

  // テナント名を保存
  const handleSaveTenantName = async () => {
    if (!currentTenant || !editedTenantName.trim()) return;

    try {
      setIsSavingTenantName(true);
      const updatedTenant = await apiRequest<{
        id: string;
        name: string;
        type: string;
        created_at: string;
      }>(
        `/tenants/${currentTenant.id}`,
        {
          method: "PUT",
          body: JSON.stringify({ name: editedTenantName.trim() }),
        },
        currentTenant.id
      );

      setCurrentTenant({
        ...currentTenant,
        name: updatedTenant.name,
      });
      setIsEditingTenantName(false);
    } catch (error) {
      console.error("Failed to update tenant name:", error);
      alert("Failed to update tenant name");
    } finally {
      setIsSavingTenantName(false);
    }
  };

  // メンバーの役割を変更
  const handleChangeMemberRole = async (
    userId: string,
    newRole: "admin" | "manager" | "staff"
  ) => {
    if (!currentTenant) return;

    try {
      await apiRequest(
        `/tenants/${currentTenant.id}/members/${userId}/role`,
        {
          method: "PUT",
          body: JSON.stringify({ role: newRole }),
        },
        currentTenant.id
      );

      // メンバー一覧を更新
      setMembers((prev) =>
        prev.map((m) => (m.user_id === userId ? { ...m, role: newRole } : m))
      );
    } catch (error) {
      console.error("Failed to change member role:", error);
      alert("Failed to change member role");
    }
  };

  // メンバーを削除
  const handleRemoveMember = async (userId: string) => {
    if (!currentTenant) return;

    if (
      !confirm("Are you sure you want to remove this member from the tenant?")
    ) {
      return;
    }

    try {
      await apiRequest(
        `/tenants/${currentTenant.id}/members/${userId}`,
        {
          method: "DELETE",
        },
        currentTenant.id
      );

      // メンバー一覧を更新
      setMembers((prev) => prev.filter((m) => m.user_id !== userId));
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

  if (!currentTenant) {
    return (
      <div className="p-8">
        <div className="flex items-center justify-center h-64">
          <div className="text-lg">Please select a tenant</div>
        </div>
      </div>
    );
  }

  // 現在のユーザーの役割を取得（currentTenantから）
  const currentUserRole = currentTenant.role || "staff";
  const isAdmin = currentUserRole === "admin";

  return (
    <div className="p-8">
      <div className="max-w-4xl mx-auto">
        {/* テナント情報セクション */}
        <div
          className={`mb-8 p-6 rounded-lg ${
            isDark ? "bg-slate-800" : "bg-white"
          }`}
        >
          <h2 className="text-xl font-semibold mb-4">
            Organization Information
          </h2>
          <div className="space-y-4">
            <div>
              <label
                className={`text-sm font-medium ${
                  isDark ? "text-slate-300" : "text-gray-700"
                }`}
              >
                Name
              </label>
              {isEditingTenantName ? (
                <div className="flex items-center gap-2 mt-1">
                  <input
                    type="text"
                    value={editedTenantName}
                    onChange={(e) => setEditedTenantName(e.target.value)}
                    className={`flex-1 px-3 py-2 rounded border ${
                      isDark
                        ? "bg-slate-700 border-slate-600 text-slate-200"
                        : "bg-white border-gray-300 text-gray-900"
                    }`}
                    disabled={isSavingTenantName}
                  />
                  <button
                    onClick={handleSaveTenantName}
                    disabled={isSavingTenantName}
                    className="p-2 text-green-600 hover:text-green-700"
                  >
                    <Save className="h-5 w-5" />
                  </button>
                  <button
                    onClick={() => {
                      setIsEditingTenantName(false);
                      setEditedTenantName(currentTenant.name);
                    }}
                    disabled={isSavingTenantName}
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
                    {currentTenant.name}
                  </span>
                  {isAdmin && (
                    <button
                      onClick={() => setIsEditingTenantName(true)}
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
                {currentTenant.type}
              </div>
            </div>
            {currentTenant.created_at && (
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
                  {new Date(currentTenant.created_at).toLocaleDateString()}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* チームメンバーセクション */}
        <div
          className={`p-6 rounded-lg ${isDark ? "bg-slate-800" : "bg-white"}`}
        >
          <h2 className="text-xl font-semibold mb-4">
            Team Members ({members.length})
          </h2>
          {members.length === 0 ? (
            <div
              className={`text-center py-8 ${
                isDark ? "text-slate-400" : "text-gray-500"
              }`}
            >
              No members found
            </div>
          ) : (
            <div className="space-y-4">
              {members.map((member) => (
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
                        {new Date(member.member_since).toLocaleDateString()}
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
                              member.user_id,
                              e.target.value as "admin" | "manager" | "staff"
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
                          onClick={() => handleRemoveMember(member.user_id)}
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
    </div>
  );
}
