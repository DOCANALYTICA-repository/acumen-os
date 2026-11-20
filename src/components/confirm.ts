"use client";

import { cls } from "./ui";

/**
 * In-page confirmation dialog. Replaces window.confirm(), which some browsers and embedded
 * webviews block (it then returns false and the action silently never runs).
 * Resolves true when the user confirms, false on Cancel / Escape / backdrop click.
 */
export function askConfirm(message: string, opts: { confirmLabel?: string; danger?: boolean } = {}): Promise<boolean> {
  if (typeof document === "undefined") return Promise.resolve(false);
  return new Promise((resolve) => {
    const dialog = document.createElement("dialog");
    dialog.className = "m-auto w-[min(92vw,26rem)] rounded-3xl border border-line bg-white p-6 text-ink shadow-2xl backdrop:bg-slate-900/40";
    dialog.setAttribute("aria-label", "Confirm");

    const text = document.createElement("p");
    text.className = "whitespace-pre-line text-sm leading-relaxed";
    text.textContent = message;

    const row = document.createElement("div");
    row.className = "mt-6 flex flex-wrap justify-end gap-2";

    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.className = `${cls.btn} ${cls.secondary} border-line`;
    cancel.textContent = "Cancel";

    const ok = document.createElement("button");
    ok.type = "button";
    ok.className = `${cls.btn} ${opts.danger ? cls.danger : cls.primary}`;
    ok.textContent = opts.confirmLabel ?? "Confirm";

    row.append(cancel, ok);
    dialog.append(text, row);
    document.body.appendChild(dialog);

    let settled = false;
    const finish = (value: boolean) => {
      if (settled) return;
      settled = true;
      if (dialog.open) dialog.close();
      dialog.remove();
      resolve(value);
    };
    cancel.addEventListener("click", () => finish(false));
    ok.addEventListener("click", () => finish(true));
    dialog.addEventListener("cancel", (e) => {
      e.preventDefault();
      finish(false);
    });
    dialog.addEventListener("click", (e) => {
      if (e.target === dialog) finish(false); // click on the backdrop
    });

    dialog.showModal();
    ok.focus();
  });
}
