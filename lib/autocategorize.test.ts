import { describe, it, expect } from "vitest";
import { guessCategory } from "./autocategorize";
import type { Category } from "./types";

const cat = (name: string): Category => ({
  id: name.toLowerCase(),
  user_id: "u",
  name,
  icon: "circle",
  color: "#000",
  bucket: "needs",
  is_archived: false,
  sort_order: 0,
  created_at: "",
  updated_at: "",
});

const categories = [cat("Groceries"), cat("Dining Out"), cat("Transportation")];

describe("guessCategory", () => {
  it("matches a known merchant keyword", () => {
    expect(guessCategory("KROGER #123", categories)?.name).toBe("Groceries");
    expect(guessCategory("Starbucks Coffee", categories)?.name).toBe("Dining Out");
    expect(guessCategory("SHELL OIL 4456", categories)?.name).toBe("Transportation");
  });

  it("returns null when nothing matches", () => {
    expect(guessCategory("ACME WIDGETS LLC", categories)).toBeNull();
  });

  it("only returns categories the user actually has", () => {
    // "netflix" maps to Subscription, which isn't in this user's list
    expect(guessCategory("NETFLIX.COM", categories)).toBeNull();
  });
});
