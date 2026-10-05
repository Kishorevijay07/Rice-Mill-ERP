"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api";
import type {
  Buyer,
  Page,
  Product,
  TaxInvoice,
  TaxInvoiceDetail,
} from "@/lib/types";

const API_BASE =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000/api/v1";

// ---- Buyers ----
export function useBuyers(activeOnly = false) {
  return useQuery({
    queryKey: ["buyers", activeOnly],
    queryFn: () => apiFetch<Buyer[]>(`/buyers?active_only=${activeOnly}`),
  });
}

export interface BuyerInput {
  name: string;
  address?: string;
  gstin?: string;
  state_name?: string;
  state_code?: string;
  cell?: string;
  is_active?: boolean;
}

export function useCreateBuyer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: BuyerInput) =>
      apiFetch<Buyer>("/buyers", {
        method: "POST",
        body: JSON.stringify(input),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["buyers"] }),
  });
}

export function useUpdateBuyer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: BuyerInput }) =>
      apiFetch<Buyer>(`/buyers/${id}`, {
        method: "PUT",
        body: JSON.stringify(input),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["buyers"] }),
  });
}

export function useDeleteBuyer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiFetch<void>(`/buyers/${id}`, { method: "DELETE" }),
    // Optimistically drop the row so the list re-renders immediately on click.
    onMutate: async (id: string) => {
      await qc.cancelQueries({ queryKey: ["buyers"] });
      const snapshots = qc.getQueriesData<Buyer[]>({ queryKey: ["buyers"] });
      for (const [key, list] of snapshots) {
        if (list) {
          qc.setQueryData<Buyer[]>(
            key,
            list.filter((b) => b.id !== id),
          );
        }
      }
      return { snapshots };
    },
    onError: (_err, _id, context) => {
      for (const [key, list] of context?.snapshots ?? []) {
        qc.setQueryData(key, list);
      }
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: ["buyers"] });
    },
  });
}

// ---- Products ----
export function useProducts(activeOnly = false) {
  return useQuery({
    queryKey: ["products", activeOnly],
    queryFn: () => apiFetch<Product[]>(`/products?active_only=${activeOnly}`),
  });
}

export interface ProductInput {
  name: string;
  hsn_sac?: string;
  default_gst_rate?: string;
  default_uom?: string;
  default_rate?: string;
  is_active?: boolean;
}

export function useCreateProduct() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: ProductInput) =>
      apiFetch<Product>("/products", {
        method: "POST",
        body: JSON.stringify(input),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["products"] }),
  });
}

// ---- Tax invoices ----
export interface InvoiceLineInput {
  product_id?: string | null;
  description: string;
  bags?: number | null;
  hsn_sac?: string;
  quantity: string;
  uom: string;
  rate: string;
  gst_rate: string;
}

export function formatLineDescription(
  name: string,
  bags?: string | number | null,
  quantity?: string | number | null,
  uom?: string | null,
  rate?: string | number | null,
  gstRate?: string | number | null,
): string {
  const trimmed = (name || "").trim();
  if (trimmed.toUpperCase().includes("BAGS") || trimmed.includes("[")) {
    return trimmed;
  }
  const lines: string[] = [];
  if (trimmed) {
    lines.push(trimmed);
  }

  const b =
    bags !== undefined && bags !== null && String(bags).trim() !== ""
      ? String(bags).trim()
      : null;
  const q =
    quantity !== undefined &&
    quantity !== null &&
    String(quantity).trim() !== ""
      ? String(quantity).trim()
      : null;
  const u = (uom || "MT").trim();

  if (b && q) {
    lines.push(`[${b} BAGS,WT.${q} ${u}]`);
  } else if (b) {
    lines.push(`[${b} BAGS]`);
  } else if (q) {
    lines.push(`[WT.${q} ${u}]`);
  }

  const r =
    rate !== undefined && rate !== null && String(rate).trim() !== ""
      ? String(rate).trim()
      : null;
  if (r) {
    const num = parseFloat(r);
    const rateStr = Number.isFinite(num)
      ? num % 1 === 0
        ? num.toString()
        : num.toFixed(2)
      : r;
    const gstNum = parseFloat(gstRate ? String(gstRate) : "0");
    const gstSuffix = gstNum > 0 ? " + GST" : "";
    lines.push(`RATE @${rateStr}/- ${u}${gstSuffix}`);
  }

  return lines.join("\n");
}

export interface InvoiceInput {
  invoice_date: string;
  invoice_number?: string;
  buyer_id?: string | null;
  dispatched_through?: string;
  destination?: string;
  motor_vehicle_no?: string;
  delivery_note?: string;
  mode_terms_of_payment?: string;
  reference_no_date?: string;
  buyers_order_no?: string;
  remarks?: string;
  declaration?: string;
  lines: InvoiceLineInput[];
}

export function useInvoices(page = 1) {
  return useQuery({
    queryKey: ["tax-invoices", page],
    queryFn: () => apiFetch<Page<TaxInvoice>>(`/tax-invoices?page=${page}`),
  });
}

export function useInvoice(id: string) {
  return useQuery({
    queryKey: ["tax-invoice", id],
    queryFn: () => apiFetch<TaxInvoiceDetail>(`/tax-invoices/${id}`),
    enabled: Boolean(id),
  });
}

export function useCreateInvoice() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: InvoiceInput) =>
      apiFetch<TaxInvoiceDetail>("/tax-invoices", {
        method: "POST",
        body: JSON.stringify(input),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["tax-invoices"] }),
  });
}

export function useUpdateInvoice(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: InvoiceInput) =>
      apiFetch<TaxInvoiceDetail>(`/tax-invoices/${id}`, {
        method: "PUT",
        body: JSON.stringify(input),
      }),
    onSuccess: () => invalidate(qc, id),
  });
}

function invalidate(qc: ReturnType<typeof useQueryClient>, id: string) {
  qc.invalidateQueries({ queryKey: ["tax-invoices"] });
  qc.invalidateQueries({ queryKey: ["tax-invoice", id] });
}

export function useIssueInvoice(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () =>
      apiFetch<TaxInvoiceDetail>(`/tax-invoices/${id}/issue`, {
        method: "POST",
      }),
    onSuccess: () => invalidate(qc, id),
  });
}

export function useUploadEwayBill(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (file: File) => {
      const body = new FormData();
      body.append("file", file);
      const res = await fetch(`${API_BASE}/tax-invoices/${id}/eway-bill`, {
        method: "POST",
        credentials: "include",
        body,
      });
      if (!res.ok) throw new Error("Failed to upload e-Way Bill");
      return (await res.json()) as { document_id: string; filename: string };
    },
    onSuccess: () => invalidate(qc, id),
  });
}

/** Fetch the invoice PDF (with session cookie) and trigger a browser download. */
export async function downloadInvoicePdf(
  invoiceId: string,
  invoiceNumber: string,
): Promise<void> {
  const res = await fetch(
    `${API_BASE}/tax-invoices/${invoiceId}/pdf/download`,
    {
      credentials: "include",
    },
  );
  if (!res.ok) throw new Error("Failed to download invoice PDF");
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `tax-invoice-${invoiceNumber}.pdf`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
