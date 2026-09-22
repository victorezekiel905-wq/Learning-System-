import type { Metadata, Viewport } from "next";
import "./globals.css";
import { ToastProvider } from "@/components/ui";

export const metadata: Metadata = {
  title: { default: "SwiftCipher", template: "%s · SwiftCipher" },
  description: "Interactive lessons, live assessment and classroom focus in one school workspace.",
  icons: { icon: "/icon.svg" }
};

export const viewport: Viewport = { themeColor: "#4f46e5", width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body style={{ ["--font-sans" as string]: "Inter, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif" }}>
        <ToastProvider>{children}</ToastProvider>
      </body>
    </html>
  );
}
