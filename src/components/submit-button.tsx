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
  disabled = false,
}: {
  children: ReactNode;
  variant?: "primary" | "secondary" | "danger";
  pendingText?: string;
  confirm?: string;
  className?: string;
  disabled?: boolean;
}) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending || disabled}
      className={`${cls.btn} ${cls[variant]} ${className}`}
      onClick={(e) => {
        if (confirm && !window.confirm(confirm)) e.preventDefault();
      }}
    >
      {pending ? pendingText : children}
    </button>
  );
}
