"use client";

import { useFormStatus } from "react-dom";
import type { ReactNode } from "react";
import { cls } from "./ui";
import { askConfirm } from "./confirm";

export function SubmitButton({
  children,
  variant = "primary",
  pendingText = "Saving…",
  confirm,
  className = "",
  disabled = false,
  name,
  value,
}: {
  children: ReactNode;
  variant?: "primary" | "secondary" | "danger";
  pendingText?: string;
  confirm?: string;
  className?: string;
  disabled?: boolean;
  name?: string;
  value?: string;
}) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      name={name}
      value={value}
      disabled={pending || disabled}
      className={`${cls.btn} ${cls[variant]} ${className}`}
      onClick={(e) => {
        if (!confirm) return;
        e.preventDefault();
        const btn = e.currentTarget;
        void askConfirm(confirm, { danger: variant === "danger" }).then((yes) => {
          if (yes) btn.form?.requestSubmit(btn);
        });
      }}
    >
      {pending ? pendingText : children}
    </button>
  );
}
