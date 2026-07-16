import { createFileRoute, redirect } from "@tanstack/react-router";
import { useEffect } from "react";
import { useAuthStore } from "@/lib/auth-store";

export const Route = createFileRoute("/")({
  beforeLoad: () => {
    if (typeof window === "undefined") return;
    const authed = !!useAuthStore.getState().accessToken;
    throw redirect({ to: authed ? "/dashboard" : "/login" });
  },
  component: () => {
    useEffect(() => {
      const authed = !!useAuthStore.getState().accessToken;
      window.location.replace(authed ? "/dashboard" : "/login");
    }, []);
    return null;
  },
});
