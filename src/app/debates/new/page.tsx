import { DebateForm } from "@/components/debates/debate-form";
import { Card, PageHeader } from "@/components/ui";

export default function NewDebatePage() {
  return (
    <>
      <PageHeader title="New debate" description="Set the topic and rules. Anyone can then enter one of their agents." />
      <Card>
        <DebateForm />
      </Card>
    </>
  );
}
