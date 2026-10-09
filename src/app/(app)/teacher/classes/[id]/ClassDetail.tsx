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
import { AddStudents, LoginCards, printCards, type AddedRow } from "./AddStudents";
import { Promote } from "./Promote";
import { SubjectTeachers } from "./SubjectTeachers";
import { SchoolProgress } from "@/app/(app)/admin/progress/SchoolProgress";
import { FEATURES } from "@/lib/features";
import { Icon } from "@/components/Icon";
import {
  Alert, Avatar, Badge, Button, Card, CopyButton, Empty, Field, Input, Modal, PageHeader, Select, Tabs, useToast, useDialog, Menu } from "@/components/ui";

type Cls = { id: string; name: string; subject: string | null; grade_level: string | null; join_code: string; archived_at: string | null; teacher_id: string; tenant_id: string };
type Member = { user_id: string; role: string; joined_at: string;
  users: { full_name: string; email: string; login_name: string | null; student_profiles: { student_number: string | null } | null } | null };

export function ClassDetail({ cls, canManage, isAdmin, policies, teachers, canTeach = false, mySubjects = [] }: {
  cls: Cls; canManage: boolean; isAdmin: boolean; policies: { id: string; name: string }[]; teachers: { id: string; full_name: string }[];
  /** Teaches the class: class teacher, admin or subject teacher (0990). */
  canTeach?: boolean; mySubjects?: string[];
}) {
  const [tab, setTab] = useState<"roster" | "analysis" | "levels" | "supports" | "groups" | "settings">("roster");
  const members = useLoader(async () => {
    const { data, error } = await createClient().from("class_members")
      .select("user_id,role,joined_at,users(full_name,email,login_name,student_profiles(student_number))").eq("class_id", cls.id).order("role", { ascending: false });
    if (error) throw error;
    return (data ?? []) as unknown as Member[];
  }, [cls.id]);
  const students = (members.data ?? []).filter((m) => m.role === "student");

  return (
    <div className="page">
      <PageHeader eyebrow={<Link href="/teacher/classes">Classes</Link>} title={cls.name}
        subtitle={!canManage && mySubjects.length ? `You teach ${mySubjects.join(" and ")} in this class.` : [cls.subject, cls.grade_level].filter(Boolean).join(" · ") || undefined}
        actions={!canManage && canTeach ? <Link href={`/teacher/live/new?class=${cls.id}`} className="btn btn-primary no-underline">Go live</Link> : canManage && <>
          <Link href={`/teacher/insights?class=${cls.id}`} className="btn btn-secondary no-underline">Analytics</Link>
          {FEATURES.parentPortal && <Link href={`/teacher/classes/${cls.id}/parent-codes`} className="btn btn-secondary no-underline">Parent codes</Link>}
          <Link href={`/teacher/live/new?class=${cls.id}`} className="btn btn-primary no-underline">Go live</Link>
        </>} />

      {cls.archived_at && <div className="mb-4"><Alert tone="warn">This class is archived. Students can no longer join with its code.</Alert></div>}

      <Tabs className="mb-5" value={tab} onChange={setTab} tabs={[
        { id: "roster", label: `Roster (${students.length})` },
        ...(canTeach || canManage ? [{ id: "analysis" as const, label: "Analysis" }] : []),
        ...(canManage ? [{ id: "levels" as const, label: "Levels & XP" }, { id: "supports" as const, label: "Supports" }] : []),
        { id: "groups", label: "Groups" },
        ...(canManage ? [{ id: "settings" as const, label: "Settings" }] : [])
      ]} />

      {tab === "roster" && <Roster cls={cls} canManage={canManage} isAdmin={isAdmin} teachers={teachers} members={members.data ?? []} loading={members.loading} reload={members.reload} />}
      {tab === "analysis" && (canTeach || canManage) && <SchoolProgress classId={cls.id} />}
      {tab === "levels" && canManage && <LevelsPanel classId={cls.id} />}
      {tab === "supports" && canManage && <SupportsPanel classId={cls.id} />}
      {tab === "groups" && <Groups cls={cls} canManage={canManage} students={students} policies={policies} />}
      {tab === "settings" && canManage && <Settings cls={cls} isAdmin={isAdmin} teachers={teachers} />}
    </div>
  );
}

function Roster({ cls, canManage, isAdmin, teachers, members, loading, reload }: {
  cls: Cls; canManage: boolean; isAdmin: boolean; teachers: { id: string; full_name: string }[]; members: Member[]; loading: boolean; reload: () => Promise<void>;
}) {
  const toast = useToast();
  const dialog = useDialog();
  const [addOpen, setAddOpen] = useState(false);
  const [promoteOpen, setPromoteOpen] = useState(false);
  const [editing, setEditing] = useState<Member | null>(null);
  const [newLogin, setNewLogin] = useState<AddedRow | null>(null);
  const studentRows = members.filter((m) => m.role === "student");
  const [codeModal, setCodeModal] = useState<{ title: string; code: string; note: string } | null>(null);
  const [parents, setParents] = useState<{ student: string; list: { parent_id: string; parent: string; relation: string }[]; studentId: string } | null>(null);
  const router = useRouter();

  async function messageParent(studentId: string, name: string) {
    const all = await rpc<{ student_id: string; parent_id: string; parent: string; relation: string }[]>("class_parents", { p_class: cls.id });
    const list = all.filter((x) => x.student_id === studentId);
    if (!list.length) { toast(`No parent is linked to ${name} yet. Send them a parent invite first.`, "info"); return; }
    if (list.length === 1) { await openParent(studentId, list[0]!.parent_id); return; }
    setParents({ student: name, list, studentId });
  }
  async function openParent(studentId: string, parentId: string) {
    const id = await rpc<string>("open_parent_thread", { p_student: studentId, p_class: cls.id, p_parent: parentId });
    router.push(`/messages?thread=${id}`);
  }
  const joinUrl = typeof window !== "undefined" ? `${window.location.origin}/join?code=${cls.join_code}` : "";

  async function remove(userId: string) {
    if (!(await dialog.confirm({ title: "Remove from this class?", body: "Their past work is kept.", tone: "danger", confirmLabel: "Remove" }))) return;
    const { error } = await createClient().from("class_members").delete().eq("class_id", cls.id).eq("user_id", userId);
    if (error) toast(error.message, "error"); else { toast("Removed", "success"); void reload(); }
  }

  async function resetPassword(m: Member) {
    const name = m.users?.full_name ?? "this student";
    if (!(await dialog.confirm({ title: `New starting password for ${name}?`, body: "Their current password stops working. They choose their own again when they next sign in.", confirmLabel: "Make a new password" }))) return;
    try {
      const r = await api<{ login: string; password: string }>(`/api/students/${m.user_id}/password`, { method: "POST" });
      setNewLogin({ name, login: r.login, password: r.password, status: "Reset", ok: true });
    } catch (e) { toast(errorText(e), "error"); }
  }

  async function deleteAccount(m: Member) {
    const name = m.users?.full_name ?? "";
    const typed = await dialog.ask({ title: `Delete ${name}'s account?`, tone: "danger", confirmLabel: "Delete account", label: "Type the student's full name to confirm",
      body: "This deletes the account from the school, with all their results, answers and reports. It can't be undone. To take them out of this class only, use Remove from class." });
    if (typed === null) return;
    try {
      await api(`/api/students/${m.user_id}`, { method: "DELETE", json: { confirm_name: typed } });
      toast("Account deleted", "success"); void reload();
    } catch (e) { toast(errorText(e), "error"); }
  }

  async function parentInvite(studentId: string, name: string) {
    try {
      // The student's standing parent code (the same one on the class's printable letters).
      const r = await rpc<{ students: { student_id: string; code: string }[] }>("parent_codes", { p_class: cls.id });
      const code = r.students.find((s) => s.student_id === studentId)?.code;
      if (!code) throw new Error("No parent code for this student.");
      setCodeModal({ title: `Parent code for ${name}`, code, note: `Give this code to the parent or guardian. They sign up at ${window.location.origin}/signup?as=parent, or add it under My children if they already have an account. Up to 4 parents can use it.` });
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
        actions={canManage && <>
          {studentRows.length > 0 && <Button size="sm" variant="secondary" onClick={() => setPromoteOpen(true)}>Promote</Button>}
          <Button size="sm" onClick={() => setAddOpen(true)}>Add students</Button>
        </>}>
        {loading ? <p className="p-5 text-sm text-ink-500">Loading…</p> : members.length <= 1 ? (
          <div className="p-5"><Empty title="No students yet" action={canManage ? <Button onClick={() => setAddOpen(true)}>Add students</Button> : undefined}>Add them one by one or from a CSV or Excel file, or let them join with the class code <strong className="font-mono">{cls.join_code}</strong>.</Empty></div>
        ) : (
          <table className="table">
            <thead><tr><th>Name</th><th className="hidden sm:table-cell">Role</th><th className="hidden sm:table-cell">Joined</th>{canManage && <th className="text-right"><span className="sr-only">Actions</span></th>}</tr></thead>
            <tbody>
              {members.map((m) => (
                <tr key={m.user_id}>
                  <td className="min-w-[11rem] sm:min-w-[14rem]"><div className="flex items-center gap-3"><Avatar name={m.users?.full_name ?? "?"} className="h-9 w-9" />
                    <div className="min-w-0">
                      <p className="flex items-center gap-2">
                        {m.role === "student"
                          ? <Link href={`/teacher/students/${m.user_id}`} className="max-w-[9rem] truncate font-semibold text-ink-900 no-underline hover:text-brand-700 hover:underline sm:max-w-[16rem]">{m.users?.full_name}</Link>
                          : <span className="max-w-[9rem] truncate font-semibold text-ink-900 sm:max-w-[16rem]">{m.users?.full_name}</span>}
                        {m.role === "teacher" && <Badge tone="ink" className="sm:hidden">Teacher</Badge>}
                      </p>
                      <p className="max-w-[9rem] truncate text-[13px] text-ink-500 sm:max-w-[18rem]">
                        {m.users?.login_name ? <>Username <span className="font-mono text-ink-700">{m.users.login_name}</span></> : m.users?.email}
                        {m.users?.student_profiles?.student_number ? ` · ${m.users.student_profiles.student_number}` : ""}
                      </p>
                    </div></div></td>
                  <td className="hidden sm:table-cell"><Badge tone={m.role === "teacher" ? "ink" : "gray"}>{m.role === "teacher" ? "Teacher" : "Student"}</Badge></td>
                  <td className="hidden text-ink-500 sm:table-cell">{formatDate(m.joined_at)}</td>
                  {canManage && (
                    <td className="text-right">
                      {m.role === "student" && <div className="flex items-center justify-end gap-1">
                        <Link href={`/teacher/students/${m.user_id}`} className="btn btn-secondary btn-sm hidden no-underline sm:inline-flex">Report</Link>
                        <Menu label={`More for ${m.users?.full_name ?? "this student"}`} items={[
                          ...(FEATURES.messaging ? [{ label: "Message parent", icon: <Icon name="chat" className="h-4 w-4" />, onSelect: () => messageParent(m.user_id, m.users?.full_name ?? "this student") }] : []),
                          ...(FEATURES.parentPortal ? [{ label: "Parent code", icon: <Icon name="users" className="h-4 w-4" />, onSelect: () => parentInvite(m.user_id, m.users?.full_name ?? "student") }] : []),
                          { label: "Edit details", icon: <Icon name="write" className="h-4 w-4" />, onSelect: () => setEditing(m) },
                          ...(m.users?.login_name ? [{ label: "Reset password", icon: <Icon name="key" className="h-4 w-4" />, onSelect: () => resetPassword(m) }] : []),
                          { label: "Pair a device", icon: <Icon name="laptop" className="h-4 w-4" />, onSelect: () => pairDevice(m.user_id, m.users?.full_name ?? "student") },
                          { label: "Remove from class", icon: <Icon name="x" className="h-4 w-4" />, tone: "danger" as const, onSelect: () => remove(m.user_id) },
                          ...(isAdmin ? [{ label: "Delete account", icon: <Icon name="trash" className="h-4 w-4" />, tone: "danger" as const, onSelect: () => deleteAccount(m) }] : [])
                        ]} />
                      </div>}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
      <div className="space-y-6">
      <SubjectTeachers classId={cls.id} canManage={canManage} teachers={teachers} />
      <Card title="Or let students join with a code">
        <p className="text-sm text-ink-600">Students with their own account join at <strong>/join</strong> with this code:</p>
        <p className="my-4 rounded-2xl bg-accent-500 py-5 text-center font-mono text-4xl font-extrabold tracking-[0.25em] text-accent-ink">{cls.join_code}</p>
        <div className="flex flex-wrap gap-2"><CopyButton value={cls.join_code} label="Copy code" /><CopyButton value={joinUrl} label="Copy join link" /></div>
        <p className="hint mt-3">Students who already have an account enter the code under "Join with code".</p>
      </Card>
      </div>

      {addOpen && <AddStudents classId={cls.id} className={cls.name} onClose={(changed) => { setAddOpen(false); if (changed) void reload(); }} />}
      {promoteOpen && <Promote cls={cls} students={studentRows.map((m) => ({ user_id: m.user_id, name: m.users?.full_name ?? "Student" }))}
        onClose={(changed) => { setPromoteOpen(false); if (changed) void reload(); }} />}
      {editing && <EditStudent m={editing} onClose={(changed) => { setEditing(null); if (changed) void reload(); }} />}
      <Modal open={!!newLogin} onClose={() => setNewLogin(null)} title={`New starting password for ${newLogin?.name ?? ""}`}
        footer={<><Button variant="secondary" onClick={printCards}>Print login card</Button><Button onClick={() => setNewLogin(null)}>Done</Button></>}>
        {newLogin && <div className="space-y-3 text-sm">
          <p>Username: <span className="font-mono text-base font-bold">{newLogin.login}</span></p>
          <p>Starting password: <span className="font-mono text-base font-bold">{newLogin.password}</span></p>
          <p className="text-ink-600">Shown only now. The student chooses their own password when they sign in.</p>
          <LoginCards className={cls.name} rows={[newLogin]} />
        </div>}
      </Modal>
      <Modal open={!!parents} onClose={() => setParents(null)} title={`Message a parent of ${parents?.student ?? ""}`}>
        <ul className="space-y-2">{parents?.list.map((x) => (
          <li key={x.parent_id} className="flex items-center justify-between gap-3 rounded-xl border border-ink-200 px-3 py-2">
            <span><span className="font-semibold">{x.parent}</span> <span className="text-[13px] capitalize text-ink-500">{x.relation}</span></span>
            <Button size="sm" onClick={() => openParent(parents.studentId, x.parent_id)}>Message</Button>
          </li>
        ))}</ul>
      </Modal>
      <Modal open={!!codeModal} onClose={() => setCodeModal(null)} title={codeModal?.title ?? ""}>
        {codeModal && <div className="space-y-3 text-center">
          <p className="rounded-2xl bg-accent-500 py-4 font-mono text-4xl font-extrabold tracking-[0.25em] text-accent-ink">{codeModal.code}</p>
          <CopyButton value={codeModal.code} />
          <p className="text-sm text-ink-600">{codeModal.note}</p>
        </div>}
      </Modal>
    </div>
  );
}

/** Edit a student's name and admission number. */
function EditStudent({ m, onClose }: { m: Member; onClose: (changed: boolean) => void }) {
  const toast = useToast();
  const [name, setName] = useState(m.users?.full_name ?? "");
  const [adm, setAdm] = useState(m.users?.student_profiles?.student_number ?? "");
  const [busy, setBusy] = useState(false);
  async function save() {
    setBusy(true);
    try { await rpc("update_student", { p_student: m.user_id, p_name: name, p_admission: adm }); toast("Saved", "success"); onClose(true); }
    catch (e) { toast(errorText(e), "error"); setBusy(false); }
  }
  return (
    <Modal open onClose={() => onClose(false)} title="Edit student"
      footer={<><Button variant="ghost" onClick={() => onClose(false)}>Cancel</Button><Button loading={busy} disabled={!name.trim()} onClick={save}>Save</Button></>}>
      <div className="space-y-4">
        <Field label="Full name" htmlFor="ed-name"><Input id="ed-name" value={name} onChange={(e) => setName(e.target.value)} /></Field>
        <Field label="Admission number" htmlFor="ed-adm"><Input id="ed-adm" value={adm} onChange={(e) => setAdm(e.target.value)} /></Field>
        {m.users?.login_name && <p className="text-[13px] text-ink-500">Username <span className="font-mono text-ink-800">{m.users.login_name}</span> stays the same.</p>}
      </div>
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
