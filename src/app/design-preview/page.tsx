import { notFound } from "next/navigation";
import { Preview } from "./Preview";

export const dynamic = "force-dynamic";
export const metadata = { title: "Design preview", robots: { index: false } };

/**
 * The game screens with example data, for design reviews and screenshots without a
 * database. Only served when SWIFTCIPHER_DESIGN_PREVIEW=1 (never set it in production).
 */
export default function DesignPreviewPage() {
  if (process.env.SWIFTCIPHER_DESIGN_PREVIEW !== "1") notFound();
  return <Preview />;
}
