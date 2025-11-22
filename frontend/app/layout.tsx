import type { Metadata } from "next";
import { headers } from "next/headers";
import "./globals.css";
import { Layout } from "@/components/Layout";
import { ThemeProvider } from "@/contexts/ThemeContext";

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
  const isLoginPage = pathname === "/login";

  return (
    <html lang="en">
      <body>
        <ThemeProvider>
          {isLoginPage ? children : <Layout>{children}</Layout>}
        </ThemeProvider>
      </body>
    </html>
  );
}
