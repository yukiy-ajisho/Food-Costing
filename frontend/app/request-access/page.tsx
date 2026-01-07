"use client";

import { useState } from "react";
import { useTheme } from "@/contexts/ThemeContext";
import Link from "next/link";

export default function RequestAccessPage() {
  const { theme } = useTheme();
  const isDark = theme === "dark";

  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setSubmitting(true);

    try {
      const response = await fetch(
        `${process.env.NEXT_PUBLIC_API_URL}/access-requests`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ email, name }),
        }
      );

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.details || data.error || "Failed to submit request");
      }

      setSubmitted(true);
    } catch (err: unknown) {
      const errorObj = err as { message?: string };
      setError(errorObj.message || "Failed to submit request");
    } finally {
      setSubmitting(false);
    }
  };

  if (submitted) {
    return (
      <div
        className={`min-h-screen flex items-center justify-center p-4 ${
          isDark ? "bg-slate-900" : "bg-gray-50"
        }`}
      >
        <div
          className={`max-w-md w-full p-8 rounded-lg shadow-lg ${
            isDark ? "bg-slate-800" : "bg-white"
          }`}
        >
          <div className="text-center">
            <div className="mb-4">
              <svg
                className="mx-auto h-12 w-12 text-green-500"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
                />
              </svg>
            </div>
            <h1
              className={`text-2xl font-bold mb-4 ${
                isDark ? "text-white" : "text-gray-900"
              }`}
            >
              Request Submitted
            </h1>
            <p
              className={`mb-6 ${
                isDark ? "text-slate-300" : "text-gray-600"
              }`}
            >
              Thank you for your request. We&apos;ll review it and get back to you soon.
            </p>
            <Link
              href="/login"
              className={`inline-block px-6 py-2 rounded-lg font-medium ${
                isDark
                  ? "bg-blue-600 hover:bg-blue-700 text-white"
                  : "bg-blue-500 hover:bg-blue-600 text-white"
              }`}
            >
              Back to Login
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      className={`min-h-screen flex items-center justify-center p-4 ${
        isDark ? "bg-slate-900" : "bg-gray-50"
      }`}
    >
      <div
        className={`max-w-md w-full p-8 rounded-lg shadow-lg ${
          isDark ? "bg-slate-800" : "bg-white"
        }`}
      >
        <h1
          className={`text-2xl font-bold mb-6 text-center ${
            isDark ? "text-white" : "text-gray-900"
          }`}
        >
          Request Access
        </h1>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label
              htmlFor="email"
              className={`block text-sm font-medium mb-2 ${
                isDark ? "text-slate-300" : "text-gray-700"
              }`}
            >
              Email *
            </label>
            <input
              type="email"
              id="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className={`w-full px-3 py-2 rounded-lg border ${
                isDark
                  ? "bg-slate-700 border-slate-600 text-white"
                  : "bg-white border-gray-300 text-gray-900"
              }`}
              placeholder="your.email@example.com"
              disabled={submitting}
            />
          </div>

          <div>
            <label
              htmlFor="name"
              className={`block text-sm font-medium mb-2 ${
                isDark ? "text-slate-300" : "text-gray-700"
              }`}
            >
              Name (Optional)
            </label>
            <input
              type="text"
              id="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className={`w-full px-3 py-2 rounded-lg border ${
                isDark
                  ? "bg-slate-700 border-slate-600 text-white"
                  : "bg-white border-gray-300 text-gray-900"
              }`}
              placeholder="Your Name"
              disabled={submitting}
            />
          </div>

          {error && (
            <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={submitting}
            className={`w-full py-2 px-4 rounded-lg font-medium ${
              isDark
                ? "bg-blue-600 hover:bg-blue-700 text-white disabled:bg-slate-600"
                : "bg-blue-500 hover:bg-blue-600 text-white disabled:bg-gray-400"
            }`}
          >
            {submitting ? "Submitting..." : "Submit Request"}
          </button>
        </form>

        <div className="mt-6 text-center">
          <Link
            href="/login"
            className={`text-sm ${
              isDark
                ? "text-blue-400 hover:text-blue-300"
                : "text-blue-600 hover:text-blue-500"
            }`}
          >
            Back to Login
          </Link>
        </div>
      </div>
    </div>
  );
}

