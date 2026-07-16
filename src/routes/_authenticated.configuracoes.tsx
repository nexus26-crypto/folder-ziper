import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState, useCallback } from "react";
import { toast } from "sonner";
import { settingsApi, type Workspace } from "@/lib/api/settings";
import { xuiApi, type XuiConnection } from "@/lib/api/xui";
import { ApiError } from "@/lib/api";
import { useAuthStore } from "@/lib/auth-store";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetFooter, SheetDescription } from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import { Loader2, Plus, Trash2, Zap, CheckCircle2, XCircle } from "lucide-react";

export const Route = createFileRoute("/_authenticated/configuracoes")({
  head: () => ({ meta: [{ title: "Configurações — VyntrixSync" }] }),
  component: SettingsPage,
});

function SettingsPage() {
  const { user, setUser } = useAuthStore();
  const isOwner = user?.role === "owner";
  const [ws, setWs] = useState<Workspace | null>(null);
  const [profileName, setProfileName] = useState(user?.full_name ?? "");
  const [currentPw, setCurrentPw] = useState("");
  const [newPw, setNewPw] = useState("");
  const [wsName, setWsName] = useState("");
  const [savingProfile, setSavingProfile] = useState(false);
  const [savingWs, setSavingWs] = useState(false);

  useEffect(() => {
    settingsApi.getWorkspace().then(w => { setWs(w); setWsName(w.name); })
      .catch(e => toast.error(e instanceof ApiError ? e.message : "Erro"));
  }, []);

  async function saveProfile() {
    setSavingProfile(true);
    try {
      const body: any = {};
      if (profileName !== user?.full_name) body.full_name = profileName;
      if (newPw) { body.current_password = currentPw; body.new_password = newPw; }
      if (Object.keys(body).length === 0) { toast.info("Nada para salvar"); return; }
      const updated = await settingsApi.updateProfile(body);
      setUser(updated); setCurrentPw(""); setNewPw("");
      toast.success("Perfil atualizado");
    } catch (e) { toast.error(e instanceof ApiError ? e.message : "Erro"); }
    finally { setSavingProfile(false); }
  }

  async function saveWs() {
    if (!wsName.trim()) return;
    setSavingWs(true);
    try {
      const updated = await settingsApi.updateWorkspace({ name: wsName });
      setWs(updated);
      if (user) setUser({ ...user, tenant_name: updated.name });
      toast.success("Workspace atualizado");
    } catch (e) { toast.error(e instanceof ApiError ? e.message : "Erro"); }
    finally { setSavingWs(false); }
  }

  return (
    <div className="p-6 md:p-8 space-y-6 max-w-3xl mx-auto">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Configurações</h1>
        <p className="text-sm text-muted-foreground mt-1">Perfil e workspace</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Perfil</CardTitle>
          <CardDescription>Suas informações pessoais</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1"><Label>Email</Label><Input value={user?.email ?? ""} disabled /></div>
          <div className="space-y-1"><Label>Nome</Label><Input value={profileName} onChange={e => setProfileName(e.target.value)} /></div>
          <div className="grid gap-4 sm:grid-cols-2 pt-2 border-t">
            <div className="space-y-1"><Label>Senha atual</Label><Input type="password" value={currentPw} onChange={e => setCurrentPw(e.target.value)} /></div>
            <div className="space-y-1"><Label>Nova senha</Label><Input type="password" value={newPw} onChange={e => setNewPw(e.target.value)} /></div>
          </div>
          <div className="flex justify-end">
            <Button onClick={saveProfile} disabled={savingProfile}>
              {savingProfile && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}Salvar perfil
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Workspace</CardTitle>
          <CardDescription>{isOwner ? "Você é owner deste workspace" : "Somente owner pode editar"}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1"><Label>Slug</Label><Input value={ws?.slug ?? ""} disabled /></div>
          <div className="space-y-1"><Label>Nome</Label><Input value={wsName} onChange={e => setWsName(e.target.value)} disabled={!isOwner} /></div>
          <div className="flex items-center gap-4">
            <div><Label className="text-xs text-muted-foreground">Plano</Label><div><Badge>{ws?.plan ?? "—"}</Badge></div></div>
            <div><Label className="text-xs text-muted-foreground">Status</Label><div><Badge variant="outline">{ws?.status ?? "—"}</Badge></div></div>
          </div>
          {isOwner && (
            <div className="flex justify-end">
              <Button onClick={saveWs} disabled={savingWs}>
                {savingWs && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}Salvar workspace
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      <XuiConnectionsCard />
    </div>
  );
}

// -------------------- XUI CONNECTIONS --------------------

function XuiConnectionsCard() {
  const [conns, setConns] = useState<XuiConnection[]>([]);
  const [loading, setLoading] = useState(true);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [editing, setEditing] = useState<XuiConnection | null>(null);
  const [testingId, setTestingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try { setConns(await xuiApi.list()); }
    catch (e) { toast.error(e instanceof ApiError ? e.message : "Erro"); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  async function test(id: string) {
    setTestingId(id);
    try {
      const r = await xuiApi.test(id);
      if (r.ok) toast.success(`OK — ${r.version} (${r.bouquets?.length ?? 0} bouquets)`);
      else toast.error(r.error ?? "Falha na conexão");
      await load();
    } catch (e) { toast.error(e instanceof ApiError ? e.message : "Erro"); }
    finally { setTestingId(null); }
  }
  async function remove(id: string) {
    if (!confirm("Remover essa conexão? Fontes que apontam pra ela ficarão sem destino.")) return;
    try { await xuiApi.remove(id); toast.success("Removida"); await load(); }
    catch (e) { toast.error(e instanceof ApiError ? e.message : "Erro"); }
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between">
        <div>
          <CardTitle>Conexões XUI / Xtream (destino)</CardTitle>
          <CardDescription>Painéis onde as sincronizações vão gravar canais e filmes.</CardDescription>
        </div>
        <Button size="sm" onClick={() => { setEditing(null); setSheetOpen(true); }}>
          <Plus className="h-4 w-4 mr-2" />Adicionar
        </Button>
      </CardHeader>
      <CardContent className="space-y-2">
        {loading ? (
          <p className="text-sm text-muted-foreground">Carregando…</p>
        ) : conns.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nenhuma conexão cadastrada.</p>
        ) : conns.map(c => (
          <div key={c.id} className="flex items-center justify-between border rounded-md p-3 gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-medium">{c.name}</span>
                {c.is_default && <Badge variant="outline">default</Badge>}
                {c.last_test_ok === true && <Badge className="gap-1"><CheckCircle2 className="h-3 w-3" />{c.detected_version || "ok"}</Badge>}
                {c.last_test_ok === false && <Badge variant="destructive" className="gap-1"><XCircle className="h-3 w-3" />falha</Badge>}
              </div>
              <p className="text-xs text-muted-foreground truncate">{c.db_user}@{c.host}:{c.port}/{c.db_name}</p>
              {c.last_test_error && <p className="text-xs text-destructive truncate">{c.last_test_error}</p>}
            </div>
            <div className="flex gap-1 shrink-0">
              <Button size="sm" variant="ghost" onClick={() => test(c.id)} disabled={testingId === c.id}>
                {testingId === c.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Zap className="h-4 w-4" />}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => { setEditing(c); setSheetOpen(true); }}>Editar</Button>
              <Button size="icon" variant="ghost" onClick={() => remove(c.id)}><Trash2 className="h-4 w-4 text-destructive" /></Button>
            </div>
          </div>
        ))}
      </CardContent>
      {sheetOpen && (
        <XuiConnectionSheet
          editing={editing}
          onClose={() => setSheetOpen(false)}
          onSaved={() => { setSheetOpen(false); load(); }}
        />
      )}
    </Card>
  );
}

function XuiConnectionSheet({ editing, onClose, onSaved }: {
  editing: XuiConnection | null; onClose: () => void; onSaved: () => void;
}) {
  const [name, setName] = useState(editing?.name ?? "");
  const [host, setHost] = useState(editing?.host ?? "");
  const [port, setPort] = useState(editing?.port ?? 3306);
  const [db_name, setDbName] = useState(editing?.db_name ?? "xtream_iptvpro");
  const [db_user, setDbUser] = useState(editing?.db_user ?? "");
  const [db_pass, setDbPass] = useState("");
  const [is_default, setIsDefault] = useState(editing?.is_default ?? false);
  const [saving, setSaving] = useState(false);

  async function save() {
    if (!name || !host || !db_name || !db_user || (!editing && !db_pass)) {
      return toast.error("Preencha os campos obrigatórios");
    }
    setSaving(true);
    try {
      if (editing) {
        const body: any = { name, host, port, db_name, db_user, is_default };
        if (db_pass) body.db_pass = db_pass;
        await xuiApi.update(editing.id, body);
      } else {
        await xuiApi.create({ name, host, port, db_name, db_user, db_pass, is_default });
      }
      toast.success("Salvo"); onSaved();
    } catch (e) { toast.error(e instanceof ApiError ? e.message : "Erro"); }
    finally { setSaving(false); }
  }

  return (
    <Sheet open onOpenChange={o => !o && onClose()}>
      <SheetContent className="w-full sm:max-w-md overflow-y-auto">
        <SheetHeader>
          <SheetTitle>{editing ? "Editar conexão" : "Nova conexão XUI"}</SheetTitle>
          <SheetDescription>Credenciais MySQL do painel XUI/Xtream de destino. Ficam criptografadas.</SheetDescription>
        </SheetHeader>
        <div className="space-y-3 py-6">
          <div className="space-y-1"><Label>Nome</Label><Input value={name} onChange={e => setName(e.target.value)} placeholder="Meu painel" /></div>
          <div className="grid grid-cols-3 gap-3">
            <div className="col-span-2 space-y-1"><Label>Host MySQL</Label><Input value={host} onChange={e => setHost(e.target.value)} placeholder="127.0.0.1" /></div>
            <div className="space-y-1"><Label>Porta</Label><Input type="number" value={port} onChange={e => setPort(Number(e.target.value))} /></div>
          </div>
          <div className="space-y-1"><Label>Banco</Label><Input value={db_name} onChange={e => setDbName(e.target.value)} /></div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1"><Label>Usuário</Label><Input value={db_user} onChange={e => setDbUser(e.target.value)} /></div>
            <div className="space-y-1"><Label>Senha {editing && <span className="text-xs text-muted-foreground">(vazio = mantém)</span>}</Label><Input type="password" value={db_pass} onChange={e => setDbPass(e.target.value)} /></div>
          </div>
          <div className="flex items-center justify-between pt-2">
            <Label>Marcar como padrão</Label>
            <Switch checked={is_default} onCheckedChange={setIsDefault} />
          </div>
        </div>
        <SheetFooter>
          <Button variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button onClick={save} disabled={saving}>{saving ? "Salvando…" : "Salvar"}</Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
