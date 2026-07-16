import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { channelsApi, type Channel } from "@/lib/api/channels";
import { ApiError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetFooter } from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { Plus, Trash2, Search, Loader2 } from "lucide-react";

export const Route = createFileRoute("/_authenticated/canais")({
  head: () => ({ meta: [{ title: "Canais — VyntrixSync" }] }),
  component: CanaisPage,
});

const emptyForm = { name: "", category: "", group_name: "", logo_url: "", stream_url: "", epg_id: "", is_active: true };

function CanaisPage() {
  const [items, setItems] = useState<Channel[]>([]);
  const [total, setTotal] = useState(0);
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [sheetOpen, setSheetOpen] = useState(false);
  const [editing, setEditing] = useState<Channel | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const res = await channelsApi.list({ q: q || undefined, limit: 200 });
      setItems(res.items); setTotal(res.total);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Erro ao carregar canais");
    } finally { setLoading(false); }
  }
  useEffect(() => { load(); /* eslint-disable-next-line */ }, []);

  const allSelected = items.length > 0 && selected.size === items.length;
  const toggleAll = () => setSelected(allSelected ? new Set() : new Set(items.map(i => i.id)));
  const toggle = (id: string) => setSelected(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });

  function openCreate() { setEditing(null); setForm(emptyForm); setSheetOpen(true); }
  function openEdit(c: Channel) {
    setEditing(c);
    setForm({
      name: c.name, category: c.category ?? "", group_name: c.group_name ?? "",
      logo_url: c.logo_url ?? "", stream_url: c.stream_url ?? "", epg_id: c.epg_id ?? "",
      is_active: c.is_active,
    });
    setSheetOpen(true);
  }

  async function save() {
    if (!form.name.trim()) { toast.error("Nome é obrigatório"); return; }
    setSaving(true);
    try {
      const payload = { ...form, category: form.category || null, group_name: form.group_name || null,
        logo_url: form.logo_url || null, stream_url: form.stream_url || null, epg_id: form.epg_id || null } as any;
      if (editing) await channelsApi.update(editing.id, payload);
      else await channelsApi.create(payload);
      toast.success(editing ? "Canal atualizado" : "Canal criado");
      setSheetOpen(false); await load();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Erro ao salvar");
    } finally { setSaving(false); }
  }

  async function bulk(action: "activate" | "deactivate" | "delete") {
    if (selected.size === 0) return;
    if (action === "delete" && !confirm(`Deletar ${selected.size} canais?`)) return;
    try {
      await channelsApi.bulk([...selected], action);
      toast.success("Concluído"); setSelected(new Set()); await load();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Erro na ação em lote");
    }
  }

  return (
    <div className="p-6 md:p-8 space-y-6 max-w-7xl mx-auto">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Canais</h1>
          <p className="text-sm text-muted-foreground mt-1">{total} canais no workspace</p>
        </div>
        <Button onClick={openCreate}><Plus className="h-4 w-4 mr-2" />Novo canal</Button>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <div className="relative flex-1 min-w-[200px] max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input value={q} onChange={e => setQ(e.target.value)}
            onKeyDown={e => e.key === "Enter" && load()}
            placeholder="Buscar por nome…" className="pl-9" />
        </div>
        <Button variant="outline" onClick={load}>Buscar</Button>
        {selected.size > 0 && (
          <div className="flex items-center gap-2 ml-auto">
            <span className="text-sm text-muted-foreground">{selected.size} selecionados</span>
            <Button size="sm" variant="outline" onClick={() => bulk("activate")}>Ativar</Button>
            <Button size="sm" variant="outline" onClick={() => bulk("deactivate")}>Desativar</Button>
            <Button size="sm" variant="destructive" onClick={() => bulk("delete")}>Deletar</Button>
          </div>
        )}
      </div>

      <div className="border rounded-lg overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-10"><Checkbox checked={allSelected} onCheckedChange={toggleAll} /></TableHead>
              <TableHead>Nome</TableHead>
              <TableHead>Categoria</TableHead>
              <TableHead>Grupo</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="w-16" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow><TableCell colSpan={6} className="text-center py-12"><Loader2 className="h-5 w-5 animate-spin inline" /></TableCell></TableRow>
            ) : items.length === 0 ? (
              <TableRow><TableCell colSpan={6} className="text-center py-12 text-muted-foreground">Nenhum canal ainda. Crie o primeiro.</TableCell></TableRow>
            ) : items.map(c => (
              <TableRow key={c.id} className="cursor-pointer" onClick={() => openEdit(c)}>
                <TableCell onClick={e => e.stopPropagation()}>
                  <Checkbox checked={selected.has(c.id)} onCheckedChange={() => toggle(c.id)} />
                </TableCell>
                <TableCell className="font-medium">{c.name}</TableCell>
                <TableCell className="text-muted-foreground">{c.category ?? "—"}</TableCell>
                <TableCell className="text-muted-foreground">{c.group_name ?? "—"}</TableCell>
                <TableCell>
                  <Badge variant={c.is_active ? "default" : "secondary"}>{c.is_active ? "Ativo" : "Inativo"}</Badge>
                </TableCell>
                <TableCell onClick={e => e.stopPropagation()}>
                  <Button size="icon" variant="ghost" onClick={async () => {
                    if (!confirm(`Deletar "${c.name}"?`)) return;
                    try { await channelsApi.remove(c.id); toast.success("Deletado"); await load(); }
                    catch (e) { toast.error(e instanceof ApiError ? e.message : "Erro"); }
                  }}>
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
        <SheetContent className="sm:max-w-md overflow-y-auto">
          <SheetHeader>
            <SheetTitle>{editing ? "Editar canal" : "Novo canal"}</SheetTitle>
          </SheetHeader>
          <div className="space-y-4 mt-6 px-4">
            {(["name", "category", "group_name", "logo_url", "stream_url", "epg_id"] as const).map(f => (
              <div key={f} className="space-y-1">
                <Label className="capitalize">{f.replace("_", " ")}</Label>
                <Input value={(form as any)[f]} onChange={e => setForm({ ...form, [f]: e.target.value })} />
              </div>
            ))}
            <div className="flex items-center gap-3">
              <Switch checked={form.is_active} onCheckedChange={v => setForm({ ...form, is_active: v })} />
              <Label>Ativo</Label>
            </div>
          </div>
          <SheetFooter className="mt-6">
            <Button variant="outline" onClick={() => setSheetOpen(false)}>Cancelar</Button>
            <Button onClick={save} disabled={saving}>
              {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}Salvar
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </div>
  );
}
