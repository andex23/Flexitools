import React from 'react';

export interface Tab {
  id: string;
  label: string;
  icon: string;
}

interface TabsProps {
  tabs: Tab[];
  activeTab: string;
  onTabChange: (tabId: string) => void;
}

const Tabs: React.FC<TabsProps> = ({ tabs, activeTab, onTabChange }) => {
  return (
    <div className="border-b border-creamline bg-taupe">
      <nav className="flex justify-start sm:justify-center overflow-x-auto space-x-2 sm:space-x-4 lg:space-x-8 px-3 sm:px-6" aria-label="Tabs" style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}>
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => onTabChange(tab.id)}
            className={`${
              activeTab === tab.id
                ? 'border-ink text-graphite'
                : 'border-transparent text-mist hover:border-creamline hover:text-graphite'
            } flex-shrink-0 whitespace-nowrap border-b-2 py-3 sm:py-4 px-2 sm:px-3 lg:px-4 text-xs sm:text-sm font-medium flex items-center space-x-1 sm:space-x-2 transition-all duration-200 hover:scale-105 font-heading`}
          >
            <span className="text-base sm:text-lg">{tab.icon}</span>
            <span className="hidden xs:inline sm:inline">{tab.label}</span>
          </button>
        ))}
      </nav>
    </div>
  );
};

export default Tabs; 