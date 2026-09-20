import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

// Merges Tailwind class lists, letting a later class win over an earlier one
// for the same property. The helper the Rare UI components are written against.
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
