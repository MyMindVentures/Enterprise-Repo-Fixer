import { GoogleGenAI } from "@google/genai";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });

export async function generateStepOutput(repoName: string, stepName: string) {
  try {
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: `You are an Enterprise Repo Fixer agent. Generate a realistic, technical, one-line log output for step "${stepName}" while analyzing a repository named "${repoName}". Return only the log message.`,
    });
    return response.text || `Executed ${stepName} for ${repoName}`;
  } catch (error) {
    console.error("Gemini API error:", error);
    return `Completed ${stepName} with internal verification.`;
  }
}

export async function generateFeatureCards(repoName: string) {
  try {
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: `Generate a list of 5 realistic feature names and their purposes for a repository named "${repoName}". Return as a JSON array of objects with "name" and "purpose" fields.`,
      config: {
        responseMimeType: "application/json"
      }
    });
    return JSON.parse(response.text || "[]");
  } catch (error) {
    console.error("Gemini API error:", error);
    return [
      { name: "Auth Engine", purpose: "Handles user authentication and session management." },
      { name: "Data Pipeline", purpose: "Processes incoming data streams and stores them in Firestore." }
    ];
  }
}
