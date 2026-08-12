"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export function TripTabs({ tripId }: { tripId: string }) {
  const pathname = usePathname();
  const balancesHref = `/trips/${tripId}/balances`;
  const expensesHref = `/trips/${tripId}`;
  const onBalances = pathname === balancesHref;

  const tabClass = (active: boolean) =>
    `flex-1 border-b-2 py-2.5 text-center text-sm font-medium ${
      active
        ? "border-teal-700 text-teal-700 dark:border-teal-400 dark:text-teal-400"
        : "border-transparent text-zinc-500"
    }`;

  return (
    <nav className="mx-auto flex max-w-2xl px-4">
      <Link href={expensesHref} className={tabClass(!onBalances)}>
        Expenses
      </Link>
      <Link href={balancesHref} className={tabClass(onBalances)}>
        Balances
      </Link>
    </nav>
  );
}
