import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { syncApi, type SyncJob } from "@/lib/api/sync";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { ArrowLeft, CheckCircle2, Loader2, XCircle, Clock, RefreshCw, Tv, Film, Clapperboard } from "lucide-react";

export const Route = createFileRoute("/_authenticated/sync/jobs/$jobId")({
  component: JobDetailPage,
  head: () => ({ meta: [{ title: "Acompanhar sync — VODSystem" }] }),
});

const CATS = [
  { key: "canais", label: "Canais", icon: Tv },
  { key: "filmes", label: "Filmes", icon: Film },
  { key: "series", label: "Séries", icon: Clapperboard },
] as const;

type CatKey = (typeof CATS)[number]["key"];

function statusMeta(s: string) {
  switch (s) {
    case "success": return { label: "Concluído", color: "bg-emerald-500/15 text-emerald-500 border-emerald-500/30", icon: CheckCircle2 };
    case "failed": return { label: "Falhou", color: "bg-red-500/15 text-red-500 border-red-500/30", icon: XCircle };
    case "running": return { label: "Executando", color: "bg-blue-500/15 text-blue-500 border-blue-500/30", icon: Loader2 };
    case "queued":
    case "pending": return { label: "Na fila", color: "bg-amber-500/15 text-amber-500 border-amber-500/30", icon: Clock };
    default: return { label: s, color: "bg-muted text-foreground border-border", icon: Clock };
  }
}

function fmt(dt: string | null) {
  if (!dt) return "—";
  return new Date(dt).toLocaleString();
}

function duration(a: string | null, b: string | null) {
  if (!a) return "—";
  const start = new Date(a).getTime();
  const end = b ? new Date(b).getTime() : Date.now();
  const s = Math.max(0, Math.floor((end - start) / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const rs = s % 60;
  if (h > 0) return `${h}h ${m}m ${rs}s`;
  if (m > 0) return `${m}m ${rs}s`;
  return `${rs}s`;
}

const LOG_TAG_COLOR: Record<string, string> = {
  INSERIDO: "text-emerald-400",
  ATUALIZADO: "text-blue-400",
  IGNORADO: "text-muted-foreground",
  ERRO: "text-red-400",
  REMOVIDOS: "text-orange-400",
  ÓRFÃOS: "text-orange-400",
  DEDUP: "text-orange-400",
  "SÉRIE": "text-purple-400",
};

function colorizeLine(line: string) {
  const m = line.match(/\[(INSERIDO|ATUALIZADO|IGNORADO|ERRO|REMOVIDOS|ÓRFÃOS|DEDUP|SÉRIE NOVA)\]/);
  if (!m) return "text-foreground/80";
  const tag = m[1].split(" ")[0];
  return LOG_TAG_COLOR[tag] || "text-foreground/80";
}

function JobDetailPage() {
  const { jobId } = Route.useParams();
  const [job, setJob] = useState<SyncJob | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [filter, setFilter] = useState<"all" | CatKey>("all");
  const [tagFilter, setTagFilter] = useState<"all" | "INSERIDO" | "ATUALIZADO" | "IGNORADO" | "ERRO">("all");
  const logRef = useRef<HTMLDivElement>(null);
  const [autoScroll, setAutoScroll] = useState(true);

  useEffect(() => {
    let alive = true;
    let stop = false;
    const tick = async () => {
      try {
        const j = await syncApi.getJob(jobId);
        if (!alive) return;
        setJob(j); setErr(null);
        if (j.status === "success" || j.status === "failed") stop = true;
      } catch (e) {
        if (alive) setErr(e instanceof Error ? e.message : "Não foi possível carregar o job");
      }
    };
    tick();
    const iv = setInterval(() => { if (!stop) tick(); }, 1500);
    return () => { alive = false; clearInterval(iv); };
  }, [jobId]);

  useEffect(() => {
    if (autoScroll && logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [job?.log_tail, autoScroll, filter, tagFilter]);

  const meta = statusMeta(job?.status ?? "queued");
  const Icon = meta.icon;

  const breakdown = useMemo(() => {
    const r = (job?.result ?? {}) as Record<string, any>;
    return CATS.map(c => {
      const b = r[c.key] ?? {};
      const total = b.total ?? 0;
      const processed = b.processed ?? 0;
      const pct = total > 0 ? Math.min(100, Math.round((processed / total) * 100)) : (job?.status === "success" ? 100 : 0);
      return {
        key: c.key,
        label: c.label,
        Icon: c.icon,
        total,
        processed,
        pct,
        inserted: b.inserted ?? 0,
        updated: b.updated ?? 0,
        skipped: b.skipped ?? 0,
        deleted: b.deleted ?? 0,
        errors: b.errors ?? 0,
      };
    });
  }, [job?.result, job?.status]);

  const filteredLines = useMemo(() => {
    const raw = (job?.log_tail || "").split("\n");
    return raw.filter(ln => {
      if (!ln.trim()) return false;
      if (filter !== "all") {
        // formato: "[HH:MM:SS] categoria: [TAG] ..."
        if (!ln.includes(`] ${filter}:`)) return false;
      }
      if (tagFilter !== "all") {
        if (!ln.includes(`[${tagFilter}]`)) return false;
      }
      return true;
    });
  }, [job?.log_tail, filter, tagFilter]);

  const overallProcessed = Math.round(((job?.progress ?? 0) / 100) * (job?.total_items ?? 0));

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Button asChild variant="ghost" size="sm"><Link to="/sync"><ArrowLeft className="h-4 w-4 mr-1" />Voltar</Link></Button>
          <div>
            <h1 className="text-2xl font-semibold">Sincronização #{jobId.slice(0, 8)}</h1>
            <p className="text-sm text-muted-foreground">Acompanhamento em tempo real</p>
          </div>
        </div>
        <Badge variant="outline" className={meta.color}>
          <Icon className={`h-3.5 w-3.5 mr-1 ${job?.status === "running" ? "animate-spin" : ""}`} />
          {meta.label}
        </Badge>
      </div>

      {err && (
        <div className="flex items-center justify-between gap-3 rounded border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
          <span>{err}</span>
          <Button size="sm" variant="outline" onClick={() => window.location.reload()}>Tentar novamente</Button>
        </div>
      )}

      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base">Progresso geral</CardTitle>
            <div className="text-sm text-muted-foreground">
              {job?.progress ?? 0}% · {overallProcessed}/{job?.total_items ?? 0} itens
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <Progress value={job?.progress ?? 0} />
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
            <Stat label="Inseridos" value={job?.inserted ?? 0} tone="emerald" />
            <Stat label="Ignorados" value={job?.skipped ?? 0} tone="muted" />
            <Stat label="Erros" value={job?.errors ?? 0} tone={job?.errors ? "red" : "muted"} />
            <Stat label="Duração" value={duration(job?.started_at ?? null, job?.finished_at ?? null)} tone="muted" />
          </div>
          <div className="grid grid-cols-2 gap-3 text-xs text-muted-foreground">
            <div>Início: <span className="text-foreground">{fmt(job?.started_at ?? null)}</span></div>
            <div>Fim: <span className="text-foreground">{fmt(job?.finished_at ?? null)}</span></div>
          </div>
        </CardContent>
      </Card>

      {/* Cards por categoria — estilo concorrente */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {breakdown.map(b => {
          const CIcon = b.Icon;
          const isActive = b.total > 0 && b.processed < b.total && job?.status === "running";
          return (
            <Card key={b.key} className={isActive ? "ring-1 ring-primary/40" : ""}>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base flex items-center gap-2">
                    <CIcon className="h-4 w-4 text-primary" />
                    {b.label}
                  </CardTitle>
                  <span className="text-xs text-muted-foreground">{b.pct}%</span>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                <Progress value={b.pct} />
                <div className="text-sm font-medium">Processado {b.processed.toLocaleString()} de {b.total.toLocaleString()}</div>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <MiniStat label="Inseridos" value={b.inserted} color="text-emerald-500" />
                  <MiniStat label="Atualizados" value={b.updated} color="text-blue-500" />
                  <MiniStat label="Ignorados" value={b.skipped} color="text-muted-foreground" />
                  <MiniStat label="Removidos" value={b.deleted} color="text-orange-500" />
                  <MiniStat label="Erros" value={b.errors} color={b.errors ? "text-red-500" : "text-muted-foreground"} />
                </div>
                <Button
                  variant="ghost" size="sm" className="w-full h-8 text-xs"
                  onClick={() => setFilter(f => f === b.key ? "all" : b.key)}
                >
                  {filter === b.key ? "Mostrar todos os logs" : `Ver só logs de ${b.label.toLowerCase()}`}
                </Button>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <Card>
        <CardHeader className="pb-3 flex-row items-center justify-between space-y-0">
          <CardTitle className="text-base">Log ao vivo</CardTitle>
          <div className="flex items-center gap-2 flex-wrap justify-end">
            <div className="flex items-center gap-1 rounded-md border p-0.5">
              {(["all", "INSERIDO", "ATUALIZADO", "IGNORADO", "ERRO"] as const).map(t => (
                <button
                  key={t}
                  onClick={() => setTagFilter(t)}
                  className={`px-2 py-0.5 text-[11px] rounded ${tagFilter === t ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
                >
                  {t === "all" ? "Todos" : t}
                </button>
              ))}
            </div>
            <Button variant="ghost" size="sm" onClick={() => setAutoScroll(v => !v)}>
              <RefreshCw className="h-3.5 w-3.5 mr-1" />{autoScroll ? "Pausar scroll" : "Auto-scroll"}
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <div ref={logRef} className="bg-black/40 rounded p-3 text-xs font-mono max-h-[520px] overflow-auto">
            {filteredLines.length === 0 ? (
              <div className="text-muted-foreground">(sem log ainda)</div>
            ) : filteredLines.map((ln, i) => (
              <div key={i} className={`whitespace-pre-wrap leading-relaxed ${colorizeLine(ln)}`}>{ln}</div>
            ))}
          </div>
          <div className="mt-2 text-[11px] text-muted-foreground">
            Mostrando {filteredLines.length} linhas · buffer limitado às últimas 2000 linhas do job
          </div>
          {job?.error && (
            <div className="mt-3 rounded border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-500">
              <strong>Erro:</strong> {job.error}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: number | string; tone: "emerald" | "red" | "muted" }) {
  const color = tone === "emerald" ? "text-emerald-500" : tone === "red" ? "text-red-500" : "text-foreground";
  return (
    <div className="rounded-lg border bg-card p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={`text-xl font-semibold ${color}`}>{value}</div>
    </div>
  );
}

function MiniStat({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-muted-foreground">{label}</span>
      <span className={`font-semibold ${color}`}>{value.toLocaleString()}</span>
    </div>
  );
}
