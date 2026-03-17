"use client";

import { useState, useEffect, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useTheme } from "@/contexts/ThemeContext";
import { createClient } from "@/lib/supabase-client";
import { apiRequest } from "@/lib/api";
import { CheckCircle, XCircle, Loader2, Building2 } from "lucide-react";

interface CompanyInvitationData {
  id: string;
  email: string;
  company_id: string;
  company_name: string | null;
  status: string;
  expires_at: string;
}

function JoinCompanyPageContent() {
  const { theme } = useTheme();
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get("token");

  const [invitation, setInvitation] = useState<CompanyInvitationData | null>(
    null,
  );
  const [isVerifying, setIsVerifying] = useState(true);
  const [isAccepting, setIsAccepting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isAuthenticated, setIsAuthenticated] = useState<boolean | null>(null);

  const isDark = theme === "dark";

  useEffect(() => {
    const checkAuth = async () => {
      try {
        const supabase = createClient();
        const {
          data: { session },
        } = await supabase.auth.getSession();
        setIsAuthenticated(!!session);
      } catch {
        setIsAuthenticated(false);
      }
    };

    if (token) {
      checkAuth();
    }
  }, [token]);

  useEffect(() => {
    const verifyToken = async () => {
      if (!token) {
        setError("No invitation token provided");
        setIsVerifying(false);
        return;
      }

      try {
        const API_URL =
          process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";
        const response = await fetch(
          `${API_URL}/invite/verify-company/${encodeURIComponent(token)}`,
        );

        if (!response.ok) {
          const errorData = await response.json();
          throw new Error(
            errorData.error || errorData.details || "Invalid invitation",
          );
        }

        const data = await response.json();
        setInvitation(data);
      } catch (err: unknown) {
        const error = err as { message?: string };
        setError(error.message || "Invalid invitation");
      } finally {
        setIsVerifying(false);
      }
    };

    verifyToken();
  }, [token]);

  const handleAcceptInvite = async () => {
    if (!token || !invitation) return;

    if (!isAuthenticated) {
      setIsAccepting(true);
      const supabase = createClient();
      const callbackUrl = `${window.location.origin}/join-company?token=${encodeURIComponent(token)}`;

      const { error } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: {
          redirectTo: callbackUrl,
        },
      });

      if (error) {
        console.error("OAuth error:", error);
        setError("Failed to start authentication. Please try again.");
        setIsAccepting(false);
      }
      return;
    }

    setIsAccepting(true);
    try {
      await apiRequest("/invite/accept-company", {
        method: "POST",
        body: JSON.stringify({ token }),
      });

      alert(
        "You've joined the company as a director. Redirecting to Team...",
      );
      setTimeout(() => {
        router.push("/team");
      }, 1500);
    } catch (err: unknown) {
      const error = err as { details?: string; error?: string };
      setError(error.details || error.error || "Failed to accept invitation");
      setIsAccepting(false);
    }
  };

  if (isVerifying) {
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
            onClick={() => (window.location.href = "/team")}
            className={`w-full px-4 py-2 rounded-lg font-medium ${
              isDark
                ? "bg-slate-700 hover:bg-slate-600 text-slate-200"
                : "bg-gray-200 hover:bg-gray-300 text-gray-700"
            }`}
          >
            Go to Team
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
          Company Director Invitation
        </h1>
        <p
          className={`text-center mb-6 ${
            isDark ? "text-slate-300" : "text-gray-600"
          }`}
        >
          You&apos;ve been invited to join a company on Food Costing as a
          director. You can create and manage tenants (locations) under this
          company.
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
              Company
            </p>
            <p
              className={`text-lg flex items-center gap-2 ${
                isDark ? "text-slate-100" : "text-gray-900"
              }`}
            >
              <Building2 className="h-5 w-5 shrink-0" />
              {invitation.company_name || "Unknown Company"}
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
              className={`text-lg ${
                isDark ? "text-slate-100" : "text-gray-900"
              }`}
            >
              Director
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
          ) : !isAuthenticated ? (
            "Sign in to accept"
          ) : (
            "Accept invitation"
          )}
        </button>
      </div>
    </div>
  );
}

function JoinCompanyPageFallback() {
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

export default function JoinCompanyPage() {
  return (
    <Suspense fallback={<JoinCompanyPageFallback />}>
      <JoinCompanyPageContent />
    </Suspense>
  );
}
