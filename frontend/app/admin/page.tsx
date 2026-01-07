"use client";

import { useState, useEffect } from "react";
import { useTheme } from "@/contexts/ThemeContext";
import { apiRequest } from "@/lib/api";
import { useRouter } from "next/navigation";

interface AccessRequest {
  id: string;
  email: string;
  status: string;
  created_at: string;
  approved_at: string | null;
  approved_by: string | null;
  request_count: number;
  last_requested_at: string;
  note: string | null;
}

export default function AdminPage() {
  const { theme } = useTheme();
  const router = useRouter();
  const isDark = theme === "dark";

  const [requests, setRequests] = useState<AccessRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<string>("pending");
  const [processing, setProcessing] = useState<Set<string>>(new Set());

  const fetchRequests = async () => {
    try {
      setLoading(true);
      const data = await apiRequest<{ requests: AccessRequest[] }>(
        `/access-requests?status=${filter}`
      );
      setRequests(data.requests);
    } catch (error) {
      console.error("Failed to fetch requests:", error);
      const apiError = error as { status?: number };
      if (apiError?.status === 403) {
        alert("System Admin access required");
        router.push("/");
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchRequests();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter]);

  const handleApprove = async (id: string) => {
    if (!confirm("Are you sure you want to approve this request?")) {
      return;
    }

    try {
      setProcessing((prev) => new Set(prev).add(id));
      await apiRequest(`/access-requests/${id}/approve`, {
        method: "PUT",
      });
      await fetchRequests();
      alert("Request approved successfully");
    } catch (error) {
      console.error("Failed to approve request:", error);
      alert("Failed to approve request");
    } finally {
      setProcessing((prev) => {
        const newSet = new Set(prev);
        newSet.delete(id);
        return newSet;
      });
    }
  };

  const handleReject = async (id: string) => {
    if (!confirm("Are you sure you want to reject this request?")) {
      return;
    }

    try {
      setProcessing((prev) => new Set(prev).add(id));
      await apiRequest(`/access-requests/${id}/reject`, {
        method: "PUT",
      });
      await fetchRequests();
      alert("Request rejected successfully");
    } catch (error) {
      console.error("Failed to reject request:", error);
      alert("Failed to reject request");
    } finally {
      setProcessing((prev) => {
        const newSet = new Set(prev);
        newSet.delete(id);
        return newSet;
      });
    }
  };

  const handleDelete = async (id: string) => {
    if (
      !confirm(
        "Are you sure you want to delete this request? This cannot be undone."
      )
    ) {
      return;
    }

    try {
      setProcessing((prev) => new Set(prev).add(id));
      await apiRequest(`/access-requests/${id}`, {
        method: "DELETE",
      });
      await fetchRequests();
      alert("Request deleted successfully");
    } catch (error) {
      console.error("Failed to delete request:", error);
      alert("Failed to delete request");
    } finally {
      setProcessing((prev) => {
        const newSet = new Set(prev);
        newSet.delete(id);
        return newSet;
      });
    }
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleString();
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case "pending":
        return isDark
          ? "bg-yellow-900/30 text-yellow-400"
          : "bg-yellow-100 text-yellow-800";
      case "approved":
        return isDark
          ? "bg-green-900/30 text-green-400"
          : "bg-green-100 text-green-800";
      case "rejected":
        return isDark
          ? "bg-red-900/30 text-red-400"
          : "bg-red-100 text-red-800";
      default:
        return isDark
          ? "bg-gray-900/30 text-gray-400"
          : "bg-gray-100 text-gray-800";
    }
  };

  return (
    <div className="p-8">
      <div className="max-w-7xl mx-auto">
        <h1
          className={`text-3xl font-bold mb-6 ${
            isDark ? "text-white" : "text-gray-900"
          }`}
        >
          System Admin Panel
        </h1>

        {/* Filter Tabs */}
        <div className="flex gap-2 mb-6">
          {["pending", "approved", "rejected", "all"].map((status) => (
            <button
              key={status}
              onClick={() => setFilter(status === "all" ? "" : status)}
              className={`px-4 py-2 rounded-lg font-medium transition-colors ${
                (status === "all" ? filter === "" : filter === status)
                  ? isDark
                    ? "bg-blue-600 text-white"
                    : "bg-blue-500 text-white"
                  : isDark
                  ? "bg-slate-700 text-slate-300 hover:bg-slate-600"
                  : "bg-gray-200 text-gray-700 hover:bg-gray-300"
              }`}
            >
              {status.charAt(0).toUpperCase() + status.slice(1)}
            </button>
          ))}
        </div>

        {/* Requests Table */}
        {loading ? (
          <div className="flex justify-center items-center h-64">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500"></div>
          </div>
        ) : requests.length === 0 ? (
          <div
            className={`text-center py-12 ${
              isDark ? "text-slate-400" : "text-gray-500"
            }`}
          >
            No requests found
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table
              className={`w-full ${
                isDark ? "bg-slate-800" : "bg-white"
              } rounded-lg overflow-hidden shadow`}
            >
              <thead
                className={isDark ? "bg-slate-700" : "bg-gray-50"}
              >
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider">
                    Email
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider">
                    Status
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider">
                    Requested
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider">
                    Count
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider">
                    Note
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-700">
                {requests.map((request) => (
                  <tr
                    key={request.id}
                    className={
                      isDark
                        ? "hover:bg-slate-700"
                        : "hover:bg-gray-50"
                    }
                  >
                    <td className="px-6 py-4 whitespace-nowrap text-sm">
                      {request.email}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span
                        className={`px-2 py-1 rounded-full text-xs font-medium ${getStatusColor(
                          request.status
                        )}`}
                      >
                        {request.status}
                      </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm">
                      {formatDate(request.last_requested_at)}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm">
                      {request.request_count}
                    </td>
                    <td className="px-6 py-4 text-sm">
                      {request.note || "-"}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm">
                      <div className="flex gap-2">
                        {request.status === "pending" && (
                          <>
                            <button
                              onClick={() => handleApprove(request.id)}
                              disabled={processing.has(request.id)}
                              className="px-3 py-1 bg-green-600 hover:bg-green-700 text-white rounded disabled:opacity-50"
                            >
                              Approve
                            </button>
                            <button
                              onClick={() => handleReject(request.id)}
                              disabled={processing.has(request.id)}
                              className="px-3 py-1 bg-red-600 hover:bg-red-700 text-white rounded disabled:opacity-50"
                            >
                              Reject
                            </button>
                          </>
                        )}
                        <button
                          onClick={() => handleDelete(request.id)}
                          disabled={processing.has(request.id)}
                          className={`px-3 py-1 rounded disabled:opacity-50 ${
                            isDark
                              ? "bg-slate-600 hover:bg-slate-500 text-white"
                              : "bg-gray-400 hover:bg-gray-500 text-white"
                          }`}
                        >
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

