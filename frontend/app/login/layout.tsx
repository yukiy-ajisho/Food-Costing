import { ReactNode } from "react";
import { ThemeProvider } from "@/contexts/ThemeContext";

export default function LoginLayout({ children }: { children: ReactNode }) {
  return (
    <ThemeProvider>
      <div className="h-full">{children}</div>
    </ThemeProvider>
  );
}
