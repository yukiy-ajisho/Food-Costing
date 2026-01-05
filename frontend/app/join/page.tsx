"use client";

import { useState, useEffect, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { apiRequest } from "@/lib/api";
import { useTheme } from "@/contexts/ThemeContext";
import { CheckCircle, XCircle, Loader2 } from "lucide-react";

interface InvitationData {
  id: string;
  email: string;
  role: string;
  tenant_id: string;
  tenant_name: string | null;
  status: string;
  expires_at: string;
}

function JoinPageContent() {
  const { theme } = useTheme();
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get("token");

  const [invitation, setInvitation] = useState<InvitationData | null>(null);
  const [isVerifying, setIsVerifying] = useState(true);
  const [isAccepting, setIsAccepting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isAuthenticated, setIsAuthenticated] = useState<boolean | null>(null);

  const isDark = theme === "dark";

  // 認証状態を確認
  useEffect(() => {
    const checkAuth = async () => {
      try {
        // セッションを確認するためにAPIリクエストを試行
        await apiRequest("/tenants");
        setIsAuthenticated(true);
      } catch (err) {
        setIsAuthenticated(false);
      }
    };

    if (token) {
      checkAuth();
    }
  }, [token]);

  // トークンを検証
  useEffect(() => {
    const verifyToken = async () => {
      if (!token) {
        setError("No invitation token provided");
        setIsVerifying(false);
        return;
      }

      try {
        const data = await apiRequest<InvitationData>(
          `/invite/verify/${token}`
        );
        setInvitation(data);
      } catch (err: unknown) {
        const error = err as { details?: string; error?: string };
        setError(error.details || error.error || "Invalid invitation");
      } finally {
        setIsVerifying(false);
      }
    };

    verifyToken();
  }, [token]);

  // 未認証の場合はログインページにリダイレクト
  useEffect(() => {
    if (isAuthenticated === false && token) {
      // トークンをsessionStorageに保存
      if (typeof window !== "undefined") {
        sessionStorage.setItem("inviteToken", token);
      }
      router.push(`/login?returnUrl=${encodeURIComponent(`/join?token=${token}`)}`);
    }
  }, [isAuthenticated, token, router]);

  const handleAcceptInvite = async () => {
    if (!token || !invitation) return;

    setIsAccepting(true);
    try {
      await apiRequest("/invite/accept", {
        method: "POST",
        body: JSON.stringify({ token }),
      });

      // 成功メッセージを表示
      alert("Invitation accepted successfully! Redirecting to dashboard...");

      // ダッシュボードにリダイレクト
      setTimeout(() => {
        router.push("/");
      }, 1500);
    } catch (err: unknown) {
      const error = err as { details?: string; error?: string };
      setError(error.details || error.error || "Failed to accept invitation");
      setIsAccepting(false);
    }
  };

  if (isVerifying || isAuthenticated === null) {
    return (
      <div className="min-h-screen flex items-center justify-center p-8">
        <div
          className={`max-w-md w-full p-8 rounded-lg ${
            isDark ? "bg-slate-800" : "bg-white"
          }`}
        >
          <div className="flex items-center justify-center">
            <Loader2 className="h-8 w-8 animate-spin text-blue-500" />
          </div>
          <p
            className={`mt-4 text-center ${
              isDark ? "text-slate-300" : "text-gray-600"
            }`}
          >
            Verifying invitation...
          </p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center p-8">
        <div
          className={`max-w-md w-full p-8 rounded-lg ${
            isDark ? "bg-slate-800" : "bg-white"
          }`}
        >
          <div className="flex items-center justify-center mb-4">
            <XCircle className="h-12 w-12 text-red-500" />
          </div>
          <h1
            className={`text-2xl font-semibold mb-4 text-center ${
              isDark ? "text-slate-100" : "text-gray-900"
            }`}
          >
            Invalid Invitation
          </h1>
          <p
            className={`text-center mb-6 ${
              isDark ? "text-slate-300" : "text-gray-600"
            }`}
          >
            {error}
          </p>
          <button
            onClick={() => router.push("/")}
            className={`w-full px-4 py-2 rounded-lg font-medium ${
              isDark
                ? "bg-slate-700 hover:bg-slate-600 text-slate-200"
                : "bg-gray-200 hover:bg-gray-300 text-gray-700"
            }`}
          >
            Go Home
          </button>
        </div>
      </div>
    );
  }

  if (!invitation) {
    return null;
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-8">
      <div
        className={`max-w-md w-full p-8 rounded-lg ${
          isDark ? "bg-slate-800" : "bg-white"
        }`}
      >
        <div className="flex items-center justify-center mb-4">
          <CheckCircle className="h-12 w-12 text-green-500" />
        </div>
        <h1
          className={`text-2xl font-semibold mb-4 text-center ${
            isDark ? "text-slate-100" : "text-gray-900"
          }`}
        >
          Team Invitation
        </h1>
        <p
          className={`text-center mb-6 ${
            isDark ? "text-slate-300" : "text-gray-600"
          }`}
        >
          You&apos;ve been invited to join a team on Food Costing.
        </p>

        <div
          className={`space-y-4 mb-6 p-4 rounded-lg ${
            isDark ? "bg-slate-700" : "bg-gray-50"
          }`}
        >
          <div>
            <p
              className={`text-sm font-medium mb-1 ${
                isDark ? "text-slate-400" : "text-gray-500"
              }`}
            >
              Team
            </p>
            <p
              className={`text-lg ${
                isDark ? "text-slate-100" : "text-gray-900"
              }`}
            >
              {invitation.tenant_name || "Unknown Team"}
            </p>
          </div>
          <div>
            <p
              className={`text-sm font-medium mb-1 ${
                isDark ? "text-slate-400" : "text-gray-500"
              }`}
            >
              Role
            </p>
            <p
              className={`text-lg capitalize ${
                isDark ? "text-slate-100" : "text-gray-900"
              }`}
            >
              {invitation.role}
            </p>
          </div>
          <div>
            <p
              className={`text-sm font-medium mb-1 ${
                isDark ? "text-slate-400" : "text-gray-500"
              }`}
            >
              Email
            </p>
            <p
              className={`text-lg ${
                isDark ? "text-slate-100" : "text-gray-900"
              }`}
            >
              {invitation.email}
            </p>
          </div>
        </div>

        <button
          onClick={handleAcceptInvite}
          disabled={isAccepting}
          className={`w-full px-4 py-3 rounded-lg font-medium ${
            isDark
              ? "bg-blue-600 hover:bg-blue-700 text-white disabled:bg-slate-600"
              : "bg-blue-500 hover:bg-blue-600 text-white disabled:bg-gray-400"
          }`}
        >
          {isAccepting ? (
            <span className="flex items-center justify-center">
              <Loader2 className="h-5 w-5 animate-spin mr-2" />
              Accepting...
            </span>
          ) : (
            "Accept Invitation"
          )}
        </button>
      </div>
    </div>
  );
}

// Loading fallback component
function JoinPageFallback() {
  const { theme } = useTheme();
  const isDark = theme === "dark";

  return (
    <div className="min-h-screen flex items-center justify-center p-8">
      <div
        className={`max-w-md w-full p-8 rounded-lg ${
          isDark ? "bg-slate-800" : "bg-white"
        }`}
      >
        <div className="flex items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-blue-500" />
        </div>
        <p
          className={`mt-4 text-center ${
            isDark ? "text-slate-300" : "text-gray-600"
          }`}
        >
          Loading...
        </p>
      </div>
    </div>
  );
}

// Main page component with Suspense boundary
export default function JoinPage() {
  return (
    <Suspense fallback={<JoinPageFallback />}>
      <JoinPageContent />
    </Suspense>
  );
}

