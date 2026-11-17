"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Plus, Trash2, FileText, ChevronRight } from "lucide-react";
import { ApiError } from "@/lib/api";
import { useHasPermission } from "@/lib/auth";
import { formatDate, formatMoney } from "@/lib/format";
import {
  type InvoiceLineInput,
  formatLineDescription,
  isBagBilling,
  useBuyers,
  useCreateInvoice,
  useInvoices,
  useProducts,
} from "@/lib/invoicing";
import { useMillSettings } from "@/lib/settings";
import type { Product } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { Input, Select } from "@/components/ui/input";
import {
  EmptyState,
  ErrorNote,
  Spinner,
  StatusPill,
} from "@/components/ui/misc";

type LineRow = {
  product_id: string;
  description: string;
  bags: string;
  hsn_sac: string;
  quantity: string;
  uom: string;
  rate: string;
  gst_rate: string;
};

const EMPTY_ROW: LineRow = {
  product_id: "",
  description: "",
  bags: "",
  hsn_sac: "",
  quantity: "",
  uom: "MT",
  rate: "",
  gst_rate: "",
};

function money(n: number): string {
  return formatMoney(Number.isFinite(n) ? n : 0);
}

function lineTaxable(row: LineRow): number {
  if (isBagBilling(row.uom)) {
    const bags = parseInt(row.bags, 10);
    const count =
      Number.isFinite(bags) && bags > 0 ? bags : Number(row.quantity) || 0;
    return count * (Number(row.rate) || 0);
  }
  return (Number(row.quantity) || 0) * (Number(row.rate) || 0);
}

function lineGst(row: LineRow): number {
  return (lineTaxable(row) * (Number(row.gst_rate) || 0)) / 100;
}

// Intra-state GST is shown split equally as CGST + SGST.
function lineCgst(row: LineRow): number {
  return lineGst(row) / 2;
}

function NewInvoiceForm({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const { data: buyers } = useBuyers(true);
  const { data: products } = useProducts(true);
  const { data: mill } = useMillSettings();
  const create = useCreateInvoice();

  const today = new Date().toISOString().slice(0, 10);
  const [header, setHeader] = useState({
    invoice_date: today,
    invoice_number: "",
    buyer_id: "",
    dispatched_through: "",
    destination: "",
    motor_vehicle_no: "",
    delivery_note: "",
    remarks: "",
  });
  const [rows, setRows] = useState<LineRow[]>([{ ...EMPTY_ROW }]);

  function updateRow(i: number, patch: Partial<LineRow>) {
    setRows((r) =>
      r.map((row, idx) => (idx === i ? { ...row, ...patch } : row)),
    );
  }

  function onPickProduct(i: number, productId: string) {
    const p: Product | undefined = (products ?? []).find(
      (x) => x.id === productId,
    );
    if (!p) {
      updateRow(i, { product_id: "" });
      return;
    }
    const current = rows[i] ?? EMPTY_ROW;
    updateRow(i, {
      product_id: p.id,
      description: current.description || p.name,
      hsn_sac: p.hsn_sac ?? "",
      uom: p.default_uom,
      rate: p.default_rate ?? current.rate,
      gst_rate: p.default_gst_rate,
    });
    if (!header.remarks || !header.remarks.trim()) {
      setHeader((h) => ({ ...h, remarks: p.name }));
    }
  }

  const taxable = rows.reduce((s, r) => s + lineTaxable(r), 0);
  const tax = rows.reduce((s, r) => s + lineGst(r), 0);
  const rawTotal = taxable + tax;
  const cents = Math.round(rawTotal * 100);
  const paise = cents % 100;
  const grandTotal =
    paise >= 40 ? Math.floor(cents / 100) + 1 : Math.floor(cents / 100);
  const roundOff = paise === 0 ? 0 : Number((grandTotal - rawTotal).toFixed(2));

  // Inter-state (buyer in a different state) → IGST; same state → CGST + SGST.
  const selectedBuyer = (buyers ?? []).find((b) => b.id === header.buyer_id);
  const sellerState = mill?.state_code?.trim();
  const buyerState = selectedBuyer?.state_code?.trim();
  const interstate = Boolean(
    sellerState && buyerState && sellerState !== buyerState,
  );

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const lines: InvoiceLineInput[] = rows
      .filter((r) => r.description && r.quantity && r.rate)
      .map((r) => ({
        product_id: r.product_id || null,
        description: formatLineDescription(
          r.description,
          r.bags,
          r.quantity,
          r.uom,
          r.rate,
          r.gst_rate,
        ),
        bags: r.bags ? parseInt(r.bags, 10) : undefined,
        hsn_sac: r.hsn_sac || undefined,
        quantity: r.quantity,
        uom: r.uom,
        rate: r.rate,
        gst_rate: r.gst_rate || "0",
      }));
    if (lines.length === 0) return;
    const derivedRemarks =
      header.remarks ||
      rows
        .map((r) => ((r.description || "").split("\n")[0] ?? "").split("[")[0]?.trim() ?? "")
        .filter(Boolean)[0] ||
      undefined;
    create.mutate(
      {
        invoice_date: header.invoice_date,
        invoice_number: header.invoice_number || undefined,
        buyer_id: header.buyer_id || null,
        dispatched_through: header.dispatched_through || undefined,
        destination: header.destination || undefined,
        motor_vehicle_no: header.motor_vehicle_no || undefined,
        delivery_note: header.delivery_note || undefined,
        remarks: derivedRemarks,
        lines,
      },
      { onSuccess: (inv) => router.push(`/invoices/view?id=${inv.id}`) },
    );
  }

  return (
    <Card className="mb-6">
      <CardHeader>
        <CardTitle>New tax invoice</CardTitle>
      </CardHeader>
      <CardContent>
        {(buyers?.length ?? 0) === 0 ? (
          <EmptyState>
            Add a buyer first (Settings → Buyers) before creating an invoice.
          </EmptyState>
        ) : (
          <form onSubmit={submit} className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label="Invoice date">
                <Input
                  type="date"
                  value={header.invoice_date}
                  onChange={(e) =>
                    setHeader({ ...header, invoice_date: e.target.value })
                  }
                  required
                />
              </Field>
              <Field label="Invoice no (optional)">
                <Input
                  value={header.invoice_number}
                  placeholder="auto"
                  onChange={(e) =>
                    setHeader({ ...header, invoice_number: e.target.value })
                  }
                />
              </Field>
              <Field label="Buyer">
                <Select
                  value={header.buyer_id}
                  onChange={(e) =>
                    setHeader({ ...header, buyer_id: e.target.value })
                  }
                  required
                >
                  <option value="" disabled>
                    Select buyer
                  </option>
                  {(buyers ?? []).map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                      {b.gstin ? ` · ${b.gstin}` : ""}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Dispatched through">
                <Input
                  value={header.dispatched_through}
                  onChange={(e) =>
                    setHeader({ ...header, dispatched_through: e.target.value })
                  }
                />
              </Field>
              <Field label="Destination">
                <Input
                  value={header.destination}
                  onChange={(e) =>
                    setHeader({ ...header, destination: e.target.value })
                  }
                />
              </Field>
              <Field label="Motor vehicle no">
                <Input
                  value={header.motor_vehicle_no}
                  onChange={(e) =>
                    setHeader({ ...header, motor_vehicle_no: e.target.value })
                  }
                />
              </Field>
              <Field label="Delivery note">
                <Input
                  value={header.delivery_note}
                  onChange={(e) =>
                    setHeader({ ...header, delivery_note: e.target.value })
                  }
                />
              </Field>
              <Field label="Remarks" className="sm:col-span-2">
                <Input
                  value={header.remarks}
                  placeholder="e.g. RICE BRAN"
                  onChange={(e) =>
                    setHeader({ ...header, remarks: e.target.value })
                  }
                />
              </Field>
            </div>

            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-foreground">Line items</h3>
                <span className="text-xs text-muted-foreground">{rows.length} {rows.length === 1 ? "item" : "items"}</span>
              </div>
              {rows.map((row, i) => (
                <div
                  key={i}
                  className="space-y-3 rounded-lg border border-border bg-card p-3 sm:p-4 shadow-sm"
                >
                  <div className="flex items-center justify-between gap-2 border-b border-border/60 pb-2">
                    <span className="inline-flex items-center rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-semibold text-primary">
                      Item #{i + 1}
                    </span>
                    {rows.length > 1 ? (
                      <button
                        type="button"
                        aria-label={`Remove item ${i + 1}`}
                        className="inline-flex items-center gap-1 text-xs text-destructive hover:text-destructive/80"
                        onClick={() =>
                          setRows((r) => r.filter((_, idx) => idx !== i))
                        }
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                        <span>Remove</span>
                      </button>
                    ) : null}
                  </div>

                  <div className="grid gap-3 sm:grid-cols-2">
                    <Field label="Product preset">
                      <Select
                        value={row.product_id}
                        onChange={(e) => onPickProduct(i, e.target.value)}
                      >
                        <option value="">— custom —</option>
                        {(products ?? []).map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name}
                          </option>
                        ))}
                      </Select>
                    </Field>
                    <Field label="Description">
                      <Input
                        value={row.description}
                        placeholder="e.g. RICE BRAN"
                        onChange={(e) =>
                          updateRow(i, { description: e.target.value })
                        }
                        required
                      />
                    </Field>
                  </div>

                  {/* Units grid: 3-column on mobile & desktop */}
                  <div className="grid grid-cols-3 gap-2 sm:gap-3">
                    <Field label="Bags">
                      <Input
                        type="number"
                        min="0"
                        step="1"
                        placeholder="e.g. 530"
                        value={row.bags}
                        onChange={(e) => updateRow(i, { bags: e.target.value })}
                      />
                    </Field>
                    <Field label="Qty / Weight">
                      <Input
                        type="number"
                        step="0.001"
                        min="0"
                        placeholder="e.g. 24.69"
                        value={row.quantity}
                        onChange={(e) =>
                          updateRow(i, { quantity: e.target.value })
                        }
                        required
                      />
                    </Field>
                    <Field label="UOM">
                      <Input
                        list="uom-options"
                        value={row.uom}
                        placeholder="MT / BAG"
                        onChange={(e) => updateRow(i, { uom: e.target.value })}
                      />
                      <datalist id="uom-options">
                        <option value="MT" />
                        <option value="BAG" />
                        <option value="BAGS" />
                        <option value="KGS" />
                      </datalist>
                    </Field>
                  </div>

                  {/* Pricing grid: 3-column on mobile & desktop */}
                  <div className="grid grid-cols-3 gap-2 sm:gap-3">
                    <Field label="HSN/SAC">
                      <Input
                        value={row.hsn_sac}
                        placeholder="e.g. 23022020"
                        onChange={(e) =>
                          updateRow(i, { hsn_sac: e.target.value })
                        }
                      />
                    </Field>
                    <Field label="Rate (₹)">
                      <Input
                        type="number"
                        step="0.0001"
                        min="0"
                        placeholder="e.g. 22000"
                        value={row.rate}
                        onChange={(e) => updateRow(i, { rate: e.target.value })}
                        required
                      />
                    </Field>
                    <Field label="GST %">
                      <Input
                        type="number"
                        step="0.01"
                        min="0"
                        placeholder="e.g. 5"
                        value={row.gst_rate}
                        onChange={(e) =>
                          updateRow(i, { gst_rate: e.target.value })
                        }
                      />
                    </Field>
                  </div>

                  {/* Live calculations pill */}
                  <div className="rounded-md bg-muted/50 p-2.5 text-xs">
                    <div className="flex flex-wrap items-center justify-between gap-1">
                      <span className="font-semibold text-foreground">
                        {isBagBilling(row.uom)
                          ? `Billed by Bag: ${(parseInt(row.bags, 10) || Number(row.quantity) || 0)} BAGS × ${money(Number(row.rate) || 0)}`
                          : `Billed by Qty: ${row.quantity || 0} ${row.uom || "MT"} × ${money(Number(row.rate) || 0)}`}
                      </span>
                      <span className="font-medium text-foreground">
                        Taxable: {money(lineTaxable(row))}
                      </span>
                    </div>
                    <div className="mt-1 text-muted-foreground">
                      {interstate
                        ? `IGST (${row.gst_rate || 0}%): ${money(lineGst(row))}`
                        : `CGST: ${money(lineCgst(row))} · SGST: ${money(lineCgst(row))}`}
                    </div>
                  </div>

                  <div className="rounded border border-dashed border-border bg-muted/20 px-3 py-2 text-xs">
                    <span className="font-medium text-muted-foreground">
                      Description preview on invoice:
                    </span>
                    <div className="mt-1 font-mono text-xs whitespace-pre-line text-foreground">
                      {formatLineDescription(
                        row.description,
                        row.bags,
                        row.quantity,
                        row.uom,
                        row.rate,
                        row.gst_rate,
                      ) || (
                        <span className="italic text-muted-foreground">
                          Fill in item details above
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              ))}
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="w-full sm:w-auto"
                onClick={() => setRows((r) => [...r, { ...EMPTY_ROW }])}
              >
                <Plus className="mr-1.5 h-4 w-4" />
                Add line item
              </Button>
            </div>

            <div className="rounded-md bg-muted/40 p-3 text-sm">
              <div className="flex justify-between">
                <span>Taxable</span>
                <span>{money(taxable)}</span>
              </div>
              {interstate ? (
                <div className="flex justify-between">
                  <span>IGST</span>
                  <span>{money(tax)}</span>
                </div>
              ) : (
                <>
                  <div className="flex justify-between">
                    <span>CGST</span>
                    <span>{money(tax / 2)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>SGST</span>
                    <span>{money(tax / 2)}</span>
                  </div>
                </>
              )}
              {roundOff !== 0 && (
                <div className="flex justify-between text-muted-foreground">
                  <span>Round off</span>
                  <span>
                    {roundOff > 0 ? `+${money(roundOff)}` : `-${money(Math.abs(roundOff))}`}
                  </span>
                </div>
              )}
              <div className="flex justify-between font-semibold">
                <span>Grand total</span>
                <span>{money(grandTotal)}</span>
              </div>
            </div>

            <ErrorNote
              message={
                create.error instanceof ApiError
                  ? create.error.message
                  : undefined
              }
            />
            <div className="flex gap-2">
              <Button type="submit" disabled={create.isPending}>
                {create.isPending ? "Creating…" : "Create invoice"}
              </Button>
              <Button type="button" variant="ghost" onClick={onClose}>
                Cancel
              </Button>
            </div>
          </form>
        )}
      </CardContent>
    </Card>
  );
}

export default function InvoicesPage() {
  const { data, isLoading, isError } = useInvoices();
  const [creating, setCreating] = useState(false);
  const can = useHasPermission();

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Invoices</h1>
        {can("invoice.create") && !creating ? (
          <Button onClick={() => setCreating(true)}>New invoice</Button>
        ) : null}
      </div>
      {creating ? <NewInvoiceForm onClose={() => setCreating(false)} /> : null}
      {isLoading ? (
        <div className="flex justify-center py-12">
          <Spinner className="h-8 w-8" />
        </div>
      ) : isError ? (
        <ErrorNote message="Could not load invoices." />
      ) : !data || data.items.length === 0 ? (
        <EmptyState>No invoices yet.</EmptyState>
      ) : (
        <Card>
          {/* Mobile / Tablet card list (< lg) */}
          <div className="divide-y divide-border lg:hidden">
            {data.items.map((inv) => (
              <div key={inv.id} className="p-3.5 space-y-2.5">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-foreground text-base tracking-tight">
                    #{inv.invoice_number}
                  </span>
                  <StatusPill status={inv.status} />
                </div>
                <div className="text-sm font-medium text-foreground">
                  {inv.buyer_name}
                </div>
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span>{formatDate(inv.invoice_date)}</span>
                  <span className="text-sm font-bold text-foreground">
                    {formatMoney(inv.grand_total)}
                  </span>
                </div>
                <div className="pt-1 flex items-center justify-end gap-2 text-xs">
                  <Link
                    href={`/invoices/view?id=${inv.id}`}
                    className="inline-flex min-h-[36px] items-center justify-center rounded-md bg-primary/10 px-3.5 py-1.5 font-medium text-primary hover:bg-primary/20 transition-colors"
                  >
                    Open invoice
                  </Link>
                  {can("invoice.create") ? (
                    <Link
                      href={`/invoices/view?id=${inv.id}&edit=true`}
                      className="inline-flex min-h-[36px] items-center justify-center rounded-md border border-border px-3.5 py-1.5 font-medium text-muted-foreground hover:bg-muted transition-colors"
                    >
                      Edit
                    </Link>
                  ) : null}
                </div>
              </div>
            ))}
          </div>

          {/* Desktop table (>= lg) */}
          <div className="hidden lg:block overflow-x-auto rounded-md border border-border/50">
            <table className="w-full min-w-[650px] text-sm">
              <thead className="border-b border-border bg-muted/40 text-left text-muted-foreground">
                <tr>
                  <th className="px-4 py-2.5 font-medium whitespace-nowrap">Invoice No.</th>
                  <th className="px-4 py-2.5 font-medium">Buyer</th>
                  <th className="px-4 py-2.5 font-medium whitespace-nowrap">Date</th>
                  <th className="px-4 py-2.5 font-medium whitespace-nowrap">Status</th>
                  <th className="px-4 py-2.5 font-medium whitespace-nowrap">Total</th>
                  <th className="px-4 py-2.5" />
                </tr>
              </thead>
              <tbody className="divide-y divide-border/60">
                {data.items.map((inv) => (
                  <tr
                    key={inv.id}
                    className="hover:bg-muted/30 transition-colors"
                  >
                    <td className="px-4 py-2.5 font-medium whitespace-nowrap">{inv.invoice_number}</td>
                    <td className="px-4 py-2.5">{inv.buyer_name}</td>
                    <td className="px-4 py-2.5 text-muted-foreground whitespace-nowrap">
                      {formatDate(inv.invoice_date)}
                    </td>
                    <td className="px-4 py-2.5 whitespace-nowrap">
                      <StatusPill status={inv.status} />
                    </td>
                    <td className="px-4 py-2.5 font-semibold whitespace-nowrap">{formatMoney(inv.grand_total)}</td>
                    <td className="px-4 py-2.5 text-right whitespace-nowrap">
                      <div className="inline-flex items-center gap-3">
                        <Link
                          href={`/invoices/view?id=${inv.id}`}
                          className="font-medium text-primary hover:underline"
                        >
                          Open
                        </Link>
                        {can("invoice.create") ? (
                          <Link
                            href={`/invoices/view?id=${inv.id}&edit=true`}
                            className="font-medium text-muted-foreground hover:text-foreground hover:underline"
                          >
                            Edit
                          </Link>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}
