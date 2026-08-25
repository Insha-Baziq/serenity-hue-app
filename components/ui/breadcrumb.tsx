import { ChevronRight } from "lucide-react";
import { forwardRef, type HTMLAttributes, type AnchorHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

const Breadcrumb = forwardRef<HTMLElement, HTMLAttributes<HTMLElement>>(({ className, ...props }, ref) => (
  <nav ref={ref} aria-label="breadcrumb" className={cn("shadcn-breadcrumb", className)} {...props} />
));
Breadcrumb.displayName = "Breadcrumb";

const BreadcrumbList = forwardRef<HTMLOListElement, HTMLAttributes<HTMLOListElement>>(({ className, ...props }, ref) => (
  <ol ref={ref} className={cn("shadcn-breadcrumb__list", className)} {...props} />
));
BreadcrumbList.displayName = "BreadcrumbList";

const BreadcrumbItem = forwardRef<HTMLLIElement, HTMLAttributes<HTMLLIElement>>(({ className, ...props }, ref) => (
  <li ref={ref} className={cn("shadcn-breadcrumb__item", className)} {...props} />
));
BreadcrumbItem.displayName = "BreadcrumbItem";

const BreadcrumbLink = forwardRef<HTMLAnchorElement, AnchorHTMLAttributes<HTMLAnchorElement>>(({ className, ...props }, ref) => (
  <a ref={ref} className={cn("shadcn-breadcrumb__link", className)} {...props} />
));
BreadcrumbLink.displayName = "BreadcrumbLink";

const BreadcrumbPage = forwardRef<HTMLSpanElement, HTMLAttributes<HTMLSpanElement>>(({ className, ...props }, ref) => (
  <span ref={ref} aria-current="page" className={cn("shadcn-breadcrumb__page", className)} {...props} />
));
BreadcrumbPage.displayName = "BreadcrumbPage";

function BreadcrumbSeparator({ className, children, ...props }: HTMLAttributes<HTMLLIElement>) {
  return <li role="presentation" aria-hidden="true" className={cn("shadcn-breadcrumb__separator", className)} {...props}>{children ?? <ChevronRight size={14} />}</li>;
}

export { Breadcrumb, BreadcrumbList, BreadcrumbItem, BreadcrumbLink, BreadcrumbPage, BreadcrumbSeparator };
