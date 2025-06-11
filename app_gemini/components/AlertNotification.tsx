
import React from 'react';
import { RiskType } from '../types';

interface AlertNotificationProps {
  alert: {
    type: RiskType | 'INFO' | 'ERROR';
    message: string;
    details?: string;
  } | null;
  onDismiss?: () => void;
}

const AlertNotification: React.FC<AlertNotificationProps> = ({ alert, onDismiss }) => {
  if (!alert) return null;

  const getAlertStyles = () => {
    switch (alert.type) {
      case RiskType.FALL:
      case RiskType.FIRE:
        return {
          bg: 'bg-red-600',
          icon: '🚨',
          title: `¡ALERTA DE ${alert.type === RiskType.FALL ? 'CAÍDA' : 'INCENDIO'}!`
        };
      case RiskType.UNKNOWN:
         return {
          bg: 'bg-yellow-500',
          icon: '⚠️',
          title: 'Advertencia de Análisis'
        };
      case 'ERROR':
        return {
          bg: 'bg-red-700',
          icon: '❌',
          title: 'Error del Sistema'
        };
      case 'INFO':
      default:
        return {
          bg: 'bg-sky-600',
          icon: 'ℹ️',
          title: 'Información'
        };
    }
  };

  const styles = getAlertStyles();

  return (
    <div className={`fixed bottom-5 right-5 w-full max-w-md p-4 rounded-lg shadow-2xl text-white ${styles.bg} z-50 transform transition-all duration-300 ease-out`}>
      <div className="flex items-start">
        <div className="text-2xl mr-3">{styles.icon}</div>
        <div className="flex-1">
          <h3 className="font-bold text-lg">{styles.title}</h3>
          <p className="text-sm mt-1">{alert.message}</p>
          {alert.details && <p className="text-xs mt-2 opacity-80">{alert.details}</p>}
        </div>
        {onDismiss && (
          <button
            onClick={onDismiss}
            className="ml-4 p-1 rounded-md hover:bg-white hover:bg-opacity-20 focus:outline-none focus:ring-2 focus:ring-white focus:ring-opacity-50"
            aria-label="Cerrar alerta"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        )}
      </div>
    </div>
  );
};

export default AlertNotification;
