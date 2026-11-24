import { useEffect, useState } from "react";

/** Sample customer used in previews. */
export interface SampleValues {
  name: string;
  business: string;
  points: string;
  reward: string;
}

const TOKENS: Record<string, keyof SampleValues> = { "{{name}}": "name", "{{business}}": "business", "{{points}}": "points", "{{reward}}": "reward" };

export function resolveParams(params: string[], sample: SampleValues) {
  return params.map((p) => p.replace(/\{\{(name|business|points|reward)\}\}/g, (t) => sample[TOKENS[t]!]));
}

/** Fill a WhatsApp template body ({{1}}, {{2}}…) with the resolved variables. */
export function fillTemplate(text: string, values: string[]) {
  return text.replace(/\{\{(\d+)\}\}/g, (m, n: string) => values[Number(n) - 1] ?? m);
}

const textKey = (businessId: string, template: string) => `graahak.waTemplate.${businessId}.${template.trim().toLowerCase()}`;

/**
 * The approved template's text lives in Meta's WhatsApp Manager, not in our database. Owners paste it once
 * to see the preview; it's remembered on this device only.
 */
export function useTemplateText(businessId: string, templateName: string) {
  const [text, setText] = useState("");
  useEffect(() => {
    try {
      setText(templateName.trim() ? (localStorage.getItem(textKey(businessId, templateName)) ?? "") : "");
    } catch {
      setText("");
    }
  }, [businessId, templateName]);
  const update = (v: string) => {
    setText(v);
    try {
      if (templateName.trim()) localStorage.setItem(textKey(businessId, templateName), v);
    } catch {
      // Private mode: preview text just isn't remembered.
    }
  };
  return [text, update] as const;
}

/** WhatsApp-style chat showing the message a sample customer would receive. */
export function WhatsAppPreview({
  businessName,
  templateName,
  templateText,
  values,
  compact,
}: {
  businessName: string;
  templateName: string;
  templateText: string;
  values: string[];
  compact?: boolean;
}) {
  const body = templateText.trim() ? fillTemplate(templateText, values) : null;
  const parts = body ? body.split(/(\{\{\d+\}\})/g) : [];
  return (
    <div className={compact ? "overflow-hidden rounded-2xl ring-1 ring-zinc-200" : "mx-auto w-full max-w-[320px] overflow-hidden rounded-[2rem] border-[8px] border-zinc-900 shadow-xl"}>
      <div className="flex items-center gap-2.5 bg-[#075E54] px-3 py-2.5 text-white">
        <span className="flex size-8 items-center justify-center rounded-full bg-white/20 text-sm font-semibold">{businessName[0] ?? "?"}</span>
        <span className="min-w-0">
          <span className="block truncate text-sm font-semibold">{businessName}</span>
          <span className="block text-[11px] text-white/75">Business account</span>
        </span>
      </div>
      <div className={compact ? "bg-[#ECE5DD] p-3" : "min-h-[360px] bg-[#ECE5DD] p-3"}>
        <p className="mx-auto mb-3 w-fit rounded-md bg-white/80 px-2 py-0.5 text-[11px] text-zinc-600 shadow-sm">TODAY</p>
        <div className="relative max-w-[88%] rounded-lg rounded-tl-none bg-white px-3 py-2 text-[13.5px] leading-snug text-zinc-900 shadow-sm">
          {body ? (
            <p className="whitespace-pre-line break-words">
              {parts.map((part, i) =>
                /^\{\{\d+\}\}$/.test(part) ? (
                  <mark key={i} className="rounded bg-amber-200 px-0.5" title="No value for this variable">
                    {part}
                  </mark>
                ) : (
                  <span key={i}>{part}</span>
                ),
              )}
            </p>
          ) : (
            <div className="space-y-1.5 text-zinc-600">
              <p>
                Template <b className="text-zinc-900">{templateName.trim() || "…"}</b> will be sent with:
              </p>
              <ul className="space-y-0.5">
                {values.map((v, i) => (
                  <li key={i}>
                    <code className="rounded bg-zinc-100 px-1 text-[12px]">{`{{${i + 1}}}`}</code> → <b className="text-zinc-900">{v || "(empty)"}</b>
                  </li>
                ))}
              </ul>
              <p className="text-[11.5px] text-zinc-500">Paste the template text to see the full message.</p>
            </div>
          )}
          <p className="mt-1 text-right text-[10.5px] text-zinc-400">10:30 am</p>
        </div>
      </div>
    </div>
  );
}
