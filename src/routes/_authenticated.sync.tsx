import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState, useCallback } from "react";
import { toast } from "sonner";
import { syncApi, type XtreamSource, type SyncJob, type SourceType, type CreateSourceBody } from "@/lib/api/sync";
import { xuiApi, type XuiConnection, type XuiMeta } from "@/lib/api/xui";
import { ApiError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetFooter, SheetDescription } from "@/components/ui/sheet";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Switch } from "@/components/ui/switch";
import { RefreshCw, Plus, Play, Trash2, Settings2, FileText } from "lucide-react";
import { Link } from "@tanstack/react-router";

export const Route = createFileRoute("/_authenticated/sync")({
  head: () => ({ meta: [{ title: "Sync — VyntrixSync" }] }),
  component: SyncPage,
});

const statusColor: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  success: "default", queued: "secondary", pending: "secondary",
  running: "outline", failed: "destructive",
};

function SyncPage() {
  const [sources, setSources] = useState<XtreamSource[]>([]);
  const [jobs, setJobs] = useState<SyncJob[]>([]);
  const [xuis, setXuis] = useState<XuiConnection[]>([]);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [mapSheet, setMapSheet] = useState<XtreamSource | null>(null);
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

  return (
    <div className="p-6 md:p-8 space-y-6 max-w-7xl mx-auto">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Sync</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Importa canais e filmes de M3U ou API Xtream direto no seu painel XUI.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" asChild>
            <Link to="/configuracoes">Conexões XUI</Link>
          </Button>
          <Button onClick={() => setSheetOpen(true)}><Plus className="h-4 w-4 mr-2" />Nova fonte</Button>
        </div>
      </div>

      {xuis.length === 0 && (
        <Card className="border-yellow-500/40 bg-yellow-500/5">
          <CardContent className="py-4 text-sm">
            Você ainda não cadastrou nenhuma conexão XUI de destino.{" "}
            <Link to="/configuracoes" className="underline font-medium">Cadastrar agora</Link>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader><CardTitle className="text-base">Fontes</CardTitle></CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nome</TableHead><TableHead>Tipo</TableHead>
                <TableHead>Destino XUI</TableHead><TableHead>Auto</TableHead>
                <TableHead>Última sync</TableHead>
                <TableHead className="w-48" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {sources.length === 0 ? (
                <TableRow><TableCell colSpan={6} className="text-center py-8 text-muted-foreground">Nenhuma fonte cadastrada.</TableCell></TableRow>
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
                      <Button size="sm" variant="ghost" onClick={() => setMapSheet(s)} title="Mapeamento"><Settings2 className="h-4 w-4" /></Button>
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
                <TableHead>Progresso</TableHead>
                <TableHead>Inseridos</TableHead>
                <TableHead>Ignorados</TableHead>
                <TableHead>Erros</TableHead>
                <TableHead>Criado</TableHead>
                <TableHead />
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

      <NewSourceSheet open={sheetOpen} onOpenChange={setSheetOpen} xuis={xuis} onCreated={loadAll} />
      {mapSheet && <MappingSheet source={mapSheet} xuis={xuis} onOpenChange={o => !o && setMapSheet(null)} onSaved={loadAll} />}
      {logSheet && <JobLogSheet job={logSheet} onOpenChange={o => !o && setLogSheet(null)} />}
    </div>
  );
}

// ---------------- NEW SOURCE ----------------

function NewSourceSheet({ open, onOpenChange, xuis, onCreated }: {
  open: boolean; onOpenChange: (o: boolean) => void;
  xuis: XuiConnection[]; onCreated: () => void;
}) {
  const [tab, setTab] = useState<SourceType>("xtream_api");
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState("");
  const [xuiId, setXuiId] = useState<string>("");
  // xtream
  const [host, setHost] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  // m3u
  const [m3uUrl, setM3uUrl] = useState("");
  const [file, setFile] = useState<File | null>(null);

  function reset() {
    setName(""); setHost(""); setUsername(""); setPassword("");
    setM3uUrl(""); setFile(null); setXuiId("");
  }

  async function save() {
    if (!name.trim()) return toast.error("Informe um nome");
    setSaving(true);
    try {
      if (tab === "m3u_file") {
        if (!file) return toast.error("Selecione o arquivo M3U");
        await syncApi.uploadM3u(name, file, xuiId || undefined);
      } else {
        const body: CreateSourceBody = {
          name, source_type: tab,
          xui_connection_id: xuiId || null,
          mapping: {},
        };
        if (tab === "xtream_api") { body.host = host; body.username = username; body.password = password; body.kind = "all"; }
        if (tab === "m3u_url") body.m3u_url = m3uUrl;
        await syncApi.createSource(body);
      }
      toast.success("Fonte criada");
      reset(); onOpenChange(false); onCreated();
    } catch (e) { toast.error(e instanceof ApiError ? e.message : "Erro"); }
    finally { setSaving(false); }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-lg overflow-y-auto">
        <SheetHeader>
          <SheetTitle>Nova fonte</SheetTitle>
          <SheetDescription>M3U ou API Xtream de origem.</SheetDescription>
        </SheetHeader>
        <div className="space-y-4 py-6">
          <div className="space-y-1"><Label>Nome</Label><Input value={name} onChange={e => setName(e.target.value)} placeholder="Ex.: Painel principal" /></div>

          <div className="space-y-1">
            <Label>Destino XUI</Label>
            <Select value={xuiId} onValueChange={setXuiId}>
              <SelectTrigger><SelectValue placeholder={xuis.length ? "Padrão (marcado como default)" : "Cadastre uma conexão primeiro"} /></SelectTrigger>
              <SelectContent>
                {xuis.map(x => (
                  <SelectItem key={x.id} value={x.id}>{x.name} {x.is_default && "(default)"}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <Tabs value={tab} onValueChange={v => setTab(v as SourceType)}>
            <TabsList className="grid grid-cols-3 w-full">
              <TabsTrigger value="xtream_api">Xtream API</TabsTrigger>
              <TabsTrigger value="m3u_url">M3U URL</TabsTrigger>
              <TabsTrigger value="m3u_file">M3U arquivo</TabsTrigger>
            </TabsList>
            <TabsContent value="xtream_api" className="space-y-3 pt-4">
              <div className="space-y-1"><Label>Host</Label><Input value={host} onChange={e => setHost(e.target.value)} placeholder="http://painel.exemplo.com:80" /></div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1"><Label>Usuário</Label><Input value={username} onChange={e => setUsername(e.target.value)} /></div>
                <div className="space-y-1"><Label>Senha</Label><Input type="password" value={password} onChange={e => setPassword(e.target.value)} /></div>
              </div>
            </TabsContent>
            <TabsContent value="m3u_url" className="space-y-3 pt-4">
              <div className="space-y-1"><Label>URL da lista M3U</Label><Input value={m3uUrl} onChange={e => setM3uUrl(e.target.value)} placeholder="http://.../get.php?..." /></div>
            </TabsContent>
            <TabsContent value="m3u_file" className="space-y-3 pt-4">
              <div className="space-y-1"><Label>Arquivo M3U</Label><Input type="file" accept=".m3u,.m3u8,text/plain" onChange={e => setFile(e.target.files?.[0] ?? null)} /></div>
              {file && <p className="text-xs text-muted-foreground">{file.name} — {(file.size / 1024).toFixed(1)} KB</p>}
            </TabsContent>
          </Tabs>
        </div>
        <SheetFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button onClick={save} disabled={saving}>{saving ? "Salvando…" : "Salvar"}</Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

// ---------------- MAPPING ----------------

function MappingSheet({ source, xuis, onOpenChange, onSaved }: {
  source: XtreamSource; xuis: XuiConnection[];
  onOpenChange: (o: boolean) => void; onSaved: () => void;
}) {
  const [xuiId, setXuiId] = useState(source.xui_connection_id ?? xuis.find(x => x.is_default)?.id ?? "");
  const [meta, setMeta] = useState<XuiMeta | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const m0 = (source.mapping || {}) as any;
  const [bouquetCanais, setBouquetCanais] = useState<string>(String(m0.bouquet_canais ?? ""));
  const [bouquetFilmes, setBouquetFilmes] = useState<string>(String(m0.bouquet_filmes ?? ""));
  const [bouquetSeries, setBouquetSeries] = useState<string>(String(m0.bouquet_series ?? ""));
  const [serverId, setServerId] = useState<string>(String(m0.server_id ?? "0"));
  const [usarTmdb, setUsarTmdb] = useState<boolean>(!!m0.usar_tmdb);
  const [tmdbKey, setTmdbKey] = useState<string>(m0.tmdb_api_key ?? "");
  const [autoSync, setAutoSync] = useState(source.auto_sync);
  const [cron, setCron] = useState(source.auto_sync_cron ?? "0 3 * * *");

  useEffect(() => {
    if (!xuiId) return;
    setLoading(true);
    xuiApi.meta(xuiId).then(setMeta)
      .catch(e => toast.error(e instanceof ApiError ? e.message : "Erro ao ler XUI"))
      .finally(() => setLoading(false));
  }, [xuiId]);

  async function save() {
    setSaving(true);
    try {
      await syncApi.updateSource(source.id, {
        xui_connection_id: xuiId || null,
        auto_sync: autoSync, auto_sync_cron: cron || null,
        mapping: {
          bouquet_canais: bouquetCanais ? Number(bouquetCanais) : null,
          bouquet_filmes: bouquetFilmes ? Number(bouquetFilmes) : null,
          bouquet_series: bouquetSeries ? Number(bouquetSeries) : null,
          server_id: Number(serverId) || 0,
          criar_categorias: true,
          usar_tmdb: usarTmdb,
          tmdb_api_key: tmdbKey || null,
          live: {}, movie: {}, series: {},
        },
      });
      toast.success("Mapeamento salvo"); onSaved(); onOpenChange(false);
    } catch (e) { toast.error(e instanceof ApiError ? e.message : "Erro"); }
    finally { setSaving(false); }
  }

  return (
    <Sheet open onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-lg overflow-y-auto">
        <SheetHeader>
          <SheetTitle>{source.name}</SheetTitle>
          <SheetDescription>Configurar destino, bouquets, servidor e auto-sync.</SheetDescription>
        </SheetHeader>
        <div className="space-y-4 py-6">
          <div className="space-y-1">
            <Label>Conexão XUI</Label>
            <Select value={xuiId} onValueChange={setXuiId}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {xuis.map(x => <SelectItem key={x.id} value={x.id}>{x.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          {loading && <p className="text-sm text-muted-foreground">Consultando XUI…</p>}

          {meta && (
            <>
              <p className="text-xs text-muted-foreground">Detectado: {meta.version}</p>
              <div className="space-y-1">
                <Label>Bouquet dos Canais</Label>
                <Select value={bouquetCanais} onValueChange={setBouquetCanais}>
                  <SelectTrigger><SelectValue placeholder="— nenhum —" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="0">— nenhum —</SelectItem>
                    {meta.bouquets.map(b => <SelectItem key={b.id} value={String(b.id)}>{b.nome}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label>Bouquet dos Filmes</Label>
                <Select value={bouquetFilmes} onValueChange={setBouquetFilmes}>
                  <SelectTrigger><SelectValue placeholder="— nenhum —" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="0">— nenhum —</SelectItem>
                    {meta.bouquets.map(b => <SelectItem key={b.id} value={String(b.id)}>{b.nome}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label>Bouquet das Séries</Label>
                <Select value={bouquetSeries} onValueChange={setBouquetSeries}>
                  <SelectTrigger><SelectValue placeholder="— nenhum —" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="0">— nenhum —</SelectItem>
                    {meta.bouquets.map(b => <SelectItem key={b.id} value={String(b.id)}>{b.nome}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label>Servidor de streaming</Label>
                <Select value={serverId} onValueChange={setServerId}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {meta.servers.map(s => <SelectItem key={s.id} value={String(s.id)}>{s.nome}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </>
          )}

          <div className="pt-4 border-t space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <Label>Enriquecer com TMDB</Label>
                <p className="text-xs text-muted-foreground">Busca capa, sinopse e gênero para filmes e séries.</p>
              </div>
              <Switch checked={usarTmdb} onCheckedChange={setUsarTmdb} />
            </div>
            {usarTmdb && (
              <div className="space-y-1">
                <Label>TMDB API Key <span className="text-xs text-muted-foreground">(opcional — usa a padrão do servidor se vazio)</span></Label>
                <Input value={tmdbKey} onChange={e => setTmdbKey(e.target.value)} placeholder="v3 auth (32 chars)" />
              </div>
            )}
          </div>

          <div className="pt-4 border-t space-y-3">
            <div className="flex items-center justify-between">
              <div><Label>Auto-sync</Label><p className="text-xs text-muted-foreground">Executa periodicamente via cron.</p></div>
              <Switch checked={autoSync} onCheckedChange={setAutoSync} />
            </div>
            {autoSync && (
              <div className="space-y-1">
                <Label>Expressão cron</Label>
                <Input value={cron} onChange={e => setCron(e.target.value)} placeholder="0 3 * * *" />
                <p className="text-xs text-muted-foreground">Ex.: <code>0 3 * * *</code> (todo dia às 3h). Fuso: America/Sao_Paulo.</p>
              </div>
            )}
          </div>
        </div>
        <SheetFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button onClick={save} disabled={saving}>{saving ? "Salvando…" : "Salvar"}</Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

// ---------------- JOB LOG ----------------

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
