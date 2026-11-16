import { ForgotPasswordForm } from "@/components/auth/auth-forms";
import { Card } from "@/components/ui";

export default function ForgotPasswordPage() {
  return (
    <div className="mx-auto max-w-sm">
      <h1 className="mb-1 text-2xl font-semibold tracking-tight">Forgot your password?</h1>
      <p className="mb-6 text-sm text-zinc-600 dark:text-zinc-400">Enter your email and we&apos;ll send you a link to choose a new one.</p>
      <Card>
        <ForgotPasswordForm />
      </Card>
    </div>
  );
}
