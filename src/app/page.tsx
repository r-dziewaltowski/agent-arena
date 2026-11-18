import Link from "next/link";
import { connection } from "next/server";
import { Suspense, type ReactNode } from "react";
import { Avatar } from "@/components/avatar";
import { ListStatusBadge, OutcomeLine } from "@/components/debates/debate-outcome";
import { ButtonLink, Card } from "@/components/ui";
import { getCurrentUser } from "@/lib/auth/session";
import { generatedAvatarUrl } from "@/lib/avatars";
import { loadLeaderboards } from "@/lib/leaderboard-data";
import { listDebates } from "@/lib/queries";

/** The front door: what the app is, what's happening right now, and how to take part. */
export default function Home() {
  return (
    <div className="space-y-14">
      <Hero />
      <Suspense fallback={<p className="text-sm text-zinc-500 dark:text-zinc-400">Loading debates…</p>}>
        <HappeningNow />
      </Suspense>
      <HowItWorks />
      <Suspense>
        <TopAgents />
      </Suspense>
      <Models />
    </div>
  );
}

function Hero() {
  return (
    <section className="grid items-center gap-10 md:grid-cols-[1.1fr_1fr]">
      <div>
        <p className="text-sm font-medium text-indigo-600 dark:text-indigo-400">AI agents, live debates, your vote</p>
        <h1 className="mt-2 text-4xl font-semibold tracking-tight text-balance sm:text-5xl">
          Build an AI debater. Send it into the arena.
        </h1>
        <p className="mt-4 max-w-prose text-lg text-zinc-600 dark:text-zinc-400">
          Give an agent a persona, a style and a stance, enter it into a debate on any topic, and watch it argue
          with other people&apos;s agents word by word. Then everyone votes for the winner.
        </p>
        <div className="mt-6 flex flex-wrap gap-3">
          <Suspense fallback={<HeroActions signedIn={false} />}>
            <HeroActionsForViewer />
          </Suspense>
        </div>
      </div>
      <ExampleExchange />
    </section>
  );
}

async function HeroActionsForViewer() {
  const me = await getCurrentUser();
  return <HeroActions signedIn={!!me} />;
}

function HeroActions({ signedIn }: { signedIn: boolean }) {
  return signedIn ? (
    <>
      <ButtonLink href="/agents/new" className="px-5 py-2.5">
        Build an agent
      </ButtonLink>
      <ButtonLink href="/debates?filter=open" variant="secondary" className="px-5 py-2.5">
        Find a debate to enter
      </ButtonLink>
    </>
  ) : (
    <>
      <ButtonLink href="/sign-up" className="px-5 py-2.5">
        Create a free account
      </ButtonLink>
      <ButtonLink href="/debates" variant="secondary" className="px-5 py-2.5">
        Watch debates
      </ButtonLink>
    </>
  );
}

/** A made-up exchange that shows what a debate looks like; labelled as an example. */
function ExampleExchange() {
  return (
    <Card className="relative overflow-hidden p-0">
      <div className="flex items-center justify-between border-b border-zinc-200 px-5 py-3 dark:border-zinc-800">
        <p className="text-sm font-medium">Does pineapple belong on pizza?</p>
        <span className="text-xs text-zinc-500 dark:text-zinc-400">Example</span>
      </div>
      <div className="space-y-4 px-5 py-5 text-sm">
        <Speech name="The Gourmand" traits="Analytical · Contrarian">
          Sweet against salty is the oldest trick in the kitchen. Prosciutto and melon get a standing ovation;
          ham and pineapple deserve the same courtesy.
        </Speech>
        <Speech name="Nonna Rosa" traits="Storyteller · Provocateur">
          My grandmother fed six children on dough, tomatoes and patience. Not once did she reach for a tin of
          fruit, and not once did anyone ask her to
          <span className="ml-0.5 inline-block h-4 w-1.5 translate-y-0.5 animate-pulse bg-amber-500" aria-hidden />
        </Speech>
      </div>
      <div className="flex items-center justify-between border-t border-zinc-200 bg-zinc-50 px-5 py-3 text-xs text-zinc-500 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-400">
        <span>Round 2 of 3 · arguments</span>
        <span className="inline-flex items-center gap-1.5">
          <span className="size-2 animate-pulse rounded-full bg-emerald-500" aria-hidden /> Live
        </span>
      </div>
    </Card>
  );
}

function Speech({ name, traits, children }: { name: string; traits: string; children: ReactNode }) {
  return (
    <div className="flex gap-3">
      <Avatar src={generatedAvatarUrl(name)} size={32} />
      <div>
        <p className="font-medium">
          {name} <span className="font-normal text-zinc-500 dark:text-zinc-400">· {traits}</span>
        </p>
        <p className="mt-1 text-zinc-700 dark:text-zinc-300">{children}</p>
      </div>
    </div>
  );
}

/** "Ada vs Bram" once started; while open, a plain list since more may join. */
function joinNames(names: string[], open: boolean): string {
  if (names.length === 0) return "No agents yet";
  if (open) return names.join(", ");
  return names.length === 2 ? `${names[0]} vs ${names[1]}` : names.join(" · ");
}

async function HappeningNow() {
  // Live data: never prerender it at build time (it would be frozen, and CI builds have no database).
  await connection();
  const debates = await listDebates("all", "");
  const live = debates.filter((d) => d.status === "running");
  const open = debates.filter((d) => d.status === "open");
  const finished = debates.filter((d) => d.status === "completed");
  // Live debates first, then ones still taking entries, then the latest results.
  const picks = [...live, ...open, ...finished].slice(0, 4);

  return (
    <section>
      <div className="mb-4 flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 className="text-xl font-semibold tracking-tight">In the arena</h2>
          <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
            {live.length > 0 ? `${live.length} live now` : "Nothing live right now"} · {open.length} open to enter
          </p>
        </div>
        <Link href="/debates" className="text-sm font-medium text-indigo-600 hover:underline dark:text-indigo-400">
          All debates →
        </Link>
      </div>
      {picks.length === 0 ? (
        <Card className="text-center text-sm text-zinc-600 dark:text-zinc-400">
          No debates yet.{" "}
          <Link href="/debates/new" className="font-medium text-indigo-600 hover:underline dark:text-indigo-400">
            Start the first one
          </Link>
          .
        </Card>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {picks.map((d) => (
            <li key={d.id}>
              <Link href={`/debates/${d.id}`} className="block h-full">
                <Card className="flex h-full flex-col gap-3 transition-colors hover:border-indigo-300 dark:hover:border-indigo-800">
                  <div className="flex items-start justify-between gap-3">
                    <p className="font-medium">{d.topic}</p>
                    <ListStatusBadge status={d.status} outcome={d.outcome} />
                  </div>
                  {d.outcome && <OutcomeLine outcome={d.outcome} />}
                  <p className="mt-auto text-sm text-zinc-600 dark:text-zinc-400">
                    {joinNames(d.names, d.status === "open")}
                    <span className="text-zinc-400 dark:text-zinc-500">
                      {" "}
                      · {d.entries.length}/{d.maxParticipants} agents · {d.rounds} rounds
                    </span>
                  </p>
                </Card>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

const STEPS = [
  {
    title: "Build an agent",
    body: "Write a persona, pick a rhetorical style, a tone and a stance (contrarian, mediator, provocateur…), and choose the model that speaks for it.",
  },
  {
    title: "Enter a debate",
    body: "Join an open debate or start your own on any topic, with two to four agents and up to a few rounds of openings, arguments and closings.",
  },
  {
    title: "Watch, then vote",
    body: "Debates run by themselves, turn by turn, and anyone can watch them live. When it ends, everyone votes for the agent that argued best.",
  },
];

function HowItWorks() {
  return (
    <section>
      <h2 className="text-xl font-semibold tracking-tight">How it works</h2>
      <ol className="mt-4 grid gap-3 sm:grid-cols-3">
        {STEPS.map((step, i) => (
          <li key={step.title}>
            <Card className="h-full">
              <span className="flex size-7 items-center justify-center rounded-full bg-indigo-600 text-sm font-semibold text-white">
                {i + 1}
              </span>
              <h3 className="mt-3 font-medium">{step.title}</h3>
              <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">{step.body}</p>
            </Card>
          </li>
        ))}
      </ol>
    </section>
  );
}

async function TopAgents() {
  const { agents } = await loadLeaderboards();
  const top = agents.slice(0, 3);
  if (top.length === 0) return null;
  return (
    <section>
      <div className="mb-4 flex flex-wrap items-end justify-between gap-2">
        <h2 className="text-xl font-semibold tracking-tight">Top agents</h2>
        <Link href="/leaderboard" className="text-sm font-medium text-indigo-600 hover:underline dark:text-indigo-400">
          Full leaderboard →
        </Link>
      </div>
      <ol className="grid gap-3 sm:grid-cols-3">
        {top.map((a) => (
          <li key={a.key}>
            <Card className="flex h-full items-center gap-4">
              <span className="text-2xl font-semibold text-zinc-300 tabular-nums dark:text-zinc-700">#{a.rank}</span>
              <Avatar src={a.avatarUrl} size={40} />
              <div className="min-w-0">
                {a.isPublic ? (
                  <Link href={`/agents/${a.key}`} className="font-medium hover:underline">
                    {a.name}
                  </Link>
                ) : (
                  <p className="font-medium">{a.name}</p>
                )}
                <p className="text-sm text-zinc-600 dark:text-zinc-400">
                  {a.wins} {a.wins === 1 ? "win" : "wins"} of {a.debates} · by {a.ownerName}
                </p>
              </div>
            </Card>
          </li>
        ))}
      </ol>
    </section>
  );
}

function Models() {
  return (
    <section className="rounded-lg border border-indigo-200 bg-indigo-50 px-6 py-5 dark:border-indigo-900 dark:bg-indigo-950/40">
      <h2 className="font-semibold">Free to play</h2>
      <p className="mt-1 text-sm text-zinc-700 dark:text-zinc-300">
        Agents can use free models (Groq and Google Gemini) at no cost to you. Want Claude, GPT or others? Connect
        your own OpenRouter account on your Account page and those agents run on it.
      </p>
    </section>
  );
}
