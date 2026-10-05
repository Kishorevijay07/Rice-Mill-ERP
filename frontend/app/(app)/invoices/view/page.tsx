"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useRef, useState } from "react";
import { ApiError } from "@/lib/api";
import { useHasPermission } from "@/lib/auth";
import { formatDate, formatMoney } from "@/lib/format";
import {
  type InvoiceLineInput,
  downloadInvoicePdf,
  formatLineDescription,
  useBuyers,
  useInvoice,
  useIssueInvoice,
  useProducts,
  useUpdateInvoice,
  useUploadEwayBill,
} from "@/lib/invoicing";
import { useMillSettings } from "@/lib/settings";
import type { Product, TaxInvoiceDetail } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { Input, Select } from "@/components/ui/input";
import { ErrorNote, Spinner, StatusPill } from "@/components/ui/misc";

function Detail({ label, value }: { label: string; value: string | null }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-sm">{value || "—"}</p>
    </div>
  );
}

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

function lineCgst(row: LineRow): number {
  return lineGst(row) / 2;
}

function EditInvoiceForm({
  inv,
  onClose,
}: {
  inv: TaxInvoiceDetail;
  onClose: () => void;
}) {
  const { data: buyers } = useBuyers(true);
  const { data: products } = useProducts(true);
  const { data: mill } = useMillSettings();
  const update = useUpdateInvoice(inv.id);

  const fallbackRemarks =
    inv.lines
      .map((l) => ((l.description || "").split("\n")[0] ?? "").split("[")[0]?.trim() ?? "")
      .filter(Boolean)[0] || "";

  const [header, setHeader] = useState({
    invoice_date: inv.invoice_date,
    invoice_number: inv.invoice_number,
    buyer_id: inv.buyer_id || "",
    dispatched_through: inv.dispatched_through || "",
    destination: inv.destination || "",
    motor_vehicle_no: inv.motor_vehicle_no || "",
    delivery_note: inv.delivery_note || "",
    remarks: inv.remarks || fallbackRemarks,
  });

  const [rows, setRows] = useState<LineRow[]>(() => {
    if (!inv.lines || inv.lines.length === 0) {
      return [{ ...EMPTY_ROW }];
    }
    return inv.lines.map((ln) => {
      const fullDesc = ln.description || "";
      const firstLine = (fullDesc.split("\n")[0] ?? "").split("[")[0]?.trim();
      const cleanDesc = firstLine || fullDesc;
      return {
        product_id: ln.product_id || "",
        description: cleanDesc,
        bags: ln.bags !== null && ln.bags !== undefined ? String(ln.bags) : "",
        hsn_sac: ln.hsn_sac || "",
        quantity: String(ln.quantity ?? ""),
        uom: ln.uom || "MT",
        rate: String(ln.rate ?? ""),
        gst_rate: String(ln.gst_rate ?? "0"),
      };
    });
  });

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

  const selectedBuyer = (buyers ?? []).find((b) => b.id === header.buyer_id);
  const sellerState = mill?.state_code?.trim();
  const buyerState = selectedBuyer?.state_code?.trim() || inv.buyer_state_code?.trim();
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
    const finalRemarks =
      header.remarks ||
      rows
        .map((r) => ((r.description || "").split("\n")[0] ?? "").split("[")[0]?.trim() ?? "")
        .filter(Boolean)[0] ||
      undefined;

    update.mutate(
      {
        invoice_date: header.invoice_date,
        invoice_number: header.invoice_number || undefined,
        buyer_id: header.buyer_id || null,
        dispatched_through: header.dispatched_through || undefined,
        destination: header.destination || undefined,
        motor_vehicle_no: header.motor_vehicle_no || undefined,
        delivery_note: header.delivery_note || undefined,
        remarks: finalRemarks,
        lines,
      },
      {
        onSuccess: () => {
          onClose();
        },
      },
    );
  }

  return (
    <Card className="border-primary/40 shadow-sm">
      <CardHeader>
        <CardTitle>Edit Invoice {inv.invoice_number}</CardTitle>
      </CardHeader>
      <CardContent>
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
            <Field label="Invoice no">
              <Input
                value={header.invoice_number}
                onChange={(e) =>
                  setHeader({ ...header, invoice_number: e.target.value })
                }
                required
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
                    onChange={(e) => updateRow(i, { hsn_sac: e.target.value })}
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
              update.error instanceof ApiError ? update.error.message : undefined
            }
          />
          <div className="flex gap-2">
            <Button type="submit" disabled={update.isPending}>
              {update.isPending ? "Saving…" : "Save changes"}
            </Button>
            <Button type="button" variant="ghost" onClick={onClose}>
              Cancel
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

function InvoiceView() {
  const searchParams = useSearchParams();
  const id = searchParams.get("id") ?? "";
  const initialEdit = searchParams.get("edit") === "true";
  const { data: inv, isLoading, isError } = useInvoice(id);
  const issue = useIssueInvoice(id);
  const uploadEway = useUploadEwayBill(id);
  const can = useHasPermission();
  const fileInput = useRef<HTMLInputElement>(null);
  const [downloadError, setDownloadError] = useState<string | undefined>();
  const [isEditing, setIsEditing] = useState(initialEdit);

  if (isLoading) {
    return (
      <div className="flex justify-center py-12">
        <Spinner className="h-8 w-8" />
      </div>
    );
  }
  if (isError || !inv) {
    return <ErrorNote message="Could not load invoice." />;
  }

  async function onDownload() {
    setDownloadError(undefined);
    try {
      await downloadInvoicePdf(inv!.id, inv!.invoice_number);
    } catch {
      setDownloadError("Failed to download the invoice PDF.");
    }
  }

  const derivedRemarks =
    inv.lines
      .map((l) => ((l.description || "").split("\n")[0] ?? "").split("[")[0]?.trim() ?? "")
      .filter(Boolean)
      .filter((v, i, a) => a.indexOf(v) === i)
      .join(", ") || null;
  const remarksToDisplay = inv.remarks || derivedRemarks;

  return (
    <div className="space-y-6">
      <Link href="/invoices" className="text-sm text-primary hover:underline">
        ← Back to invoices
      </Link>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-semibold">
            Invoice {inv.invoice_number}
          </h1>
          <StatusPill status={inv.status} />
        </div>
        <div className="flex flex-wrap gap-2">
          {inv.status === "DRAFT" && can("invoice.issue") ? (
            <Button onClick={() => issue.mutate()} disabled={issue.isPending}>
              {issue.isPending ? "Issuing…" : "Issue invoice"}
            </Button>
          ) : null}
          {can("invoice.create") ? (
            <Button
              variant={isEditing ? "ghost" : "outline"}
              onClick={() => setIsEditing(!isEditing)}
            >
              {isEditing ? "Close edit" : "Edit invoice"}
            </Button>
          ) : null}
          <Button variant="outline" onClick={onDownload}>
            Download PDF
          </Button>
          {can("invoice.create") ? (
            <>
              <input
                ref={fileInput}
                type="file"
                accept="application/pdf"
                hidden
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) uploadEway.mutate(f);
                  e.target.value = "";
                }}
              />
              <Button
                variant="outline"
                onClick={() => fileInput.current?.click()}
                disabled={uploadEway.isPending}
              >
                {uploadEway.isPending
                  ? "Uploading…"
                  : inv.eway_document_id
                    ? "Replace e-Way Bill"
                    : "Upload e-Way Bill"}
              </Button>
            </>
          ) : null}
        </div>
      </div>
      <ErrorNote message={downloadError} />

      {isEditing ? (
        <EditInvoiceForm inv={inv} onClose={() => setIsEditing(false)} />
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Buyer & dispatch</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-3">
          <Detail label="Buyer" value={inv.buyer_name} />
          <Detail label="GSTIN/UIN" value={inv.buyer_gstin} />
          <Detail label="Invoice date" value={formatDate(inv.invoice_date)} />
          <Detail label="Address" value={inv.buyer_address} />
          <Detail label="Destination" value={inv.destination} />
          <Detail label="Motor vehicle no" value={inv.motor_vehicle_no} />
          <Detail label="Dispatched through" value={inv.dispatched_through} />
          <Detail label="Delivery note" value={inv.delivery_note} />
          <Detail label="Remarks" value={remarksToDisplay} />
          <Detail
            label="e-Way Bill"
            value={inv.eway_document_id ? "Attached" : null}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Line items</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-border text-left text-muted-foreground">
              <tr>
                <th className="p-2 font-medium">Description</th>
                <th className="p-2 font-medium">HSN/SAC</th>
                <th className="p-2 font-medium">Qty</th>
                <th className="p-2 font-medium">Rate</th>
                <th className="p-2 font-medium">Taxable</th>
                {inv.is_interstate ? (
                  <th className="p-2 font-medium">IGST</th>
                ) : (
                  <>
                    <th className="p-2 font-medium">CGST</th>
                    <th className="p-2 font-medium">SGST</th>
                  </>
                )}
              </tr>
            </thead>
            <tbody>
              {inv.lines.map((ln) => (
                <tr
                  key={ln.id}
                  className="border-b border-border last:border-0"
                >
                  <td className="whitespace-pre-line p-2">{ln.description}</td>
                  <td className="p-2">{ln.hsn_sac || "—"}</td>
                  <td className="p-2">
                    {ln.quantity} {ln.uom}
                  </td>
                  <td className="p-2">{formatMoney(ln.rate)}</td>
                  <td className="p-2">{formatMoney(ln.taxable_amount)}</td>
                  {inv.is_interstate ? (
                    <td className="p-2">
                      {formatMoney(ln.igst_amount)}
                      <span className="text-xs text-muted-foreground">
                        {" "}
                        @ {ln.igst_rate}%
                      </span>
                    </td>
                  ) : (
                    <>
                      <td className="p-2">
                        {formatMoney(ln.cgst_amount)}
                        <span className="text-xs text-muted-foreground">
                          {" "}
                          @ {ln.cgst_rate}%
                        </span>
                      </td>
                      <td className="p-2">
                        {formatMoney(ln.sgst_amount)}
                        <span className="text-xs text-muted-foreground">
                          {" "}
                          @ {ln.sgst_rate}%
                        </span>
                      </td>
                    </>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
          <div className="mt-4 space-y-1 border-t border-border pt-4 text-sm sm:ml-auto sm:w-72">
            <div className="flex justify-between">
              <span>Taxable value</span>
              <span>{formatMoney(inv.taxable_amount)}</span>
            </div>
            {inv.is_interstate ? (
              <div className="flex justify-between">
                <span>IGST</span>
                <span>{formatMoney(inv.total_tax_amount)}</span>
              </div>
            ) : (
              <>
                <div className="flex justify-between">
                  <span>CGST</span>
                  <span>
                    {formatMoney(
                      inv.tax_summary
                        .reduce((s, r) => s + Number(r.cgst_amount), 0)
                        .toFixed(2),
                    )}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span>SGST</span>
                  <span>
                    {formatMoney(
                      inv.tax_summary
                        .reduce((s, r) => s + Number(r.sgst_amount), 0)
                        .toFixed(2),
                    )}
                  </span>
                </div>
              </>
            )}
            <div className="flex justify-between font-semibold">
              <span>Grand total</span>
              <span>{formatMoney(inv.grand_total)}</span>
            </div>
          </div>
          <p className="mt-3 text-xs text-muted-foreground">
            {inv.amount_in_words}
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

export default function InvoiceViewPage() {
  return (
    <Suspense
      fallback={
        <div className="flex justify-center py-12">
          <Spinner className="h-8 w-8" />
        </div>
      }
    >
      <InvoiceView />
    </Suspense>
  );
}
