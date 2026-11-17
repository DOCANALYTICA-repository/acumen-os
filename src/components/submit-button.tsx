"use client";

import { useFormStatus } from "react-dom";
import type { ReactNode } from "react";
import { cls } from "./ui";

export function SubmitButton({
  children,
  variant = "primary",
  pendingText = "Saving…",
  confirm,
  className = "",
}: {
  children: ReactNode;
  variant?: "primary" | "secondary" | "danger";
  pendingText?: string;
  confirm?: string;
  className?: string;
}) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className={`${cls.btn} ${cls[variant]} ${className}`}
      onClick={(e) => {
        if (confirm && !window.confirm(confirm)) e.preventDefault();
      }}
    >
      {pending ? pendingText : children}
    </button>
  );
}
