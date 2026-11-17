"use client";

import { useEffect, useMemo, useState } from "react";
import { ApiError } from "@/lib/api";
import { useHasPermission } from "@/lib/auth";
import { formatMoney } from "@/lib/format";
import {
  orderStates,
  pushRecentStateCode,
  readRecentStateCodes,
  stateByCode,
} from "@/lib/india-states";
import { Pencil, Trash2 } from "lucide-react";
import type { Buyer } from "@/lib/types";
import {
  useBuyers,
  useCreateBuyer,
  useCreateProduct,
  useDeleteBuyer,
  useProducts,
  useUpdateBuyer,
} from "@/lib/invoicing";
import { useMillSettings, useUpdateMillSettings } from "@/lib/settings";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { Input, Select } from "@/components/ui/input";
import { EmptyState, ErrorNote, Spinner } from "@/components/ui/misc";

function msg(e: unknown): string | undefined {
  return e instanceof ApiError ? e.message : undefined;
}

const MILL_FORM_INIT = {
  name: "",
  address: "",
  registration_no: "",
  contact_phone: "",
  contact_email: "",
  currency: "INR",
  invoice_notes: "",
  gstin: "",
  state_name: "",
  state_code: "",
  bank_account_name: "",
  bank_name: "",
  bank_account_no: "",
  bank_branch: "",
  bank_ifsc: "",
  invoice_declaration: "",
};

function MillProfile({ canManage }: { canManage: boolean }) {
  const { data, isLoading } = useMillSettings();
  const update = useUpdateMillSettings();
  const [form, setForm] = useState(MILL_FORM_INIT);

  useEffect(() => {
    if (data) {
      setForm({
        name: data.name,
        address: data.address ?? "",
        registration_no: data.registration_no ?? "",
        contact_phone: data.contact_phone ?? "",
        contact_email: data.contact_email ?? "",
        currency: data.currency,
        invoice_notes: data.invoice_notes ?? "",
        gstin: data.gstin ?? "",
        state_name: data.state_name ?? "",
        state_code: data.state_code ?? "",
        bank_account_name: data.bank_account_name ?? "",
        bank_name: data.bank_name ?? "",
        bank_account_no: data.bank_account_no ?? "",
        bank_branch: data.bank_branch ?? "",
        bank_ifsc: data.bank_ifsc ?? "",
        invoice_declaration: data.invoice_declaration ?? "",
      });
    }
  }, [data]);

  if (isLoading) return <Spinner />;

  function submit(e: React.FormEvent) {
    e.preventDefault();
    update.mutate(form);
  }

  function bind(key: keyof typeof form) {
    return {
      value: form[key],
      onChange: (e: React.ChangeEvent<HTMLInputElement>) =>
        setForm({ ...form, [key]: e.target.value }),
      disabled: !canManage,
    };
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Mill profile & tax invoice identity</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit} className="grid gap-3 sm:grid-cols-2">
          <Field label="Mill name">
            <Input {...bind("name")} required />
          </Field>
          <Field label="GSTIN/UIN">
            <Input {...bind("gstin")} />
          </Field>
          <Field label="Address" className="sm:col-span-2">
            <Input {...bind("address")} />
          </Field>
          <Field label="State name">
            <Input {...bind("state_name")} />
          </Field>
          <Field label="State code">
            <Input {...bind("state_code")} />
          </Field>
          <Field label="E-Mail">
            <Input {...bind("contact_email")} />
          </Field>
          <Field label="Contact phone">
            <Input {...bind("contact_phone")} />
          </Field>
          <Field label="Bank A/c holder name" className="sm:col-span-2">
            <Input {...bind("bank_account_name")} />
          </Field>
          <Field label="Bank name">
            <Input {...bind("bank_name")} />
          </Field>
          <Field label="Bank A/c no">
            <Input {...bind("bank_account_no")} />
          </Field>
          <Field label="Branch">
            <Input {...bind("bank_branch")} />
          </Field>
          <Field label="IFSC code">
            <Input {...bind("bank_ifsc")} />
          </Field>
          <Field label="Invoice declaration" className="sm:col-span-2">
            <Input {...bind("invoice_declaration")} />
          </Field>
          {canManage ? (
            <div className="sm:col-span-2">
              <ErrorNote message={msg(update.error)} />
              <Button
                type="submit"
                disabled={update.isPending}
                className="mt-2"
              >
                {update.isPending ? "Saving…" : "Save profile"}
              </Button>
            </div>
          ) : null}
        </form>
      </CardContent>
    </Card>
  );
}

const BUYER_FORM_INIT = {
  name: "",
  address: "",
  gstin: "",
  state_name: "",
  state_code: "",
  cell: "",
};

function Buyers({ canManage }: { canManage: boolean }) {
  const { data, isLoading } = useBuyers();
  const create = useCreateBuyer();
  const update = useUpdateBuyer();
  const remove = useDeleteBuyer();
  const [form, setForm] = useState(BUYER_FORM_INIT);
  const [editingBuyerId, setEditingBuyerId] = useState<string | null>(null);
  const [recentStates, setRecentStates] = useState<string[]>([]);

  useEffect(() => setRecentStates(readRecentStateCodes()), []);
  const stateOptions = useMemo(() => orderStates(recentStates), [recentStates]);

  function pickState(code: string) {
    const s = stateByCode(code);
    setForm((f) => ({
      ...f,
      state_code: s?.code ?? "",
      state_name: s?.name ?? "",
    }));
  }

  function startEdit(b: Buyer) {
    setEditingBuyerId(b.id);
    setForm({
      name: b.name,
      address: b.address ?? "",
      gstin: b.gstin ?? "",
      state_name: b.state_name ?? "",
      state_code: b.state_code ?? "",
      cell: b.cell ?? "",
    });
  }

  function cancelEdit() {
    setEditingBuyerId(null);
    setForm(BUYER_FORM_INIT);
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (editingBuyerId) {
      update.mutate(
        { id: editingBuyerId, input: form },
        {
          onSuccess: () => {
            if (form.state_code) {
              setRecentStates((r) => pushRecentStateCode(form.state_code, r));
            }
            cancelEdit();
          },
        },
      );
    } else {
      create.mutate(form, {
        onSuccess: () => {
          if (form.state_code) {
            setRecentStates((r) => pushRecentStateCode(form.state_code, r));
          }
          setForm(BUYER_FORM_INIT);
        },
      });
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Buyers</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {isLoading ? (
          <Spinner />
        ) : (data?.length ?? 0) === 0 ? (
          <EmptyState>No buyers yet.</EmptyState>
        ) : (
          <>
            {/* Mobile / Tablet card list (< lg) */}
            <div className="divide-y divide-border lg:hidden">
              {(data ?? []).map((b) => (
                <div
                  key={b.id}
                  className={`py-3.5 space-y-2.5 first:pt-0 last:pb-0 ${
                    editingBuyerId === b.id ? "bg-primary/5 p-3 rounded-lg" : ""
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <span className="font-semibold text-foreground text-sm leading-snug">
                      {b.name}
                    </span>
                    {canManage ? (
                      <div className="flex items-center gap-1.5 shrink-0">
                        <button
                          type="button"
                          aria-label={`Edit ${b.name}`}
                          className="flex h-8 w-8 items-center justify-center rounded-md border border-border bg-background text-muted-foreground hover:bg-muted hover:text-primary transition-colors disabled:opacity-50"
                          onClick={() => startEdit(b)}
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          aria-label={`Delete ${b.name}`}
                          className="flex h-8 w-8 items-center justify-center rounded-md border border-border bg-background text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-colors disabled:opacity-50"
                          disabled={remove.isPending}
                          onClick={() => {
                            if (
                              window.confirm(
                                `Delete buyer "${b.name}"? Past invoices and their PDFs are not affected.`,
                              )
                            ) {
                              if (editingBuyerId === b.id) cancelEdit();
                              remove.mutate(b.id);
                            }
                          }}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    ) : null}
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-xs text-muted-foreground bg-muted/30 p-2.5 rounded-md">
                    <div>
                      <span className="block text-[11px] font-medium text-muted-foreground/80">GSTIN</span>
                      <span className="font-mono text-foreground">{b.gstin ?? "—"}</span>
                    </div>
                    <div>
                      <span className="block text-[11px] font-medium text-muted-foreground/80">State</span>
                      <span className="text-foreground">
                        {b.state_name ?? "—"}
                        {b.state_code ? ` (${b.state_code})` : ""}
                      </span>
                    </div>
                    {b.cell && (
                      <div>
                        <span className="block text-[11px] font-medium text-muted-foreground/80">Cell</span>
                        <span className="text-foreground">{b.cell}</span>
                      </div>
                    )}
                    {b.address && (
                      <div className={b.cell ? "" : "col-span-2"}>
                        <span className="block text-[11px] font-medium text-muted-foreground/80">Address</span>
                        <span className="text-foreground truncate block">{b.address}</span>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>

            {/* Desktop table (>= lg) */}
            <div className="hidden lg:block overflow-x-auto rounded-md border border-border/50">
              <table className="w-full min-w-[650px] text-sm">
                <thead className="border-b border-border bg-muted/40 text-left text-muted-foreground">
                  <tr>
                    <th className="px-4 py-2.5 font-medium">Name</th>
                    <th className="px-4 py-2.5 font-medium whitespace-nowrap">GSTIN</th>
                    <th className="px-4 py-2.5 font-medium whitespace-nowrap">State</th>
                    <th className="px-4 py-2.5 font-medium whitespace-nowrap">Cell</th>
                    {canManage ? <th className="px-4 py-2.5 text-right font-medium whitespace-nowrap">Actions</th> : null}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/60">
                  {(data ?? []).map((b) => (
                    <tr
                      key={b.id}
                      className={`hover:bg-muted/30 transition-colors ${
                        editingBuyerId === b.id ? "bg-muted/50" : ""
                      }`}
                    >
                      <td className="px-4 py-2.5 font-medium text-foreground">{b.name}</td>
                      <td className="px-4 py-2.5 font-mono text-xs whitespace-nowrap">{b.gstin ?? "—"}</td>
                      <td className="px-4 py-2.5 whitespace-nowrap">
                        {b.state_name ?? "—"}
                        {b.state_code ? ` (${b.state_code})` : ""}
                      </td>
                      <td className="px-4 py-2.5 whitespace-nowrap">{b.cell ?? "—"}</td>
                      {canManage ? (
                        <td className="px-4 py-2.5 text-right whitespace-nowrap">
                          <div className="inline-flex items-center gap-1.5 justify-end">
                            <button
                              type="button"
                              aria-label={`Edit ${b.name}`}
                              title="Edit buyer"
                              className="p-1 rounded text-muted-foreground hover:bg-muted hover:text-primary transition-colors disabled:opacity-50"
                              onClick={() => startEdit(b)}
                            >
                              <Pencil className="h-4 w-4" />
                            </button>
                            <button
                              type="button"
                              aria-label={`Delete ${b.name}`}
                              title="Delete buyer"
                              className="p-1 rounded text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-colors disabled:opacity-50"
                              disabled={remove.isPending}
                              onClick={() => {
                                if (
                                  window.confirm(
                                    `Delete buyer "${b.name}"? Past invoices and their PDFs are not affected.`,
                                  )
                                ) {
                                  if (editingBuyerId === b.id) cancelEdit();
                                  remove.mutate(b.id);
                                }
                              }}
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          </div>
                        </td>
                      ) : null}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
        {canManage ? (
          <form
            onSubmit={submit}
            className="grid gap-3 border-t border-border pt-4 sm:grid-cols-3"
          >
            {editingBuyerId ? (
              <div className="flex items-center justify-between rounded-md bg-muted/60 px-3 py-2 text-sm sm:col-span-3">
                <span className="font-medium text-foreground">
                  Editing buyer: <span className="text-primary">{form.name || "..."}</span>
                </span>
                <button
                  type="button"
                  onClick={cancelEdit}
                  className="text-xs text-muted-foreground hover:text-foreground hover:underline"
                >
                  Cancel editing
                </button>
              </div>
            ) : null}
            <Field label="Name">
              <Input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                required
              />
            </Field>
            <Field label="GSTIN">
              <Input
                value={form.gstin}
                onChange={(e) => setForm({ ...form, gstin: e.target.value })}
              />
            </Field>
            <Field label="Cell">
              <Input
                value={form.cell}
                onChange={(e) => setForm({ ...form, cell: e.target.value })}
              />
            </Field>
            <Field label="Address" className="sm:col-span-3">
              <Input
                value={form.address}
                onChange={(e) => setForm({ ...form, address: e.target.value })}
              />
            </Field>
            <Field label="State">
              <Select
                value={form.state_code}
                onChange={(e) => pickState(e.target.value)}
              >
                <option value="">Select state</option>
                {stateOptions.map((s) => (
                  <option key={s.code} value={s.code}>
                    {s.name} ({s.code})
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="State code">
              <Input value={form.state_code} placeholder="auto" readOnly />
            </Field>
            <div className="sm:col-span-3 flex items-center gap-2">
              <ErrorNote
                message={msg(editingBuyerId ? update.error : create.error)}
              />
              <Button
                type="submit"
                disabled={editingBuyerId ? update.isPending : create.isPending}
                className="mt-1"
              >
                {editingBuyerId
                  ? update.isPending
                    ? "Saving…"
                    : "Update buyer"
                  : create.isPending
                    ? "Adding…"
                    : "Add buyer"}
              </Button>
              {editingBuyerId ? (
                <Button
                  type="button"
                  variant="outline"
                  onClick={cancelEdit}
                  className="mt-1"
                >
                  Cancel
                </Button>
              ) : null}
            </div>
          </form>
        ) : null}
      </CardContent>
    </Card>
  );
}

function Products({ canManage }: { canManage: boolean }) {
  const { data, isLoading } = useProducts();
  const create = useCreateProduct();
  const [form, setForm] = useState({
    name: "",
    hsn_sac: "",
    default_gst_rate: "",
    default_uom: "MT",
    default_rate: "",
  });

  function submit(e: React.FormEvent) {
    e.preventDefault();
    create.mutate(
      {
        name: form.name,
        hsn_sac: form.hsn_sac || undefined,
        default_gst_rate: form.default_gst_rate || "0",
        default_uom: form.default_uom,
        default_rate: form.default_rate || undefined,
      },
      {
        onSuccess: () =>
          setForm({
            name: "",
            hsn_sac: "",
            default_gst_rate: "",
            default_uom: "MT",
            default_rate: "",
          }),
      },
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Products</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {isLoading ? (
          <Spinner />
        ) : (data?.length ?? 0) === 0 ? (
          <EmptyState>No products yet.</EmptyState>
        ) : (
          <>
            {/* Mobile / Tablet card list (< lg) */}
            <div className="divide-y divide-border lg:hidden">
              {(data ?? []).map((p) => (
                <div key={p.id} className="py-3.5 space-y-2 first:pt-0 last:pb-0">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-foreground text-sm">
                      {p.name}
                    </span>
                    <span className="rounded-full bg-muted px-2.5 py-0.5 text-xs font-semibold text-foreground">
                      {p.default_uom}
                    </span>
                  </div>
                  <div className="grid grid-cols-3 gap-2 text-xs text-muted-foreground bg-muted/30 p-2.5 rounded-md">
                    <div>
                      <span className="block text-[11px] font-medium text-muted-foreground/80">HSN/SAC</span>
                      <span className="font-mono text-foreground">{p.hsn_sac ?? "—"}</span>
                    </div>
                    <div>
                      <span className="block text-[11px] font-medium text-muted-foreground/80">GST</span>
                      <span className="font-medium text-foreground">{p.default_gst_rate}%</span>
                    </div>
                    <div>
                      <span className="block text-[11px] font-medium text-muted-foreground/80">Default Rate</span>
                      <span className="font-semibold text-foreground">
                        {p.default_rate ? formatMoney(p.default_rate) : "—"}
                      </span>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {/* Desktop table (>= lg) */}
            <div className="hidden lg:block overflow-x-auto rounded-md border border-border/50">
              <table className="w-full min-w-[550px] text-sm">
                <thead className="border-b border-border bg-muted/40 text-left text-muted-foreground">
                  <tr>
                    <th className="px-4 py-2.5 font-medium">Name</th>
                    <th className="px-4 py-2.5 font-medium whitespace-nowrap">HSN/SAC</th>
                    <th className="px-4 py-2.5 font-medium whitespace-nowrap">GST %</th>
                    <th className="px-4 py-2.5 font-medium whitespace-nowrap">UOM</th>
                    <th className="px-4 py-2.5 font-medium whitespace-nowrap">Default Rate</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/60">
                  {(data ?? []).map((p) => (
                    <tr
                      key={p.id}
                      className="hover:bg-muted/30 transition-colors"
                    >
                      <td className="px-4 py-2.5 font-medium text-foreground">{p.name}</td>
                      <td className="px-4 py-2.5 font-mono text-xs whitespace-nowrap">{p.hsn_sac ?? "—"}</td>
                      <td className="px-4 py-2.5 whitespace-nowrap">{p.default_gst_rate}%</td>
                      <td className="px-4 py-2.5 whitespace-nowrap">{p.default_uom}</td>
                      <td className="px-4 py-2.5 font-medium whitespace-nowrap">
                        {p.default_rate ? formatMoney(p.default_rate) : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
        {canManage ? (
          <form
            onSubmit={submit}
            className="grid gap-3 border-t border-border pt-4 sm:grid-cols-5"
          >
            <Field label="Name" className="sm:col-span-2">
              <Input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                required
              />
            </Field>
            <Field label="HSN/SAC">
              <Input
                value={form.hsn_sac}
                onChange={(e) => setForm({ ...form, hsn_sac: e.target.value })}
              />
            </Field>
            <Field label="GST %">
              <Input
                type="number"
                step="0.01"
                min="0"
                value={form.default_gst_rate}
                onChange={(e) =>
                  setForm({ ...form, default_gst_rate: e.target.value })
                }
              />
            </Field>
            <Field label="UOM">
              <Select
                value={form.default_uom}
                onChange={(e) =>
                  setForm({ ...form, default_uom: e.target.value })
                }
              >
                <option value="MT">MT</option>
                <option value="KG">KG</option>
                <option value="QTL">QTL</option>
                <option value="BAG">BAG</option>
              </Select>
            </Field>
            <Field label="Default rate">
              <Input
                type="number"
                step="0.0001"
                min="0"
                value={form.default_rate}
                onChange={(e) =>
                  setForm({ ...form, default_rate: e.target.value })
                }
              />
            </Field>
            <div className="sm:col-span-5">
              <ErrorNote message={msg(create.error)} />
              <Button
                type="submit"
                disabled={create.isPending}
                className="mt-1"
              >
                {create.isPending ? "Adding…" : "Add product"}
              </Button>
            </div>
          </form>
        ) : null}
      </CardContent>
    </Card>
  );
}

export default function SettingsPage() {
  const can = useHasPermission();
  const canManage = can("settings.manage");
  const canMasters = can("invoice.masters.manage");

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Settings</h1>
      <MillProfile canManage={canManage} />
      <Buyers canManage={canMasters} />
      <Products canManage={canMasters} />
    </div>
  );
}
