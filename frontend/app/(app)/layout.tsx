"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { useMe } from "@/lib/auth";
import { AppShell } from "@/components/app-shell";
import { ServerWaking } from "@/components/ui/misc";

export default function AuthenticatedLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const router = useRouter();
  const { data, isLoading, isError } = useMe();

  useEffect(() => {
    if (isError) router.replace("/login");
  }, [isError, router]);

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <ServerWaking />
      </div>
    );
  }

  if (!data) {
    // Redirecting to /login.
    return null;
  }

  return <AppShell>{children}</AppShell>;
}
