import type { FC } from 'react';

interface SolthriftLogoProps {
  size?: number;
  className?: string;
}

/**
 * SolthriftLogo
 * The official Solthrift protocol emblem:
 * A central Solana network logo surrounded by four human icons in a savings circle,
 * symbolizing decentralized group savings on Solana.
 */
export const SolthriftLogo: FC<SolthriftLogoProps> = ({ size = 26, className = '' }) => {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 48 48"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-label="Solthrift logo: Solana surrounded by four members"
    >
      {/* Outer subtle circular ring connecting the members */}
      <circle
        cx="24"
        cy="24"
        r="19.5"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeDasharray="2.5 2.5"
        opacity="0.35"
      />

      {/* Central Solana Logo (Official vector, centered) */}
      <g transform="translate(16, 17.5)">
        <path
          d="M15.9162 11.0381L13.2749 13.809C13.2178 13.8692 13.1486 13.9172 13.0716 13.95C12.9947 13.9829 12.9117 13.9999 12.8277 14H0.306886C0.247168 14 0.188756 13.9829 0.138801 13.9509C0.0888472 13.9188 0.0494488 13.8732 0.025345 13.8194C0.00124119 13.7657 -0.00657519 13.7061 0.00282869 13.6477C0.0122326 13.5893 0.0384762 13.5346 0.0784261 13.4901L2.71969 10.7192C2.77684 10.6591 2.84599 10.6111 2.92296 10.5782C2.99993 10.5454 3.08298 10.5284 3.16694 10.5283H15.6878C15.7475 10.5283 15.8059 10.5454 15.8559 10.5775C15.9058 10.6095 15.9452 10.6551 15.9693 10.7089C15.9934 10.7627 16.0012 10.8222 15.9918 10.8806C15.9824 10.939 15.9562 10.9937 15.9162 11.0381ZM15.9162 0.50989L13.2749 3.28076C13.2178 3.34094 13.1486 3.38894 13.0716 3.42183C12.9947 3.45472 12.9117 3.47171 12.8277 3.47179H0.306886C0.247168 3.47179 0.188756 3.45472 0.138801 3.42267C0.0888472 3.39062 0.0494488 3.345 0.025345 3.29124C0.00124119 3.23748 -0.00657519 3.1779 0.00282869 3.11951C0.0122326 3.06112 0.0384762 3.00642 0.0784261 2.96191L2.71969 0.19104C2.77684 0.130863 2.84599 0.082864 2.92296 0.0499719C2.99993 0.0170798 3.08298 8.87114e-05 3.16694 0H15.6878C15.7475 0 15.8059 0.0170798 15.8559 0.0491325C15.9058 0.0811853 15.9452 0.126804 15.9693 0.180564C15.9934 0.234324 16.0012 0.293904 15.9918 0.352296C15.9824 0.410688 15.9562 0.465384 15.9162 0.50989ZM0.0784261 5.76759L2.71969 8.53846C2.77684 8.59864 2.84599 8.64664 2.92296 8.67953C2.99993 8.71242 3.08298 8.72941 3.16694 8.72949H15.6878C15.7475 8.72949 15.8059 8.71242 15.8559 8.68036C15.9058 8.64831 15.9452 8.60269 15.9693 8.54893C15.9934 8.49517 16.0012 8.43559 15.9918 8.3772C15.9824 8.31881 15.9562 8.26411 15.9162 8.2196L13.2749 5.44873C13.2178 5.38855 13.1486 5.34056 13.0716 5.30766C12.9947 5.27477 12.9117 5.25778 12.8277 5.2577H0.306886C0.247168 5.2577 0.188756 5.27477 0.138801 5.30683C0.0888472 5.33888 0.0494488 5.3845 0.025345 5.43826C0.00124119 5.49202 -0.00657519 5.5516 0.00282869 5.60999C0.0122326 5.66838 0.0384762 5.72308 0.0784261 5.76759Z"
          fill="currentColor"
        />
      </g>

      {/* 4 Human Member Icons surrounding the Solana core */}
      {/* 1. Top Member (0 deg / 12 o'clock) */}
      <g transform="rotate(0, 24, 24)">
        <circle cx="24" cy="4.5" r="2.4" fill="currentColor" />
        <path
          d="M 19.5 11.5 C 19.5 8.2 28.5 8.2 28.5 11.5"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
        />
      </g>

      {/* 2. Right Member (90 deg / 3 o'clock) */}
      <g transform="rotate(90, 24, 24)">
        <circle cx="24" cy="4.5" r="2.4" fill="currentColor" />
        <path
          d="M 19.5 11.5 C 19.5 8.2 28.5 8.2 28.5 11.5"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
        />
      </g>

      {/* 3. Bottom Member (180 deg / 6 o'clock) */}
      <g transform="rotate(180, 24, 24)">
        <circle cx="24" cy="4.5" r="2.4" fill="currentColor" />
        <path
          d="M 19.5 11.5 C 19.5 8.2 28.5 8.2 28.5 11.5"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
        />
      </g>

      {/* 4. Left Member (270 deg / 9 o'clock) */}
      <g transform="rotate(270, 24, 24)">
        <circle cx="24" cy="4.5" r="2.4" fill="currentColor" />
        <path
          d="M 19.5 11.5 C 19.5 8.2 28.5 8.2 28.5 11.5"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
        />
      </g>
    </svg>
  );
};
