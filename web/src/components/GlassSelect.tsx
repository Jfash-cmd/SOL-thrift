import type { FC, ReactNode } from 'react';
import { useState, useRef, useEffect } from 'react';
import { ChevronDown, Check } from 'lucide-react';

export interface GlassSelectOption {
  value: string;
  label: string;
}

interface GlassSelectProps {
  id: string;
  value: string;
  options: GlassSelectOption[];
  onChange: (value: string) => void;
  icon?: ReactNode;
  ariaLabel?: string;
}

export const GlassSelect: FC<GlassSelectProps> = ({
  id,
  value,
  options,
  onChange,
  icon,
  ariaLabel,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const selectedOption = options.find((opt) => opt.value === value) || options[0];

  // Close dropdown on outside click or Escape key
  useEffect(() => {
    const handleOutsideClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setIsOpen(false);
      }
    };

    if (isOpen) {
      document.addEventListener('mousedown', handleOutsideClick);
      document.addEventListener('keydown', handleKeyDown);
    }
    return () => {
      document.removeEventListener('mousedown', handleOutsideClick);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen]);

  const handleSelect = (optionValue: string) => {
    onChange(optionValue);
    setIsOpen(false);
  };

  return (
    <div className="glass-select-wrapper" ref={containerRef}>
      {/* Hidden native select keeps HTML form semantics, accessibility, and element IDs intact */}
      <select
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        tabIndex={-1}
        aria-hidden="true"
        style={{
          position: 'absolute',
          opacity: 0,
          pointerEvents: 'none',
          width: 0,
          height: 0,
          margin: 0,
          padding: 0,
          border: 0,
        }}
      >
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>

      {/* Glassy trigger button matching panel glassmorphism */}
      <button
        type="button"
        id={`${id}-trigger`}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        aria-label={ariaLabel || id}
        className={`glass-select-trigger ${isOpen ? 'active' : ''}`}
        onClick={() => setIsOpen((prev) => !prev)}
      >
        <span className="glass-select-label">
          {icon && <span className="glass-select-icon">{icon}</span>}
          {selectedOption ? selectedOption.label : value}
        </span>
        <ChevronDown
          size={16}
          className={`glass-select-chevron ${isOpen ? 'rotated' : ''}`}
        />
      </button>

      {/* Frosted glass dropdown menu */}
      {isOpen && (
        <div
          role="listbox"
          id={`${id}-dropdown`}
          aria-labelledby={id}
          className="glass-select-dropdown"
        >
          <div className="glass-select-dropdown-scroll">
            {options.map((opt) => {
              const isSelected = opt.value === value;
              return (
                <div
                  key={opt.value}
                  role="option"
                  aria-selected={isSelected}
                  tabIndex={0}
                  className={`glass-select-option ${isSelected ? 'selected' : ''}`}
                  onClick={() => handleSelect(opt.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      handleSelect(opt.value);
                    }
                  }}
                >
                  <span className="glass-option-text">{opt.label}</span>
                  {isSelected && <Check size={14} className="text-green glass-option-check" />}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};
