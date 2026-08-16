import { cva, type VariantProps } from "class-variance-authority";
import { forwardRef, type ButtonHTMLAttributes } from "react";

const buttonVariants = cva("ui-button", {
  variants: {
    variant: {
      default: "ui-button--default",
      primary: "ui-button--primary",
      outline: "ui-button--outline",
      ghost: "ui-button--ghost",
    },
    size: {
      default: "ui-button--default-size",
      compact: "ui-button--compact",
      icon: "ui-button--icon",
    },
  },
  defaultVariants: {
    variant: "default",
    size: "default",
  },
});

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & VariantProps<typeof buttonVariants>;

const Button = forwardRef<HTMLButtonElement, ButtonProps>(({ className, variant, size, type = "button", ...props }, ref) => (
  <button ref={ref} type={type} className={buttonVariants({ variant, size, className })} {...props} />
));

Button.displayName = "Button";

export { Button, buttonVariants };
