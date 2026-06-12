"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function InvoicingInvoiceRedirectPage() {
  const router = useRouter();

  useEffect(() => {
    router.replace("/invoicing/orders");
  }, [router]);

  return (
    <div className="flex h-full min-h-0 items-center justify-center p-12 text-sm text-gray-500">
      Loading…
    </div>
  );
}
