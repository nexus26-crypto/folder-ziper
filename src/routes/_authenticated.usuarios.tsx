import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { membersApi, type Member } from "@/lib/api/members";
import { ApiError } from "@/lib/api";
import { useAuthStore } from "@/lib/auth-store";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetFooter } from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { Plus, Trash2, Loader2 } from "lucide-react";

export const Route = createFileRoute("/_authenticated/usuarios")({
  head: () => ({ meta: [{ title: "Usuários — VyntrixSync" }] }),
  component: UsuariosPage,
});

function UsuariosPage() {
  const currentUser = useAuthStore(s => s.user);
  const canManage = currentUser?.role === "owner" || currentUser?.role === "admin";
  const [items, setItems] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ email: "", full_name: "", role: "staff" as "admin" | "staff", password: "" });

  async function load() {
    setLoading(true);
    try { const res = await membersApi.list(); setItems(res.items); }
    catch (e) { toast.error(e instanceof ApiError ? e.message : "Erro"); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  async function invite() {
    if (!form.email || !form.full_name || form.password.length < 8) {
      toast.error("Preencha todos os campos (senha mín. 8)"); return;
    }
    setSaving(true);
    try {
      await membersApi.invite(form);
      toast.success("Membro adicionado"); setSheetOpen(false);
      setForm({ email: "", full_name: "", role: "staff", password: "" });
      await load();
    } catch (e) { toast.error(e instanceof ApiError ? e.message : "Erro"); }
    finally { setSaving(false); }
  }

  async function toggleActive(m: Member) {
    try { await membersApi.update(m.id, { is_active: !m.is_active }); await load(); }
    catch (e) { toast.error(e instanceof ApiError ? e.message : "Erro"); }
  }

  async function remove(m: Member) {
    if (!confirm(`Remover ${m.full_name}?`)) return;
    try { await membersApi.remove(m.id); toast.success("Removido"); await load(); }
    catch (e) { toast.error(e instanceof ApiError ? e.message : "Erro"); }
  }

  return (
    <div className="p-6 md:p-8 space-y-6 max-w-7xl mx-auto">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Usuários</h1>
          <p className="text-sm text-muted-foreground mt-1">{items.length} membros no workspace</p>
        </div>
        {canManage && <Button onClick={() => setSheetOpen(true)}><Plus className="h-4 w-4 mr-2" />Convidar</Button>}
      </div>

      <div className="border rounded-lg overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Nome</TableHead><TableHead>Email</TableHead>
              <TableHead>Role</TableHead><TableHead>Status</TableHead>
              <TableHead className="w-16" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow><TableCell colSpan={5} className="text-center py-12"><Loader2 className="h-5 w-5 animate-spin inline" /></TableCell></TableRow>
            ) : items.map(m => (
              <TableRow key={m.id}>
                <TableCell className="font-medium">{m.full_name}</TableCell>
                <TableCell className="text-muted-foreground">{m.email}</TableCell>
                <TableCell><Badge variant={m.role === "owner" ? "default" : "outline"}>{m.role}</Badge></TableCell>
                <TableCell>
                  {canManage && m.role !== "owner" ? (
                    <Switch checked={m.is_active} onCheckedChange={() => toggleActive(m)} />
                  ) : (
                    <Badge variant={m.is_active ? "default" : "secondary"}>{m.is_active ? "Ativo" : "Inativo"}</Badge>
                  )}
                </TableCell>
                <TableCell>
                  {canManage && m.role !== "owner" && m.id !== currentUser?.id && (
                    <Button size="icon" variant="ghost" onClick={() => remove(m)}>
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
        <SheetContent className="sm:max-w-md">
          <SheetHeader><SheetTitle>Convidar membro</SheetTitle></SheetHeader>
          <div className="space-y-4 mt-6 px-4">
            <div className="space-y-1"><Label>Nome completo</Label><Input value={form.full_name} onChange={e => setForm({ ...form, full_name: e.target.value })} /></div>
            <div className="space-y-1"><Label>Email</Label><Input type="email" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} /></div>
            <div className="space-y-1"><Label>Senha temporária</Label><Input type="password" value={form.password} onChange={e => setForm({ ...form, password: e.target.value })} /></div>
            <div className="space-y-1">
              <Label>Role</Label>
              <Select value={form.role} onValueChange={v => setForm({ ...form, role: v as any })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="staff">Staff</SelectItem>
                  <SelectItem value="admin">Admin</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <SheetFooter className="mt-6">
            <Button variant="outline" onClick={() => setSheetOpen(false)}>Cancelar</Button>
            <Button onClick={invite} disabled={saving}>
              {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}Adicionar
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </div>
  );
}
