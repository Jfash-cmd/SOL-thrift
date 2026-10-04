import type { FC } from 'react';

interface PlanetBackdropProps {
  routeTab?: 'home' | 'circle' | 'create';
}

/**
 * PlanetBackdrop renders an authentic, architectural pure-CSS/SVG Saturn backdrop:
 * - 3D volumetric sphere with layered radial lighting (upper-left light, soft lower-right terminator, limb darkening)
 * - Desaturated warm grey palette (brightest #cfc8bb, dimmed for WCAG 4.5:1 text contrast)
 * - Multi-frequency latitude cloud bands drifting horizontally (surface turning)
 * - Static SVG feTurbulence cloud texture clipped to the planetary globe
 * - Ring diameter = 2.2x planet width, inner edge = 1.2x planet radius (54.5% disk radius)
 * - Authentic ring bands: C-Ring, B-Ring, crisp dark Cassini Division, A-Ring (with Encke division), faint F-Ring
 * - Slightly see-through ring with micro-grooves and fine radial speckle, revealing background stars
 * - Dual-layer depth clipping: back ring behind globe (z-index 1), globe in middle (z-index 2), front ring in front (z-index 3)
 * - Planet shadow cast strictly across the back ring (masked to ring geometry, preventing any sky bleed)
 * - Thin ring shadow cast across the planet clouds just below the ring (with Cassini sunlight pass)
 * - Faint atmospheric limb glow and static celestial stars
 * - Frozen animations under 640px and under prefers-reduced-motion
 */
export const PlanetBackdrop: FC<PlanetBackdropProps> = ({ routeTab = 'home' }) => {
  const isHome = routeTab === 'home';

  return (
    <div
      className={`planet-backdrop-root ${isHome ? 'planet-backdrop-home' : 'planet-backdrop-subpage'}`}
      aria-hidden="true"
    >
      {/* SVG Definitions for Static feTurbulence Texture */}
      <svg
        className="saturn-svg-defs"
        aria-hidden="true"
        style={{ position: 'absolute', width: 0, height: 0, pointerEvents: 'none' }}
      >
        <defs>
          <filter id="saturn-cloud-turbulence">
            <feTurbulence
              type="fractalNoise"
              baseFrequency="0.04 0.008"
              numOctaves="3"
              result="turbulence"
            />
            <feColorMatrix
              type="matrix"
              values="0.81 0 0 0 0.81  0 0.78 0 0 0.78  0 0 0.73 0 0.73  0 0 0 0.16 0"
            />
          </filter>
        </defs>
      </svg>

      {/* Static celestial stars across the backdrop */}
      <div className="saturn-star star-1" />
      <div className="saturn-star star-2" />
      <div className="saturn-star star-3" />
      <div className="saturn-star star-4" />
      <div className="saturn-star star-5" />
      <div className="saturn-star star-6" />

      <div className="saturn-system">
        {/* Celestial moon adding depth & scale */}
        <div className="saturn-moon" />

        {/* Faint atmospheric haze around the planet globe */}
        <div className="saturn-atmosphere-glow" />

        {/* ==================================================================
            LAYER 1: Back Ring (Clipped to upper/back half, passes BEHIND globe)
            ================================================================== */}
        <div className="saturn-ring-container ring-back">
          <div className="saturn-ring-tilt">
            <div className="saturn-ring-surface">
              <div className="saturn-ring-microgrooves" />
              <div className="saturn-ring-speckle" />
            </div>
            {/* Planet's shadow cast strictly on the back ring surface */}
            <div className="saturn-planet-shadow-on-ring" />
          </div>
        </div>

        {/* ==================================================================
            LAYER 2: Planet Body (Oblate sphere with bands, texture & terminator)
            ================================================================== */}
        <div className="saturn-planet-body">
          {/* Base warm grey globe tone */}
          <div className="saturn-base-tone" />

          {/* Drifting latitude cloud bands */}
          <div className="saturn-clouds-strip" />
          <div className="saturn-clouds-fine" />

          {/* Static SVG feTurbulence cloud texture (rendered once, not animated) */}
          <div className="saturn-clouds-turbulence" />

          {/* Polar hood darkening */}
          <div className="saturn-polar-hood" />

          {/* Slender ring shadow cast onto planet clouds just below the ring */}
          <div className="saturn-ring-shadow-on-planet" />

          {/* 3D Volumetric shading: light at upper left, soft terminator lower right, limb darkening */}
          <div className="saturn-sphere-shading" />

          {/* Atmospheric Rayleigh scattering crescent rim glow */}
          <div className="saturn-atmosphere-rim" />
        </div>

        {/* ==================================================================
            LAYER 3: Front Ring (Clipped to lower/front half, passes IN FRONT)
            ================================================================== */}
        <div className="saturn-ring-container ring-front">
          <div className="saturn-ring-tilt">
            <div className="saturn-ring-surface">
              <div className="saturn-ring-microgrooves" />
              <div className="saturn-ring-speckle" />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
