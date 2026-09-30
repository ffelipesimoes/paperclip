import type { ImgHTMLAttributes } from "react";
import { cn } from "../lib/utils";

interface PaperclipLockupProps extends ImgHTMLAttributes<HTMLImageElement> {
  decorative?: boolean;
  title?: string;
}

/**
 * The official W3DU brand lockup, replacing the Paperclip lockup.
 * Uses the official brand asset in /w3du-logo.png.
 */
export function PaperclipLockup({
  decorative = false,
  title = "W3DU",
  className,
  ...rest
}: PaperclipLockupProps) {
  return (
    <img
      src="/w3du-logo.png"
      alt={decorative ? "" : title}
      role={decorative ? "presentation" : "img"}
      className={cn("h-8 w-auto object-contain", className)}
      {...rest}
    />
  );
}

