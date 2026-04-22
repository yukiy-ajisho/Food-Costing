import type { Metadata } from "next";
import { headers } from "next/headers";
import "./globals.css";
import { Layout } from "@/components/Layout";
import { ThemeProvider } from "@/contexts/ThemeContext";
import { UserProvider } from "@/contexts/UserContext";
import { CompanyProvider } from "@/contexts/CompanyContext";
import { TenantProvider } from "@/contexts/TenantContext";

export const metadata: Metadata = {
  title: "Food Costing",
  description: "Restaurant Recipe Costing System",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const headersList = await headers();
  const pathname = headersList.get("x-pathname") || "";
  const isPublicPage = pathname === "/login" || pathname === "/request-access" || pathname.startsWith("/join");
  /** Invoice embed: no sidebar/header shell; still needs auth providers. */
  const isInvoiceEmbedChrome = pathname === "/items/vendors-embed";

  return (
    <html lang="en">
      <body>
        <ThemeProvider>
          {isPublicPage ? (
            children
          ) : isInvoiceEmbedChrome ? (
            <UserProvider>
              <CompanyProvider>
                <TenantProvider>{children}</TenantProvider>
              </CompanyProvider>
            </UserProvider>
          ) : (
            <UserProvider>
              <CompanyProvider>
                <TenantProvider>
                  <Layout>{children}</Layout>
                </TenantProvider>
              </CompanyProvider>
            </UserProvider>
          )}
        </ThemeProvider>
      </body>
    </html>
  );
}
