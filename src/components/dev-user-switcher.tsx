import { switchDevUser } from "@/actions/dev";
import { DEV_USERS } from "@/lib/auth/dev-users";
import { getCurrentUser } from "@/lib/auth/session";
import { AutoSubmitSelect } from "./auto-submit-select";

/** Dev-only "signed in as" picker (M2). */
export async function DevUserSwitcher() {
  const current = await getCurrentUser();
  return (
    <form action={switchDevUser} className="flex items-center gap-2 text-sm">
      <span className="text-zinc-500">Signed in as</span>
      <AutoSubmitSelect name="userId" defaultValue={current.id} aria-label="Dev user">
        {DEV_USERS.map((u) => (
          <option key={u.id} value={u.id}>
            {u.name}
            {u.isAdmin ? " (admin)" : ""}
          </option>
        ))}
      </AutoSubmitSelect>
      <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-800 dark:bg-amber-950 dark:text-amber-300">
        dev
      </span>
    </form>
  );
}
