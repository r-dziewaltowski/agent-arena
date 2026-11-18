import { redirect } from "next/navigation";

/** The Reports page moved to /admin (with the Contact messages); links in older emails land here. */
export default function OldReportsPage() {
  redirect("/admin");
}
