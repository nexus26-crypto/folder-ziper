import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { syncApi, type XtreamSource, type SyncJob } from "@/lib/api/sync";
import { ApiError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetFooter } from "@/components/ui/sheet";
import { RefreshCw, Plus, Play, Trash2, Loader2 } from "lucide-react";

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
  const [sheetOpen, setSheetOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ name: "", host: "", username: "", password: "", kind: "live" as const });
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  async function loadAll() {
    try {
      const [s, j] = await Promise.all([syncApi.listSources(), syncApi.listJobs()]);
      setSources(s); setJobs(j.items);
    } catch (e) { toast.error(e instanceof ApiError ? e.message : "Erro ao carregar"); }
  }

  useEffect(() => {
    loadAll();
    timer.current = setInterval(() => {
      // só refaz polling se houver algo pendente
      if (jobs.some(j => ["queued", "pending", "running"].includes(j.status))) loadAll();
    }, 3000);
    return () => { if (timer.current) clearInterval(timer.current); };
    // eslint-disable-next-line
  }, [jobs.length]);

  async function createSource() {
    if (!form.name || !form.host || !form.username || !form.password) {
      toast.error("Preencha todos os campos"); return;
    }
    setSaving(true);
    try {
      await syncApi.createSource(form as any);
      toast.success("Fonte criada"); setSheetOpen(false);
      setForm({ name: "", host: "", username: "", password: "", kind: "live" });
      await loadAll();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Erro");
    } finally { setSaving(false); }
  }

  async function trigger(source_id: string) {
    try {
      await syncApi.trigger(source_id);
      toast.success("Sincronização enfileirada");
      await loadAll();
    } catch (e) { toast.error(e instanceof ApiError ? e.message : "Erro"); }
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
          <p className="text-sm text-muted-foreground mt-1">Fontes Xtream e histórico de jobs</p>
        </div>
        <Button onClick={() => setSheetOpen(true)}><Plus className="h-4 w-4 mr-2" />Nova fonte</Button>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">Fontes Xtream</CardTitle></CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nome</TableHead><TableHead>Host</TableHead>
                <TableHead>Tipo</TableHead><TableHead>Última sync</TableHead>
                <TableHead className="w-32" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {sources.length === 0 ? (
                <TableRow><TableCell colSpan={5} className="text-center py-8 text-muted-foreground">Nenhuma fonte cadastrada.</TableCell></TableRow>
              ) : sources.map(s => (
                <TableRow key={s.id}>
                  <TableCell className="font-medium">{s.name}</TableCell>
                  <TableCell className="text-muted-foreground text-sm">{s.host}</TableCell>
                  <TableCell><Badge variant="outline">{s.kind}</Badge></TableCell>
                  <TableCell className="text-muted-foreground text-sm">
                    {s.last_sync_at ? new Date(s.last_sync_at).toLocaleString("pt-BR") : "—"}
                  </TableCell>
                  <TableCell className="text-right space-x-1">
                    <Button size="sm" onClick={() => trigger(s.id)}><Play className="h-3 w-3 mr-1" />Sync</Button>
                    <Button size="icon" variant="ghost" onClick={() => deleteSource(s.id)}>
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
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
                <TableHead>Progresso</TableHead><TableHead>Criado</TableHead>
                <TableHead>Erro</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {jobs.length === 0 ? (
                <TableRow><TableCell colSpan={5} className="text-center py-8 text-muted-foreground">Sem jobs ainda.</TableCell></TableRow>
              ) : jobs.map(j => (
                <TableRow key={j.id}>
                  <TableCell className="font-medium">{j.job_type}</TableCell>
                  <TableCell><Badge variant={statusColor[j.status] ?? "outline"}>{j.status}</Badge></TableCell>
                  <TableCell>{j.progress}%</TableCell>
                  <TableCell className="text-muted-foreground text-sm">{new Date(j.created_at).toLocaleString("pt-BR")}</TableCell>
                  <TableCell className="text-destructive text-sm truncate max-w-[240px]">{j.error ?? ""}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
        <SheetContent className="sm:max-w-md">
          <SheetHeader><SheetTitle>Nova fonte Xtream</SheetTitle></SheetHeader>
          <div className="space-y-4 mt-6 px-4">
            <div className="space-y-1"><Label>Nome</Label><Input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} /></div>
            <div className="space-y-1"><Label>Host</Label><Input placeholder="http://painel.exemplo.com:8080" value={form.host} onChange={e => setForm({ ...form, host: e.target.value })} /></div>
            <div className="space-y-1"><Label>Usuário</Label><Input value={form.username} onChange={e => setForm({ ...form, username: e.target.value })} /></div>
            <div className="space-y-1"><Label>Senha</Label><Input type="password" value={form.password} onChange={e => setForm({ ...form, password: e.target.value })} /></div>
            <div className="space-y-1">
              <Label>Tipo</Label>
              <Select value={form.kind} onValueChange={v => setForm({ ...form, kind: v as any })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="live">Live</SelectItem>
                  <SelectItem value="vod">VOD</SelectItem>
                  <SelectItem value="series">Séries</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <SheetFooter className="mt-6">
            <Button variant="outline" onClick={() => setSheetOpen(false)}>Cancelar</Button>
            <Button onClick={createSource} disabled={saving}>
              {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}Salvar
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </div>
  );
}
