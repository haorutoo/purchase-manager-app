import {onCall, HttpsError} from "firebase-functions/v2/https";
import {defineSecret} from "firebase-functions/params";

const geminiApiKeySecret = defineSecret("GEMINI_API_KEY");

export const searchPrices = onCall(
  {secrets: [geminiApiKeySecret], timeoutSeconds: 60},
  async (request) => {
    const item = request.data.item;
    if (!item) {
      throw new HttpsError("invalid-argument", "Item is required.");
    }

    try {
      // Dynamic import to handle ESM package in CJS environment
      const {GoogleGenAI} = await import("@google/genai");

      // Initialize the Gemini client
      const ai = new GoogleGenAI({apiKey: geminiApiKeySecret.value()});

      const response = await ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: `Search Google for the lowest prices for the office supply or item: "${item}". Find the top 3 best prices from reputable online sellers (like Amazon, Staples, Office Depot, Walmart, etc). Provide the seller name, the exact price (as a string with $), and the direct shopping link URL to the product page. Ensure URLs are well-formed.

Return the results as a JSON object with a "results" array containing objects with "seller", "price", and "url" string properties. Respond ONLY with raw valid JSON, no markdown formatting.`,
        config: {
          tools: [{googleSearch: {}}],
        },
      });

      if (response.text) {
        let text = response.text.trim();
        if (text.startsWith("```json")) {
          text = text.substring(7);
        } else if (text.startsWith("```")) {
          text = text.substring(3);
        }
        if (text.endsWith("```")) {
          text = text.substring(0, text.length - 3);
        }
        text = text.trim();
        return JSON.parse(text);
      } else {
        throw new Error("No text returned from Gemini.");
      }
    } catch (e: any) {
      console.error("Gemini Search Error:", e);
      throw new HttpsError("internal", "Failed to search prices: " + e.message);
    }
  }
);
