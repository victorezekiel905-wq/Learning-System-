import { notFound } from "next/navigation";
import { EditorPreview, ImportPreview, Preview } from "./Preview";

export const dynamic = "force-dynamic";
export const metadata = { title: "Design preview", robots: { index: false } };

/**
 * The game screens with example data, for design reviews and screenshots without a
 * database. Only served when SWIFTCIPHER_DESIGN_PREVIEW=1 (never set it in production).
 * ?view=import shows the Import questions window (with Write with AI).
 */
export default async function DesignPreviewPage(props: { searchParams: Promise<{ view?: string }> }) {
  if (process.env.SWIFTCIPHER_DESIGN_PREVIEW !== "1") notFound();
  const { view } = await props.searchParams;
  return view === "import" ? <ImportPreview /> : view === "editor" ? <EditorPreview /> : <Preview />;
}
