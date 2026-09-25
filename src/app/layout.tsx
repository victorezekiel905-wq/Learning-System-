import type { Metadata, Viewport } from "next";
import { Inter, JetBrains_Mono, Plus_Jakarta_Sans } from "next/font/google";
import "./globals.css";
import { ToastProvider } from "@/components/ui";
import { ErrorReporter } from "@/components/ErrorReporter";
import { KeyboardScroll } from "@/components/KeyboardScroll";

// Self-hosted at build time by next/font (no runtime requests to Google).
const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });
const jakarta = Plus_Jakarta_Sans({ subsets: ["latin"], variable: "--font-jakarta", weight: ["500", "600", "700", "800"], display: "swap" });
// Join codes and code blocks: unambiguous characters (0/O, 1/I) on every device.
const mono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-mono", weight: ["500", "700", "800"], display: "swap" });

export const metadata: Metadata = {
  title: { default: "SwiftCipher", template: "%s · SwiftCipher" },
  description: "Interactive lessons, live assessment and classroom focus in one school workspace.",
  icons: { icon: "/icon.svg" }
};

export const viewport: Viewport = { themeColor: "#4f46e5", width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${jakarta.variable} ${mono.variable}`}>
      <body className="font-sans">
        <ErrorReporter />
        <KeyboardScroll />
        <ToastProvider>{children}</ToastProvider>
      </body>
    </html>
  );
}
