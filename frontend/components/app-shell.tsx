"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { FileText, LogOut, Settings, User } from "lucide-react";
import { useLogout, useMe } from "@/lib/auth";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

const NAV = [
  { href: "/invoices", label: "Invoices", icon: FileText },
  { href: "/settings", label: "Settings", icon: Settings },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { data: me } = useMe();
  const logout = useLogout();

  function handleLogout() {
    logout.mutate(undefined, {
      onSuccess: () => router.replace("/login"),
    });
  }

  return (
    <div className="flex min-h-screen flex-col md:flex-row bg-muted/20">
      {/* Desktop Sidebar */}
      <aside className="hidden md:flex md:w-64 md:flex-col md:border-r md:border-border md:bg-background md:shadow-sm">
        <div className="border-b border-border p-5">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary font-bold text-primary-foreground shadow-sm">
              RM
            </div>
            <div>
              <p className="text-base font-bold leading-tight tracking-tight">
                (RM)<sup>2</sup> ERP
              </p>
              <p className="text-xs text-muted-foreground">GST & Rice Mill Management</p>
            </div>
          </div>
        </div>

        <nav className="flex-1 space-y-1.5 p-3">
          {NAV.map((item) => {
            const active = pathname.startsWith(item.href);
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-all",
                  active
                    ? "bg-primary text-primary-foreground shadow-sm"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground",
                )}
              >
                <Icon className="h-4 w-4" />
                {item.label}
              </Link>
            );
          })}
        </nav>

        {/* User Card & Sign Out at bottom of sidebar */}
        <div className="border-t border-border p-4 bg-muted/30">
          {me ? (
            <div className="mb-3 flex items-center gap-3">
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
                {me.user.full_name?.slice(0, 2).toUpperCase() || "US"}
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-foreground">
                  {me.user.full_name}
                </p>
                <p className="truncate text-xs text-muted-foreground">
                  {me.roles.join(", ")}
                </p>
              </div>
            </div>
          ) : null}
          <Button
            variant="outline"
            size="sm"
            onClick={handleLogout}
            disabled={logout.isPending}
            className="w-full justify-center gap-2 text-xs"
          >
            <LogOut className="h-3.5 w-3.5" />
            Sign out
          </Button>
        </div>
      </aside>

      {/* Mobile Top Header */}
      <header className="sticky top-0 z-40 flex items-center justify-between border-b border-border bg-background/95 px-4 py-3 backdrop-blur md:hidden shadow-xs">
        <div className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-md bg-primary text-xs font-bold text-primary-foreground">
            RM
          </div>
          <div>
            <p className="text-sm font-bold leading-tight">
              (RM)<sup>2</sup>
            </p>
            <p className="text-[10px] text-muted-foreground">GST Invoicing</p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {me ? (
            <span className="hidden xs:inline-block max-w-[120px] truncate text-xs font-medium text-muted-foreground">
              {me.user.full_name}
            </span>
          ) : null}
          <Button
            variant="ghost"
            size="sm"
            onClick={handleLogout}
            disabled={logout.isPending}
            className="h-8 px-2 text-xs text-muted-foreground hover:text-foreground"
            title="Sign out"
          >
            <LogOut className="h-4 w-4" />
            <span className="sr-only">Sign out</span>
          </Button>
        </div>
      </header>

      {/* Main Content Area with mobile bottom padding */}
      <div className="flex flex-1 flex-col pb-20 md:pb-6">
        <main className="mx-auto w-full max-w-5xl flex-1 p-3 sm:p-5 md:p-6">
          {children}
        </main>
      </div>

      {/* Mobile Bottom Navigation Bar */}
      <nav className="fixed bottom-0 left-0 right-0 z-50 flex items-center justify-around border-t border-border bg-background/95 py-1.5 backdrop-blur shadow-lg md:hidden">
        {NAV.map((item) => {
          const active = pathname.startsWith(item.href);
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex flex-col items-center gap-1 rounded-md px-5 py-1.5 text-xs font-medium transition-all active:scale-95",
                active
                  ? "text-primary"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              <div
                className={cn(
                  "flex h-7 w-12 items-center justify-center rounded-full transition-colors",
                  active ? "bg-primary/15 text-primary" : "text-muted-foreground",
                )}
              >
                <Icon className="h-4 w-4" />
              </div>
              <span className={cn(active ? "font-semibold text-primary" : "")}>
                {item.label}
              </span>
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
