
import React from 'react';
import { RiskType } from '../types';
import LoadingSpinner from './LoadingSpinner';

interface StatusIndicatorProps {
  statusText: string;
  isAnalyzing: boolean;
  currentRisk: RiskType;
  confidence?: number;
  lastAnalysisTime?: Date | null;
}

const StatusIndicator: React.FC<StatusIndicatorProps> = ({ statusText, isAnalyzing, currentRisk, confidence, lastAnalysisTime }) => {
  const getRiskStyles = () => {
    switch (currentRisk) {
      case RiskType.FALL:
        return { text: 'CAÍDA DETECTADA', color: 'text-red-400', icon: '🚶💥' };
      case RiskType.FIRE:
        return { text: 'INCENDIO DETECTADO', color: 'text-orange-400', icon: '🔥' };
      case RiskType.UNKNOWN:
        return { text: 'RIESGO DESCONOCIDO', color: 'text-yellow-400', icon: '❓' };
      case RiskType.NONE:
      default:
        return { text: 'Sin riesgos detectados', color: 'text-green-400', icon: '✅' };
    }
  };

  const riskInfo = getRiskStyles();

  return (
    <div className="p-4 bg-gray-800 rounded-lg shadow-md w-full">
      <div className="flex justify-between items-center mb-3">
        <h2 className="text-xl font-semibold text-sky-400">Estado del Sistema</h2>
        {isAnalyzing && <LoadingSpinner size="sm" />}
      </div>
      
      <div className="space-y-2 text-sm">
        <p>
          <span className="font-medium text-gray-400">Monitorización: </span>
          <span className={isAnalyzing ? 'text-yellow-400' : 'text-sky-300'}>
            {isAnalyzing ? 'Analizando imagen...' : statusText}
          </span>
        </p>
        <p>
          <span className="font-medium text-gray-400">Detección Actual: </span>
          <span className={`${riskInfo.color} font-semibold`}>
            {riskInfo.icon} {riskInfo.text}
            {currentRisk !== RiskType.NONE && confidence !== undefined && (
              <span className="text-xs opacity-80"> (Confianza: {(confidence * 100).toFixed(1)}%)</span>
            )}
          </span>
        </p>
        {lastAnalysisTime && (
           <p className="text-xs text-gray-500">
             Último análisis: {lastAnalysisTime.toLocaleTimeString()}
           </p>
        )}
      </div>
    </div>
  );
};

export default StatusIndicator;
