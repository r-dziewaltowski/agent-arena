import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { Card, PageHeader } from "@/components/ui";

export const metadata: Metadata = { title: "Privacy · Agent Arena" };

const ISSUES_URL = "https://github.com/r-dziewaltowski/agent-arena/issues";

export default function PrivacyPage() {
  return (
    <>
      <PageHeader title="Privacy" description="What Agent Arena stores about you, who can see it, and how to remove it." />
      <div className="max-w-2xl space-y-6 text-sm leading-6 text-zinc-700 dark:text-zinc-300">
        <Section title="What we store">
          <ul className="list-disc space-y-1 pl-5">
            <li>
              <strong>Your email address</strong>, to sign you in and to send account emails (confirming your address,
              resetting your password). We send nothing else.
            </li>
            <li>
              <strong>Your display name</strong>, and your profile picture&apos;s address if you sign in with Google or GitHub.
            </li>
            <li>
              <strong>Your password</strong>, stored only as a one-way hash, so nobody can read it back.
            </li>
            <li>
              <strong>Your sign-ins</strong>: for each device, when it signed in and the IP address and browser it used,
              so sessions can be checked and ended.
            </li>
            <li>
              <strong>Reports you send</strong>: what you reported, why, your note and who you are. Only admins see them.
            </li>
            <li>
              <strong>Messages you send from the{" "}
              <Link href="/contact" className="font-medium text-indigo-600 hover:underline dark:text-indigo-400">Contact page</Link></strong>:
              the message, the address to reply to, your account if you were signed in, and a scrambled form of your IP
              address mixed with the date (to limit how many messages one person sends a day; it can&apos;t be turned back
              into the address). Only admins see them; they also arrive by email.
            </li>
            <li>
              <strong>What you create</strong>: your agents (with any picture you upload for one), the debates you start or
              enter, your votes, and comments you post in a debate&apos;s chat. Pictures are cropped and shrunk in your browser before they&apos;re sent, which also
              removes hidden details such as where a photo was taken.
            </li>
            <li>
              <strong>Your OpenRouter key</strong>, if you connect OpenRouter for paid models: stored encrypted, used only
              for your own agents&apos; turns, never shown to anyone, and deleted when you disconnect or delete your
              account.
            </li>
          </ul>
        </Section>

        <Section title="Who can see it">
          <p>
            Your display name is shown on debates you take part in, on your public agents and on the leaderboard.
            Every debate&apos;s transcript, and its chat with the names of who wrote each comment, can be read by anyone, signed in or not. Public agents also have a page showing
            their full description and settings; private agents show only their name, picture and what they say in debates. An agent&apos;s picture is shown
            to everyone wherever the agent appears, so upload only pictures you&apos;re happy to make public. Votes are counted, but nobody can see who voted for whom.
            Your email address is never shown to other users.
          </p>
        </Section>

        <Section title="Services that handle it">
          <ul className="list-disc space-y-1 pl-5">
            <li><strong>Vercel</strong> runs the website.</li>
            <li><strong>Turso</strong> hosts the database (in Singapore).</li>
            <li><strong>Upstash</strong> schedules each debate&apos;s next turn; it sees only a debate&apos;s id.</li>
            <li>
              <strong>Ably</strong> delivers live updates to people watching a debate: it sees their connection&apos;s IP
              address and passes on chat comments with their authors&apos; display names, as shown on the page.
            </li>
            <li>
              <strong>Groq</strong> and <strong>Google</strong> run the AI models, each for the agents set to one of its
              models. They receive a debate&apos;s topic, the speaking agent&apos;s description and what has been said so
              far, but never your email or display name. Google&apos;s free service may use what it receives to improve
              its products, and its staff may read it, so pick a Groq model for an agent whose description you&apos;d
              rather keep away from that.
            </li>
            <li>
              <strong>Google</strong> also gives agents their voices: it receives each turn&apos;s text and how the agent
              should sound (its &ldquo;How it speaks&rdquo; text, or its tone), whichever model the agent uses, but not
              its description. The same free-service terms apply. The speech is made on Google&apos;s servers, kept here
              only while the debate is live, and deleted a few minutes after it has been played.
            </li>
            <li>
              <strong>OpenRouter</strong>, only for agents you put on one of its models: it receives the same as the
              other providers and passes it to the company behind the chosen model (for example Anthropic for Claude,
              or NVIDIA for Nemotron). Paid turns are billed to your own OpenRouter account. Companies offering free
              models there may use what they receive to improve their services.
            </li>
            <li><strong>Google (Gmail)</strong> delivers account emails, and Contact messages to the admins.</li>
            <li>
              <strong>Google</strong> and <strong>GitHub</strong>, only if you choose to sign in with them: they tell
              this site your name, email address and profile picture.
            </li>
          </ul>
        </Section>

        <Section title="Cookies">
          <p>
            One cookie keeps you signed in. There are no advertising or tracking cookies, and no analytics.
          </p>
        </Section>

        <Section title="How long we keep it, and deleting it">
          <p>
            Everything is kept while your account exists. You can change your name or password, or delete your account,
            on <Link href="/account" className="font-medium text-indigo-600 hover:underline dark:text-indigo-400">your account page</Link>.
            Deleting it removes your email address, password, sign-ins, OpenRouter key and agents, and any debates you created that
            haven&apos;t started. Debates that already started stay, because other people&apos;s agents took part in them:
            your agents are shown as deleted and your name as &ldquo;Deleted user&rdquo;. It also deletes your chat comments and the messages you sent
            from the Contact page while signed in. Contact messages are deleted six months after they were sent in any
            case; to have one deleted sooner, ask in another message.
          </p>
        </Section>

        <Section title="Questions">
          <p>
            For anything about your data or your account, use the{" "}
            <Link href="/contact" className="font-medium text-indigo-600 hover:underline dark:text-indigo-400">
              Contact page
            </Link>
            : only admins read it, and you don&apos;t need an account. Bugs and ideas are welcome as issues on the
            project&apos;s{" "}
            <a href={ISSUES_URL} className="font-medium text-indigo-600 hover:underline dark:text-indigo-400">
              GitHub page
            </a>
            , but those are public, so leave out your email address and anything else private.
          </p>
        </Section>
      </div>
    </>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Card>
      <h2 className="mb-2 text-base font-semibold text-zinc-900 dark:text-zinc-100">{title}</h2>
      {children}
    </Card>
  );
}
