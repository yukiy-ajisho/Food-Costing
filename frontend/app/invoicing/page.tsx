"use client";

import { Suspense, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";

function InvoicingRedirectContent() {
  const router = useRouter();
  const searchParams = useSearchParams();

  useEffect(() => {
    const section = searchParams.get("section");
    const tab = searchParams.get("tab");

    if (
      section === "account" ||
      tab === "accounts" ||
      tab === "delivery" ||
      tab === "delivery-site"
    ) {
      if (tab === "delivery" || tab === "delivery-site") {
        router.replace("/invoicing/account?tab=delivery-site");
      } else {
        router.replace("/invoicing/account");
      }
      return;
    }

    router.replace("/invoicing/orders");
  }, [router, searchParams]);

  return (
    <div className="flex h-full min-h-0 items-center justify-center p-12 text-sm text-gray-500">
      Loading…
    </div>
  );
}

export default function InvoicingPage() {
  return (
    <Suspense
      fallback={
        <div className="flex h-full min-h-0 items-center justify-center p-12 text-sm text-gray-500">
          Loading…
        </div>
      }
    >
      <InvoicingRedirectContent />
    </Suspense>
  );
}
