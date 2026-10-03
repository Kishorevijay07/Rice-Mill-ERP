// API response types mirroring the backend Pydantic schemas.

export interface Page<T> {
  items: T[];
  total: number;
  page: number;
  page_size: number;
}

export interface User {
  id: string;
  email: string;
  username: string;
  full_name: string;
  is_active: boolean;
  is_superuser: boolean;
}

export interface Me {
  user: User;
  roles: string[];
  permissions: string[];
}

export interface Agency {
  id: string;
  code: string;
  name: string;
  contact_name: string | null;
  contact_phone: string | null;
  created_at: string;
}

export interface Allocation {
  id: string;
  reference: string;
  agency_id: string;
  quantity_kg: string;
  allocated_on: string;
  season: string | null;
  notes: string | null;
  created_at: string;
}

export interface DeliveryOrder {
  id: string;
  reference: string;
  allocation_id: string;
  do_number: string;
  quantity_kg: string;
  issued_on: string;
  notes: string | null;
  created_at: string;
}

export type LoadStatus =
  "DRAFT" | "ARRIVED" | "WEIGHED" | "QC_PENDING" | "ACCEPTED" | "REJECTED";

export interface GovernmentLoad {
  id: string;
  reference: string;
  delivery_order_id: string;
  lorry_number: string;
  driver_name: string | null;
  declared_quantity_kg: string | null;
  status: LoadStatus;
  notes: string | null;
  created_at: string;
}

export interface Weighment {
  id: string;
  load_id: string;
  gross_kg: string;
  tare_kg: string;
  net_kg: string;
  is_final: boolean;
  weighbridge_ref: string | null;
  created_at: string;
}

export interface PaddyQuality {
  id: string;
  load_id: string;
  moisture_pct: string;
  foreign_matter_pct: string;
  damaged_pct: string;
  notes: string | null;
  created_at: string;
}

export interface PaddyLot {
  id: string;
  reference: string;
  load_id: string;
  quantity_kg: string;
  created_at: string;
}

export interface PaddyLotWithStock extends PaddyLot {
  available_kg: string;
}

export interface AcceptResponse {
  load: GovernmentLoad;
  paddy_lot: PaddyLot;
}

// ---- Milling ----
export type MillingBatchStatus = "DRAFT" | "IN_PROGRESS" | "COMPLETED";
export type RiceCategory = "CATEGORY_1" | "CATEGORY_2";

export interface MillingInput {
  id: string;
  paddy_lot_id: string;
  quantity_kg: string;
}

export interface RiceProductionOutput {
  id: string;
  category: string;
  quantity_kg: string;
  bag_weight_kg: string;
  bag_count: number;
}

export interface RiceProduction {
  id: string;
  reference: string;
  produced_on: string | null;
  notes: string | null;
  outputs: RiceProductionOutput[];
}

export interface MillingBatch {
  id: string;
  reference: string;
  status: MillingBatchStatus;
  started_at: string | null;
  completed_at: string | null;
  notes: string | null;
  created_at: string;
}

export interface MillingBatchDetail extends MillingBatch {
  inputs: MillingInput[];
  productions: RiceProduction[];
}

// ---- Rice ----
export type RiceQualityStatus = "PENDING" | "PASSED" | "FAILED";

export interface RiceQuality {
  id: string;
  output_id: string;
  status: RiceQualityStatus;
  broken_pct: string | null;
  moisture_pct: string | null;
  notes: string | null;
  created_at: string;
}

export interface RiceLotWithStock {
  id: string;
  reference: string;
  output_id: string;
  category: string;
  quantity_kg: string;
  bag_weight_kg: string;
  bag_count: number;
  available_kg: string;
  created_at: string;
}

// ---- Delivery ----
export type DispatchStatus = "DRAFT" | "PREPARED" | "DISPATCHED" | "DELIVERED";

export interface DispatchItem {
  id: string;
  rice_lot_id: string;
  quantity_kg: string;
}

export interface DeliveryReceipt {
  id: string;
  reference: string;
  dispatch_id: string;
  dispatched_quantity_kg: string;
  received_quantity_kg: string;
  received_bags: number | null;
  shortage_kg: string;
  excess_kg: string;
  receipt_number: string | null;
  receipt_date: string | null;
  notes: string | null;
  created_at: string;
}

export interface Dispatch {
  id: string;
  reference: string;
  status: DispatchStatus;
  destination_name: string;
  destination_agency_id: string | null;
  delivery_order_id: string | null;
  lorry_number: string;
  dispatched_at: string | null;
  notes: string | null;
  created_at: string;
}

export interface DispatchDetail extends Dispatch {
  items: DispatchItem[];
  receipt: DeliveryReceipt | null;
}

// ---- Settings ----
export type ChargeUnit = "PER_KG" | "PER_QUINTAL" | "FLAT";

export interface MillSettings {
  id: string;
  name: string;
  address: string | null;
  registration_no: string | null;
  contact_phone: string | null;
  contact_email: string | null;
  currency: string;
  invoice_notes: string | null;
  gstin: string | null;
  state_name: string | null;
  state_code: string | null;
  bank_account_name: string | null;
  bank_name: string | null;
  bank_account_no: string | null;
  bank_branch: string | null;
  bank_ifsc: string | null;
  invoice_declaration: string | null;
}

export interface ChargeRate {
  id: string;
  code: string;
  label: string;
  rate: string;
  unit: ChargeUnit;
  is_deduction: boolean;
  is_active: boolean;
}

// ---- Billing ----
export type ClaimStatus =
  "DRAFT" | "SUBMITTED" | "APPROVED" | "PARTIALLY_PAID" | "PAID";

export interface ClaimLine {
  id: string;
  description: string;
  quantity: string;
  rate: string;
  amount: string;
  is_deduction: boolean;
  sort_order: number;
}

export interface Payment {
  id: string;
  reference: string;
  claim_id: string;
  amount: string;
  paid_on: string | null;
  method: string | null;
  reference_no: string | null;
  notes: string | null;
  created_at: string;
}

export interface Claim {
  id: string;
  reference: string;
  agency_id: string;
  status: ClaimStatus;
  currency: string;
  gross_amount: string;
  deduction_amount: string;
  net_amount: string;
  submitted_at: string | null;
  approved_at: string | null;
  notes: string | null;
  created_at: string;
}

export interface ClaimDetail extends Claim {
  lines: ClaimLine[];
  delivery_receipt_ids: string[];
  payments: Payment[];
  paid_amount: string;
  outstanding_amount: string;
}

// ---- Invoicing (commercial GST tax invoices) ----
export interface Buyer {
  id: string;
  name: string;
  address: string | null;
  gstin: string | null;
  state_name: string | null;
  state_code: string | null;
  cell: string | null;
  is_active: boolean;
}

export interface Product {
  id: string;
  name: string;
  hsn_sac: string | null;
  default_gst_rate: string;
  default_uom: string;
  default_rate: string | null;
  is_active: boolean;
}

export type InvoiceStatus = "DRAFT" | "ISSUED";

export interface InvoiceLine {
  id: string;
  product_id: string | null;
  description: string;
  bags?: number | null;
  hsn_sac: string | null;
  quantity: string;
  uom: string;
  rate: string;
  taxable_amount: string;
  gst_rate: string;
  gst_amount: string;
  cgst_rate: string;
  cgst_amount: string;
  sgst_rate: string;
  sgst_amount: string;
  igst_rate: string;
  igst_amount: string;
  sort_order: number;
}

export interface TaxSummaryRow {
  hsn_sac: string | null;
  taxable_amount: string;
  gst_rate: string;
  gst_amount: string;
  cgst_rate: string;
  cgst_amount: string;
  sgst_rate: string;
  sgst_amount: string;
  igst_rate: string;
  igst_amount: string;
}

export interface TaxInvoice {
  id: string;
  reference: string;
  invoice_number: string;
  invoice_date: string;
  status: InvoiceStatus;
  currency: string;
  buyer_id: string | null;
  buyer_name: string;
  buyer_address: string | null;
  buyer_gstin: string | null;
  buyer_state_name: string | null;
  buyer_state_code: string | null;
  buyer_cell: string | null;
  destination: string | null;
  motor_vehicle_no: string | null;
  remarks: string | null;
  taxable_amount: string;
  total_tax_amount: string;
  round_off: string;
  grand_total: string;
  issued_at: string | null;
  pdf_document_id: string | null;
  eway_document_id: string | null;
  created_at: string;
}

export interface TaxInvoiceDetail extends TaxInvoice {
  delivery_note: string | null;
  mode_terms_of_payment: string | null;
  reference_no_date: string | null;
  other_references: string | null;
  buyers_order_no: string | null;
  buyers_order_dated: string | null;
  dispatch_doc_no: string | null;
  delivery_note_date: string | null;
  dispatched_through: string | null;
  bill_of_lading_lr_rr_no: string | null;
  terms_of_delivery: string | null;
  declaration: string | null;
  is_interstate: boolean;
  lines: InvoiceLine[];
  tax_summary: TaxSummaryRow[];
  amount_in_words: string;
  tax_amount_in_words: string;
}

// ---- Dashboard ----
export interface DashboardKpis {
  paddy_received_kg: string;
  paddy_available_kg: string;
  rice_stock_kg: string;
  pending_delivery: number;
  claims_pending: number;
  amount_paid: string;
  amount_outstanding: string;
}
