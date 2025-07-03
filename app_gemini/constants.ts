
export const GEMINI_API_MODEL = "gemini-2.5-flash-preview-04-17"; // Model for image analysis
export const IMAGE_ANALYSIS_INTERVAL_MS = 7000; // 7 seconds
export const MIN_CONFIDENCE_SCORE = 0.7; // Minimum confidence score to trigger an alert

export const GEMINI_PROMPT_SYSTEM_INSTRUCTION = `
Eres un asistente de IA para un sistema de monitorización domiciliaria.
Analiza la imagen proporcionada para detectar posibles riesgos de seguridad para una persona en situación de dependencia.
Busca específicamente:
1. Una persona que se haya caído (en el suelo, en una postura inusual que sugiera una caída).
2. Un incendio sin supervisión o humo significativo (llamas visibles, humo denso).
Responde ÚNICAMENTE con un objeto JSON con la siguiente estructura:
{
  "detected_risk": "FALL" | "FIRE" | "NONE",
  "description": "Una breve descripción del riesgo detectado o 'No se detectó riesgo inmediato.'",
  "confidence_score": 0.0-1.0
}
Si hay múltiples riesgos, prioriza el más severo (ej. FIRE sobre FALL).
Si no estás seguro o la imagen no es clara, usa "NONE" y una confianza baja.
Asegúrate que detected_risk sea uno de los tres valores literales: "FALL", "FIRE", o "NONE".
`;

export const DEFAULT_CAMERA_CONSTRAINTS: MediaStreamConstraints = {
  video: {
    width: { ideal: 640 },
    height: { ideal: 480 },
    facingMode: "user"
  },
  audio: false,
};
