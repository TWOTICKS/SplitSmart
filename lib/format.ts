import { currencyExponent, formatMajor } from "./money";

const SYMBOLS: Record<string, string> = {
  USD: "$",
  SGD: "S$",
  EUR: "€",
  GBP: "£",
  JPY: "¥",
  KRW: "₩",
  THB: "฿",
  MYR: "RM",
  IDR: "Rp",
  VND: "₫",
  AUD: "A$",
  CNY: "¥",
  HKD: "HK$",
  TWD: "NT$",
  INR: "₹",
  KWD: "KD",
  BHD: "BD",
};

/** Render minor units as "S$12.34" — symbol + correct decimal count, never raw minor units. */
export function formatMoney(amountMinor: number, currency: string): string {
  const symbol = SYMBOLS[currency.toUpperCase()] ?? `${currency.toUpperCase()} `;
  return `${symbol}${formatMajor(amountMinor, currency)}`;
}

/** Parse a user-typed decimal string ("12.3") into minor units for a currency, or null if invalid. */
export function parseMoneyInput(input: string, currency: string): number | null {
  const trimmed = input.trim();
  if (trimmed === "" || !/^\d*\.?\d*$/.test(trimmed)) return null;
  const exp = currencyExponent(currency);
  const [wholeStr, fracStr = ""] = trimmed.split(".");
  if (wholeStr === "" && fracStr === "") return null;
  const whole = wholeStr === "" ? 0 : parseInt(wholeStr, 10);
  const fracPadded = (fracStr + "0".repeat(exp)).slice(0, exp);
  const frac = fracPadded === "" ? 0 : parseInt(fracPadded, 10);
  return whole * 10 ** exp + frac;
}
