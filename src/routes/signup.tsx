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

const schema = z.object({
  tenant_name: z.string().min(2, "Nome do workspace muito curto"),
  tenant_slug: z
    .string()
    .min(3, "Slug muito curto")
    .max(32)
    .regex(/^[a-z0-9-]+$/, "Use apenas letras minúsculas, números e hífen"),
  full_name: z.string().min(2, "Informe seu nome"),
  email: z.string().email("Email inválido"),
  password: z.string().min(8, "Mínimo 8 caracteres"),
});
type FormData = z.infer<typeof schema>;

type SignupResponse = {
  user: CurrentUser;
  tokens: { access_token: string; refresh_token: string };
};

export const Route = createFileRoute("/signup")({
  head: () => ({
    meta: [
      { title: "Criar workspace — VyntrixSync" },
      { name: "description", content: "Crie seu workspace VyntrixSync em minutos." },
    ],
  }),
  component: SignupPage,
});

function SignupPage() {
  const navigate = useNavigate();
  const setAuth = useAuthStore((s) => s.setAuth);
  const [serverError, setServerError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<FormData>({ resolver: zodResolver(schema) });

  const tenantName = watch("tenant_name");
  // Auto-fill slug from name
  const autoSlug = (name: string) =>
    name.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 32);

  const onSubmit = async (values: FormData) => {
    setServerError(null);
    try {
      const res = await api<SignupResponse>("/api/v1/auth/signup", {
        method: "POST",
        body: values,
        auth: false,
      });
      setAuth(res.user, res.tokens.access_token, res.tokens.refresh_token);
      navigate({ to: "/dashboard" });
    } catch (e) {
      setServerError(e instanceof ApiError ? e.message : "Falha ao criar conta");
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4 py-10">
      <Card className="w-full max-w-lg">
        <CardHeader className="space-y-1">
          <CardTitle className="text-2xl">Criar workspace</CardTitle>
          <CardDescription>Comece grátis. Seu workspace fica isolado com dados próprios.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="tenant_name">Nome do workspace</Label>
                <Input
                  id="tenant_name"
                  placeholder="Minha Empresa"
                  {...register("tenant_name", {
                    onChange: (e) => {
                      const current = watch("tenant_slug");
                      if (!current) setValue("tenant_slug", autoSlug(e.target.value));
                    },
                  })}
                />
                {errors.tenant_name && <p className="text-sm text-destructive">{errors.tenant_name.message}</p>}
              </div>
              <div className="space-y-2">
                <Label htmlFor="tenant_slug">Slug (URL)</Label>
                <Input id="tenant_slug" placeholder="minha-empresa" {...register("tenant_slug")} />
                {errors.tenant_slug && <p className="text-sm text-destructive">{errors.tenant_slug.message}</p>}
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="full_name">Seu nome</Label>
              <Input id="full_name" {...register("full_name")} />
              {errors.full_name && <p className="text-sm text-destructive">{errors.full_name.message}</p>}
            </div>
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input id="email" type="email" autoComplete="email" {...register("email")} />
              {errors.email && <p className="text-sm text-destructive">{errors.email.message}</p>}
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Senha</Label>
              <Input id="password" type="password" autoComplete="new-password" {...register("password")} />
              {errors.password && <p className="text-sm text-destructive">{errors.password.message}</p>}
            </div>
            {serverError && (
              <div className="rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
                {serverError}
              </div>
            )}
            <Button type="submit" className="w-full" disabled={isSubmitting}>
              {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Criar workspace
            </Button>
            <p className="text-center text-sm text-muted-foreground">
              Já tem conta?{" "}
              <Link to="/login" className="text-primary underline-offset-4 hover:underline">
                Entrar
              </Link>
            </p>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
