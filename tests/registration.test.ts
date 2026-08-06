import { describe, expect, it } from "vitest";
import { studentRegistrationSchema } from "../lib/registration";

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

  it("rejects email addresses outside uom.lk", () => {
    const result = studentRegistrationSchema.safeParse({
      ...validRegistration,
      email: "student@gmail.com",
    });

    expect(result.success).toBe(false);
  });

  it("rejects subdomains and lookalike UOM domains", () => {
    for (const email of [
      "student@sub.uom.lk",
      "student@uom.lk.example.com",
      "student@eviluom.lk",
    ]) {
      expect(studentRegistrationSchema.safeParse({
        ...validRegistration,
        email,
      }).success).toBe(false);
    }
  });

  it("normalizes UOM email and student index casing", () => {
    const result = studentRegistrationSchema.parse({
      ...validRegistration,
      email: "  Nimal@UOM.LK  ",
      registrationNumber: "  20en012a  ",
    });

    expect(result.email).toBe("nimal@uom.lk");
    expect(result.registrationNumber).toBe("20EN012A");
  });
});
