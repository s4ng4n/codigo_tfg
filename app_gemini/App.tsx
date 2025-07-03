import React, { useState, useEffect, useCallback, ChangeEvent } from 'react';
import CameraFeed from './components/CameraFeed';
import AlertNotification from './components/AlertNotification';
import StatusIndicator from './components/StatusIndicator';
import LoadingSpinner from './components/LoadingSpinner';
import { initializeGeminiService, analyzeImageForRisks } from './services/geminiService';
import { RiskType, DetectedRisk, Alert as AlertType } from './types';
import { MIN_CONFIDENCE_SCORE } from './constants';

type VideoSourceType = 'webcam' | 'file';

const App: React.FC = () => {
  const [currentRisk, setCurrentRisk] = useState<RiskType>(RiskType.NONE);
  const [currentRiskDetails, setCurrentRiskDetails] = useState<DetectedRisk | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState<boolean>(false);
  const [appError, setAppError] = useState<string | null>(null);
  const [geminiInitialized, setGeminiInitialized] = useState<boolean>(false);
  const [lastAnalysisTime, setLastAnalysisTime] = useState<Date | null>(null);
  const [activeAlert, setActiveAlert] = useState<AlertType['message'] | null>(null);

  const [videoSource, setVideoSource] = useState<VideoSourceType>('webcam');
  const [uploadedVideoFile, setUploadedVideoFile] = useState<File | null>(null);
  const [cameraFeedKey, setCameraFeedKey] = useState<string>(Date.now().toString());

  useEffect(() => {
    const initError = initializeGeminiService();
    if (initError) {
      setAppError(initError);
      setGeminiInitialized(false);
    } else {
      setGeminiInitialized(true);
      setAppError(null);
    }
  }, []);

  const resetAnalysisState = () => {
    setCurrentRisk(RiskType.NONE);
    setCurrentRiskDetails(null);
    setActiveAlert(null);
    setLastAnalysisTime(null);
    setAppError(null);
  };

  const handleVideoSourceChange = (source: VideoSourceType) => {
    resetAnalysisState();
    setVideoSource(source);
    if (source === 'webcam') {
      setUploadedVideoFile(null);
    }
    setCameraFeedKey(Date.now().toString());
  };

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      resetAnalysisState();
      setUploadedVideoFile(file);
      setCameraFeedKey(Date.now().toString());
    } else {
      setUploadedVideoFile(null);
      if (videoSource === 'file') {
         setAppError("No se ha seleccionado ningún archivo de video.");
      }
    }
  };

  const handleCameraError = useCallback((message: string) => {
    setAppError(`Error de Video/Cámara: ${message}`);
    setActiveAlert(`Error de Video/Cámara: ${message}`);
  }, []);

  const handleFrameCapture = useCallback(async (base64ImageData: string) => {
    if (isAnalyzing || !geminiInitialized) {
      return;
    }
    if (videoSource === 'file' && !uploadedVideoFile) {
        setAppError("Intentando analizar sin un archivo de video cargado.");
        return;
    }

    setIsAnalyzing(true);

    try {
      const analysisResult = await analyzeImageForRisks(base64ImageData);
      setLastAnalysisTime(new Date());
      setCurrentRiskDetails(analysisResult);

      if (analysisResult.detected_risk !== RiskType.NONE && analysisResult.confidence_score >= MIN_CONFIDENCE_SCORE) {
        setCurrentRisk(analysisResult.detected_risk);
        const alertMessage = `${analysisResult.detected_risk === RiskType.FALL ? 'Posible caída detectada.' : 'Posible incendio detectado.'} ${analysisResult.description}`;
        setActiveAlert(alertMessage);
        console.warn(`ALERTA: ${analysisResult.detected_risk} detectado. Confianza: ${analysisResult.confidence_score}. Descripción: ${analysisResult.description}`);
      } else {
         if (currentRisk !== RiskType.NONE && analysisResult.detected_risk === RiskType.NONE) {
           setActiveAlert(null); 
         }
        setCurrentRisk(RiskType.NONE);
      }
      
      if(appError && !appError.includes("API_KEY") && !appError.includes("Error de Video/Cámara")) {
        setAppError(null);
      }
      
    } catch (error) {
      console.error("Error en el flujo de análisis de frame:", error);
      const errorMessage = error instanceof Error ? error.message : String(error);
      setAppError(`Error durante el análisis: ${errorMessage}`);
      setCurrentRisk(RiskType.UNKNOWN);
      setCurrentRiskDetails({ detected_risk: RiskType.UNKNOWN, description: `Error de análisis: ${errorMessage}`, confidence_score: 0 });
      setActiveAlert(`Error de análisis: ${errorMessage}`);
    } finally {
      setIsAnalyzing(false);
    }
  }, [isAnalyzing, geminiInitialized, currentRisk, videoSource, uploadedVideoFile, appError]);


  if (!geminiInitialized && !appError) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-gray-900 p-4">
        <LoadingSpinner message="Inicializando servicio de IA..." size="lg" />
      </div>
    );
  }
  
  const getStatusText = () => {
    if (appError && appError.includes("API_KEY")) return "API Key no configurada.";
    if (appError && appError.includes("Error de Video/Cámara")) return "Problema con la fuente de video.";
    if (appError) return "Error del sistema.";
    if (!geminiInitialized) return "Servicio IA no disponible.";
     if (videoSource === 'file' && !uploadedVideoFile) return "Esperando archivo de video...";
    return "Monitorizando...";
  };

  const renderVideoPlayer = () => {
    if (videoSource === 'webcam') {
      return (
        <CameraFeed
          key={cameraFeedKey}
          sourceType="webcam"
          onFrameCapture={handleFrameCapture}
          isAnalyzing={isAnalyzing}
          onError={handleCameraError}
        />
      );
    }
    if (videoSource === 'file') {
      if (uploadedVideoFile) {
        return (
          <CameraFeed
            key={cameraFeedKey}
            sourceType="file"
            videoFile={uploadedVideoFile}
            onFrameCapture={handleFrameCapture}
            isAnalyzing={isAnalyzing}
            onError={handleCameraError}
          />
        );
      }
      return (
        <div className="w-full aspect-video bg-gray-800 rounded-lg shadow-xl flex items-center justify-center border-2 border-gray-700">
          <p className="text-gray-400">Por favor, selecciona un archivo de video para analizar.</p>
        </div>
      );
    }
    return null;
  };

  return (
    <div className="min-h-screen flex flex-col items-center bg-gray-900 p-4 md:p-8 selection:bg-sky-500 selection:text-white">
      <header className="w-full max-w-4xl mb-6 text-center">
        <h1 className="text-4xl font-bold text-sky-400">
          Sistema de Asistencia Inteligente <span role="img" aria-label="ojo vigilante">👁️‍🗨️</span>
        </h1>
        <p className="text-gray-400 mt-2">Vigilancia en tiempo real para la seguridad y autonomía.</p>
      </header>

      <main className="w-full max-w-2xl space-y-6">
        {appError && !appError.includes("Video/Cámara") && !appError.includes("análisis") && (
           <div className="bg-red-800 border border-red-600 text-red-100 px-4 py-3 rounded-lg shadow-md relative" role="alert">
            <strong className="font-bold">Error de Configuración o Sistema: </strong>
            <span className="block sm:inline">{appError}</span>
          </div>
        )}

        <div className="bg-gray-800 p-4 rounded-lg shadow-md">
          <h2 className="text-lg font-semibold text-sky-300 mb-3">Seleccionar Fuente de Video:</h2>
          <div className="flex space-x-4 items-center">
            <label className="flex items-center space-x-2 cursor-pointer p-2 rounded hover:bg-gray-700 transition-colors">
              <input
                type="radio"
                name="videoSource"
                value="webcam"
                checked={videoSource === 'webcam'}
                onChange={() => handleVideoSourceChange('webcam')}
                className="form-radio h-5 w-5 text-sky-500 bg-gray-700 border-gray-600 focus:ring-sky-500"
              />
              <span className="text-gray-200">Webcam</span>
            </label>
            <label className="flex items-center space-x-2 cursor-pointer p-2 rounded hover:bg-gray-700 transition-colors">
              <input
                type="radio"
                name="videoSource"
                value="file"
                checked={videoSource === 'file'}
                onChange={() => handleVideoSourceChange('file')}
                className="form-radio h-5 w-5 text-sky-500 bg-gray-700 border-gray-600 focus:ring-sky-500"
              />
              <span className="text-gray-200">Subir Video</span>
            </label>
          </div>
          {videoSource === 'file' && (
            <div className="mt-4">
              <label htmlFor="videoUpload" className="block text-sm font-medium text-gray-300 mb-1">
                Seleccionar archivo de video:
              </label>
              <input
                id="videoUpload"
                type="file"
                accept="video/*"
                onChange={handleFileChange}
                className="block w-full text-sm text-gray-300
                           file:mr-4 file:py-2 file:px-4
                           file:rounded-md file:border-0
                           file:text-sm file:font-semibold
                           file:bg-sky-600 file:text-white
                           hover:file:bg-sky-700
                           focus:outline-none focus:ring-2 focus:ring-sky-500 focus:border-sky-500"
              />
            </div>
          )}
        </div>
        
        {renderVideoPlayer()}

        <StatusIndicator
          statusText={getStatusText()}
          isAnalyzing={isAnalyzing}
          currentRisk={currentRiskDetails?.detected_risk ?? RiskType.NONE}
          confidence={currentRiskDetails?.confidence_score}
          lastAnalysisTime={lastAnalysisTime}
        />
      </main>

      <AlertNotification
        alert={activeAlert ? { type: currentRiskDetails?.detected_risk ?? 'INFO', message: activeAlert, details: currentRiskDetails?.description } : null}
        onDismiss={() => setActiveAlert(null)}
      />

      <footer className="w-full max-w-4xl mt-10 pt-6 border-t border-gray-700 text-center">
        <p className="text-sm text-gray-500">
          © {new Date().getFullYear()} Proyecto de Asistencia Inteligente.
          <br/>La precisión de la detección depende de la calidad de imagen y del modelo de IA.
        </p>
         {process.env.API_KEY ? null : <p className="text-yellow-500 text-xs mt-1">ADVERTENCIA: La API Key de Gemini no está configurada. El análisis de imágenes no funcionará.</p>}
      </footer>
    </div>
  );
};

export default App;