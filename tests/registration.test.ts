import { describe, expect, it } from "vitest";
import {
  isUniversityEmailAllowed,
  normalizeUniversityDomain,
  studentRegistrationSchema,
} from "../lib/registration";

const validRegistration = {
  fullName: "Nimal Perera",
  email: "nimal@uom.lk",
  registrationNumber: "200012A",
  password: "SecurePass1",
  confirmPassword: "SecurePass1",
};

describe("student registration", () => {
  it("accepts complete student details", () => {
    expect(studentRegistrationSchema.safeParse(validRegistration).success).toBe(true);
  });

  it("rejects mismatched passwords", () => {
    const result = studentRegistrationSchema.safeParse({
      ...validRegistration,
      confirmPassword: "DifferentPass1",
    });
    expect(result.success).toBe(false);
  });

  it("rejects weak passwords", () => {
    const result = studentRegistrationSchema.safeParse({
      ...validRegistration,
      password: "password",
      confirmPassword: "password",
    });
    expect(result.success).toBe(false);
  });

  it("normalizes and enforces the configured university domain", () => {
    const domain = normalizeUniversityDomain(" @UOM.LK ");
    expect(domain).toBe("uom.lk");
    expect(isUniversityEmailAllowed("student@uom.lk", domain)).toBe(true);
    expect(isUniversityEmailAllowed("student@gmail.com", domain)).toBe(false);
  });
});
