import React, { useState, useEffect } from 'react';

const TimeDisplay: React.FC = () => {
  const [currentTime, setCurrentTime] = useState(new Date());

  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentTime(new Date());
    }, 1000);

    return () => clearInterval(timer);
  }, []);

  const formatTime = (date: Date) => {
    return date.toLocaleTimeString('en-US', {
      hour12: true,
      hour: 'numeric',
      minute: '2-digit',
      second: '2-digit'
    });
  };

  const formatTimeCompact = (date: Date) => {
    return date.toLocaleTimeString('en-US', {
      hour12: false,
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  const formatDate = (date: Date) => {
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric'
    });
  };

  const formatDateCompact = (date: Date) => {
    return date.toLocaleDateString('en-US', {
      month: '2-digit',
      day: '2-digit'
    });
  };

  return (
    <div className="text-right">
      {/* Desktop version */}
      <div className="hidden sm:block">
        <div className="text-sm font-medium text-graphite">
          {formatTime(currentTime)}
        </div>
        <div className="text-xs text-mist">
          {formatDate(currentTime)}
        </div>
      </div>
      
      {/* Mobile version - compact numbers only */}
      <div className="block sm:hidden text-xs text-graphite">
        <div>{formatTimeCompact(currentTime)}</div>
        <div className="text-mist">{formatDateCompact(currentTime)}</div>
      </div>
    </div>
  );
};

export default TimeDisplay; 