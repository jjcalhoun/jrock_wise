import type { Category } from "@/lib/types";

/* Best-guess categorization for imported transactions (decision 3).
   Keyword → category-name matching against the user's own categories. Returns
   the matched category, or null when nothing is confident enough — callers then
   leave the transaction uncategorized for the Review queue. */

// Keyword fragments keyed by the default category names. Matched case-insensitively
// as substrings of the merchant/description. Only categories the user actually
// has are eligible, so renaming/deleting defaults degrades gracefully.
const KEYWORDS: Record<string, string[]> = {
  Groceries: ["grocer", "kroger", "safeway", "aldi", "trader joe", "whole foods", "publix", "wegmans", "costco", "sam's club", "meijer"],
  "Dining Out": ["restaurant", "cafe", "coffee", "starbucks", "mcdonald", "chipotle", "doordash", "uber eats", "grubhub", "pizza", "taco", "bar &", "diner", "bakery"],
  Transportation: ["uber", "lyft", "shell", "exxon", "chevron", "bp ", "gas ", "fuel", "parking", "transit", "metro", "toll", "auto"],
  "Utilities & Bills": ["electric", "water", "gas company", "utility", "comcast", "xfinity", "at&t", "verizon", "t-mobile", "internet", "energy", "duke energy"],
  Shopping: ["amazon", "amzn", "target", "walmart", "best buy", "ebay", "etsy", "home depot", "lowe's", "ikea", "macy"],
  Health: ["pharmacy", "cvs", "walgreens", "doctor", "dental", "clinic", "hospital", "medical", "health", "fitness", "gym"],
  Entertainment: ["cinema", "movie", "amc", "ticket", "concert", "steam", "playstation", "xbox", "nintendo", "spotify"],
  Subscription: ["netflix", "hulu", "disney+", "subscription", "membership", "prime video", "patreon", "icloud", "google storage", "adobe"],
  Travel: ["airline", "delta", "united", "southwest", "hotel", "airbnb", "expedia", "marriott", "hilton", "rental car"],
  Pets: ["petco", "petsmart", "chewy", "veterinar", "vet "],
  Education: ["tuition", "university", "college", "school", "udemy", "coursera", "textbook"],
  "Gifts & Donations": ["donation", "gofundme", "charity", "red cross"],
  "Debt Payments": ["loan", "student loan", "earnest", "mortgage", "credit card payment"],
  Fees: ["fee", "interest charge", "service charge", "atm "],
  Housing: ["rent", "landlord", "property mgmt", "hoa "],
};

export function guessCategory(
  description: string,
  categories: Category[],
): Category | null {
  const text = description.toLowerCase();
  const byName = new Map(categories.map((c) => [c.name, c]));

  for (const [name, words] of Object.entries(KEYWORDS)) {
    const cat = byName.get(name);
    if (!cat) continue;
    if (words.some((w) => text.includes(w))) return cat;
  }
  return null;
}
