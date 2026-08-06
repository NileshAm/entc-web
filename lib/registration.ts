import { z } from "zod";

export const universityEmailDomain = "uom.lk";

export function normalizeStudentIndex(value: string) {
  return value.trim().toUpperCase();
}

export const studentRegistrationSchema = z
  .object({
    fullName: z
      .string()
      .trim()
      .min(2, "Enter your full name.")
      .max(100, "Full name must be 100 characters or fewer."),
    email: z
      .string()
      .trim()
      .toLowerCase()
      .email("Enter a valid email.")
      .refine(
        (value) => value.split("@")[1] === universityEmailDomain,
        `Use your @${universityEmailDomain} university email address.`,
      ),
    registrationNumber: z
      .string()
      .trim()
      .min(4, "Enter your student index.")
      .max(30, "Student index must be 30 characters or fewer.")
      .regex(
        /^[a-zA-Z0-9/_-]+$/,
        "Student index can only contain letters, numbers, /, _ or -.",
      )
      .transform(normalizeStudentIndex),
    password: z
      .string()
      .min(8, "Password must contain at least 8 characters.")
      .max(72, "Password must be 72 characters or fewer.")
      .regex(/[a-z]/, "Password must include a lowercase letter.")
      .regex(/[A-Z]/, "Password must include an uppercase letter.")
      .regex(/[0-9]/, "Password must include a number."),
    confirmPassword: z.string(),
  })
  .refine((value) => value.password === value.confirmPassword, {
    message: "Passwords do not match.",
    path: ["confirmPassword"],
  });
