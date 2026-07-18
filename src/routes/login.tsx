import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { api, ApiError } from "@/lib/api";
import { useAuthStore, type CurrentUser } from "@/lib/auth-store";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2 } from "lucide-react";
import logo from "@/assets/vodsystem-logo.png.asset.json";

const schema = z.object({
  email: z.string().email("Email inválido"),
  password: z.string().min(1, "Informe a senha"),
});
type FormData = z.infer<typeof schema>;

type LoginResponse = {
  user: CurrentUser;
  tokens: { access_token: string; refresh_token: string };
};

export const Route = createFileRoute("/login")({
  head: () => ({
    meta: [
      { title: "Entrar — VODSystem" },
      { name: "description", content: "Acesse seu painel VODSystem." },
    ],
  }),
  component: LoginPage,
});

function LoginPage() {
  const navigate = useNavigate();
  const setAuth = useAuthStore((s) => s.setAuth);
  const [serverError, setServerError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormData>({ resolver: zodResolver(schema) });

  const onSubmit = async (values: FormData) => {
    setServerError(null);
    try {
      const res = await api<LoginResponse>("/api/v1/auth/login", {
        method: "POST",
        body: values,
        auth: false,
      });
      setAuth(res.user, res.tokens.access_token, res.tokens.refresh_token);
      navigate({ to: "/dashboard" });
    } catch (e) {
      setServerError(e instanceof ApiError ? e.message : "Falha ao entrar");
    }
  };

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-background p-4 gap-6">
      <img src={logo.url} alt="VODSystem" className="h-14 w-auto" />
      <Card className="w-full max-w-md border-border/60 shadow-[var(--shadow-brand)]">
        <CardHeader className="space-y-1">
          <CardTitle className="text-2xl">Entrar</CardTitle>
          <CardDescription>Acesse sua conta VODSystem</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input id="email" type="email" autoComplete="email" {...register("email")} />
              {errors.email && <p className="text-sm text-destructive">{errors.email.message}</p>}
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Senha</Label>
              <Input id="password" type="password" autoComplete="current-password" {...register("password")} />
              {errors.password && <p className="text-sm text-destructive">{errors.password.message}</p>}
            </div>
            {serverError && (
              <div className="rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
                {serverError}
              </div>
            )}
            <Button type="submit" className="w-full" disabled={isSubmitting}>
              {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Entrar
            </Button>
            <p className="text-center text-sm text-muted-foreground">
              Não tem conta?{" "}
              <Link to="/signup" className="text-primary underline-offset-4 hover:underline">
                Criar workspace
              </Link>
            </p>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
