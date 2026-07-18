import { createFileRoute, Outlet } from "@tanstack/react-router";

export const Route = createFileRoute("/_authenticated/sync")({
  component: SyncLayout,
});

function SyncLayout() {
  return <Outlet />;
}