import React from 'react';
import { RefreshCw, XCircle } from 'lucide-react';
import { COLORS } from '../config';

export const Button = ({
  children,
  onClick,
  variant = 'primary',
  size = 'md',
  className = '',
  disabled = false,
  loading = false,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  variant?: 'primary' | 'secondary' | 'outline' | 'danger' | 'success';
  size?: 'sm' | 'md' | 'lg';
  className?: string;
  disabled?: boolean;
  loading?: boolean;
}) => {
  const baseStyle =
    'font-sans font-medium rounded transition-colors duration-200 flex items-center justify-center gap-2';
  const variants = {
    primary: `bg-[${COLORS.primary}] text-white hover:bg-[${COLORS.primaryHover}] disabled:opacity-50`,
    secondary: `bg-[${COLORS.background}] text-[${COLORS.textPrimary}] hover:bg-gray-200`,
    outline: `border border-[${COLORS.border}] text-[${COLORS.textPrimary}] hover:bg-gray-50 bg-white`,
    danger: `bg-[${COLORS.error}] text-white hover:opacity-90`,
    success: `bg-[${COLORS.success}] text-white hover:opacity-90`,
  };
  const sizes = {
    sm: 'px-3 py-1 text-xs',
    md: 'px-4 py-2 text-sm',
    lg: 'px-6 py-3 text-base',
  };

  return (
    <button
      onClick={onClick}
      disabled={disabled || loading}
      className={`${baseStyle} ${variants[variant]} ${sizes[size]} ${className}`}
    >
      {loading && <RefreshCw className="w-4 h-4 animate-spin" />}
      {children}
    </button>
  );
};

export const Card = ({
  children,
  className = '',
}: {
  children: React.ReactNode;
  className?: string;
}) => (
  <div
    className={`bg-white rounded border border-[${COLORS.border}] shadow-sm p-4 ${className}`}
  >
    {children}
  </div>
);

export const Badge = ({
  children,
  color = 'gray',
}: {
  children: React.ReactNode;
  color?: 'gray' | 'blue' | 'green' | 'red' | 'yellow';
}) => {
  const colors = {
    gray: 'bg-gray-100 text-gray-800',
    blue: 'bg-blue-100 text-blue-800',
    green: 'bg-green-100 text-green-800',
    red: 'bg-red-100 text-red-800',
    yellow: 'bg-yellow-100 text-yellow-800',
  };
  return (
    <span className={`px-2 py-0.5 rounded text-xs font-medium ${colors[color]}`}>
      {children}
    </span>
  );
};

export const Modal = ({
  isOpen,
  onClose,
  title,
  children,
}: {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
}) => {
  if (!isOpen) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50 p-4">
      <div className="bg-white rounded-lg shadow-xl max-w-lg w-full max-h-[90vh] overflow-y-auto">
        <div className="flex justify-between items-center p-4 border-b">
          <h3 className="font-serif text-lg font-bold">{title}</h3>
          <button onClick={onClose}>
            <XCircle className="text-gray-400 hover:text-gray-600" />
          </button>
        </div>
        <div className="p-4">{children}</div>
      </div>
    </div>
  );
};

