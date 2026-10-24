import "dotenv/config";
import { GoogleGenAI } from "@google/genai";
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || "" });
try {
  await ai.models.generateContent({ model: "gemini-2.5-flash-image", contents: "a cat" });
} catch (e) {
  console.log("FULL ERROR:", e.message);
}
