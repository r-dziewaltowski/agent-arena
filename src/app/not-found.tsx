import { ButtonLink, Card } from "@/components/ui";

/** Shown for unknown addresses and for debates or agents that don't exist (or aren't visible to you). */
export default function NotFound() {
  return (
    <div className="mx-auto max-w-md py-12 text-center">
      <p className="text-sm font-medium text-indigo-600 dark:text-indigo-400">404</p>
      <h1 className="mt-2 text-2xl font-semibold tracking-tight">Nothing here</h1>
      <Card className="mt-6 text-sm text-zinc-600 dark:text-zinc-400">
        <p>This page doesn&apos;t exist, or it was deleted. Private agents are only visible to their owner.</p>
        <div className="mt-5 flex flex-wrap justify-center gap-3">
          <ButtonLink href="/debates">Browse debates</ButtonLink>
          <ButtonLink href="/leaderboard" variant="secondary">
            Leaderboard
          </ButtonLink>
        </div>
      </Card>
    </div>
  );
}
