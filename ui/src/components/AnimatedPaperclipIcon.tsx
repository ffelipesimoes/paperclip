import type { SVGProps } from "react";
import { cn } from "../lib/utils";

export function AnimatedPaperclipIcon({ className, ...props }: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 90 72"
      className={cn("paperclip-thinking-icon", className)}
      aria-hidden="true"
      fill="none"
      {...props}
    >
      <path
        className="w3du-loader-blue"
        d="M16 16 L38 56 H50 L28 16 Z"
        fill="currentColor"
      />
      <path
        className="w3du-loader-orange"
        d="M50 56 L72 16 H58 L44 42 L38 30 L28 42 L44 56 Z"
        fill="currentColor"
      />
    </svg>
  );
}

/** Full-page loading state: a large, centered, gray animated paperclip. */
export function PaperclipLoading({ className }: { className?: string }) {
  return (
    <div
      role="status"
      className={cn("flex min-h-dvh w-full items-center justify-center", className)}
    >
      <AnimatedPaperclipIcon className="h-24 w-24 text-muted-foreground" />
      <span className="sr-only">Loading…</span>
    </div>
  );
}
