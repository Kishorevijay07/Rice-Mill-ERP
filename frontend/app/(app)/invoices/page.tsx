"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ApiError } from "@/lib/api";
import { useHasPermission } from "@/lib/auth";
import { formatDate, formatMoney } from "@/lib/format";
import {
  type InvoiceLineInput,
  formatLineDescription,
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
  }

  const taxable = rows.reduce((s, r) => s + lineTaxable(r), 0);
  const tax = rows.reduce((s, r) => s + lineGst(r), 0);

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
    create.mutate(
      {
        invoice_date: header.invoice_date,
        invoice_number: header.invoice_number || undefined,
        buyer_id: header.buyer_id || null,
        dispatched_through: header.dispatched_through || undefined,
        destination: header.destination || undefined,
        motor_vehicle_no: header.motor_vehicle_no || undefined,
        delivery_note: header.delivery_note || undefined,
        remarks: header.remarks || undefined,
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
            </div>

            <div className="space-y-3">
              {rows.map((row, i) => (
                <div
                  key={i}
                  className="grid gap-2 rounded-md border border-border p-3 sm:grid-cols-12"
                >
                  <Field label="Product" className="sm:col-span-3">
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
                  <Field label="Description" className="sm:col-span-3">
                    <Input
                      value={row.description}
                      onChange={(e) =>
                        updateRow(i, { description: e.target.value })
                      }
                      required
                    />
                  </Field>
                  <Field label="HSN/SAC" className="sm:col-span-2">
                    <Input
                      value={row.hsn_sac}
                      onChange={(e) =>
                        updateRow(i, { hsn_sac: e.target.value })
                      }
                    />
                  </Field>
                  <Field label="Bags" className="sm:col-span-2">
                    <Input
                      type="number"
                      min="0"
                      step="1"
                      placeholder="e.g. 530"
                      value={row.bags}
                      onChange={(e) => updateRow(i, { bags: e.target.value })}
                    />
                  </Field>
                  <Field label="Qty" className="sm:col-span-2">
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
                  <Field label="UOM" className="sm:col-span-2">
                    <Input
                      value={row.uom}
                      onChange={(e) => updateRow(i, { uom: e.target.value })}
                    />
                  </Field>
                  <Field label="Rate" className="sm:col-span-3">
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
                  <Field label="GST %" className="sm:col-span-2">
                    <Input
                      type="number"
                      step="0.01"
                      min="0"
                      value={row.gst_rate}
                      onChange={(e) =>
                        updateRow(i, { gst_rate: e.target.value })
                      }
                    />
                  </Field>
                  <div className="flex items-end justify-between sm:col-span-3">
                    <p className="text-xs text-muted-foreground">
                      Taxable {money(lineTaxable(row))} ·{" "}
                      {interstate
                        ? `IGST ${money(lineGst(row))}`
                        : `CGST ${money(lineCgst(row))} · SGST ${money(lineCgst(row))}`}
                    </p>
                  </div>
                  <div className="flex items-end justify-end sm:col-span-2">
                    {rows.length > 1 ? (
                      <button
                        type="button"
                        className="text-xs text-red-600 hover:underline"
                        onClick={() =>
                          setRows((r) => r.filter((_, idx) => idx !== i))
                        }
                      >
                        Remove
                      </button>
                    ) : null}
                  </div>
                  <div className="rounded border border-dashed border-border bg-muted/30 px-3 py-2 text-xs sm:col-span-12">
                    <span className="font-semibold text-muted-foreground">
                      Description of Goods Preview (on invoice):
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
                onClick={() => setRows((r) => [...r, { ...EMPTY_ROW }])}
              >
                + Add line
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
              <div className="flex justify-between font-semibold">
                <span>Grand total</span>
                <span>{money(taxable + tax)}</span>
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
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-border text-left text-muted-foreground">
                <tr>
                  <th className="p-3 font-medium">Invoice No.</th>
                  <th className="p-3 font-medium">Buyer</th>
                  <th className="p-3 font-medium">Date</th>
                  <th className="p-3 font-medium">Status</th>
                  <th className="p-3 font-medium">Total</th>
                  <th className="p-3" />
                </tr>
              </thead>
              <tbody>
                {data.items.map((inv) => (
                  <tr
                    key={inv.id}
                    className="border-b border-border last:border-0"
                  >
                    <td className="p-3 font-medium">{inv.invoice_number}</td>
                    <td className="p-3">{inv.buyer_name}</td>
                    <td className="p-3 text-muted-foreground">
                      {formatDate(inv.invoice_date)}
                    </td>
                    <td className="p-3">
                      <StatusPill status={inv.status} />
                    </td>
                    <td className="p-3">{formatMoney(inv.grand_total)}</td>
                    <td className="p-3 text-right">
                      <Link
                        href={`/invoices/view?id=${inv.id}`}
                        className="font-medium text-primary hover:underline"
                      >
                        Open
                      </Link>
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
