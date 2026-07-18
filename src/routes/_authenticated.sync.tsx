import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useRef, useState, useCallback } from "react";
import { toast } from "sonner";
import { syncApi, type XtreamSource, type SyncJob, type SourceType, type CreateSourceBody } from "@/lib/api/sync";
import { xuiApi, type XuiConnection, type XuiMeta } from "@/lib/api/xui";
import { ApiError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import {
  RefreshCw, Plus, Play, Trash2, Settings2, FileText, ArrowLeft, ArrowRight,
  Rocket, Check, Link as LinkIcon, Upload, Radio, Film, Tv, Zap, Copy,
} from "lucide-react";

export const Route = createFileRoute("/_authenticated/sync")({
  head: () => ({ meta: [{ title: "Sync — VyntrixSync" }] }),
  component: SyncPage,
});

const statusColor: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  success: "default", queued: "secondary", pending: "secondary",
  running: "outline", failed: "destructive",
};

type SyncMode = "insert_only" | "insert_update" | "delete_all" | "mirror";

type Mapping = {
  bouquets_canais: number[];
  bouquets_filmes: number[];
  bouquets_series: number[];
  server_id: number;
  criar_categorias: boolean;
  mode_canais: SyncMode;
  mode_filmes: SyncMode;
  mode_series: SyncMode;
  usar_tmdb: boolean;
  tmdb_api_key: string;
  tmdb_language: string;
  skip_tmdb_existing: boolean;
  dedup_by_full_url: boolean;
  dedup_by_url_only: boolean;
  delete_dupes_before: boolean;
  remove_orphans: boolean;
  live: Record<string, number>;
  movie: Record<string, number>;
  series: Record<string, number>;
};

const defaultMapping = (): Mapping => ({
  bouquets_canais: [], bouquets_filmes: [], bouquets_series: [],
  server_id: 0, criar_categorias: true,
  mode_canais: "insert_only", mode_filmes: "insert_only", mode_series: "insert_only",
  usar_tmdb: false, tmdb_api_key: "", tmdb_language: "pt-BR",
  skip_tmdb_existing: false, dedup_by_full_url: false, dedup_by_url_only: false,
  delete_dupes_before: false, remove_orphans: false,
  live: {}, movie: {}, series: {},
});

function SyncPage() {
  const [sources, setSources] = useState<XtreamSource[]>([]);
  const [jobs, setJobs] = useState<SyncJob[]>([]);
  const [xuis, setXuis] = useState<XuiConnection[]>([]);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [editingSource, setEditingSource] = useState<XtreamSource | null>(null);
  const [logSheet, setLogSheet] = useState<SyncJob | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const loadAll = useCallback(async () => {
    try {
      const [s, j, x] = await Promise.all([syncApi.listSources(), syncApi.listJobs(), xuiApi.list()]);
      setSources(s); setJobs(j.items); setXuis(x);
    } catch (e) { toast.error(e instanceof ApiError ? e.message : "Erro ao carregar"); }
  }, []);

  useEffect(() => { loadAll(); }, [loadAll]);

  useEffect(() => {
    const hasPending = jobs.some(j => ["queued", "pending", "running"].includes(j.status));
    if (!hasPending) return;
    timer.current = setInterval(loadAll, 2000);
    return () => { if (timer.current) clearInterval(timer.current); };
  }, [jobs, loadAll]);

  async function trigger(id: string) {
    try { await syncApi.trigger(id); toast.success("Sincronização enfileirada"); await loadAll(); }
    catch (e) { toast.error(e instanceof ApiError ? e.message : "Erro"); }
  }
  async function deleteSource(id: string) {
    if (!confirm("Remover essa fonte?")) return;
    try { await syncApi.deleteSource(id); toast.success("Removida"); await loadAll(); }
    catch (e) { toast.error(e instanceof ApiError ? e.message : "Erro"); }
  }
  function openEdit(s: XtreamSource) { setEditingSource(s); setWizardOpen(true); }
  function openNew() { setEditingSource(null); setWizardOpen(true); }

  return (
    <div className="p-6 md:p-8 space-y-6 max-w-7xl mx-auto">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Sync</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Importa canais, filmes e séries de M3U ou API Xtream direto no seu painel Xtream Codes / XUI ONE.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" asChild><Link to="/configuracoes">Painéis Xtream/XUI</Link></Button>
          <Button onClick={openNew}><Plus className="h-4 w-4 mr-2" />Nova sincronia</Button>
        </div>
      </div>

      {xuis.length === 0 && (
        <Card className="border-yellow-500/40 bg-yellow-500/5">
          <CardContent className="py-4 text-sm">
            Você ainda não cadastrou nenhum painel de destino (Xtream Codes ou XUI ONE).{" "}
            <Link to="/configuracoes" className="underline font-medium">Cadastrar agora</Link>

          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader><CardTitle className="text-base">Fontes cadastradas</CardTitle></CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nome</TableHead><TableHead>Tipo</TableHead>
                <TableHead>Painel destino</TableHead><TableHead>Auto</TableHead>
                <TableHead>Última sync</TableHead><TableHead className="w-56" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {sources.length === 0 ? (
                <TableRow><TableCell colSpan={6} className="text-center py-10 text-muted-foreground">
                  Nenhuma fonte. Clique em <strong>Nova sincronia</strong> pra começar.
                </TableCell></TableRow>
              ) : sources.map(s => {
                const xui = xuis.find(x => x.id === s.xui_connection_id);
                return (
                  <TableRow key={s.id}>
                    <TableCell className="font-medium">{s.name}</TableCell>
                    <TableCell><Badge variant="outline">{s.source_type}</Badge></TableCell>
                    <TableCell className="text-sm text-muted-foreground">{xui?.name ?? "— padrão —"}</TableCell>
                    <TableCell>{s.auto_sync ? <Badge>{s.auto_sync_cron || "cron"}</Badge> : <span className="text-muted-foreground">off</span>}</TableCell>
                    <TableCell className="text-muted-foreground text-sm">{s.last_sync_at ? new Date(s.last_sync_at).toLocaleString("pt-BR") : "—"}</TableCell>
                    <TableCell className="text-right space-x-1">
                      <Button size="sm" variant="ghost" onClick={() => openEdit(s)} title="Configurar"><Settings2 className="h-4 w-4" /></Button>
                      <Button size="sm" onClick={() => trigger(s.id)}><Play className="h-3 w-3 mr-1" />Sync</Button>
                      <Button size="icon" variant="ghost" onClick={() => deleteSource(s.id)}><Trash2 className="h-4 w-4 text-destructive" /></Button>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base">Jobs recentes</CardTitle>
          <Button size="sm" variant="ghost" onClick={loadAll}><RefreshCw className="h-4 w-4" /></Button>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Tipo</TableHead><TableHead>Status</TableHead>
                <TableHead>Prog.</TableHead><TableHead>Inseridos</TableHead>
                <TableHead>Ignorados</TableHead><TableHead>Erros</TableHead>
                <TableHead>Criado</TableHead><TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {jobs.length === 0 ? (
                <TableRow><TableCell colSpan={8} className="text-center py-8 text-muted-foreground">Sem jobs.</TableCell></TableRow>
              ) : jobs.map(j => (
                <TableRow key={j.id}>
                  <TableCell className="font-medium">{j.job_type}</TableCell>
                  <TableCell><Badge variant={statusColor[j.status] ?? "outline"}>{j.status}</Badge></TableCell>
                  <TableCell>{j.progress}%</TableCell>
                  <TableCell className="text-green-600">{j.inserted}</TableCell>
                  <TableCell className="text-muted-foreground">{j.skipped}</TableCell>
                  <TableCell className={j.errors ? "text-destructive" : "text-muted-foreground"}>{j.errors}</TableCell>
                  <TableCell className="text-muted-foreground text-sm">{new Date(j.created_at).toLocaleString("pt-BR")}</TableCell>
                  <TableCell><Button size="sm" variant="ghost" onClick={() => setLogSheet(j)}><FileText className="h-4 w-4" /></Button></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <SyncWizard
        open={wizardOpen} onOpenChange={setWizardOpen}
        xuis={xuis} source={editingSource} onDone={loadAll}
      />
      {logSheet && <JobLogSheet job={logSheet} onOpenChange={o => !o && setLogSheet(null)} />}
    </div>
  );
}

// ============================================================
// WIZARD (5 passos, estilo SyncVods)
// ============================================================

type WizardStep = 1 | 2 | 3 | 4 | 5;
type MethodChoice = "xtream_api" | "m3u_url" | "m3u_file";

function SyncWizard({ open, onOpenChange, xuis, source, onDone }: {
  open: boolean; onOpenChange: (o: boolean) => void;
  xuis: XuiConnection[]; source: XtreamSource | null; onDone: () => void;
}) {
  const [step, setStep] = useState<WizardStep>(1);
  const [method, setMethod] = useState<MethodChoice>("m3u_url");
  const [name, setName] = useState("");
  const [xuiId, setXuiId] = useState("");
  const [host, setHost] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [m3uUrl, setM3uUrl] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [mapping, setMapping] = useState<Mapping>(defaultMapping());
  const [autoSync, setAutoSync] = useState(false);
  const [cron, setCron] = useState("0 3 * * *");
  const [meta, setMeta] = useState<XuiMeta | null>(null);
  const [loadingMeta, setLoadingMeta] = useState(false);
  const [saving, setSaving] = useState(false);
  const [createdSourceId, setCreatedSourceId] = useState<string | null>(null);
  const [createdJobId, setCreatedJobId] = useState<string | null>(null);

  // reset on open change / source change
  useEffect(() => {
    if (!open) return;
    if (source) {
      setStep(3); // vai direto pro mapeamento pra editar
      setName(source.name);
      setXuiId(source.xui_connection_id ?? xuis.find(x => x.is_default)?.id ?? "");
      setMethod(source.source_type as MethodChoice);
      setHost(source.host ?? "");
      setUsername(source.username ?? "");
      setM3uUrl(source.m3u_url ?? "");
      setAutoSync(source.auto_sync);
      setCron(source.auto_sync_cron ?? "0 3 * * *");
      const m = { ...defaultMapping(), ...(source.mapping || {}) } as Mapping;
      // legacy single-bouquet → array
      const legacy = source.mapping as any;
      if (legacy?.bouquet_canais && !m.bouquets_canais?.length) m.bouquets_canais = [Number(legacy.bouquet_canais)];
      if (legacy?.bouquet_filmes && !m.bouquets_filmes?.length) m.bouquets_filmes = [Number(legacy.bouquet_filmes)];
      if (legacy?.bouquet_series && !m.bouquets_series?.length) m.bouquets_series = [Number(legacy.bouquet_series)];
      setMapping(m);
    } else {
      setStep(1); setName(""); setXuiId(xuis.find(x => x.is_default)?.id ?? "");
      setHost(""); setUsername(""); setPassword(""); setM3uUrl(""); setFile(null);
      setAutoSync(false); setCron("0 3 * * *");
      setMapping(defaultMapping());
      setCreatedSourceId(null); setCreatedJobId(null);
    }
  }, [open, source, xuis]);

  // fetch XUI meta ao chegar no step 3+
  useEffect(() => {
    if (!open || !xuiId || step < 3) return;
    setLoadingMeta(true);
    xuiApi.meta(xuiId).then(setMeta)
      .catch(e => toast.error(e instanceof ApiError ? e.message : "Erro ao ler XUI"))
      .finally(() => setLoadingMeta(false));
  }, [open, xuiId, step]);

  const canNext = (): boolean => {
    if (step === 1) return method !== undefined;
    if (step === 2) {
      if (!name.trim()) return false;
      if (!xuiId) return false;
      if (method === "xtream_api") return !!(host && username && password);
      if (method === "m3u_url") return !!m3uUrl;
      if (method === "m3u_file") return !!(file || source);
      return false;
    }
    if (step === 3) return true;
    if (step === 4) return true;
    return true;
  };

  async function saveAndMaybeTrigger(triggerNow: boolean) {
    setSaving(true);
    try {
      let sid = source?.id ?? createdSourceId;
      const body: Partial<CreateSourceBody> = {
        name, xui_connection_id: xuiId || null,
        mapping, auto_sync: autoSync, auto_sync_cron: autoSync ? cron : null,
      };
      if (!sid) {
        if (method === "m3u_file") {
          if (!file) throw new Error("Selecione o arquivo M3U");
          const created = await syncApi.uploadM3u(name, file, xuiId || undefined);
          sid = created.id;
          await syncApi.updateSource(sid, { mapping, auto_sync: autoSync, auto_sync_cron: autoSync ? cron : null });
        } else {
          const createBody: CreateSourceBody = {
            name, source_type: method,
            xui_connection_id: xuiId || null,
            mapping, auto_sync: autoSync, auto_sync_cron: autoSync ? cron : null,
          };
          if (method === "xtream_api") { createBody.host = host; createBody.username = username; createBody.password = password; createBody.kind = "all"; }
          if (method === "m3u_url") createBody.m3u_url = m3uUrl;
          const created = await syncApi.createSource(createBody);
          sid = created.id;
        }
        setCreatedSourceId(sid);
      } else {
        const updateBody: Partial<CreateSourceBody> = { ...body };
        if (method === "xtream_api") { updateBody.host = host; updateBody.username = username; if (password) updateBody.password = password; }
        if (method === "m3u_url") updateBody.m3u_url = m3uUrl;
        await syncApi.updateSource(sid, updateBody);
      }
      if (triggerNow && sid) {
        const job = await syncApi.trigger(sid);
        setCreatedJobId(job.id);
      }
      onDone();
      return true;
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : (e as Error).message || "Erro ao salvar");
      return false;
    } finally { setSaving(false); }
  }

  async function handleFinish() {
    const ok = await saveAndMaybeTrigger(true);
    if (ok) setStep(5);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Rocket className="h-5 w-5 text-primary" />
            {source ? "Editar sincronia" : "Nova sincronia"}
          </DialogTitle>
          <DialogDescription>Passo {step} de 5</DialogDescription>
        </DialogHeader>

        <Stepper current={step} />

        <div className="py-4 min-h-[300px]">
          {step === 1 && <Step1Method method={method} setMethod={setMethod} />}
          {step === 2 && (
            <Step2Source
              method={method} name={name} setName={setName}
              xuiId={xuiId} setXuiId={setXuiId} xuis={xuis}
              host={host} setHost={setHost}
              username={username} setUsername={setUsername}
              password={password} setPassword={setPassword}
              m3uUrl={m3uUrl} setM3uUrl={setM3uUrl}
              file={file} setFile={setFile}
              isEditing={!!source}
            />
          )}
          {step === 3 && (
            <Step3Mapping mapping={mapping} setMapping={setMapping}
              meta={meta} loading={loadingMeta} />
          )}
          {step === 4 && (
            <Step4Review name={name} method={method} m3uUrl={m3uUrl} host={host}
              xui={xuis.find(x => x.id === xuiId) ?? null}
              mapping={mapping} autoSync={autoSync} setAutoSync={setAutoSync}
              cron={cron} setCron={setCron} />
          )}
          {step === 5 && (
            <Step5Done sourceId={createdSourceId ?? source?.id ?? ""} jobId={createdJobId} onClose={() => onOpenChange(false)} />
          )}
        </div>

        {step < 5 && (
          <DialogFooter className="gap-2 sm:justify-between">
            <div>
              {step > 1 && (
                <Button variant="ghost" onClick={() => setStep((s) => (s - 1) as WizardStep)} disabled={saving}>
                  <ArrowLeft className="h-4 w-4 mr-1" />Voltar
                </Button>
              )}
            </div>
            <div className="flex gap-2">
              <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={saving}>Cancelar</Button>
              {step < 4 && (
                <Button onClick={() => setStep((s) => (s + 1) as WizardStep)} disabled={!canNext() || saving}>
                  Próximo<ArrowRight className="h-4 w-4 ml-1" />
                </Button>
              )}
              {step === 4 && (
                <Button onClick={handleFinish} disabled={saving}>
                  {saving ? "Executando…" : <><Zap className="h-4 w-4 mr-1" />Começar sincronia</>}
                </Button>
              )}
            </div>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}

function Stepper({ current }: { current: WizardStep }) {
  const steps = [
    { n: 1, label: "Método" }, { n: 2, label: "Origem" },
    { n: 3, label: "Mapeamento" }, { n: 4, label: "Revisão" },
    { n: 5, label: "Pronto" },
  ];
  return (
    <div className="flex items-center justify-between gap-2 border-y py-3">
      {steps.map((s, i) => (
        <div key={s.n} className="flex items-center gap-2 flex-1">
          <div className={`h-7 w-7 shrink-0 rounded-full flex items-center justify-center text-xs font-medium border ${
            current === s.n ? "bg-primary text-primary-foreground border-primary"
            : current > s.n ? "bg-primary/10 text-primary border-primary/40"
            : "bg-muted text-muted-foreground border-border"
          }`}>{current > s.n ? <Check className="h-3.5 w-3.5" /> : s.n}</div>
          <span className={`text-xs font-medium hidden sm:inline ${current === s.n ? "" : "text-muted-foreground"}`}>{s.label}</span>
          {i < steps.length - 1 && <div className="flex-1 h-px bg-border" />}
        </div>
      ))}
    </div>
  );
}

// ---------- Step 1: método ----------
function Step1Method({ method, setMethod }: { method: MethodChoice; setMethod: (m: MethodChoice) => void }) {
  const opts = [
    { id: "m3u_url" as const, icon: LinkIcon, title: "M3U por URL", desc: "Cola a URL da lista M3U (com usuário/senha ou link direto)",
      tags: ["Mais confiável", "Auto-sync", "TMDB"] },
    { id: "xtream_api" as const, icon: Radio, title: "API Xtream", desc: "Usa player_api.php de outro painel — puxa canais/filmes",
      tags: ["Mais rápido", "Sem parse M3U", "Auto-sync"] },
    { id: "m3u_file" as const, icon: Upload, title: "Upload de arquivo M3U", desc: "Envia um arquivo .m3u/.m3u8 do computador",
      tags: ["Sem auto-sync", "Requer re-upload"] },
  ];
  return (
    <div className="space-y-3">
      <h3 className="font-semibold text-lg">Como deseja informar a lista?</h3>
      <p className="text-sm text-muted-foreground">Cada método tem prós e contras. Escolha o que se encaixa melhor.</p>
      <div className="space-y-3 mt-2">
        {opts.map(o => (
          <button key={o.id} onClick={() => setMethod(o.id)}
            className={`w-full text-left p-4 rounded-lg border-2 transition ${
              method === o.id ? "border-primary bg-primary/5" : "border-border hover:border-primary/40"
            }`}>
            <div className="flex items-start gap-3">
              <div className={`h-10 w-10 rounded-lg flex items-center justify-center ${
                method === o.id ? "bg-primary text-primary-foreground" : "bg-muted"
              }`}><o.icon className="h-5 w-5" /></div>
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <span className="font-medium">{o.title}</span>
                  {method === o.id && <Check className="h-4 w-4 text-primary" />}
                </div>
                <p className="text-sm text-muted-foreground mt-0.5">{o.desc}</p>
                <div className="flex gap-1.5 flex-wrap mt-2">
                  {o.tags.map(t => <Badge key={t} variant="secondary" className="text-[10px]">{t}</Badge>)}
                </div>
              </div>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

// ---------- Step 2: origem ----------
function Step2Source(props: {
  method: MethodChoice; name: string; setName: (v: string) => void;
  xuiId: string; setXuiId: (v: string) => void; xuis: XuiConnection[];
  host: string; setHost: (v: string) => void;
  username: string; setUsername: (v: string) => void;
  password: string; setPassword: (v: string) => void;
  m3uUrl: string; setM3uUrl: (v: string) => void;
  file: File | null; setFile: (v: File | null) => void;
  isEditing: boolean;
}) {
  const { method, name, setName, xuiId, setXuiId, xuis } = props;
  return (
    <div className="space-y-4">
      <h3 className="font-semibold text-lg">Detalhes da origem</h3>
      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-1">
          <Label>Nome da sincronia *</Label>
          <Input value={name} onChange={e => setName(e.target.value)} placeholder="Ex.: Painel Principal" />
        </div>
        <div className="space-y-1">
          <Label>Painel de destino *</Label>
          <Select value={xuiId} onValueChange={setXuiId}>
            <SelectTrigger><SelectValue placeholder="Selecione…" /></SelectTrigger>
            <SelectContent>
              {xuis.map(x => <SelectItem key={x.id} value={x.id}>{x.name}{x.is_default ? " (default)" : ""}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </div>

      {method === "xtream_api" && (
        <div className="space-y-3 pt-2 border-t">
          <div className="space-y-1">
            <Label>Host *</Label>
            <Input value={props.host} onChange={e => props.setHost(e.target.value)} placeholder="http://painel.exemplo.com:80" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1"><Label>Usuário *</Label><Input value={props.username} onChange={e => props.setUsername(e.target.value)} /></div>
            <div className="space-y-1"><Label>Senha {props.isEditing && <span className="text-xs text-muted-foreground">(deixe vazio pra manter)</span>}</Label><Input type="password" value={props.password} onChange={e => props.setPassword(e.target.value)} /></div>
          </div>
        </div>
      )}
      {method === "m3u_url" && (
        <div className="space-y-1 pt-2 border-t">
          <Label>URL da lista M3U *</Label>
          <Input value={props.m3uUrl} onChange={e => props.setM3uUrl(e.target.value)}
            placeholder="http://dns.com/get.php?username=X&password=Y&type=m3u_plus" />
          <p className="text-xs text-muted-foreground">
            Formatos suportados: <code>get.php?username=…&amp;password=…</code> ou <code>/playlist/user/pass/m3u_plus</code>
          </p>
        </div>
      )}
      {method === "m3u_file" && (
        <div className="space-y-1 pt-2 border-t">
          <Label>Arquivo M3U {props.isEditing && <span className="text-xs text-muted-foreground">(mantém o anterior se vazio)</span>}</Label>
          <Input type="file" accept=".m3u,.m3u8,text/plain" onChange={e => props.setFile(e.target.files?.[0] ?? null)} />
          {props.file && <p className="text-xs text-muted-foreground">{props.file.name} — {(props.file.size / 1024).toFixed(1)} KB</p>}
        </div>
      )}
    </div>
  );
}

// ---------- Step 3: mapping ----------
function Step3Mapping({ mapping, setMapping, meta, loading }: {
  mapping: Mapping; setMapping: (m: Mapping) => void;
  meta: XuiMeta | null; loading: boolean;
}) {
  const update = <K extends keyof Mapping>(k: K, v: Mapping[K]) => setMapping({ ...mapping, [k]: v });
  const toggleBouquet = (kind: "canais" | "filmes" | "series", id: number) => {
    const key = `bouquets_${kind}` as const;
    const list = mapping[key];
    const next = list.includes(id) ? list.filter(x => x !== id) : [...list, id];
    setMapping({ ...mapping, [key]: next });
  };

  if (loading) return <div className="py-8 text-center text-sm text-muted-foreground">Consultando painel Xtream/XUI…</div>;
  if (!meta) return <div className="py-8 text-center text-sm text-muted-foreground">Selecione um painel de destino válido antes.</div>;


  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-lg">Mapeamento e regras</h3>
        <Badge variant="outline" className="text-[10px]">{meta.version}</Badge>
      </div>

      <SectionCard icon={Radio} title="Canais">
        <ModeSelect value={mapping.mode_canais} onChange={v => update("mode_canais", v)} />
        <MultiBouquet label="Adicionar aos bouquets" items={meta.bouquets}
          selected={mapping.bouquets_canais} onToggle={id => toggleBouquet("canais", id)} />
      </SectionCard>

      <SectionCard icon={Film} title="Filmes">
        <ModeSelect value={mapping.mode_filmes} onChange={v => update("mode_filmes", v)} />
        <MultiBouquet label="Adicionar aos bouquets" items={meta.bouquets}
          selected={mapping.bouquets_filmes} onToggle={id => toggleBouquet("filmes", id)} />
      </SectionCard>

      <SectionCard icon={Tv} title="Séries">
        <ModeSelect value={mapping.mode_series} onChange={v => update("mode_series", v)} />
        <MultiBouquet label="Adicionar aos bouquets" items={meta.bouquets}
          selected={mapping.bouquets_series} onToggle={id => toggleBouquet("series", id)} />
      </SectionCard>

      <SectionCard title="Servidor de streaming">
        <Select value={String(mapping.server_id)} onValueChange={v => update("server_id", Number(v))}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            {meta.servers.map(s => <SelectItem key={s.id} value={String(s.id)}>{s.nome}</SelectItem>)}
          </SelectContent>
        </Select>
      </SectionCard>

      <SectionCard title="TMDB (filmes e séries)">
        <ToggleRow label="Enriquecer com TMDB" desc="Busca capa, sinopse e gênero."
          checked={mapping.usar_tmdb} onChange={v => update("usar_tmdb", v)} />
        {mapping.usar_tmdb && (
          <>
            <div className="space-y-1">
              <Label>Idioma</Label>
              <Input value={mapping.tmdb_language} onChange={e => update("tmdb_language", e.target.value)} placeholder="pt-BR" />
            </div>
            <div className="space-y-1">
              <Label>API Key <span className="text-xs text-muted-foreground">(opcional — usa TMDB_API_KEY do servidor)</span></Label>
              <Input value={mapping.tmdb_api_key} onChange={e => update("tmdb_api_key", e.target.value)} placeholder="v3 auth (32 chars)" />
            </div>
            <ToggleRow label="Pular filme com TMDB ID existente" desc="Se já existe outro filme com o mesmo TMDB ID, não insere/atualiza."
              checked={mapping.skip_tmdb_existing} onChange={v => update("skip_tmdb_existing", v)} />
          </>
        )}
      </SectionCard>

      <SectionCard title="Duplicatas e órfãos (avançado)">
        <ToggleRow label="Criar categorias automaticamente" desc="Se a categoria não existir no painel, é criada com o mesmo nome."
          checked={mapping.criar_categorias} onChange={v => update("criar_categorias", v)} />
        <ToggleRow label="Dedup por URL da fonte (ignora título)"
          desc="Útil se o mesmo filme aparece com nomes diferentes mas mesma URL."
          checked={mapping.dedup_by_url_only} onChange={v => update("dedup_by_url_only", v)} />
        <ToggleRow label="Dedup pela URL completa"
          desc="Compara URL inteira (útil pra separar conteúdo próprio de alugado)."
          checked={mapping.dedup_by_full_url} onChange={v => update("dedup_by_full_url", v)} />
        <ToggleRow label="Deletar duplicatas antes de sincronizar"
          desc="Remove filmes/canais no destino com nome idêntico ao da nova lista antes de inserir."
          checked={mapping.delete_dupes_before} onChange={v => update("delete_dupes_before", v)} />
        <ToggleRow label="Remover órfãos ao final"
          desc="Deleta itens do destino que não estão na fonte. (Automático no modo Espelhar.)"
          checked={mapping.remove_orphans} onChange={v => update("remove_orphans", v)} />
      </SectionCard>
    </div>
  );
}

function SectionCard({ title, icon: Icon, children }: { title: string; icon?: any; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border p-4 space-y-3">
      <div className="flex items-center gap-2 font-medium text-sm">
        {Icon && <Icon className="h-4 w-4 text-primary" />}{title}
      </div>
      {children}
    </div>
  );
}

function ToggleRow({ label, desc, checked, onChange }: {
  label: string; desc?: string; checked: boolean; onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-start justify-between gap-4 py-1">
      <div className="min-w-0">
        <p className="text-sm font-medium">{label}</p>
        {desc && <p className="text-xs text-muted-foreground mt-0.5">{desc}</p>}
      </div>
      <Switch checked={checked} onCheckedChange={onChange} />
    </div>
  );
}

function ModeSelect({ value, onChange }: { value: SyncMode; onChange: (v: SyncMode) => void }) {
  const modes: { id: SyncMode; label: string; desc: string; danger?: boolean }[] = [
    { id: "insert_only", label: "Inserir, não atualizar", desc: "Recomendado. Só cria se não existir." },
    { id: "insert_update", label: "Inserir e atualizar", desc: "Cria novos e atualiza existentes (nome, capa, URL) — não muda categoria." },
    { id: "delete_all", label: "Excluir tudo e recriar", desc: "Apaga TODOS os itens do tipo antes de sincronizar.", danger: true },
    { id: "mirror", label: "Espelhar origem", desc: "Insere/atualiza e REMOVE órfãos ao final. Cria uma cópia exata da fonte.", danger: true },
  ];
  return (
    <div className="space-y-1.5">
      <Label>Modo de operação</Label>
      <div className="grid gap-2 sm:grid-cols-2">
        {modes.map(m => (
          <button key={m.id} onClick={() => onChange(m.id)}
            className={`text-left p-3 rounded-md border-2 transition ${
              value === m.id
                ? m.danger ? "border-destructive bg-destructive/5" : "border-primary bg-primary/5"
                : "border-border hover:border-primary/40"
            }`}>
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">{m.label}</span>
              {value === m.id && <Check className="h-4 w-4" />}
            </div>
            <p className="text-xs text-muted-foreground mt-1">{m.desc}</p>
          </button>
        ))}
      </div>
    </div>
  );
}

function MultiBouquet({ label, items, selected, onToggle }: {
  label: string; items: { id: number; nome: string }[];
  selected: number[]; onToggle: (id: number) => void;
}) {
  return (
    <div className="space-y-1.5">
      <Label>{label} <span className="text-xs text-muted-foreground">({selected.length} selecionado{selected.length === 1 ? "" : "s"})</span></Label>
      {items.length === 0 ? (
        <p className="text-xs text-muted-foreground">Nenhum bouquet encontrado nesse painel.</p>
      ) : (
        <div className="max-h-40 overflow-y-auto rounded border p-2 space-y-1">
          {items.map(b => {
            const on = selected.includes(b.id);
            return (
              <label key={b.id} className="flex items-center gap-2 px-2 py-1 rounded hover:bg-muted cursor-pointer">
                <Checkbox checked={on} onCheckedChange={() => onToggle(b.id)} />
                <span className="text-sm">{b.nome}</span>
              </label>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ---------- Step 4: revisão ----------
function Step4Review({ name, method, m3uUrl, host, xui, mapping, autoSync, setAutoSync, cron, setCron }: {
  name: string; method: MethodChoice; m3uUrl: string; host: string;
  xui: XuiConnection | null; mapping: Mapping;
  autoSync: boolean; setAutoSync: (v: boolean) => void;
  cron: string; setCron: (v: string) => void;
}) {
  const bqCount = mapping.bouquets_canais.length + mapping.bouquets_filmes.length + mapping.bouquets_series.length;
  return (
    <div className="space-y-4">
      <h3 className="font-semibold text-lg">Revisar e confirmar</h3>

      <div className="rounded-lg border p-4 bg-muted/30 space-y-2 text-sm">
        <Row k="Sincronia">{name}</Row>
        <Row k="Método">{method}</Row>
        {method === "m3u_url" && <Row k="URL M3U" mono>{m3uUrl}</Row>}
        {method === "xtream_api" && <Row k="Host" mono>{host}</Row>}
        <Row k="XUI de destino">{xui ? `${xui.name} — ${xui.host}:${xui.port}` : "—"}</Row>
        <Row k="DB / usuário">{xui ? `${xui.db_name} / ${xui.db_user}` : "—"}</Row>
        <Row k="Server ID">{mapping.server_id}</Row>
        <Row k="Modos">canais: <b>{mapping.mode_canais}</b> · filmes: <b>{mapping.mode_filmes}</b> · séries: <b>{mapping.mode_series}</b></Row>
        <Row k="Bouquets">{bqCount} selecionado(s)</Row>
        <Row k="TMDB">{mapping.usar_tmdb ? `sim (${mapping.tmdb_language})` : "não"}</Row>
      </div>

      <div className="rounded-lg border border-yellow-500/40 bg-yellow-500/5 p-3 text-sm">
        <strong>⚠️ Faça backup do banco de dados AGORA antes de começar.</strong>
        <p className="text-xs text-muted-foreground mt-1">
          Apesar do sistema estar testado, alterações em massa podem afetar dados existentes. Caso perca dados sem backup, não é possível recuperar.
        </p>
      </div>

      <div className="rounded-lg border p-4 space-y-3">
        <ToggleRow label="Ativar auto-sync" desc="Executa periodicamente via cron."
          checked={autoSync} onChange={setAutoSync} />
        {autoSync && (
          <div className="space-y-1">
            <Label>Expressão cron (UTC)</Label>
            <Input value={cron} onChange={e => setCron(e.target.value)} placeholder="0 3 * * *" />
            <p className="text-xs text-muted-foreground">Ex.: <code>0 3 * * *</code> = todo dia às 03:00 UTC.</p>
          </div>
        )}
      </div>
    </div>
  );
}

function Row({ k, children, mono }: { k: string; children: React.ReactNode; mono?: boolean }) {
  return (
    <div className="flex items-baseline gap-2">
      <span className="text-muted-foreground min-w-32">{k}:</span>
      <span className={mono ? "font-mono text-xs break-all" : ""}>{children}</span>
    </div>
  );
}

// ---------- Step 5: done ----------
function Step5Done({ sourceId, jobId, onClose }: { sourceId: string; jobId: string | null; onClose: () => void }) {
  return (
    <div className="py-6 text-center space-y-4">
      <div className="inline-flex h-14 w-14 items-center justify-center rounded-full bg-green-500/10 text-green-600">
        <Check className="h-7 w-7" />
      </div>
      <h3 className="font-semibold text-xl">Tudo pronto!</h3>
      <p className="text-sm text-muted-foreground">
        {jobId ? "Sua sincronia foi enfileirada. Acompanhe o progresso na lista de jobs." : "Fonte salva."}
      </p>
      {jobId && (
        <div className="inline-flex items-center gap-2 px-3 py-2 rounded-md border bg-muted text-xs font-mono">
          Job #{jobId.slice(0, 8)}
          <button onClick={() => { navigator.clipboard.writeText(jobId); toast.success("Copiado"); }}>
            <Copy className="h-3 w-3" />
          </button>
        </div>
      )}
      <div className="pt-2"><Button onClick={onClose}>Fechar</Button></div>
      <p className="text-xs text-muted-foreground pt-2">ID da fonte: <code className="font-mono">{sourceId}</code></p>
    </div>
  );
}

// ============================================================
// JOB LOG
// ============================================================
function JobLogSheet({ job, onOpenChange }: { job: SyncJob; onOpenChange: (o: boolean) => void }) {
  const [log, setLog] = useState(job.log_tail ?? "");
  const [status, setStatus] = useState(job.status);
  const [progress, setProgress] = useState(job.progress);

  useEffect(() => {
    if (!["queued", "pending", "running"].includes(status)) return;
    const t = setInterval(async () => {
      try {
        const r = await syncApi.getJobLog(job.id);
        setLog(r.log); setStatus(r.status as any); setProgress(r.progress);
      } catch { /* silent */ }
    }, 1500);
    return () => clearInterval(t);
  }, [job.id, status]);

  return (
    <Sheet open onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-2xl overflow-y-auto">
        <SheetHeader>
          <SheetTitle>Job {job.id.slice(0, 8)}</SheetTitle>
          <SheetDescription>
            <Badge variant={statusColor[status] ?? "outline"}>{status}</Badge>
            <span className="ml-2">{progress}%</span>
          </SheetDescription>
        </SheetHeader>
        <pre className="mt-4 p-3 bg-muted rounded text-xs overflow-auto max-h-[70vh] whitespace-pre-wrap">
          {log || "(sem log ainda)"}
        </pre>
      </SheetContent>
    </Sheet>
  );
}
