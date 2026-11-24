import { describe, expect, it } from "vitest";
import { fillMessage, WA_TEMPLATES, waLink, type WaVars } from "../src/client/lib/wa-draft";

const v: WaVars = { name: "Riya", shop: "Chai Point", stamps: 7, total: 10, left: 3, reward: "Free coffee", ready: null, link: "https://x.test/c" };

describe("WhatsApp draft messages", () => {
  it("fills every placeholder and adds the card link", () => {
    expect(fillMessage(WA_TEMPLATES.en.thanks, v, "en", true)).toBe(
      "Hi Riya! 🙏 Thanks for visiting Chai Point today.\nYou have 7/10 stamps. Just 3 more for Free coffee!\n\nYour card: https://x.test/c",
    );
  });

  it("drops only the sentence whose value is missing", () => {
    const full = { ...v, left: null, reward: null };
    expect(fillMessage(WA_TEMPLATES.en.thanks, full, "en", false)).toBe("Hi Riya! 🙏 Thanks for visiting Chai Point today.\nYou have 7/10 stamps.");
    expect(fillMessage(WA_TEMPLATES.hi.thanks, full, "hi", false)).toBe("नमस्ते Riya जी! 🙏 आज Chai Point आने के लिए धन्यवाद।\nआपके कार्ड पर 7/10 स्टैम्प हैं।");
  });

  it("builds a wa.me link with the Indian country code", () => {
    expect(waLink("98765 43210", "Hi Riya!")).toBe("https://wa.me/919876543210?text=Hi%20Riya!");
  });
});
