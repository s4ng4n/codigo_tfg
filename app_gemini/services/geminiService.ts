
import { GoogleGenAI, GenerateContentResponse } from "@google/genai";
import { GEMINI_API_MODEL, GEMINI_PROMPT_SYSTEM_INSTRUCTION } from '../constants';
import { RiskType, GeminiAnalysisResponse } from '../types';

let ai: GoogleGenAI | null = null;

export const initializeGeminiService = (): string | null => {
  const apiKey = process.env.API_KEY;
  if (!apiKey) {
    console.error("API_KEY no encontrada en process.env");
    return "API_KEY no configurada. Por favor, configure la variable de entorno API_KEY.";
  }
  try {
    ai = new GoogleGenAI({ apiKey });
    return null; // Success
  } catch (error) {
    console.error("Error inicializando GoogleGenAI:", error);
    return `Error inicializando el servicio Gemini: ${error instanceof Error ? error.message : String(error)}`;
  }
};

export const analyzeImageForRisks = async (base64ImageData: string): Promise<GeminiAnalysisResponse> => {
  if (!ai) {
    throw new Error("Gemini service not initialized. Call initializeGeminiService() first.");
  }

  const imagePart = {
    inlineData: {
      mimeType: 'image/jpeg',
      data: base64ImageData,
    },
  };

  const textPart = {
    text: "Analiza esta imagen en busca de riesgos según las instrucciones del sistema."
  };

  try {
    const response: GenerateContentResponse = await ai.models.generateContent({
      model: GEMINI_API_MODEL,
      contents: { parts: [imagePart, textPart] },
      config: {
        systemInstruction: GEMINI_PROMPT_SYSTEM_INSTRUCTION,
        responseMimeType: "application/json",
      },
    });
    
    let jsonStr = response.text.trim();
    const fenceRegex = /^```(\w*)?\s*\n?(.*?)\n?\s*```$/s;
    const match = jsonStr.match(fenceRegex);
    if (match && match[2]) {
      jsonStr = match[2].trim();
    }

    const parsedData = JSON.parse(jsonStr) as GeminiAnalysisResponse;

    if (typeof parsedData.detected_risk !== 'string' || !Object.values(RiskType).includes(parsedData.detected_risk as RiskType)) {
      console.warn('Respuesta de Gemini con detected_risk inválido:', parsedData);
      return { detected_risk: RiskType.UNKNOWN, description: "Respuesta de IA inválida o no concluyente.", confidence_score: 0 };
    }
    if (typeof parsedData.description !== 'string' || typeof parsedData.confidence_score !== 'number') {
       console.warn('Respuesta de Gemini con formato inesperado:', parsedData);
       return { detected_risk: RiskType.UNKNOWN, description: "Formato de respuesta de IA inesperado.", confidence_score: 0 };
    }

    return parsedData;

  } catch (error) {
    console.error("Error analizando imagen con Gemini:", error);
    let errorMessage = "Error en el análisis de IA";
    if (error instanceof Error) {
        errorMessage = error.message;
    } else if (typeof error === 'string') {
        errorMessage = error;
    }
     return {
        detected_risk: RiskType.UNKNOWN,
        description: `Error en la comunicación con el servicio de IA: ${errorMessage}`,
        confidence_score: 0
    };
  }
};
