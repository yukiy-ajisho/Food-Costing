"use client";

import { useState } from "react";
import Image from "next/image";
import { LogOut } from "lucide-react";
import { useUser } from "@/hooks/useUser";
import { signOut } from "@/lib/auth";
import { useTheme } from "@/contexts/ThemeContext";

export function UserProfile() {
  const { user, loading } = useUser();
  const { theme } = useTheme();
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);

  const isDark = theme === "dark";

  const handleSignOut = async () => {
    try {
      await signOut();
      // ハードリロードでログインページに遷移（レイアウトを完全にクリア）
      window.location.href = "/login";
    } catch (error) {
      console.error("Error signing out:", error);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center">
        <div
          className={`w-10 h-10 rounded-full animate-pulse ${
            isDark ? "bg-slate-700" : "bg-gray-200"
          }`}
        ></div>
      </div>
    );
  }

  if (!user) {
    return null;
  }

  const avatarUrl =
    user.user_metadata?.avatar_url || user.user_metadata?.picture;

  const displayName =
    user.user_metadata?.full_name ||
    user.user_metadata?.name ||
    user.email?.split("@")[0] ||
    "User";

  const fullName =
    user.user_metadata?.full_name || user.user_metadata?.name || "User";

  return (
    <div className="relative">
      <button
        onClick={() => setIsDropdownOpen(!isDropdownOpen)}
        className={`flex items-center space-x-3 px-3 py-2 rounded-lg transition-colors ${
          isDark
            ? "hover:bg-slate-700 text-slate-200"
            : "hover:bg-gray-100 text-gray-700"
        }`}
      >
        {avatarUrl ? (
          <Image
            src={avatarUrl}
            alt={displayName}
            width={40}
            height={40}
            className="rounded-full"
          />
        ) : (
          <div
            className={`w-10 h-10 rounded-full flex items-center justify-center text-sm font-semibold ${
              isDark
                ? "bg-slate-600 text-slate-200"
                : "bg-gray-300 text-gray-700"
            }`}
          >
            {displayName.charAt(0).toUpperCase()}
          </div>
        )}
        <span className="text-sm font-medium">{displayName}</span>
      </button>

      {isDropdownOpen && (
        <>
          <div
            className="fixed inset-0 z-40"
            onClick={() => setIsDropdownOpen(false)}
          ></div>
          <div
            className={`absolute top-full right-0 mt-2 w-56 rounded-lg shadow-lg border py-2 z-[60] ${
              isDark
                ? "bg-slate-800 border-slate-700"
                : "bg-white border-gray-200"
            }`}
          >
            <div className="px-4 pt-2 pb-1">
              <p
                className={`text-sm font-medium ${
                  isDark ? "text-slate-100" : "text-gray-900"
                }`}
              >
                {fullName}
              </p>
            </div>
            <div
              className={`px-4 pt-0 pb-4 border-b ${
                isDark ? "border-slate-700" : "border-gray-100"
              }`}
            >
              <p
                className={`text-xs ${
                  isDark ? "text-slate-400" : "text-gray-500"
                }`}
              >
                {user.email}
              </p>
            </div>
            <button
              onClick={handleSignOut}
              className={`w-full px-4 py-2 text-left flex items-center text-sm transition-colors ${
                isDark
                  ? "text-slate-200 hover:bg-slate-700"
                  : "text-gray-700 hover:bg-gray-100"
              }`}
            >
              <LogOut className="w-4 h-4 mr-3" />
              Sign Out
            </button>
          </div>
        </>
      )}
    </div>
  );
}
