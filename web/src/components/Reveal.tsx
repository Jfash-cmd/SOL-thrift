import type { FC, ReactNode, CSSProperties } from 'react';
import { useRef, useState, useEffect } from 'react';

/**
 * Module-level cache of revealed keys per page session.
 * Invariant: Once an item has been revealed, it NEVER re-animates on chain data refreshes.
 */
const revealedSessionKeys = new Set<string>();

export interface RevealProps {
  children: ReactNode;
  /** Unique stable key to identify this element across data updates */
  revealKey?: string;
  /** Index for staggering in a grid or list (0, 1, 2...) */
  staggerIndex?: number;
  /** Stagger delay in milliseconds per item (default: 70ms) */
  staggerMs?: number;
  /** Maximum stagger items cap (default: 5 items) */
  maxStagger?: number;
  className?: string;
  style?: CSSProperties;
  /** HTML tag for the wrapper (default: 'div') */
  as?: keyof JSX.IntrinsicElements;
}

export const Reveal: FC<RevealProps> = ({
  children,
  revealKey,
  staggerIndex,
  staggerMs = 70,
  maxStagger = 5,
  className = '',
  style,
  as: Component = 'div',
}) => {
  // Check if item was already revealed in this page load
  const isAlreadyRevealed = Boolean(revealKey && revealedSessionKeys.has(revealKey));
  const [isRevealed, setIsRevealed] = useState<boolean>(isAlreadyRevealed);
  const elementRef = useRef<HTMLElement>(null);

  // Stagger calculation capped at maxStagger (70ms * max 4 = 280ms)
  const delayMs =
    staggerIndex !== undefined && !isAlreadyRevealed
      ? Math.min(staggerIndex, Math.max(0, maxStagger - 1)) * staggerMs
      : 0;

  const [animationCompleted, setAnimationCompleted] = useState<boolean>(isAlreadyRevealed);

  useEffect(() => {
    if (isRevealed && !animationCompleted) {
      const timer = setTimeout(() => {
        setAnimationCompleted(true);
      }, delayMs + 650);
      return () => clearTimeout(timer);
    }
  }, [isRevealed, animationCompleted, delayMs]);

  useEffect(() => {
    // If already revealed, do nothing
    if (isAlreadyRevealed || isRevealed) {
      if (revealKey) revealedSessionKeys.add(revealKey);
      return;
    }

    // If prefers-reduced-motion is enabled, show immediately
    if (
      typeof window !== 'undefined' &&
      window.matchMedia &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches
    ) {
      setIsRevealed(true);
      setAnimationCompleted(true);
      if (revealKey) revealedSessionKeys.add(revealKey);
      return;
    }

    const node = elementRef.current;
    if (!node) return;

    // If IntersectionObserver is unavailable, reveal immediately
    if (typeof IntersectionObserver === 'undefined') {
      setIsRevealed(true);
      setAnimationCompleted(true);
      if (revealKey) revealedSessionKeys.add(revealKey);
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        const [entry] = entries;
        if (entry && entry.isIntersecting) {
          setIsRevealed(true);
          if (revealKey) revealedSessionKeys.add(revealKey);
          observer.unobserve(node);
        }
      },
      {
        threshold: 0.08, // Trigger when 8% enters viewport
        rootMargin: '0px 0px -40px 0px', // Responsive scroll trigger zone
      }
    );

    observer.observe(node);

    return () => {
      if (node) observer.unobserve(node);
    };
  }, [isAlreadyRevealed, isRevealed, revealKey]);

  const inlineStyles: CSSProperties = {
    ...style,
    transitionDelay:
      !animationCompleted && delayMs > 0 && !isAlreadyRevealed
        ? `${delayMs}ms`
        : undefined,
  };

  const ComponentTag = Component as any;

  return (
    <ComponentTag
      ref={elementRef}
      className={`reveal-wrapper ${isRevealed ? 'is-revealed' : 'is-hidden'} ${className}`.trim()}
      style={inlineStyles}
    >
      {children}
    </ComponentTag>
  );
};
