import { renderTemplate } from "@/products/missed-call/template";

/** A WhatsApp-style preview of a message template, so owners see what customers will read. */
export function MessagePreview({ template, businessName, label }: { template: string; businessName: string; label: string }) {
  const text = renderTemplate(template, { business_name: businessName });

  return (
    <div className="rounded-xl bg-[oklch(0.94_0.025_160)] p-4">
      <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-[oklch(0.4_0.06_160)]">{label}</p>
      <div className="max-w-[85%] rounded-2xl rounded-tl-sm bg-white px-3.5 py-2.5 text-sm leading-relaxed shadow-sm">
        {text || <span className="text-muted-foreground">Your message will appear here.</span>}
      </div>
    </div>
  );
}
