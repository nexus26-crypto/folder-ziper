import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { syncApi, type SyncJob } from "@/lib/api/sync";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { ArrowLeft, CheckCircle2, Loader2, XCircle, Clock, RefreshCw } from "lucide-react";

export const Route = createFileRoute("/_authenticated/sync/jobs/$jobId")({
  component: JobDetailPage,
  head: () => ({ meta: [{ title: "Acompanhar sync — VyntrixSync" }] }),
});

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
  const m = Math.floor(s / 60);
  const rs = s % 60;
  return m > 0 ? `${m}m ${rs}s` : `${rs}s`;
}

function JobDetailPage() {
  const { jobId } = Route.useParams();
  const [job, setJob] = useState<SyncJob | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const logRef = useRef<HTMLPreElement>(null);
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
  }, [job?.log_tail, autoScroll]);

  const meta = statusMeta(job?.status ?? "queued");
  const Icon = meta.icon;

  const breakdown = useMemo(() => {
    const r = (job?.result ?? {}) as any;
    const cats = ["canais", "filmes", "series"] as const;
    return cats.map(c => ({
      key: c,
      label: c === "canais" ? "Canais" : c === "filmes" ? "Filmes" : "Séries",
      inserted: r[c]?.inserted ?? 0,
      updated: r[c]?.updated ?? 0,
      skipped: r[c]?.skipped ?? 0,
      deleted: r[c]?.deleted ?? 0,
      errors: r[c]?.errors ?? 0,
    }));
  }, [job?.result]);

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
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
            <CardTitle className="text-base">Progresso</CardTitle>
            <div className="text-sm text-muted-foreground">
               {job?.progress ?? 0}% · {Math.round(((job?.progress ?? 0) / 100) * (job?.total_items ?? 0))}/{job?.total_items ?? 0} itens
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

      <Card>
        <CardHeader className="pb-3"><CardTitle className="text-base">Por categoria</CardTitle></CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-xs text-muted-foreground">
                <tr className="border-b"><th className="text-left py-2">Tipo</th><th className="text-right">Inseridos</th><th className="text-right">Atualizados</th><th className="text-right">Ignorados</th><th className="text-right">Removidos</th><th className="text-right">Erros</th></tr>
              </thead>
              <tbody>
                {breakdown.map(b => (
                  <tr key={b.key} className="border-b last:border-0">
                    <td className="py-2 font-medium">{b.label}</td>
                    <td className="text-right text-emerald-500">{b.inserted}</td>
                    <td className="text-right">{b.updated}</td>
                    <td className="text-right text-muted-foreground">{b.skipped}</td>
                    <td className="text-right">{b.deleted}</td>
                    <td className={`text-right ${b.errors ? "text-red-500" : "text-muted-foreground"}`}>{b.errors}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3 flex-row items-center justify-between space-y-0">
          <CardTitle className="text-base">Log ao vivo</CardTitle>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={() => setAutoScroll(v => !v)}>
              <RefreshCw className="h-3.5 w-3.5 mr-1" />{autoScroll ? "Pausar scroll" : "Auto-scroll"}
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <pre ref={logRef} className="bg-muted/40 rounded p-3 text-xs font-mono max-h-[420px] overflow-auto whitespace-pre-wrap">
{job?.log_tail || "(sem log ainda)"}
          </pre>
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
