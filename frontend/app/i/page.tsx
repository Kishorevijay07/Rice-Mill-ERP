"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  getPublicInvoice,
  publicInvoicePdfUrl,
  waitForBackend,
  type PublicInvoiceSummary,
} from "@/lib/api";
import { formatDate, formatMoney } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ServerWaking } from "@/components/ui/misc";

type Phase = "loading" | "ready" | "error";

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-border py-2 last:border-0">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className="text-right text-sm font-medium">{value}</span>
    </div>
  );
}

function PublicInvoice() {
  const token = useSearchParams().get("token") ?? "";
  const [phase, setPhase] = useState<Phase>("loading");
  const [summary, setSummary] = useState<PublicInvoiceSummary | null>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      if (!token) {
        setPhase("error");
        return;
      }
      // The free-tier backend may be asleep — wait for it, then fetch.
      await waitForBackend();
      try {
        const data = await getPublicInvoice(token);
        if (!active) return;
        setSummary(data);
        setPhase("ready");
      } catch {
        if (active) setPhase("error");
      }
    })();
    return () => {
      active = false;
    };
  }, [token]);

  if (phase === "loading") {
    return <ServerWaking />;
  }

  if (phase === "error" || !summary) {
    return (
      <div className="py-10 text-center">
        <p className="text-lg font-semibold">Invoice not found</p>
        <p className="mt-2 text-sm text-muted-foreground">
          This invoice link is invalid or has expired. Please check the QR code
          and try again.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="text-center">
        <h1 className="text-xl font-semibold">{summary.seller_name}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Tax Invoice {summary.invoice_number}
        </p>
      </div>

      <div>
        <Detail label="Invoice No." value={summary.invoice_number} />
        <Detail label="Date" value={formatDate(summary.invoice_date)} />
        <Detail label="Buyer" value={summary.buyer_name} />
        <Detail label="Status" value={summary.status} />
        <Detail
          label="Grand total"
          value={formatMoney(summary.grand_total, summary.currency)}
        />
      </div>

      <a href={publicInvoicePdfUrl(token)} className="block">
        <Button className="w-full">Download PDF</Button>
      </a>
      <p className="text-center text-xs text-muted-foreground">
        The download opens the official tax invoice as a PDF.
      </p>
    </div>
  );
}

export default function PublicInvoicePage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-muted/30 p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>
            (RM)<sup>2</sup>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Suspense fallback={<ServerWaking />}>
            <PublicInvoice />
          </Suspense>
        </CardContent>
      </Card>
    </main>
  );
}
