import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import "./globals.css";
import { ToastProvider } from "@/components/ui";
import { ErrorReporter } from "@/components/ErrorReporter";
import { KeyboardScroll } from "@/components/KeyboardScroll";

// Font files ship with the app (src/app/fonts, SIL Open Font License): builds never
// download anything, and pages make no requests to Google.
const inter = localFont({ src: "./fonts/inter-latin-wght-normal.woff2", weight: "100 900", variable: "--font-inter", display: "swap" });
const jakarta = localFont({ src: "./fonts/plus-jakarta-sans-latin-wght-normal.woff2", weight: "200 800", variable: "--font-jakarta", display: "swap" });
// "Easy-to-read font" learning support: designed for low vision and dyslexia-friendly letter shapes.
const readable = localFont({
  src: [{ path: "./fonts/atkinson-hyperlegible-latin-400-normal.woff2", weight: "400" }, { path: "./fonts/atkinson-hyperlegible-latin-700-normal.woff2", weight: "700" }],
  // Only students who turn this support on use it, so it is not downloaded up front.
  variable: "--font-readable", display: "swap", preload: false
});
// Join codes and code blocks: unambiguous characters (0/O, 1/I) on every device.
const mono = localFont({ src: "./fonts/jetbrains-mono-latin-wght-normal.woff2", weight: "100 800", variable: "--font-mono", display: "swap" });

export const metadata: Metadata = {
  title: { default: "SwiftCipher", template: "%s · SwiftCipher" },
  description: "Interactive lessons, live assessment and classroom focus in one school workspace.",
  icons: { icon: "/icon.svg" }
};

export const viewport: Viewport = { themeColor: "#F6F5F1", width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${jakarta.variable} ${mono.variable} ${readable.variable}`}>
      <body className="font-sans">
        <ErrorReporter />
        <KeyboardScroll />
        <ToastProvider>{children}</ToastProvider>
      </body>
    </html>
  );
}
