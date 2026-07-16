import { createFileRoute } from "@tanstack/react-router";
import { useAuthStore } from "@/lib/auth-store";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tv, RefreshCw, Users, Activity } from "lucide-react";

export const Route = createFileRoute("/_authenticated/dashboard")({
  head: () => ({ meta: [{ title: "Dashboard — VyntrixSync" }] }),
  component: Dashboard,
});

const stats = [
  { label: "Canais ativos", value: "—", icon: Tv },
  { label: "Jobs rodando", value: "—", icon: RefreshCw },
  { label: "Usuários", value: "—", icon: Users },
  { label: "Uptime", value: "—", icon: Activity },
];

function Dashboard() {
  const user = useAuthStore((s) => s.user);

  return (
    <div className="p-6 md:p-8 space-y-6 max-w-7xl mx-auto">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          Olá, {user?.full_name?.split(" ")[0]}
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Workspace <span className="font-medium text-foreground">{user?.tenant_name}</span> ({user?.tenant_slug})
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {stats.map((s) => {
          const Icon = s.icon;
          return (
            <Card key={s.label}>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  {s.label}
                </CardTitle>
                <Icon className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-semibold">{s.value}</div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Primeiros passos</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm text-muted-foreground">
          <p>
            Seu workspace foi criado. Aqui você vai gerenciar canais, disparar syncs Xtream,
            gerar banners e acompanhar jobs em tempo real.
          </p>
          <p>
            A <strong>Fase 2</strong> vai portar os scrapers e o gerador de banner do sistema legado
            para as filas Celery — sem downtime e com retry automático.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
