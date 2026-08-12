import type { SupabaseClient } from "@supabase/supabase-js";

export interface FxLookupResult {
  rate: number;
  stale: boolean;
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Rate to convert 1 unit of `base` into `quote`, cached per (date, pair) in
 * fx_rates. Refreshed at most once per day. If the network is unreachable
 * and nothing is cached for today, falls back to the most recent cached
 * rate for the pair (any date) and marks the result stale so the caller can
 * show a badge — never blocks the write.
 */
export async function getLatestFxRate(
  supabase: SupabaseClient,
  base: string,
  quote: string,
  asOf: string
): Promise<FxLookupResult> {
  if (base === quote) return { rate: 1, stale: false };

  const day = asOf <= today() ? asOf : today(); // never cache a future date under "today"

  const { data: cached } = await supabase
    .from("fx_rates")
    .select("rate")
    .eq("as_of", day)
    .eq("base", base)
    .eq("quote", quote)
    .maybeSingle();
  if (cached) return { rate: Number(cached.rate), stale: false };

  try {
    const res = await fetch(`https://api.frankfurter.app/${day}?from=${base}&to=${quote}`, {
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) throw new Error(`fx fetch failed: ${res.status}`);
    const json = (await res.json()) as { rates?: Record<string, number> };
    const rate = json.rates?.[quote];
    if (!rate) throw new Error(`no rate for ${base}->${quote}`);

    await supabase.from("fx_rates").upsert({ as_of: day, base, quote, rate });
    return { rate, stale: false };
  } catch {
    // ponytail: no retry/backoff here — a single attempt per write, then
    // fall back to cache. Add retry if flaky-network users report bad rates.
    const { data: lastKnown } = await supabase
      .from("fx_rates")
      .select("rate")
      .eq("base", base)
      .eq("quote", quote)
      .order("as_of", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (lastKnown) return { rate: Number(lastKnown.rate), stale: true };
    return { rate: 1, stale: true }; // never seen this pair and offline — best we can do without blocking the write
  }
}
