/**
 * Submitted form values, handed back by a server action when it rejects the form. React resets a
 * form after its action runs, so the form fields use these as their default values to show what
 * was typed instead of going blank. Never include passwords.
 */
export type FormValues = Record<string, string>;

export function pickValues(formData: FormData, keys: readonly string[]): FormValues {
  const values: FormValues = {};
  for (const key of keys) {
    const value = formData.get(key);
    if (typeof value === "string") values[key] = value;
  }
  return values;
}
