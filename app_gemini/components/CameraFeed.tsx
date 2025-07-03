
import React, { useRef, useEffect, useState, useCallback } from 'react';
import { DEFAULT_CAMERA_CONSTRAINTS, IMAGE_ANALYSIS_INTERVAL_MS } from '../constants';
import LoadingSpinner from './LoadingSpinner';

interface CameraFeedProps {
  sourceType: 'webcam' | 'file';
  videoFile?: File;
  onFrameCapture: (base64ImageData: string) => void;
  isAnalyzing: boolean;
  onError: (message: string) => void;
}

const CameraFeed: React.FC<CameraFeedProps> = ({ sourceType, videoFile, onFrameCapture, isAnalyzing, onError }) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [mediaStream, setMediaStream] = useState<MediaStream | null>(null);
  const [mediaError, setMediaError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const analysisIntervalRef = useRef<number | null>(null);


  const captureFrame = useCallback(() => {
    if (isAnalyzing) return;

    if (videoRef.current && canvasRef.current && videoRef.current.readyState >= 3 && videoRef.current.videoWidth > 0) { // readyState 3 (HAVE_FUTURE_DATA) or 4 (HAVE_ENOUGH_DATA)
      const videoNode = videoRef.current;
      const canvasNode = canvasRef.current;
      
      if (canvasNode.width !== videoNode.videoWidth || canvasNode.height !== videoNode.videoHeight) {
        canvasNode.width = videoNode.videoWidth;
        canvasNode.height = videoNode.videoHeight;
      }
      
      const ctx = canvasNode.getContext('2d');
      if (ctx) {
        ctx.drawImage(videoNode, 0, 0, canvasNode.width, canvasNode.height);
        const base64ImageData = canvasNode.toDataURL('image/jpeg', 0.8);
        onFrameCapture(base64ImageData.split(',')[1]);
      }
    } else {
    }
  }, [onFrameCapture, isAnalyzing]);

  useEffect(() => {
    const setupMedia = async () => {
      setIsLoading(true);
      setMediaError(null);
      if (mediaStream) {
        mediaStream.getTracks().forEach(track => track.stop());
        setMediaStream(null);
      }
      if (videoRef.current && videoRef.current.srcObject) {
          videoRef.current.srcObject = null;
      }


      if (sourceType === 'webcam') {
        try {
          const stream = await navigator.mediaDevices.getUserMedia(DEFAULT_CAMERA_CONSTRAINTS);
          setMediaStream(stream);
          if (videoRef.current) {
            videoRef.current.srcObject = stream;
            videoRef.current.muted = true;
            videoRef.current.loop = false;
            videoRef.current.play().catch(e => {
                 console.error("Error playing webcam stream:", e);
                 setMediaError("Error al iniciar la reproducción de la webcam.");
                 onError("Error al iniciar la reproducción de la webcam.");
            });
          }
          setMediaError(null);
        } catch (err) {
          console.error("Error accessing camera:", err);
          let message = "Error al acceder a la cámara. ";
          if (err instanceof Error) {
            if (err.name === "NotAllowedError") message += "Permiso denegado.";
            else if (err.name === "NotFoundError") message += "No se encontró ninguna cámara.";
            else if (err.name === "NotReadableError" ) message += "La cámara ya está en uso o bloqueada.";
            else message += err.message;
          }
          setMediaError(message);
          onError(message);
        }
      } else if (sourceType === 'file' && videoFile) {
        if (videoRef.current) {
          const objectURL = URL.createObjectURL(videoFile);
          videoRef.current.src = objectURL;
          videoRef.current.muted = true; // Mute video file by default for analysis
          videoRef.current.loop = true;  // Loop for continuous analysis
          videoRef.current.play().catch(e => {
               console.error("Error playing video file:", e);
               setMediaError("Error al reproducir el archivo de video.");
               onError("Error al reproducir el archivo de video.");
          });
          setMediaError(null);

          return () => {
            URL.revokeObjectURL(objectURL);
            if (videoRef.current) {
                videoRef.current.src = ""; // Clear src
            }
          };
        }
      } else if (sourceType === 'file' && !videoFile) {
        setMediaError("No se ha proporcionado ningún archivo de video.");
      }
      setIsLoading(false);
    };

    setupMedia();
    
    return () => {
      if (mediaStream) {
        mediaStream.getTracks().forEach(track => track.stop());
      }
      if (videoRef.current && videoRef.current.srcObject) {
        videoRef.current.srcObject = null;
      }
       if (analysisIntervalRef.current) {
        clearInterval(analysisIntervalRef.current);
      }
    };
  }, [sourceType, videoFile, onError]);

  useEffect(() => {
    if (analysisIntervalRef.current) {
      clearInterval(analysisIntervalRef.current);
    }

    if (!isLoading && !mediaError && videoRef.current ) {
      const videoElement = videoRef.current;
      const onCanPlay = () => {
        if (analysisIntervalRef.current) clearInterval(analysisIntervalRef.current);
        analysisIntervalRef.current = window.setInterval(() => {
          if (!isAnalyzing) {
            captureFrame();
          }
        }, IMAGE_ANALYSIS_INTERVAL_MS);
      };
      
      videoElement.addEventListener('canplay', onCanPlay);
      if (videoElement.readyState >= 3) { 
          onCanPlay();
      }

      return () => {
        videoElement.removeEventListener('canplay', onCanPlay);
        if (analysisIntervalRef.current) {
          clearInterval(analysisIntervalRef.current);
        }
      };
    }
  }, [isLoading, mediaError, captureFrame, isAnalyzing]); 

  const handleVideoLoaded = () => {
    setIsLoading(false);
    if (videoRef.current && (sourceType === 'file' || (sourceType === 'webcam' && mediaStream))) {
        videoRef.current.play().catch(e => {
             console.error("Error playing video on loadeddata:", e);
        });
    }
  };


  return (
    <div className="relative w-full aspect-video bg-gray-800 rounded-lg shadow-xl overflow-hidden border-2 border-gray-700">
      <video
        ref={videoRef}
        playsInline
        className="w-full h-full object-cover"
        onLoadedData={handleVideoLoaded} 
        onCanPlay={() => setIsLoading(false)}
        onError={(e) => {
            console.error("Video element error:", e);
            setMediaError("Error interno del elemento de video.");
            onError("Error interno del elemento de video.");
            setIsLoading(false);
        }}
      />
      <canvas ref={canvasRef} className="hidden"></canvas>
      {isLoading && sourceType !== 'file' && !videoFile && (
        <div className="absolute inset-0 flex items-center justify-center bg-gray-800 bg-opacity-75">
          <LoadingSpinner message={sourceType === 'webcam' ? "Iniciando cámara..." : "Cargando video..."} />
        </div>
      )}
      {mediaError && (
        <div className="absolute inset-0 flex items-center justify-center bg-black bg-opacity-75 p-4">
          <p className="text-red-400 text-center text-lg font-semibold">{mediaError}</p>
        </div>
      )}
    </div>
  );
};

export default CameraFeed;
