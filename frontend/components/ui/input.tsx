import { forwardRef } from "react";
import { cn } from "@/lib/utils";

export const Input = forwardRef<
  HTMLInputElement,
  React.InputHTMLAttributes<HTMLInputElement>
>(({ className, ...props }, ref) => (
  <input
    ref={ref}
    className={cn(
      "h-10 w-full rounded-md border border-border bg-background px-3 text-base sm:text-sm outline-none transition-colors focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-50",
      className,
    )}
    {...props}
  />
));
Input.displayName = "Input";

export const Select = forwardRef<
  HTMLSelectElement,
  React.SelectHTMLAttributes<HTMLSelectElement>
>(({ className, ...props }, ref) => (
  <select
    ref={ref}
    className={cn(
      "h-10 w-full rounded-md border border-border bg-background px-3 text-base sm:text-sm outline-none transition-colors focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-50",
      className,
    )}
    {...props}
  />
));
Select.displayName = "Select";
