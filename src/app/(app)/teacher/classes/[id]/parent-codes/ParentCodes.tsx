"use client";
import Link from "next/link";
import { useState } from "react";
import { Printer } from "lucide-react";
import { Alert, Badge, Button, Card, PageHeader, useDialog, useToast } from "@/components/ui";
import { errorText, rpc } from "@/lib/rpc";

export type ParentCodesData = {
  class: { id: string; name: string }; school: string;
  students: { student_id: string; name: string; code: string; uses: number; max_uses: number; parents: string[] }[];
};

const pretty = (c: string) => `${c.slice(0, 5)}-${c.slice(5)}`;

export function ParentCodes({ data, origin }: { data: ParentCodesData; origin: string }) {
  const toast = useToast();
  const dialog = useDialog();
  const [rows, setRows] = useState(data.students);
  const signup = `${origin}/signup?as=parent`;

  async function renew(id: string, name: string) {
    if (!(await dialog.confirm({ title: `New parent code for ${name}?`, body: "The old code stops working. Parents already linked stay linked.", confirmLabel: "Make a new code" }))) return;
    try {
      const code = await rpc<string>("new_parent_code", { p_student: id });
      setRows((r) => r.map((x) => (x.student_id === id ? { ...x, code, uses: 0 } : x)));
      toast("New code made", "success");
    } catch (e) { toast(errorText(e), "error"); }
  }

  return (
    <div className="page">
      <div className="print:hidden">
        <PageHeader eyebrow={<Link href={`/teacher/classes/${data.class.id}`}>{data.class.name}</Link>} title="Parent codes"
          subtitle="Each student has a code for their parents. Send it home privately (a letter or a message to the parent), not to the student."
          actions={<Button onClick={() => window.print()}><Printer className="h-4 w-4" /> Print letters</Button>} />
        <Alert>Parents sign up at <b>{signup}</b> with the code. A parent with several children signs up once and adds each child&apos;s code under <b>My children</b>. Up to 4 parents or guardians can use each code.</Alert>
        <Card className="mt-5" pad={false}>
          <table className="table">
            <thead><tr><th>Student</th><th>Parent code</th><th>Linked parents</th><th /></tr></thead>
            <tbody>{rows.map((s) => (
              <tr key={s.student_id}>
                <td className="font-medium">{s.name}</td>
                <td className="font-mono text-base font-bold tracking-widest">{pretty(s.code)}</td>
                <td>{s.parents.length ? s.parents.join(", ") : <Badge tone="amber">None yet</Badge>}</td>
                <td className="text-right"><Button size="sm" variant="ghost" onClick={() => renew(s.student_id, s.name)}>New code</Button></td>
              </tr>
            ))}</tbody>
          </table>
        </Card>
      </div>

      {/* One letter per student, one per printed page. */}
      <div className="hidden print:block">
        {rows.map((s) => (
          <section key={s.student_id} className="break-after-page px-4 py-10 text-ink-900" style={{ breakAfter: "page" }}>
            <p className="text-sm">{data.school} · {data.class.name}</p>
            <h1 className="mt-6 font-display text-3xl font-extrabold">Follow {s.name}&apos;s progress</h1>
            <p className="mt-4 text-lg leading-relaxed">Dear parent or guardian, you can see how {s.name.split(" ")[0]} is doing in every subject on SwiftCipher:
              lessons attended, results, strengths, and where extra help is needed. You can also send feedback to each subject teacher.</p>
            <ol className="mt-6 list-decimal space-y-2 pl-6 text-lg">
              <li>Go to <b>{signup}</b></li>
              <li>Enter this parent code: <span className="font-mono text-2xl font-extrabold tracking-widest">{pretty(s.code)}</span></li>
              <li>Create your account with your name, email and a password.</li>
            </ol>
            <p className="mt-6 text-base">Already have an account for another child? Sign in, open <b>My children</b> and choose <b>Add another child</b>.</p>
            <p className="mt-6 text-sm text-ink-600">Please keep this code private. It links your account to your child&apos;s school record.</p>
          </section>
        ))}
      </div>
    </div>
  );
}
