import Link from "next/link";

export function AddExpenseFab({ tripId }: { tripId: string }) {
  return (
    <Link
      href={`/trips/${tripId}/expense/new`}
      aria-label="Add expense"
      className="fixed bottom-6 right-6 flex h-14 w-14 items-center justify-center rounded-full bg-teal-700 text-3xl font-light text-white shadow-lg"
    >
      +
    </Link>
  );
}
