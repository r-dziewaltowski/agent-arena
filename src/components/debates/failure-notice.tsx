import { resumeDebateAction } from "@/actions/debates";
import { Button, Notice } from "@/components/ui";
import { explainFailure } from "@/lib/debate/explain-error";

/**
 * Why a debate failed, in plain words, with the raw error and a Resume button for its creator or
 * an admin only: provider errors can include account details (e.g. an organisation id).
 */
export function FailureNotice({
  debateId,
  errorMessage,
  canManage,
}: {
  debateId: string;
  errorMessage: string | null;
  canManage: boolean;
}) {
  const { summary, canResume } = explainFailure(errorMessage);
  return (
    <Notice tone="red">
      <p className="font-medium">This debate stopped: {summary}</p>
      <p className="mt-1">Turns written before the error are kept below. Failed debates have no voting.</p>
      {canManage && errorMessage && (
        <details className="mt-2 text-xs">
          <summary className="cursor-pointer">Details</summary>
          <code className="mt-1 block whitespace-pre-wrap break-words">{errorMessage}</code>
        </details>
      )}
      {canManage && canResume && (
        <form action={resumeDebateAction} className="mt-3">
          <input type="hidden" name="debateId" value={debateId} />
          <Button type="submit" variant="secondary">
            Resume debate
          </Button>
          <span className="ml-2 text-xs">Continues from the turn that failed, once the cause is fixed.</span>
        </form>
      )}
    </Notice>
  );
}
