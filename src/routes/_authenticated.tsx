import { createFileRoute, Link, Outlet, useNavigate, useRouterState } from "@tanstack/react-router";
import { useEffect } from "react";
import { useAuthStore } from "@/lib/auth-store";
import { Button } from "@/components/ui/button";
import { LayoutDashboard, Tv, RefreshCw, Image as ImageIcon, Users, Settings, LogOut } from "lucide-react";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated")({
  component: AuthenticatedLayout,
});

const nav = [
  { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { to: "/canais", label: "Canais", icon: Tv },
  { to: "/sync", label: "Sync", icon: RefreshCw },
  { to: "/banners", label: "Banners", icon: ImageIcon },
  { to: "/usuarios", label: "Usuários", icon: Users },
  { to: "/configuracoes", label: "Configurações", icon: Settings },
] as const;

function AuthenticatedLayout() {
  const navigate = useNavigate();
  const { user, accessToken, logout } = useAuthStore();
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  useEffect(() => {
    if (!accessToken) navigate({ to: "/login", replace: true });
  }, [accessToken, navigate]);

  if (!accessToken || !user) return null;

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="flex">
        {/* Sidebar */}
        <aside className="hidden md:flex fixed inset-y-0 left-0 w-64 flex-col border-r border-border bg-card">
          <div className="flex h-16 items-center px-6 border-b border-border">
            <span className="font-semibold tracking-tight">VyntrixSync</span>
          </div>
          <nav className="flex-1 space-y-1 p-3">
            {nav.map((item) => {
              const active = pathname === item.to || pathname.startsWith(item.to + "/");
              const Icon = item.icon;
              return (
                <Link
                  key={item.to}
                  to={item.to}
                  className={cn(
                    "flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors",
                    active
                      ? "bg-primary/10 text-primary font-medium"
                      : "text-muted-foreground hover:bg-accent hover:text-foreground",
                  )}
                >
                  <Icon className="h-4 w-4" />
                  {item.label}
                </Link>
              );
            })}
          </nav>
          <div className="border-t border-border p-3 space-y-2">
            <div className="px-3 py-2">
              <p className="text-sm font-medium truncate">{user.full_name}</p>
              <p className="text-xs text-muted-foreground truncate">{user.tenant_name}</p>
            </div>
            <Button
              variant="ghost"
              size="sm"
              className="w-full justify-start"
              onClick={() => {
                logout();
                navigate({ to: "/login" });
              }}
            >
              <LogOut className="mr-2 h-4 w-4" />
              Sair
            </Button>
          </div>
        </aside>

        {/* Main */}
        <main className="flex-1 md:ml-64 min-h-screen">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
