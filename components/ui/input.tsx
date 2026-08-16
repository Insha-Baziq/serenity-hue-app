import { forwardRef, type InputHTMLAttributes } from "react";

type InputProps = InputHTMLAttributes<HTMLInputElement>;

const Input = forwardRef<HTMLInputElement, InputProps>(({ className = "", ...props }, ref) => (
  <input ref={ref} className={`ui-input ${className}`} {...props} />
));

Input.displayName = "Input";

export { Input };
