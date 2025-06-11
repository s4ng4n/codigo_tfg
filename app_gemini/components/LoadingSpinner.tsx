
import React from 'react';

interface LoadingSpinnerProps {
  size?: 'sm' | 'md' | 'lg';
  message?: string;
}

const LoadingSpinner: React.FC<LoadingSpinnerProps> = ({ size = 'md', message }) => {
  const sizeClasses = {
    sm: 'w-6 h-6 border-2',
    md: 'w-10 h-10 border-4',
    lg: 'w-16 h-16 border-4',
  };

  return (
    <div className="flex flex-col items-center justify-center text-gray-400">
      <div
        className={`animate-spin rounded-full ${sizeClasses[size]} border-t-transparent border-sky-500`}
      ></div>
      {message && <p className="mt-3 text-sm">{message}</p>}
    </div>
  );
};

export default LoadingSpinner;
