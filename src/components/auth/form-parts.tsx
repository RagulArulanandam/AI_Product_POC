import type { FormState } from "@/lib/form-state";

export function FieldError({ state, name }: { state: FormState; name: string }) {
  const messages = state?.fieldErrors?.[name];
  if (!messages?.length) return null;
  return (
    <p className="text-sm text-red-600" role="alert">
      {messages.join(" ")}
    </p>
  );
}

export function FormError({ state }: { state: FormState }) {
  if (!state?.error) return null;
  return (
    <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">
      {state.error}
    </p>
  );
}
