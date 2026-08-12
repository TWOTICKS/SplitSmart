// Row shapes mirroring supabase/migrations/0001_init.sql. Hand-written
// (no ORM/codegen) since the schema is 8 tables and small enough to keep in sync by hand.

export type SplitMode = "equal" | "exact" | "shares" | "percent";

export interface Trip {
  id: string;
  name: string;
  home_currency: string;
  sc_bps: number;
  gst_bps: number;
  simplify_debts: boolean;
  invite_code: string;
  created_by: string;
  created_at: string;
  archived_at: string | null;
}

export interface Member {
  id: string;
  trip_id: string;
  user_id: string | null; // null => ghost member
  display_name: string;
  created_at: string;
}

export interface Expense {
  id: string;
  trip_id: string;
  description: string;
  category: string | null;
  currency: string;
  subtotal_minor: number;
  sc_minor: number;
  gst_minor: number;
  total_minor: number;
  fx_rate_to_home: number;
  fx_stale: boolean;
  spent_at: string; // date
  split_mode: SplitMode;
  tax_inclusive: boolean;
  created_by: string;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export interface ExpensePayer {
  expense_id: string;
  member_id: string;
  amount_minor: number;
}

export interface ExpenseSplit {
  expense_id: string;
  member_id: string;
  amount_minor: number;
  input_value: number | null;
}

export interface Settlement {
  id: string;
  trip_id: string;
  from_member: string;
  to_member: string;
  currency: string;
  amount_minor: number;
  fx_rate_to_home: number;
  settled_at: string;
  note: string | null;
  created_at: string;
  deleted_at: string | null;
}

export interface FxRate {
  as_of: string;
  base: string;
  quote: string;
  rate: number;
}

// Composite shape used when building/editing an expense in the UI.
export interface ExpenseDraft {
  id: string;
  tripId: string;
  description: string;
  category: string | null;
  currency: string;
  subtotalMinor: number;
  scBps: number;
  gstBps: number;
  taxInclusive: boolean;
  spentAt: string;
  splitMode: SplitMode;
  payers: { memberId: string; amountMinor: number }[];
  // splitInputs: raw weights/amounts/percents per member, before largest-remainder resolution
  splitInputs: { memberId: string; value: number }[];
}
