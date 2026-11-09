import { useEffect, useRef, useState, type CSSProperties, type FormEvent } from "react";
import { createRoot } from "react-dom/client";
import { type Approval, type Draft, type TurnInput, type Action, type shot } from "../shared/contracts";
import { copy, type Lang, type Copy } from "./copy";
import type { z } from "zod";

type Turn = { id: string; input: TurnInput; output: string; artifact: Record<string, unknown> | null; status: string; error: string | null };
type Conversation = { id: string; title: string; project_id: string | null; draft: Draft | null; turns: Turn[] };
type Entry = Pick<Conversation, "id" | "title" | "project_id">;
type Project = { id: string; title: string };
type Model = { id: string; name: string };
type Theme = "dark" | "light" | "system";
const blank: Draft = { text: "", skill: "chat" };
const stored = (key: string) => localStorage.getItem("supdance." + key);
const remember = (key: string, value: string) => localStorage.setItem("supdance." + key, value);
function usePreferences() {
  const [lang, setLang] = useState<Lang>(stored("lang") === "en" ? "en" : "zh-CN");
  const [theme, setTheme] = useState<Theme>(() => {
    const value = stored("theme");
    return value === "light" || value === "system" ? value : "dark";
  });
  useEffect(() => { remember("lang", lang); document.documentElement.lang = lang; }, [lang]);
  useEffect(() => { remember("theme", theme); }, [theme]);
  return { lang, setLang, theme, setTheme };
}

async function http<T>(path: string, method = "GET", data?: unknown): Promise<T> {
  const response = await request(path, method, data);
  return response.status === 204 ? undefined as T : response.json();
}
async function request(path: string, method: string, data?: unknown) {
  const response = await fetch(path, { method, credentials: "same-origin",
    headers: data === undefined ? {} : { "content-type": "application/json" },
    body: data === undefined ? undefined : JSON.stringify(data) });
  if (!response.ok) {
    const detail = await response.json().catch(() => ({}));
    throw new Error(detail.code || "request_failed");
  }
  return response;
}

function Mark() { return <img src="/icon.png" className="mark" alt="" width="32" height="32" />; }
function ErrorNotice({ error, t }: { error: string; t: Copy }) {
  return error ? <div className="error" role="alert">{t.failed} · <code>{error}</code></div> : null;
}
function Login({ t, reviewId }: { t: Copy; reviewId?: string }) {
  return <div className="empty">
    <Mark /><h2>{t.assistant}</h2><p>{t.signedOut}</p>
    <a className="button solid" href={"/oauth/login" + (reviewId ? "?return=" + encodeURIComponent("/review/" + reviewId) : "")}>{t.signIn}</a>
  </div>;
}
function Artifact({ data }: { data: Record<string, unknown> }) {
  return <dl className="artifact">
    {Object.entries(data).map(([key, value]) => <div key={key}>
      <dt>{key.replace(/([a-z])([A-Z])/g, "$1 $2")}</dt>
      <dd>{Array.isArray(value)
        ? <ol>{value.map((item, i) => <li key={i}>{typeof item === "object" && item
          ? <Artifact data={item as Record<string, unknown>} /> : String(item)}</li>)}</ol>
        : String(value)}</dd>
    </div>)}
  </dl>;
}

function Review({ id, t }: { id: string; t: Copy }) {
  const [item, setItem] = useState<Approval>();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(true);
  async function run(op?: "decision" | "execute", approve?: boolean) {
    setBusy(true); setError("");
    try {
      setItem(await http<Approval>("/api/approvals/" + id + (op ? "/" + op : ""), op ? "POST" : "GET",
        op === "decision" ? { approve } : undefined));
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }
  useEffect(() => { void run(); }, [id]);
  if (error === "login_required" || error === "invalid_token") return <Login t={t} reviewId={id} />;
  return <section className="review">
    <a href="/">{t.back}</a><h1>{t.review}</h1><p>{t.reviewIntro}</p>
    <ErrorNotice error={error} t={t} />
    {item && <>
      <div className="row"><strong>{t.status[item.status]}</strong><span>{t.quote} · {item.quote.credits}</span></div>
      <Artifact data={item.action} />
      {item.receipt && <Artifact data={item.receipt} />}
      <ErrorNotice error={item.error ?? ""} t={t} />
      {item.status === "pending" && (item.quote.expiresAt > Date.now()
        ? <div className="row"><button className="solid" disabled={busy} onClick={() => run("decision", true)}>{t.approve}</button>
          <button disabled={busy} onClick={() => run("decision", false)}>{t.reject}</button></div> : <p>{t.expired}</p>)}
      {(item.status === "approved" || item.status === "running") &&
        <button className="solid" disabled={busy} onClick={() => run("execute")}>{t.execute}</button>}
    </>}
    <button disabled={busy} onClick={() => run()}>{t.refresh}</button>
  </section>;
}

function Studio({ preferences }: { preferences: ReturnType<typeof usePreferences> }) {
  const { lang, setLang, theme, setTheme } = preferences;
  const t = copy[lang];
  const [session, setSession] = useState<"loading" | "guest" | "signed">("loading");
  const [conv, setConv] = useState<Conversation>();
  const [projectId, setProject] = useState("");
  const [projects, setProjects] = useState<Project[]>([]);
  const [models, setModels] = useState<Model[]>([]);
  const [history, setHistory] = useState<Entry[]>([]);
  const [view, setView] = useState<"chat" | "history" | "settings">("chat");
  const [draft, setDraft] = useState<Draft>(blank);
  const [search, setSearch] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [opening, setOpening] = useState(false);
  const [saved, setSaved] = useState(false);
  const [partial, setPartial] = useState("");
  const [selected, setSelected] = useState<string>();
  const [collapsed, setCollapsed] = useState(false);
  const [full, setFull] = useState(false);
  const [width, setWidth] = useState(420);
  const [preview, setPreview] = useState<{ turn: Turn; canvasId: string }>();
  const lastSaved = useRef("");
  const saveQueue = useRef(Promise.resolve());
  const creating = useRef<Promise<Conversation> | undefined>(undefined);
  const composer = useRef<HTMLTextAreaElement>(null);
  const attachment = useRef<HTMLInputElement>(null);
  const bottom = useRef<HTMLDivElement>(null);

  const fail = (err: unknown) => {
    const code = (err as Error).message;
    if (code === "login_required" || code === "invalid_token") { setSession("guest"); setConv(undefined); setDraft(blank); }
    setError(code);
  };
  useEffect(() => {
    void http("/api/me").then(async () => {
      const [history, p, m] = await Promise.allSettled([
        http<Entry[]>("/api/conversations"), http<Project[]>("/api/projects"), http<Model[]>("/api/models"),
      ]);
      if (p.status === "fulfilled") setProjects(p.value);
      if (m.status === "fulfilled") setModels(m.value);
      if (history.status === "fulfilled" && history.value[0]) await load(history.value[0].id);
      setSession("signed");
    }).catch((err) => { setSession("guest"); if (err.message !== "login_required") fail(err); });
  }, []);
  useEffect(() => {
    if (view !== "history" || session !== "signed") return;
    let current = true;
    const timer = setTimeout(() => void http<Entry[]>("/api/conversations?search=" + encodeURIComponent(search))
      .then((items) => { if (current) setHistory(items); }).catch((e) => { if (current) fail(e); }), 200);
    return () => { current = false; clearTimeout(timer); };
  }, [view, search, session]);

  function save(id: string, value: Draft) {
    const serialized = JSON.stringify(value);
    if (serialized === lastSaved.current) return saveQueue.current;
    setSaving(true);
    const next = saveQueue.current.catch(() => {}).then(async () => {
      await http("/api/conversations/" + id + "/draft", "PUT", value);
      lastSaved.current = serialized;
      setSaved(true);
    });
    saveQueue.current = next;
    return next.finally(() => setSaving(false));
  }
  useEffect(() => {
    if (session !== "signed" || busy || opening || JSON.stringify(draft) === lastSaved.current) return;
    if (!conv && !draft.text.trim() && !draft.attachment) return;
    const timer = setTimeout(() => void (async () => {
      const current = conv ?? await create(draft.text.trim().slice(0, 70) || t.newTitle, false);
      await save(current.id, draft);
    })().catch(fail), 500);
    return () => clearTimeout(timer);
  }, [draft, conv?.id, busy, opening, session]);
  useEffect(() => {
    if (!conv || !conv.turns.some((turn) => turn.status === "running") || busy) return;
    const timer = setInterval(() => void http<Conversation>("/api/conversations/" + conv.id)
      .then((next) => setConv((current) => current?.id === next.id ? next : current)).catch(fail), 1800);
    return () => clearInterval(timer);
  }, [conv, busy]);
  useEffect(() => { if (busy) bottom.current?.scrollIntoView({ block: "nearest" }); }, [partial, busy]);

  function apply(next: Conversation) {
    setConv(next); setProject(next.project_id ?? ""); setDraft(next.draft ?? blank);
    lastSaved.current = JSON.stringify(next.draft ?? blank);
    setSelected(undefined); setView("chat"); setError(""); setSaved(false); setPreview(undefined);
  }
  async function load(id: string) {
    if (conv) await save(conv.id, draft);
    apply(await http<Conversation>("/api/conversations/" + id));
  }
  async function create(title: string, resetDraft = true) {
    if (creating.current) return creating.current;
    const pending = http<Conversation>("/api/conversations", "POST", { title, projectId: projectId || undefined });
    creating.current = pending;
    try {
      const next = await pending;
      if (resetDraft) apply(next);
      else setConv(next);
      return next;
    } finally { creating.current = undefined; }
  }
  async function fresh() {
    setOpening(true);
    try { if (conv) await save(conv.id, draft); await create(t.newTitle); }
    catch (err) { fail(err); }
    finally { setOpening(false); requestAnimationFrame(() => composer.current?.focus()); }
  }
  async function send(value?: TurnInput) {
    if (busy || opening || (!value && !draft.text.trim())) return;
    const latest = conv?.turns.filter((turn) => turn.status === "done").at(-1)?.id;
    const input = value ?? { ...draft, language: lang, parent: selected ?? latest };
    setBusy(true); setPartial(""); setError("");
    try {
      const current = conv ?? await create(input.text.trim().slice(0, 70));
      await saveQueue.current.catch(() => {});
      const res = await request("/api/conversations/" + current.id + "/turns", "POST", input);
      lastSaved.current = JSON.stringify(blank);
      setDraft(blank); setSaved(false); setSelected(undefined);
      let pending = "";
      let finished = false;
      const stream = res.body?.pipeThrough(new TextDecoderStream());
      if (!stream) throw new Error("stream_missing");
      const reader = stream.getReader();
      for (;;) {
        const chunk = await reader.read();
        if (chunk.done) break;
        pending += chunk.value;
        const lines = pending.split("\n");
        pending = lines.pop() || "";
        for (const line of lines) {
          const event = JSON.parse(line);
          if (event.type === "delta") setPartial((old) => old + event.text);
          if (event.type === "finished") { finished = true; if (event.error) setError(event.error); }
        }
      }
      if (!finished) setError("stream_interrupted");
      setConv(await http<Conversation>("/api/conversations/" + current.id));
    } catch (err) {
      fail(err);
      if (conv) void http<Conversation>("/api/conversations/" + conv.id).then(setConv).catch(fail);
    } finally { setBusy(false); setPartial(""); }
  }

  async function changeProject(id: string) {
    try {
      if (conv) {
        const next = await http<Conversation>("/api/conversations/" + conv.id + "/project", "PUT", { projectId: id || null });
        setConv(next);
      }
      setProject(id);
    } catch (err) { fail(err); }
  }

  async function upload(file?: File) {
    if (!file) return;
    if (file.size > 32000 || !/\.(txt|md)$/i.test(file.name)) { setError(t.maxAttachment); return; }
    try {
      const content = new TextDecoder("utf-8", { fatal: true }).decode(await file.arrayBuffer());
      if (!content.trim()) throw new Error("empty_attachment");
      setDraft((value) => ({ ...value, attachment: { name: file.name.slice(0, 160), text: content } }));
    } catch (err) { fail(err); }
  }
  async function prepare(e: FormEvent) {
    e.preventDefault();
    if (!preview || !projectId) return;
    setBusy(true);
    try {
      const canvasId = encodeURIComponent(preview.canvasId.trim());
      const { revision } = await http<{ revision: string }>(`/api/projects/${encodeURIComponent(projectId)}/canvases/${canvasId}`);
      const payload: Action = { kind: "canvas", projectId, canvasId: preview.canvasId.trim(), revision,
        shots: preview.turn.artifact?.shots as z.infer<typeof shot>[] };
      const result = await http<Approval>("/api/approvals", "POST", { requestId: crypto.randomUUID(), payload });
      location.assign("/review/" + result.id);
    } catch (err) { fail(err); }
    finally { setBusy(false); }
  }
  const running = busy || !!conv?.turns.some((turn) => turn.status === "running");
  return <main className={"layout" + (full ? " full" : "") + (collapsed ? " collapsed" : "")}
    style={{ "--panel-width": width + "px" } as CSSProperties}>
    <section className="hero">
      <header><Mark /><strong>Supdance</strong><span className="badge">{t.kicker}</span></header>
      <div className="hero-content">
        <div className="eyebrow">{t.kicker}</div><h1>{t.headline}</h1><p>{t.subhead}</p>
        <ol className="stages">{t.stages.map((stage, i) => <li key={stage}><span>0{i + 1}</span>{stage}</li>)}</ol>
        {collapsed && <button className="solid" onClick={() => setCollapsed(false)}>{t.open}</button>}
      </div>
    </section>
    {!collapsed && <aside className="panel" aria-label={t.assistant}>
      {!full && <button className="resize" aria-label={t.width}
        onKeyDown={(e) => {
          if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
          e.preventDefault(); setWidth((old) => Math.max(340, Math.min(760, old + (e.key === "ArrowLeft" ? 24 : -24))));
        }}
        onPointerDown={(e) => e.currentTarget.setPointerCapture(e.pointerId)}
        onPointerMove={(e) => {
          if (e.currentTarget.hasPointerCapture(e.pointerId)) setWidth(Math.max(340, Math.min(760, window.innerWidth - e.clientX)));
        }} />}
      <header className="panel-header">
        <div className="row">
          <strong>Supdance</strong><span className="badge">{session === "loading" ? t.connecting : session === "signed" ? t.online : t.guest}</span>
          <div className="spacer" />
          <button aria-label={full ? t.restore : t.fullscreen} title={full ? t.restore : t.fullscreen} onClick={() => setFull(!full)}>{full ? "⊟" : "⛶"}</button>
          <button aria-label={t.close} title={t.close} onClick={() => { setCollapsed(true); setFull(false); }}>×</button>
        </div>
        <nav className="row">
          <button disabled={running || opening || session !== "signed"} onClick={fresh}>＋ {t.newChat}</button>
          <button disabled={running || opening || session !== "signed"} aria-pressed={view === "history"} onClick={() => setView(view === "history" ? "chat" : "history")}>{t.history}</button>
          <button disabled={running} aria-pressed={view === "settings"} onClick={() => setView(view === "settings" ? "chat" : "settings")}>{t.settings}</button>
        </nav>
        {session === "signed" && <label className="row context">{t.project}
          <select value={projectId} disabled={running} onChange={(e) => changeProject(e.target.value)}>
            <option value="">{t.noProject}</option>
            {projectId && !projects.some((item) => item.id === projectId) && <option value={projectId}>{projectId}</option>}
            {projects.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}
          </select></label>}
      </header>
      <div className="conversation">
        <ErrorNotice error={error} t={t} />
        {view === "settings" ? <div className="settings">
          <label>{t.language}<select value={lang} onChange={(e) => setLang(e.target.value as Lang)}><option value="zh-CN">简体中文</option><option value="en">English</option></select></label>
          <label>{t.theme}<select value={theme} onChange={(e) => setTheme(e.target.value as Theme)}><option value="dark">{t.dark}</option><option value="light">{t.light}</option><option value="system">{t.system}</option></select></label>
          {session === "signed" && <button onClick={() => void http("/api/logout", "POST").then(() => location.reload()).catch(fail)}>{t.signOut}</button>}
        </div> : view === "history" ? <div className="settings">
          <input aria-label={t.search} placeholder={t.search} value={search} onChange={(e) => setSearch(e.target.value)} />
          {history.length ? history.map((item) => <button key={item.id} onClick={() => void load(item.id).catch(fail)}>{item.title}</button>) : <p>{t.emptyHistory}</p>}
          {conv && <button onClick={async () => {
            if (!confirm(t.deleteQuestion)) return;
            try {
              await saveQueue.current.catch(() => {});
              await http("/api/conversations/" + conv.id, "DELETE");
              setConv(undefined); setDraft(blank); setSelected(undefined);
              setHistory((items) => items.filter((item) => item.id !== conv.id));
            } catch (err) { fail(err); }
          }}>{t.delete}</button>}
        </div> : session === "guest" ? <Login t={t} /> : session === "loading" ? <p role="status">{t.connecting}</p> : <>
          {!conv?.turns.length && !running && <div className="empty"><Mark /><h2>{t.assistant}</h2><p>{t.noTurns}</p>
            <div className="row wrap">{(["plan", "outline", "script", "storyboard"] as const).map((item) =>
              <button key={item} aria-pressed={draft.skill === item} onClick={() => { setDraft({ ...draft, skill: item }); composer.current?.focus(); }}>{t.skills[item]}</button>)}</div>
          </div>}
          {conv?.turns.map((turn) => <article key={turn.id} className="turn">
            <div className="message user"><b>{t.you}</b><p>{turn.input.text}</p></div>
            <div className="message"><b>Supdance · {t.skills[turn.input.skill]}</b>
              {turn.artifact ? <Artifact data={turn.artifact} /> : <p>{turn.output}</p>}
              {turn.status !== "done" && <span className="badge">{t.status[turn.status as keyof Copy["status"]] ?? turn.status}</span>}
              <ErrorNotice error={turn.error ?? ""} t={t} />
              <div className="row wrap">
                {turn.status === "done" && <button disabled={running} aria-pressed={selected === turn.id} onClick={() => { setSelected(turn.id); composer.current?.focus(); }}>{t.branch}</button>}
                {turn.status === "done" && <button disabled={running} onClick={() => {
                  setSelected(turn.id); setDraft({ ...draft, skill: turn.input.skill, text: window.getSelection()?.toString().slice(0, 16000) ?? "" });
                  composer.current?.focus();
                }}>{t.revise}</button>}
                {turn.status !== "running" && <button disabled={running} onClick={() => send(turn.input)}>{t.retry}</button>}
                {turn.input.skill === "storyboard" && turn.artifact && projectId && <button disabled={running}
                  onClick={() => setPreview({ turn, canvasId: "" })}>{t.storyboardAction}</button>}
              </div>
            </div>
          </article>)}
          {preview && <form className="settings" onSubmit={prepare}>
            <label>{t.canvasId}<input required value={preview.canvasId} onChange={(e) => setPreview({ ...preview, canvasId: e.target.value })} /></label>
            <button className="solid" disabled={running}>{t.prepare}</button>
          </form>}
          {running && <div className="message" role="status"><b>{t.loading}</b><p>{partial}</p></div>}
          <div ref={bottom} />
        </>}
      </div>
      {session === "signed" && view === "chat" && <form className="composer" onSubmit={(e) => { e.preventDefault(); void send(); }}>
        {selected && <button type="button" onClick={() => setSelected(undefined)}>{t.cancelBranch}</button>}
        {draft.attachment && <button type="button" onClick={() => setDraft({ ...draft, attachment: undefined })} aria-label={t.removeAttachment}>{draft.attachment.name} ×</button>}
        <textarea ref={composer} aria-label={t.composer} placeholder={t.composer} rows={3} maxLength={16000}
          disabled={running || opening} value={draft.text} onChange={(e) => { setSaved(false); setDraft({ ...draft, text: e.target.value }); }}
          onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === "Enter") { e.preventDefault(); void send(); } }} />
        <div className="row wrap">
          <input ref={attachment} type="file" accept=".txt,.md" hidden onChange={(e) => { void upload(e.target.files?.[0]); e.target.value = ""; }} />
          <button type="button" aria-label={t.attachment} title={t.attachment} disabled={running} onClick={() => attachment.current?.click()}>＋</button>
          <select aria-label={t.skill} disabled={running} value={draft.skill} onChange={(e) => setDraft({ ...draft, skill: e.target.value as Draft["skill"] })}>
            {Object.entries(t.skills).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select>
          <select aria-label={t.model} disabled={running} value={draft.model || ""} onChange={(e) => setDraft({ ...draft, model: e.target.value || undefined })}>
            <option value="">{t.defaultModel}</option>{models.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select>
          <div className="spacer" />
          {running ? <button type="button" disabled={!conv} onClick={() => void http("/api/conversations/" + conv?.id + "/stop", "POST").catch(fail)}>{t.stop}</button>
            : <button className="solid" disabled={opening || !draft.text.trim()}>{t.send}</button>}
        </div>
        <small>{saved && !saving ? t.draftSaved + " · " : ""}{t.note}</small>
      </form>}
    </aside>}
  </main>;
}

function App() {
  const preferences = usePreferences();
  const id = location.pathname.match(/^\/review\/([\w-]+)$/)?.[1];
  return <div data-plugin-scope="supdance" data-theme={preferences.theme}>
    {id ? <Review id={id} t={copy[preferences.lang]} /> : <Studio preferences={preferences} />}
  </div>;
}
createRoot(document.getElementById("root")!).render(<App />);
