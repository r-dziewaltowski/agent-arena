import { deleteMessageAction, markMessageDoneAction } from "@/actions/contact";
import { ConfirmButton } from "@/components/confirm-button";
import { LocalDate } from "@/components/local-date";
import { Badge, Button, buttonLinkClass, Card } from "@/components/ui";
import { displayNames } from "@/lib/auth/session";
import { CONTACT_TOPICS, type MessageView } from "@/lib/contact";

/** The admin page's Contact messages: open ones to answer (by email), then recently done ones. */
export async function Messages({ open, done }: { open: MessageView[]; done: MessageView[] }) {
  const names = await displayNames(open.flatMap((m) => (m.userId ? [m.userId] : [])));
  return (
    <div id="messages" className="scroll-mt-6 space-y-10">
      <section>
        <h2 className="text-lg font-semibold">Messages to answer ({open.length})</h2>
        <p className="mb-3 text-sm text-zinc-500 dark:text-zinc-400">
          From the Contact page. Answer by email, then mark it done. Messages are deleted six months after they were sent.
        </p>
        {open.length === 0 ? (
          <Card className="text-sm text-zinc-600 dark:text-zinc-400">No messages waiting.</Card>
        ) : (
          <ul className="space-y-4">
            {open.map((m) => (
              <li key={m.id}>
                <MessageCard message={m} senderName={m.userId ? (names.get(m.userId) ?? null) : null} />
              </li>
            ))}
          </ul>
        )}
      </section>
      {done.length > 0 && (
        <section>
          <h2 className="mb-3 text-lg font-semibold">Recently answered messages</h2>
          <ul className="space-y-2 text-sm">
            {done.map((m) => (
              <li key={m.id} className="text-zinc-600 dark:text-zinc-400">
                <Badge tone="green">Done</Badge> {CONTACT_TOPICS[m.topic]}: {excerpt(m.body)}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function excerpt(text: string): string {
  const flat = text.replace(/\s+/g, " ");
  return flat.length > 90 ? `${flat.slice(0, 90)}…` : flat;
}

function MessageCard({ message: m, senderName }: { message: MessageView; senderName: string | null }) {
  const hidden = <input type="hidden" name="messageId" value={m.id} />;
  const reply = `mailto:${encodeURIComponent(m.replyTo)}?subject=${encodeURIComponent("Re: your message to Agent Arena")}`;
  return (
    <Card className="space-y-3">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <Badge tone="blue">{CONTACT_TOPICS[m.topic]}</Badge>
        <span className="text-zinc-500 dark:text-zinc-400">
          from <span className="font-medium text-zinc-800 dark:text-zinc-200">{m.replyTo}</span>
          {senderName ? `, signed in as ${senderName}` : ", not signed in"}
        </span>
      </div>
      <p className="text-sm whitespace-pre-wrap">{m.body}</p>
      <p className="text-xs text-zinc-500 dark:text-zinc-400">
        Sent <LocalDate at={m.createdAt} />
      </p>
      <div className="flex flex-wrap gap-2 pt-1">
        <a href={reply} className={buttonLinkClass("secondary")}>
          Reply by email
        </a>
        <form action={markMessageDoneAction}>
          {hidden}
          <Button type="submit">Mark done</Button>
        </form>
        <form action={deleteMessageAction}>
          {hidden}
          <ConfirmButton variant="danger" confirmLabel="Delete" message="Delete this message for good? Use this for spam, or when the sender asks.">
            Delete
          </ConfirmButton>
        </form>
      </div>
    </Card>
  );
}
