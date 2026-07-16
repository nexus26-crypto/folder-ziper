import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { bannersApi, type Banner } from "@/lib/api/banners";
import { ApiError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent } from "@/components/ui/card";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetFooter } from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { Plus, Trash2, Loader2, Image as ImageIcon } from "lucide-react";

export const Route = createFileRoute("/_authenticated/banners")({
  head: () => ({ meta: [{ title: "Banners — VyntrixSync" }] }),
  component: BannersPage,
});

function BannersPage() {
  const [items, setItems] = useState<Banner[]>([]);
  const [loading, setLoading] = useState(true);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ title: "", subtitle: "", theme: "dark", template: "default", logo_url: "" });

  async function load() {
    setLoading(true);
    try { const res = await bannersApi.list(); setItems(res.items); }
    catch (e) { toast.error(e instanceof ApiError ? e.message : "Erro"); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  async function save() {
    if (!form.title.trim()) { toast.error("Título é obrigatório"); return; }
    setSaving(true);
    try {
      await bannersApi.create({ ...form, subtitle: form.subtitle || undefined, logo_url: form.logo_url || undefined });
      toast.success("Banner enfileirado"); setSheetOpen(false);
      setForm({ title: "", subtitle: "", theme: "dark", template: "default", logo_url: "" });
      await load();
    } catch (e) { toast.error(e instanceof ApiError ? e.message : "Erro"); }
    finally { setSaving(false); }
  }

  async function remove(id: string) {
    if (!confirm("Deletar esse banner?")) return;
    try { await bannersApi.remove(id); toast.success("Deletado"); await load(); }
    catch (e) { toast.error(e instanceof ApiError ? e.message : "Erro"); }
  }

  return (
    <div className="p-6 md:p-8 space-y-6 max-w-7xl mx-auto">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Banners</h1>
          <p className="text-sm text-muted-foreground mt-1">Gere banners promocionais para seus canais</p>
        </div>
        <Button onClick={() => setSheetOpen(true)}><Plus className="h-4 w-4 mr-2" />Novo banner</Button>
      </div>

      {loading ? (
        <div className="text-center py-12"><Loader2 className="h-5 w-5 animate-spin inline" /></div>
      ) : items.length === 0 ? (
        <Card><CardContent className="py-16 text-center text-muted-foreground">
          <ImageIcon className="h-10 w-10 mx-auto mb-3 opacity-50" />
          Nenhum banner ainda.
        </CardContent></Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {items.map(b => (
            <Card key={b.id} className="overflow-hidden">
              <div className="aspect-video bg-muted flex items-center justify-center">
                {b.image_url ? (
                  <img src={b.image_url} alt={b.title} className="w-full h-full object-cover" />
                ) : (
                  <div className="text-muted-foreground text-sm flex flex-col items-center gap-2">
                    <ImageIcon className="h-8 w-8" />
                    <Badge variant="secondary">{b.status}</Badge>
                  </div>
                )}
              </div>
              <CardContent className="p-4 space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-medium truncate">{b.title}</p>
                    {b.subtitle && <p className="text-xs text-muted-foreground truncate">{b.subtitle}</p>}
                  </div>
                  <Button size="icon" variant="ghost" onClick={() => remove(b.id)}>
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </div>
                <div className="flex gap-1">
                  <Badge variant="outline" className="text-xs">{b.theme}</Badge>
                  <Badge variant="outline" className="text-xs">{b.template}</Badge>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
        <SheetContent className="sm:max-w-md">
          <SheetHeader><SheetTitle>Novo banner</SheetTitle></SheetHeader>
          <div className="space-y-4 mt-6 px-4">
            <div className="space-y-1"><Label>Título</Label><Input value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} /></div>
            <div className="space-y-1"><Label>Subtítulo</Label><Textarea value={form.subtitle} onChange={e => setForm({ ...form, subtitle: e.target.value })} /></div>
            <div className="space-y-1">
              <Label>Tema</Label>
              <Select value={form.theme} onValueChange={v => setForm({ ...form, theme: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="dark">Dark</SelectItem>
                  <SelectItem value="light">Light</SelectItem>
                  <SelectItem value="custom">Custom</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1"><Label>Template</Label><Input value={form.template} onChange={e => setForm({ ...form, template: e.target.value })} /></div>
            <div className="space-y-1"><Label>URL do logo</Label><Input value={form.logo_url} onChange={e => setForm({ ...form, logo_url: e.target.value })} /></div>
          </div>
          <SheetFooter className="mt-6">
            <Button variant="outline" onClick={() => setSheetOpen(false)}>Cancelar</Button>
            <Button onClick={save} disabled={saving}>
              {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}Gerar
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </div>
  );
}
