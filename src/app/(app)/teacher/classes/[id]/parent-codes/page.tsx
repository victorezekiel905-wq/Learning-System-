import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { requireRole, TEACHERS } from "@/lib/session";
import { appOrigin } from "@/lib/app-url";
import { ParentCodes, type ParentCodesData } from "./ParentCodes";

export const metadata = { title: "Parent codes" };

/** Each student's parent code, as a list and as printable letters to send home. Staff only. */
export default async function ParentCodesPage(props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const { sb } = await requireRole(TEACHERS);
  const { data, error } = await sb.rpc("parent_codes", { p_class: id });
  if (error || !data) notFound();
  const h = await headers();
  const origin = appOrigin(h.get("origin") ?? (h.get("host") ? `https://${h.get("host")}` : null));
  return <ParentCodes data={data as ParentCodesData} origin={origin} />;
}
