"use client";
import { Download } from "lucide-react";
import { Menu } from "@/components/ui";

/** "Download": a spreadsheet of the figures, or the page as a PDF (the browser's print dialog, Save as PDF). */
export function DownloadMenu({ onCsv, disabled }: { onCsv: () => void; disabled?: boolean }) {
  if (disabled) return null;
  return (
    <Menu label="Download this analysis" triggerClassName="btn btn-secondary btn-sm"
      trigger={<><Download className="h-4 w-4" aria-hidden />Download</>}
      items={[
        { label: "Spreadsheet (Excel, CSV)", onSelect: onCsv },
        { label: "PDF (print, then Save as PDF)", onSelect: () => window.print() }
      ]} />
  );
}
