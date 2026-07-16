import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { settingsApi, type Workspace } from "@/lib/api/settings";
import { ApiError } from "@/lib/api";
import { useAuthStore } from "@/lib/auth-store";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Loader2 } from "lucide-react";

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
    </div>
  );
}
