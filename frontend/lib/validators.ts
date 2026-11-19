import { z } from "zod";

export const loginSchema = z.object({
  email: z.string().email("Valid email required"),
  password: z.string().min(1, "Password required"),
});
export type LoginFormData = z.infer<typeof loginSchema>;

export const registerSchema = z.object({
  email: z.string().email("Valid email required"),
  password: z.string().min(8, "Password must be at least 8 characters"),
  full_name: z.string().min(1, "Full name required"),
});
export type RegisterFormData = z.infer<typeof registerSchema>;

export const searchSchema = z.object({
  query: z.string().min(1).max(1000),
  top_k: z.number().int().min(1).max(50).optional(),
});
export type SearchFormData = z.infer<typeof searchSchema>;

export const chatMessageSchema = z.object({
  message: z.string().min(1).max(2000),
});
export type ChatMessageFormData = z.infer<typeof chatMessageSchema>;
