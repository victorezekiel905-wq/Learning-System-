"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useLoader } from "@/lib/hooks";
import { api, errorText, rpc, must } from "@/lib/rpc";
import { formatDate } from "@/lib/utils";
import { LevelsPanel } from "./LevelsPanel";
import { SupportsPanel } from "./SupportsPanel";
import { Icon } from "@/components/Icon";
import {
  Alert, Avatar, Badge, Button, Card, CopyButton, Empty, Field, Input, Modal, PageHeader, Select, Tabs, Textarea, useToast, useDialog } from "@/components/ui";

type Cls = { id: string; name: string; subject: string | null; grade_level: string | null; join_code: string; archived_at: string | null; teacher_id: string; tenant_id: string };
type Member = { user_id: string; role: string; joined_at: string; users: { full_name: string; email: string } | null };

export function ClassDetail({ cls, canManage, isAdmin, policies, teachers }: {
  cls: Cls; canManage: boolean; isAdmin: boolean; policies: { id: string; name: string }[]; teachers: { id: string; full_name: string }[];
}) {
  const [tab, setTab] = useState<"roster" | "levels" | "supports" | "groups" | "attendance" | "settings">("roster");
  const members = useLoader(async () => {
    const { data, error } = await createClient().from("class_members")
      .select("user_id,role,joined_at,users(full_name,email)").eq("class_id", cls.id).order("role", { ascending: false });
    if (error) throw error;
    return (data ?? []) as unknown as Member[];
  }, [cls.id]);
  const students = (members.data ?? []).filter((m) => m.role === "student");

  return (
    <div className="page">
      <PageHeader eyebrow={<Link href="/teacher/classes">Classes</Link>} title={cls.name}
        subtitle={[cls.subject, cls.grade_level].filter(Boolean).join(" · ") || undefined}
        actions={canManage && <>
          <Link href={`/teacher/insights?class=${cls.id}`} className="btn btn-secondary no-underline">Analytics</Link>
          <a href={`/api/classes/${cls.id}/gradebook`} className="btn btn-secondary no-underline" download>Export gradebook</a>
          <Link href={`/teacher/live/new?class=${cls.id}`} className="btn btn-primary no-underline">Go live</Link>
        </>} />

      {cls.archived_at && <div className="mb-4"><Alert tone="warn">This class is archived. Students can no longer join with its code.</Alert></div>}

      <Tabs className="mb-5" value={tab} onChange={setTab} tabs={[
        { id: "roster", label: `Roster (${students.length})` },
        ...(canManage ? [{ id: "levels" as const, label: "Levels & XP" }, { id: "supports" as const, label: "Supports" }] : []),
        { id: "groups", label: "Groups" },
        { id: "attendance", label: "Attendance" },
        ...(canManage ? [{ id: "settings" as const, label: "Settings" }] : [])
      ]} />

      {tab === "roster" && <Roster cls={cls} canManage={canManage} members={members.data ?? []} loading={members.loading} reload={members.reload} />}
      {tab === "levels" && canManage && <LevelsPanel classId={cls.id} />}
      {tab === "supports" && canManage && <SupportsPanel classId={cls.id} />}
      {tab === "groups" && <Groups cls={cls} canManage={canManage} students={students} policies={policies} />}
      {tab === "attendance" && <Attendance cls={cls} canManage={canManage} students={students} />}
      {tab === "settings" && canManage && <Settings cls={cls} isAdmin={isAdmin} teachers={teachers} />}
    </div>
  );
}

function Roster({ cls, canManage, members, loading, reload }: { cls: Cls; canManage: boolean; members: Member[]; loading: boolean; reload: () => Promise<void> }) {
  const toast = useToast();
  const dialog = useDialog();
  const [importOpen, setImportOpen] = useState(false);
  const [codeModal, setCodeModal] = useState<{ title: string; code: string; note: string } | null>(null);
  const joinUrl = typeof window !== "undefined" ? `${window.location.origin}/join?code=${cls.join_code}` : "";

  async function remove(userId: string) {
    if (!(await dialog.confirm({ title: "Remove from this class?", body: "Their past work is kept.", tone: "danger", confirmLabel: "Remove" }))) return;
    const { error } = await createClient().from("class_members").delete().eq("class_id", cls.id).eq("user_id", userId);
    if (error) toast(error.message, "error"); else { toast("Removed", "success"); void reload(); }
  }

  async function parentInvite(studentId: string, name: string) {
    try {
      const inv = await rpc<{ code: string }>("create_invite", { p_role: "parent", p_student: studentId, p_days: 30 });
      setCodeModal({ title: `Parent invite for ${name}`, code: inv.code, note: "Give this code to the parent or guardian. They sign up at /join. It is valid for 30 days and works once." });
    } catch (e) { toast(errorText(e), "error"); }
  }

  async function pairDevice(studentId: string, name: string) {
    try {
      const pc = await rpc<{ code: string }>("create_pairing_code", { p_student: studentId });
      setCodeModal({ title: `Device pairing for ${name}`, code: pc.code, note: "Enter this code in the SwiftCipher extension on the student's school-managed browser. It expires in 15 minutes." });
    } catch (e) { toast(errorText(e), "error"); }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <Card className="lg:col-span-2" title="People" pad={false}
        actions={canManage && <Button size="sm" variant="secondary" onClick={() => setImportOpen(true)}>Import CSV</Button>}>
        {loading ? <p className="p-5 text-sm text-ink-500">Loading…</p> : members.length <= 1 ? (
          <div className="p-5"><Empty title="No students yet">Share the class code <strong className="font-mono">{cls.join_code}</strong>, or import a CSV.</Empty></div>
        ) : (
          <table className="table">
            <thead><tr><th>Name</th><th>Role</th><th>Joined</th>{canManage && <th className="text-right">Actions</th>}</tr></thead>
            <tbody>
              {members.map((m) => (
                <tr key={m.user_id}>
                  <td><div className="flex items-center gap-2"><Avatar name={m.users?.full_name ?? "?"} className="h-7 w-7" />
                    <div><p className="font-medium">{m.users?.full_name}</p><p className="text-xs text-ink-500">{m.users?.email}</p></div></div></td>
                  <td><Badge tone={m.role === "teacher" ? "brand" : "gray"}>{m.role}</Badge></td>
                  <td className="text-ink-500">{formatDate(m.joined_at)}</td>
                  {canManage && (
                    <td className="text-right">
                      {m.role === "student" && <div className="flex justify-end gap-1">
                        <Button size="sm" variant="ghost" onClick={() => parentInvite(m.user_id, m.users?.full_name ?? "student")}>Parent invite</Button>
                        <Button size="sm" variant="ghost" onClick={() => pairDevice(m.user_id, m.users?.full_name ?? "student")}>Pair device</Button>
                        <Button size="sm" variant="ghost" className="text-rose-600" onClick={() => remove(m.user_id)}>Remove</Button>
                      </div>}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
      <Card title="Invite students">
        <p className="text-sm text-ink-600">Students join at <strong>/join</strong> with this code:</p>
        <p className="my-3 rounded-lg bg-brand-50 py-4 text-center font-mono text-3xl font-extrabold tracking-[0.3em] text-brand-700">{cls.join_code}</p>
        <div className="flex flex-wrap gap-2"><CopyButton value={cls.join_code} label="Copy code" /><CopyButton value={joinUrl} label="Copy join link" /></div>
        <p className="hint mt-3">Students who already have an account enter the code under "Join with code".</p>
      </Card>

      {importOpen && <RosterImport cls={cls} onClose={() => { setImportOpen(false); void reload(); }} />}
      <Modal open={!!codeModal} onClose={() => setCodeModal(null)} title={codeModal?.title ?? ""}>
        {codeModal && <div className="space-y-3 text-center">
          <p className="font-mono text-4xl font-extrabold tracking-[0.25em] text-brand-700">{codeModal.code}</p>
          <CopyButton value={codeModal.code} />
          <p className="text-sm text-ink-600">{codeModal.note}</p>
        </div>}
      </Modal>
    </div>
  );
}

function RosterImport({ cls, onClose }: { cls: Cls; onClose: () => void }) {
  const [csv, setCsv] = useState("");
  const [sendEmail, setSendEmail] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [result, setResult] = useState<{ rows: { email: string; full_name: string; code: string | null; status: string }[]; emailed: number } | null>(null);

  async function run() {
    setBusy(true); setErr(null);
    try {
      setResult(await api("/api/roster/import", { method: "POST", json: { class_id: cls.id, csv, send_email: sendEmail } }));
    } catch (e) { setErr(errorText(e)); }
    setBusy(false);
  }

  return (
    <Modal open onClose={onClose} wide title="Import roster from CSV"
      footer={result ? <Button onClick={onClose}>Done</Button> : <><Button variant="ghost" onClick={onClose}>Cancel</Button><Button loading={busy} disabled={!csv.trim()} onClick={run}>Import</Button></>}>
      {!result ? (
        <div className="space-y-3">
          <p className="text-sm text-ink-600">Paste CSV with a header row containing <code>email</code> and <code>full_name</code> (or <code>first_name</code>, <code>last_name</code>). Each student gets a one-time invite code tied to their email address.</p>
          <input type="file" accept=".csv,text/csv" onChange={async (e) => { const f = e.target.files?.[0]; if (f) setCsv(await f.text()); }} />
          <Textarea rows={8} className="font-mono text-xs" value={csv} onChange={(e) => setCsv(e.target.value)} placeholder={"email,full_name\nada@school.org,Ada Lovelace"} />
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={sendEmail} onChange={(e) => setSendEmail(e.target.checked)} /> Email invitations (needs server email set up)</label>
          {err && <Alert tone="error">{err}</Alert>}
        </div>
      ) : (
        <div className="space-y-3">
          <Alert tone="success">{result.rows.filter((r) => r.code).length} invites created{result.emailed ? `, ${result.emailed} emailed` : ""}. Print or share the codes below.</Alert>
          <table className="table">
            <thead><tr><th>Name</th><th>Email</th><th>Code</th><th>Status</th></tr></thead>
            <tbody>{result.rows.map((r, i) => (
              <tr key={i}><td>{r.full_name}</td><td>{r.email}</td><td className="font-mono">{r.code ?? "—"}</td><td>{r.status}</td></tr>
            ))}</tbody>
          </table>
        </div>
      )}
    </Modal>
  );
}

type Group = { id: string; name: string; auto_start_policy_id: string | null; student_group_members: { user_id: string }[] };

function Groups({ cls, canManage, students, policies }: { cls: Cls; canManage: boolean; students: Member[]; policies: { id: string; name: string }[] }) {
  const toast = useToast();
  const dialog = useDialog();
  const [name, setName] = useState("");
  const groups = useLoader(async () => {
    const { data, error } = await createClient().from("student_groups")
      .select("id,name,auto_start_policy_id,student_group_members(user_id)").eq("class_id", cls.id).order("name");
    if (error) throw error;
    return (data ?? []) as Group[];
  }, [cls.id]);

  async function create() {
    const { error } = await createClient().from("student_groups").insert({ tenant_id: cls.tenant_id, class_id: cls.id, name: name.trim() });
    if (error) toast(error.message, "error"); else { setName(""); void groups.reload(); }
  }
  async function toggleMember(g: Group, userId: string, on: boolean) {
    const sb = createClient();
    const { error } = on
      ? await sb.from("student_group_members").insert({ group_id: g.id, user_id: userId, tenant_id: cls.tenant_id })
      : await sb.from("student_group_members").delete().eq("group_id", g.id).eq("user_id", userId);
    if (error) toast(error.message, "error"); else void groups.reload();
  }
  async function setPolicy(g: Group, policy: string) {
    const { error } = await createClient().from("student_groups").update({ auto_start_policy_id: policy || null }).eq("id", g.id);
    if (error) toast(error.message, "error"); else { toast("Saved", "success"); void groups.reload(); }
  }
  async function del(g: Group) {
    if (!(await dialog.confirm({ title: `Delete group ${g.name}?`, tone: "danger", confirmLabel: "Delete group" }))) return;
    try { must(await createClient().from("student_groups").delete().eq("id", g.id)); } catch (e) { toast(errorText(e), "error"); return; }
    void groups.reload();
  }

  return (
    <div className="space-y-4">
      <Alert>Groups can have an <strong>auto-start environment</strong>. It applies to those students automatically whenever this class is live, even if you don't start an environment yourself.</Alert>
      {canManage && (
        <div className="flex gap-2"><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="New group name, e.g. Table 1" className="max-w-xs" />
          <Button onClick={create} disabled={!name.trim()}>Add group</Button></div>
      )}
      {(groups.data ?? []).length === 0 && !groups.loading && <Empty title="No groups">Use groups for table work, differentiated focus rules or teams.</Empty>}
      <div className="grid gap-4 md:grid-cols-2">
        {(groups.data ?? []).map((g) => {
          const ids = new Set(g.student_group_members.map((m) => m.user_id));
          return (
            <Card key={g.id} title={g.name} actions={canManage && <Button size="sm" variant="ghost" className="text-rose-600" onClick={() => del(g)}>Delete</Button>}>
              <Field label="Auto-start environment">
                <Select aria-label={`Environment that starts automatically for ${g.name}`} disabled={!canManage} value={g.auto_start_policy_id ?? ""} onChange={(e) => setPolicy(g, e.target.value)}>
                  <option value="">None</option>
                  {policies.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </Select>
              </Field>
              <div className="mt-3 flex flex-wrap gap-2">
                {students.map((s) => (
                  <button key={s.user_id} type="button" aria-pressed={ids.has(s.user_id)} disabled={!canManage} onClick={() => toggleMember(g, s.user_id, !ids.has(s.user_id))}
                    className={`badge border ${ids.has(s.user_id) ? "border-brand-300 bg-brand-50 text-brand-800" : "border-ink-200 bg-white text-ink-500"}`}>
                    <Icon name={ids.has(s.user_id) ? "check" : "plus"} className="h-3 w-3" />{s.users?.full_name}
                  </button>
                ))}
              </div>
            </Card>
          );
        })}
      </div>
    </div>
  );
}

const STATUSES = ["present", "late", "absent", "excused"] as const;

function Attendance({ cls, canManage, students }: { cls: Cls; canManage: boolean; students: Member[] }) {
  const toast = useToast();
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const rows = useLoader(async () => {
    const { data, error } = await createClient().from("attendance").select("student_id,status,source").eq("class_id", cls.id).eq("date", date);
    if (error) throw error;
    return Object.fromEntries((data ?? []).map((r) => [r.student_id, r as { status: string; source: string }]));
  }, [cls.id, date]);

  async function mark(studentId: string, status: string) {
    const { error } = await createClient().from("attendance").upsert(
      { tenant_id: cls.tenant_id, class_id: cls.id, student_id: studentId, date, status, source: "manual" },
      { onConflict: "class_id,student_id,date" });
    if (error) toast(error.message, "error"); else void rows.reload();
  }
  async function markAll(status: string) {
    for (const s of students) await mark(s.user_id, status);
  }

  return (
    <Card title="Attendance" actions={<div className="flex items-center gap-2">
      <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="w-40" />
      {canManage && <Button size="sm" variant="secondary" onClick={() => markAll("present")}>All present</Button>}
    </div>} pad={false}>
      {students.length === 0 ? <p className="p-5 text-sm text-ink-500">No students.</p> : (
        <table className="table">
          <thead><tr><th>Student</th><th>Status</th><th>Source</th></tr></thead>
          <tbody>{students.map((s) => {
            const r = rows.data?.[s.user_id];
            return (
              <tr key={s.user_id}>
                <td className="font-medium">{s.users?.full_name}</td>
                <td><div className="flex gap-1">{STATUSES.map((st) => (
                  <button key={st} disabled={!canManage} onClick={() => mark(s.user_id, st)}
                    className={`badge border capitalize ${r?.status === st ? "border-brand-400 bg-brand-600 text-white" : "border-ink-200 bg-white text-ink-600"}`}>{st}</button>
                ))}</div></td>
                <td className="text-xs text-ink-500">{r ? (r.source === "session" ? "from live session" : "manual") : "not recorded"}</td>
              </tr>
            );
          })}</tbody>
        </table>
      )}
    </Card>
  );
}

function Settings({ cls, isAdmin, teachers }: { cls: Cls; isAdmin: boolean; teachers: { id: string; full_name: string }[] }) {
  const router = useRouter();
  const toast = useToast();
  const dialog = useDialog();
  const [name, setName] = useState(cls.name);
  const [subject, setSubject] = useState(cls.subject ?? "");
  const [grade, setGrade] = useState(cls.grade_level ?? "");
  const [teacher, setTeacher] = useState(cls.teacher_id);

  async function save() {
    const { error } = await createClient().from("classes").update({ name, subject: subject || null, grade_level: grade || null }).eq("id", cls.id);
    if (error) toast(error.message, "error"); else { toast("Saved", "success"); router.refresh(); }
  }
  async function archive(on: boolean) {
    const { error } = await createClient().from("classes").update({ archived_at: on ? new Date().toISOString() : null }).eq("id", cls.id);
    if (error) toast(error.message, "error"); else router.refresh();
  }
  async function regen() {
    if (!(await dialog.confirm({ title: "Generate a new join code?", body: "The old code stops working immediately.", confirmLabel: "New code" }))) return;
    try { await rpc("regenerate_class_code", { p_class: cls.id }); router.refresh(); } catch (e) { toast(errorText(e), "error"); }
  }
  async function transfer() {
    try { await rpc("transfer_class", { p_class: cls.id, p_teacher: teacher }); toast("Class transferred", "success"); router.refresh(); } catch (e) { toast(errorText(e), "error"); }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Card title="Details">
        <div className="space-y-3">
          <Field label="Name"><Input value={name} onChange={(e) => setName(e.target.value)} /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Subject"><Input value={subject} onChange={(e) => setSubject(e.target.value)} /></Field>
            <Field label="Grade"><Input value={grade} onChange={(e) => setGrade(e.target.value)} /></Field>
          </div>
          <Button onClick={save}>Save</Button>
        </div>
      </Card>
      <Card title="Access">
        <div className="space-y-4">
          <div className="flex items-center justify-between"><div><p className="font-medium">Join code <span className="font-mono">{cls.join_code}</span></p><p className="text-xs text-ink-500">Replace it if it was shared too widely.</p></div><Button variant="secondary" onClick={regen}>New code</Button></div>
          <div className="flex items-center justify-between"><div><p className="font-medium">{cls.archived_at ? "Archived" : "Active"}</p><p className="text-xs text-ink-500">Archived classes keep their history but can't be joined.</p></div>
            <Button variant="secondary" onClick={() => archive(!cls.archived_at)}>{cls.archived_at ? "Restore" : "Archive"}</Button></div>
          {isAdmin && (
            <div className="border-t border-ink-100 pt-4">
              <Field label="Transfer to teacher"><div className="flex gap-2">
                <Select value={teacher} onChange={(e) => setTeacher(e.target.value)}>{teachers.map((t) => <option key={t.id} value={t.id}>{t.full_name}</option>)}</Select>
                <Button variant="secondary" disabled={teacher === cls.teacher_id} onClick={transfer}>Transfer</Button></div></Field>
            </div>
          )}
        </div>
      </Card>
    </div>
  );
}
