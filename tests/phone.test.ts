import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { formatPhone, maskPhone, normalizeIndianMobile } from "../lib/crm/phone";

describe("Indian mobile numbers", () => {
  it("normalises common input shapes", () => {
    for (const input of ["9876543210", "+91 98765 43210", "09876543210", "91-9876543210", "+91 (987) 654-3210"]) {
      assert.equal(normalizeIndianMobile(input), "+919876543210", input);
    }
  });

  it("rejects landlines and short numbers", () => {
    for (const input of ["0847212345", "12345", "5876543210", ""]) {
      assert.equal(normalizeIndianMobile(input), null, input);
    }
  });

  it("formats and masks", () => {
    assert.equal(formatPhone("+919876543210"), "+91 98765 43210");
    assert.equal(maskPhone("+919876543210"), "+91 ••••• •3210");
  });
});
