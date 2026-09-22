"use client";
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

type Slide = { id: string; idx: number; kind: string; payload: Record<string, string> };
type Activity = { id: string; kind: string; title: string; config: unknown };
type Question = { id: string; prompt: string; options: string[]; points: number };

export default function StudentSession(props: {
  session: { id: string; state: string; mode: string; join_code: string; class_id: string };
  lessonId: string | null;
  lessonTitle: string | null;
  studentId: string;
}) {
  const [slides, setSlides] = useState<Slide[]>([]);
  const [slide, setSlide] = useState(0);
  const [announcements, setAnnouncements] = useState<{ id: string; body: string; created_at: string }[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [activities, setActivities] = useState<Activity[]>([]);
  const [questions, setQuestions] = useState<Record<string, Question[]>>({});
  const [picks, setPicks] = useState<Record<string, string>>({});
  const [results, setResults] = useState<Record<string, { correct: boolean; awarded: number }>>({});
  const [handMsg, setHandMsg] = useState("");
  const [handSent, setHandSent] = useState(false);

  // join + heartbeat presence
  useEffect(() => {
    if (props.session.state !== "live") return;
    const sb = createClient();
    sb.from("session_participants").insert({
      session_id: props.session.id, user_id: props.studentId, status: "online"
    }).then(() => {});
    const t = setInterval(() => {
      sb.from("session_participants").update({ status: "online" })
        .eq("session_id", props.session.id).eq("user_id", props.studentId).then(() => {});
    }, 30_000);
    return () => clearInterval(t);
  }, [props.session.state, props.session.id, props.studentId]);

  // slides
  useEffect(() => {
    if (!props.lessonId) return;
    const sb = createClient();
    sb.from("lesson_slides").select("id,idx,kind,payload").eq("lesson_id", props.lessonId).order("idx")
      .then(({ data }: { data: any[] | null }) => setSlides((data ?? []) as Slide[]));
  }, [props.lessonId]);

  // activities for this live session (RPC strips answer keys)
  useEffect(() => {
    if (props.session.state !== "live") return;
    const sb = createClient();
    (sb as unknown as { rpc: (n: string, a: unknown) => Promise<{ data: Activity[] | null }> })
      .rpc("session_activities", { p_session: props.session.id })
      .then(({ data }) => setActivities(data ?? []));
  }, [props.session.state, props.session.id]);

  useEffect(() => {
    if (activities.length === 0) return;
    const sb = createClient();
    activities.forEach((a) => {
      (sb as unknown as { rpc: (n: string, a: unknown) => Promise<{ data: Question[] | null }> })
        .rpc("activity_questions", { p_activity: a.id })
        .then(({ data }) => setQuestions((q) => ({ ...q, [a.id]: data ?? [] })));
    });
  }, [activities]);

  // announcements
  useEffect(() => {
    const sb = createClient();
    const ch = sb.channel(`anns-${props.session.id}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "announcements", filter: `session_id=eq.${props.session.id}` },
        (p: any) => setAnnouncements((arr) => [p.new as typeof arr[number], ...arr]))
      .subscribe();
    return () => { sb.removeChannel(ch); };
  }, [props.session.id]);

  // environment-leave detection: blur / hidden → warn event
  useEffect(() => {
    if (props.session.state !== "live") return;
    function onVis() { if (document.hidden) report("idle"); }
    window.addEventListener("blur", () => report("navigation"));
    document.addEventListener("visibilitychange", onVis);
    return () => {
      window.removeEventListener("blur", () => report("navigation"));
      document.removeEventListener("visibilitychange", onVis);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.session.state, props.session.id]);

  async function report(kind: "navigation" | "idle") {
    setNotice("Your class session requires you to return to the lesson.");
    const sb = createClient();
    await sb.from("environment_events").insert({
      session_id: props.session.id, student_id: props.studentId,
      kind, url: location.href, severity: kind === "navigation" ? "warn" : "info"
    });
    setTimeout(() => setNotice(null), 4000);
  }

  async function submit(a: Activity) {
    const v = picks[a.id];
    if (!v) return;
    const r = await fetch(`/api/activities/${a.id}/responses`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ session_id: props.session.id, response: { value: v }, elapsed_ms: 0 })
    });
    const j = await r.json();
    if (j && "correct" in j) {
      setResults((s) => ({ ...s, [a.id]: { correct: j.correct, awarded: j.awarded } }));
      setPicks((p) => { const n = { ...p }; delete n[a.id]; return n; });
    }
  }

  async function raiseHand() {
    if (!handMsg.trim()) return;
    await fetch(`/api/class-sessions/${props.session.id}/hands`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: handMsg })
    });
    setHandSent(true);
  }

  const cur = slides[slide];

  return (
    <main className="mx-auto max-w-3xl px-6 py-6">
      {notice && (
        <div className="mb-4 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          ⚠️ {notice}
        </div>
      )}
      <header className="card mb-4 flex items-center justify-between p-4">
        <div>
          <p className="text-xs uppercase text-brand-600">Fusion Learn</p>
          <h1 className="text-lg font-semibold">{props.lessonTitle ?? "Live session"}</h1>
        </div>
        <div className="flex items-center gap-2">
          {props.session.state === "live" && <a href={`/student/live/${props.session.id}/webrtc`} className="btn btn-ghost text-xs">Join A/V</a>}
          <span className="rounded-full bg-emerald-100 px-3 py-1 text-xs text-emerald-700">{props.session.mode}</span>
        </div>
      </header>

      {slides.length === 0 && (
        <div className="card p-10 text-center text-slate-500">
          {props.lessonId ? "No slides in this lesson yet." : "Your teacher hasn't attached a lesson. Waiting…"}
        </div>
      )}

      {cur && (
        <section className="card p-6">
          <div className="flex items-center justify-between">
            <span className="text-xs text-slate-400">Slide {slide + 1} / {slides.length} — {cur.kind}</span>
            <div className="flex gap-2">
              <button onClick={() => setSlide((s) => Math.max(0, s - 1))} className="btn btn-ghost text-xs">◀ Prev</button>
              <button onClick={() => setSlide((s) => Math.min(slides.length - 1, s + 1))} className="btn btn-ghost text-xs">Next ▶</button>
            </div>
          </div>
          <div className="mt-4">
            {cur.kind === "title" && (
              <div>
                <h2 className="text-3xl font-bold">{cur.payload.heading}</h2>
                {cur.payload.subheading && <p className="mt-2 text-slate-600">{cur.payload.subheading}</p>}
              </div>
            )}
            {cur.kind === "text" && <pre className="whitespace-pre-wrap text-sm">{cur.payload.markdown}</pre>}
            {cur.kind === "image" && cur.payload.url && <img src={cur.payload.url} alt={cur.payload.alt ?? ""} className="rounded" />}
            {cur.kind === "video" && cur.payload.url && <video src={cur.payload.url} controls className="w-full rounded" />}
            {cur.kind === "embed" && <div dangerouslySetInnerHTML={{ __html: cur.payload.html ?? "" }} />}
          </div>
        </section>
      )}

      {props.session.state === "live" && activities.length > 0 && (
        <section className="card mt-4 p-6">
          <h2 className="mb-3 text-lg font-semibold">Live activities</h2>
          <div className="space-y-5">
            {activities.map((a) => {
              const qs = questions[a.id] ?? [];
              const res = results[a.id];
              return (
                <div key={a.id} className="rounded-lg border border-slate-200 p-4">
                  <p className="text-sm font-semibold">{a.title} <span className="ml-1 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] uppercase">{a.kind}</span></p>
                  {res ? (
                    <p className={"mt-2 text-sm font-semibold " + (res.correct ? "text-emerald-700" : "text-rose-700")}>
                      {res.correct ? `✓ Correct (+${res.awarded})` : `✗ Try again — the teacher will review.`}
                    </p>
                  ) : (
                    <>
                      {qs.length === 0 && <p className="mt-2 text-xs text-slate-400">Question not published yet.</p>}
                      {qs.map((q) => (
                        <div key={q.id} className="mt-3">
                          <p className="text-sm">{q.prompt}</p>
                          <div className="mt-2 grid gap-1.5">
                            {(q.options ?? []).map((opt) => (
                              <label key={opt} className={"flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-sm " +
                                (picks[a.id] === opt ? "border-brand-500 bg-brand-50" : "border-slate-200 hover:bg-slate-50")}>
                                <input type="radio" name={a.id} value={opt} className="accent-brand-600"
                                  checked={picks[a.id] === opt} onChange={() => setPicks((p) => ({ ...p, [a.id]: opt }))} />
                                {opt}
                              </label>
                            ))}
                          </div>
                          <button className="btn btn-primary mt-3 text-xs" disabled={!picks[a.id]} onClick={() => submit(a)}>
                            Submit answer
                          </button>
                        </div>
                      ))}
                    </>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      )}

      <section className="card mt-4 flex items-center gap-2 p-4">
        <input className="input text-sm" placeholder="Raise hand — tell your teacher (optional)"
          value={handMsg} onChange={(e) => setHandMsg(e.target.value)} disabled={handSent || props.session.state !== "live"} />
        <button className="btn btn-ghost text-sm" onClick={raiseHand} disabled={handSent || props.session.state !== "live"}>
          {handSent ? "Hand raised ✋" : "Raise hand"}
        </button>
      </section>

      {announcements.length > 0 && (
        <section className="card mt-4 p-4">
          <h3 className="mb-2 text-sm font-semibold uppercase text-slate-600">Teacher announcements</h3>
          <ul className="divide-y divide-slate-100">
            {announcements.map((a) => (
              <li key={a.id} className="py-2 text-sm">{a.body}<span className="ml-2 text-xs text-slate-400">{new Date(a.created_at).toLocaleTimeString()}</span></li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}
