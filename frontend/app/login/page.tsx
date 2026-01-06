"use client";

import { createClient } from "@/lib/supabase-client";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState, Suspense } from "react";
import Link from "next/link";

function LoginPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [error, setError] = useState<string | null>(null);
  const [isChecking, setIsChecking] = useState(true);
  const supabase = createClient();

  useEffect(() => {
    // 既にログイン済みかチェック
    const checkUser = async () => {
      try {
        // ローカルのセッションをチェック（サーバーにリクエストしない）
        const {
          data: { session },
        } = await supabase.auth.getSession();

        // セッションがある場合は/costにリダイレクト
        // セッションの有効性はmiddlewareで検証されるため、ここでは検証しない
        if (session) {
          router.replace("/cost");
          return; // リダイレクト中は何も表示しない
        }
      } catch {
        // エラーは無視（ログインページを表示）
      } finally {
        setIsChecking(false);
      }
    };
    checkUser();

    // エラーパラメータの処理
    const errorParam = searchParams.get("error");
    if (errorParam) {
      switch (errorParam) {
        case "auth_failed":
          setError("Authentication failed. Please try again.");
          break;
        case "session_failed":
          setError("Session verification failed. Please try again.");
          break;
        case "no_code":
          setError("Authentication code was not provided. Please try again.");
          break;
        default:
          setError("An error occurred. Please try again.");
      }
    }
  }, [router, supabase, searchParams]);

  const handleGoogleLogin = async () => {
    setError(null);
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${window.location.origin}/auth/callback`,
      },
    });

    if (error) {
      console.error("Login error:", error);
      setError("Login failed. Please try again.");
    }
  };

  // 認証チェック中はローディング画面を表示
  if (isChecking) {
    return (
      <div className="flex items-center justify-center h-full bg-gradient-to-br from-gray-50 via-white to-gray-100 dark:from-slate-900 dark:via-slate-800 dark:to-slate-900">
        <div className="w-full max-w-md bg-white/80 dark:bg-slate-800/80 backdrop-blur-sm p-10 rounded-2xl shadow-xl border border-gray-200/50 dark:border-slate-700/50">
          <div className="flex flex-col items-center justify-center space-y-4">
            <div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
            <p className="text-sm text-gray-600 dark:text-gray-400">
              Loading...
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-center justify-center h-full bg-gradient-to-br from-gray-50 via-white to-gray-100 dark:from-slate-900 dark:via-slate-800 dark:to-slate-900 p-4">
      <div className="w-full max-w-md bg-white/80 dark:bg-slate-800/80 backdrop-blur-sm p-10 rounded-2xl shadow-xl border border-gray-200/50 dark:border-slate-700/50 transition-all duration-300 hover:shadow-2xl">
        {/* ロゴ・タイトル */}
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold mb-2 bg-gradient-to-r from-blue-600 to-blue-800 dark:from-blue-400 dark:to-blue-600 bg-clip-text text-transparent">
            Food Costing
          </h1>
          <p className="text-gray-600 dark:text-gray-400 text-sm">
            Restaurant Recipe Costing System
          </p>
        </div>

        {/* 説明文 */}
        <p className="text-gray-700 dark:text-gray-300 text-center mb-8 text-base">
          Please sign in with your Google account to continue
        </p>

        {/* エラーメッセージ */}
        {error && (
          <div className="mb-6 p-4 bg-red-50 dark:bg-red-900/20 border-l-4 border-red-500 dark:border-red-400 rounded-r-lg">
            <p className="text-sm text-red-700 dark:text-red-400">{error}</p>
          </div>
        )}

        {/* Googleサインインボタン */}
        <button
          onClick={handleGoogleLogin}
          className="w-full flex items-center justify-center gap-3 px-6 py-3.5 bg-white dark:bg-slate-700 border-2 border-gray-300 dark:border-slate-600 rounded-xl hover:bg-gray-50 dark:hover:bg-slate-600 hover:border-blue-400 dark:hover:border-blue-500 transition-all duration-200 shadow-sm hover:shadow-md active:scale-[0.98] group"
        >
          <svg
            className="w-5 h-5 transition-transform group-hover:scale-110"
            viewBox="0 0 24 24"
          >
            <path
              fill="#4285F4"
              d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
            />
            <path
              fill="#34A853"
              d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
            />
            <path
              fill="#FBBC05"
              d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
            />
            <path
              fill="#EA4335"
              d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
            />
          </svg>
          <span className="text-gray-900 dark:text-white font-medium text-base">
            Sign in with Google
          </span>
        </button>

        {/* Divider */}
        <div className="relative my-6">
          <div className="absolute inset-0 flex items-center">
            <div className="w-full border-t border-gray-300 dark:border-slate-600"></div>
          </div>
          <div className="relative flex justify-center text-sm">
            <span className="px-2 bg-white/80 dark:bg-slate-800/80 text-gray-500 dark:text-gray-400">
              or
            </span>
          </div>
        </div>

        {/* Request Access Link */}
        <Link
          href="/request-access"
          className="block w-full text-center px-6 py-3.5 border-2 border-gray-300 dark:border-slate-600 rounded-xl hover:border-blue-400 dark:hover:border-blue-500 transition-all duration-200 text-gray-700 dark:text-gray-300 font-medium hover:bg-gray-50 dark:hover:bg-slate-700"
        >
          Request Access
        </Link>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center h-full bg-gradient-to-br from-gray-50 via-white to-gray-100 dark:from-slate-900 dark:via-slate-800 dark:to-slate-900">
          <div className="w-full max-w-md bg-white/80 dark:bg-slate-800/80 backdrop-blur-sm p-10 rounded-2xl shadow-xl border border-gray-200/50 dark:border-slate-700/50">
            <div className="flex flex-col items-center justify-center space-y-4">
              <div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
              <p className="text-sm text-gray-600 dark:text-gray-400">
                Loading...
              </p>
            </div>
          </div>
        </div>
      }
    >
      <LoginPageContent />
    </Suspense>
  );
}
