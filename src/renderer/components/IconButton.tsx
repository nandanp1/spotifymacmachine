import {
  forwardRef,
  type ButtonHTMLAttributes,
  type ReactNode,
} from "react";

interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  label: string;
  children: ReactNode;
  size?: "small" | "medium" | "large";
  quiet?: boolean;
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(
  function IconButton(
    {
      label,
      children,
      className = "",
      size = "medium",
      quiet = false,
      ...props
    },
    ref,
  ) {
    return (
      <button
        ref={ref}
        aria-label={label}
        title={label}
        className={`icon-button icon-button--${size} ${quiet ? "icon-button--quiet" : ""} ${className}`}
        type="button"
        {...props}
      >
        {children}
      </button>
    );
  },
);
