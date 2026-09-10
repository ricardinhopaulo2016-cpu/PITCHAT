import { forwardRef, type InputHTMLAttributes, type TextareaHTMLAttributes } from "react";

const fieldBase =
  "w-full rounded-[var(--radius-input)] border border-border bg-surface-1 px-3 text-sm text-text " +
  "placeholder:text-text-muted transition-colors duration-[var(--motion-fast)] " +
  "focus-visible:border-signal focus-visible:outline-none";

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...rest }, ref) => <input ref={ref} className={`${fieldBase} h-9 ${className ?? ""}`} {...rest} />
);
Input.displayName = "Input";

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(
  ({ className, ...rest }, ref) => (
    <textarea ref={ref} className={`${fieldBase} py-2 ${className ?? ""}`} {...rest} />
  )
);
Textarea.displayName = "Textarea";
