import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useAuthStore } from "@/lib/auth-store";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { syncApi, type SyncJob } from "@/lib/api/sync";
import { xuiApi } from "@/lib/api/xui";
import { channelsApi } from "@/lib/api/channels";
import {
  Tv, RefreshCw, Database, Radio, CheckCircle2, XCircle, Loader2, Clock,
  ArrowRight, Plus, Server, Film, Play,
} from "lucide-react";

export const Route = createFileRoute("/_authenticated/dashboard")({
  head: () => ({ meta: [{ title: "Dashboard — VyntrixSync" }] }),
  component: Dashboard,
});

function statusMeta(s: string) {
  switch (s) {
    case "success": return { label: "OK", color: "bg-emerald-500/15 text-emerald-500 border-emerald-500/30", Icon: CheckCircle2 };
    case "failed": return { label: "Falhou", color: "bg-red-500/15 text-red-500 border-red-500/30", Icon: XCircle };
    case "running": return { label: "Rodando", color: "bg-blue-500/15 text-blue-500 border-blue-500/30", Icon: Loader2 };
    default: return { label: "Fila", color: "bg-amber-500/15 text-amber-500 border-amber-500/30", Icon: Clock };
  }
}

function timeAgo(iso: string | null) {
  if (!iso) return "—";
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return `${s}s atrás`;
  if (s < 3600) return `${Math.floor(s / 60)}m atrás`;
  if (s < 86400) return `${Math.floor(s / 3600)}h atrás`;
  return `${Math.floor(s / 86400)}d atrás`;
}

function Dashboard() {
  const user = useAuthStore((s) => s.user);

  const jobsQ = useQuery({
    queryKey: ["dash", "jobs"],
    queryFn: () => syncApi.listJobs(20),
    refetchInterval: 3000,
  });
  const sourcesQ = useQuery({ queryKey: ["dash", "sources"], queryFn: syncApi.listSources });
  const panelsQ = useQuery({ queryKey: ["dash", "panels"], queryFn: xuiApi.list });
  const channelsQ = useQuery({
    queryKey: ["dash", "channels"],
    queryFn: () => channelsApi.list({ limit: 1 }),
  });

  const jobs = jobsQ.data?.items ?? [];
  const running = jobs.filter((j) => j.status === "running" || j.status === "queued");
  const lastSuccess = jobs.find((j) => j.status === "success");
  const failed24h = jobs.filter(
    (j) => j.status === "failed" && j.created_at && Date.now() - new Date(j.created_at).getTime() < 86400_000,
  ).length;

  const totalInserted24h = jobs
    .filter((j) => j.created_at && Date.now() - new Date(j.created_at).getTime() < 86400_000)
    .reduce((sum, j) => sum + (j.inserted || 0), 0);

  const activePanels = (panelsQ.data ?? []).filter((p) => p.last_test_ok).length;
  const totalPanels = panelsQ.data?.length ?? 0;
  const sourcesCount = sourcesQ.data?.length ?? 0;
  const channelsCount = channelsQ.data?.total ?? 0;

  return (
    <div className="p-6 md:p-8 space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">
            Olá, {user?.full_name?.split(" ")[0]}
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Workspace <span className="font-medium text-foreground">{user?.tenant_name}</span>
            <span className="text-muted-foreground/70"> · {user?.tenant_slug}</span>
          </p>
        </div>
        <div className="flex gap-2">
          <Button asChild variant="outline">
            <Link to="/configuracoes"><Server className="h-4 w-4 mr-2" />Painéis</Link>
          </Button>
          <Button asChild>
            <Link to="/sync"><RefreshCw className="h-4 w-4 mr-2" />Nova sincronia</Link>
          </Button>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi
          label="Sincronias ativas"
          value={running.length}
          hint={running.length ? `${running[0].progress}% no atual` : "Nenhuma em execução"}
          Icon={RefreshCw}
          spin={running.length > 0}
        />
        <Kpi
          label="Itens inseridos (24h)"
          value={totalInserted24h.toLocaleString("pt-BR")}
          hint={failed24h ? `${failed24h} falha(s) nas últimas 24h` : "Sem falhas recentes"}
          hintTone={failed24h ? "red" : "muted"}
          Icon={Film}
        />
        <Kpi
          label="Canais no catálogo"
          value={channelsCount.toLocaleString("pt-BR")}
          hint={`${sourcesCount} fonte(s) configurada(s)`}
          Icon={Tv}
        />
        <Kpi
          label="Painéis conectados"
          value={`${activePanels}/${totalPanels || "—"}`}
          hint={totalPanels === 0 ? "Cadastre um painel" : activePanels === totalPanels ? "Todos operacionais" : "Alguns com erro"}
          hintTone={totalPanels > 0 && activePanels < totalPanels ? "red" : "muted"}
          Icon={Database}
        />
      </div>

      {/* Onboarding: aparece só quando falta configuração */}
      {(totalPanels === 0 || sourcesCount === 0) && (
        <Card className="border-primary/40 bg-primary/5">
          <CardHeader>
            <CardTitle className="text-base">Primeiros passos</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <Step
              done={totalPanels > 0}
              title="Conectar um painel Xtream / XUI"
              description="Adicione host, porta e credenciais do MySQL do seu painel."
              to="/configuracoes"
              cta="Adicionar painel"
            />
            <Step
              done={sourcesCount > 0}
              title="Cadastrar uma fonte M3U"
              description="URL M3U, arquivo ou API Xtream que será importada."
              to="/sync"
              cta="Nova fonte"
            />
            <Step
              done={jobs.some((j) => j.status === "success")}
              title="Disparar a primeira sincronia"
              description="Importe canais, filmes e séries e acompanhe em tempo real."
              to="/sync"
              cta="Sincronizar"
            />
          </CardContent>
        </Card>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        {/* Sincronias em andamento */}
        <Card className="lg:col-span-2">
          <CardHeader className="flex flex-row items-center justify-between pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Radio className="h-4 w-4 text-primary" />
              Sincronias em andamento
            </CardTitle>
            <Button asChild variant="ghost" size="sm">
              <Link to="/sync">Ver todas <ArrowRight className="h-3.5 w-3.5 ml-1" /></Link>
            </Button>
          </CardHeader>
          <CardContent className="space-y-3">
            {running.length === 0 ? (
              <div className="text-sm text-muted-foreground py-8 text-center border border-dashed rounded-lg">
                Nenhuma sincronia em execução no momento.
              </div>
            ) : (
              running.map((j) => <RunningJob key={j.id} job={j} />)
            )}
          </CardContent>
        </Card>

        {/* Última sincronia bem sucedida */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-emerald-500" />
              Última importação
            </CardTitle>
          </CardHeader>
          <CardContent>
            {!lastSuccess ? (
              <div className="text-sm text-muted-foreground py-4">
                Nenhuma sincronia concluída ainda.
              </div>
            ) : (
              <div className="space-y-3">
                <div className="text-xs text-muted-foreground">
                  {timeAgo(lastSuccess.finished_at ?? lastSuccess.created_at)}
                </div>
                <div className="grid grid-cols-2 gap-2 text-sm">
                  <MiniStat label="Inseridos" value={lastSuccess.inserted} tone="emerald" />
                  <MiniStat label="Ignorados" value={lastSuccess.skipped} tone="muted" />
                  <MiniStat label="Total" value={lastSuccess.total_items} tone="muted" />
                  <MiniStat label="Erros" value={lastSuccess.errors} tone={lastSuccess.errors ? "red" : "muted"} />
                </div>
                <Button asChild variant="outline" size="sm" className="w-full">
                  <Link to="/sync/jobs/$jobId" params={{ jobId: lastSuccess.id }}>
                    <Play className="h-3.5 w-3.5 mr-1" />Ver detalhes
                  </Link>
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Histórico recente */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-3">
          <CardTitle className="text-base">Histórico recente</CardTitle>
          <Button asChild variant="ghost" size="sm">
            <Link to="/sync">Abrir Sync <ArrowRight className="h-3.5 w-3.5 ml-1" /></Link>
          </Button>
        </CardHeader>
        <CardContent>
          {jobs.length === 0 ? (
            <div className="text-sm text-muted-foreground py-8 text-center border border-dashed rounded-lg">
              Nenhuma sincronia registrada. <Link to="/sync" className="text-primary underline">Criar a primeira</Link>.
            </div>
          ) : (
            <div className="divide-y">
              {jobs.slice(0, 8).map((j) => {
                const m = statusMeta(j.status);
                return (
                  <Link
                    key={j.id}
                    to="/sync/jobs/$jobId"
                    params={{ jobId: j.id }}
                    className="flex items-center justify-between py-3 hover:bg-muted/30 rounded px-2 -mx-2 transition-colors"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <Badge variant="outline" className={m.color}>
                        <m.Icon className={`h-3 w-3 mr-1 ${j.status === "running" ? "animate-spin" : ""}`} />
                        {m.label}
                      </Badge>
                      <div className="min-w-0">
                        <div className="text-sm font-mono truncate">#{j.id.slice(0, 8)}</div>
                        <div className="text-xs text-muted-foreground">{timeAgo(j.created_at)}</div>
                      </div>
                    </div>
                    <div className="hidden sm:flex items-center gap-4 text-xs text-muted-foreground">
                      <span><span className="text-emerald-500 font-medium">{j.inserted}</span> inseridos</span>
                      <span>{j.total_items} total</span>
                      {j.errors > 0 && <span className="text-red-500">{j.errors} erros</span>}
                    </div>
                  </Link>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Kpi({
  label, value, hint, hintTone = "muted", Icon, spin,
}: {
  label: string; value: string | number; hint?: string;
  hintTone?: "muted" | "red";
  Icon: React.ComponentType<{ className?: string }>;
  spin?: boolean;
}) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
        <CardTitle className="text-xs uppercase tracking-wide text-muted-foreground font-medium">
          {label}
        </CardTitle>
        <Icon className={`h-4 w-4 text-muted-foreground ${spin ? "animate-spin" : ""}`} />
      </CardHeader>
      <CardContent>
        <div className="text-3xl font-semibold tabular-nums">{value}</div>
        {hint && (
          <div className={`text-xs mt-1 ${hintTone === "red" ? "text-red-500" : "text-muted-foreground"}`}>
            {hint}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function RunningJob({ job }: { job: SyncJob }) {
  return (
    <Link
      to="/sync/jobs/$jobId"
      params={{ jobId: job.id }}
      className="block rounded-lg border p-3 hover:border-primary/50 transition-colors"
    >
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2 text-sm">
          <Loader2 className="h-3.5 w-3.5 animate-spin text-blue-500" />
          <span className="font-mono">#{job.id.slice(0, 8)}</span>
          <span className="text-muted-foreground text-xs">iniciado {timeAgo(job.started_at ?? job.created_at)}</span>
        </div>
        <span className="text-sm font-medium tabular-nums">{job.progress}%</span>
      </div>
      <Progress value={job.progress} className="h-1.5" />
      <div className="flex gap-4 text-xs text-muted-foreground mt-2">
        <span><span className="text-emerald-500">{job.inserted}</span> inseridos</span>
        <span>{job.total_items} total</span>
        {job.errors > 0 && <span className="text-red-500">{job.errors} erros</span>}
      </div>
    </Link>
  );
}

function MiniStat({ label, value, tone }: { label: string; value: number; tone: "emerald" | "red" | "muted" }) {
  const color = tone === "emerald" ? "text-emerald-500" : tone === "red" ? "text-red-500" : "text-foreground";
  return (
    <div className="rounded border bg-muted/30 p-2">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className={`text-lg font-semibold tabular-nums ${color}`}>{value}</div>
    </div>
  );
}

function Step({
  done, title, description, to, cta,
}: {
  done: boolean; title: string; description: string; to: string; cta: string;
}) {
  return (
    <div className="flex items-start gap-3 rounded-lg border bg-card p-3">
      <div className={`mt-0.5 h-5 w-5 rounded-full flex items-center justify-center shrink-0 ${
        done ? "bg-emerald-500/20 text-emerald-500" : "bg-muted text-muted-foreground"
      }`}>
        {done ? <CheckCircle2 className="h-4 w-4" /> : <Plus className="h-3 w-3" />}
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium">{title}</div>
        <div className="text-xs text-muted-foreground">{description}</div>
      </div>
      {!done && (
        <Button asChild size="sm" variant="outline">
          <Link to={to}>{cta}</Link>
        </Button>
      )}
    </div>
  );
}
