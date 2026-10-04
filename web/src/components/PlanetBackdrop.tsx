import type { FC } from 'react';

interface PlanetBackdropProps {
  routeTab?: 'home' | 'circle' | 'create';
}

/**
 * PlanetBackdrop renders an ultra-realistic, architectural pure-CSS Saturn backdrop:
 * - Volumetric 3D spherical lighting with physical limb darkening & atmospheric Rayleigh rim
 * - Multi-frequency harmonic cloud bands drifting slowly inside the globe
 * - Ring shadow cast onto the planet's cloud tops (with Cassini gap sunlight band)
 * - Tilted rings (72deg tilt, -18deg orbital axis) with C-Ring (crepe), B-Ring, Cassini Division,
 *   A-Ring (with Encke division), and faint F-Ring
 * - Concentric micro-groove ringlet textures
 * - Dual-layer depth clipping (back ring behind planet, front ring in front)
 * - Parabolic planet shadow cast across the back rings
 * - Pinpoint celestial moon (Enceladus) adding cosmic scale
 * - Performance optimized: GPU transforms, frozen under 640px & prefers-reduced-motion
 */
export const PlanetBackdrop: FC<PlanetBackdropProps> = ({ routeTab = 'home' }) => {
  const isHome = routeTab === 'home';

  return (
    <div
      className={`planet-backdrop-root ${isHome ? 'planet-backdrop-home' : 'planet-backdrop-subpage'}`}
      aria-hidden="true"
    >
      <div className="saturn-system">
        {/* Subtle celestial moon adding depth & scale */}
        <div className="saturn-moon" />

        {/* Layer 1: Back Ring (Clipped to upper/back half, passes behind the planet) */}
        <div className="saturn-ring-container ring-back">
          <div className="saturn-ring-tilt">
            <div className="saturn-ring-surface">
              <div className="saturn-ring-microgrooves" />
              <div className="saturn-ring-speckle" />
            </div>
          </div>
          {/* Planet's shadow cast onto the back ring */}
          <div className="saturn-planet-shadow-on-ring" />
        </div>

        {/* Layer 2: Planet Body (Globe with 3D Sphere, clipped clouds, dark limb & shadows) */}
        <div className="saturn-planet-body">
          {/* Multi-layered atmospheric cloud bands drifting horizontally */}
          <div className="saturn-clouds-strip" />
          <div className="saturn-clouds-fine" />

          {/* Polar darkening / hood */}
          <div className="saturn-polar-hood" />

          {/* Realistic ring shadow cast onto the planet's sunlit clouds */}
          <div className="saturn-ring-shadow-on-planet" />

          {/* 3D Volumetric Spherical Shading & Limb Darkening */}
          <div className="saturn-sphere-shading" />

          {/* Atmospheric Rayleigh limb glow on the sunlit crescent edge */}
          <div className="saturn-atmosphere-rim" />
        </div>

        {/* Layer 3: Front Ring (Clipped to lower/front half, passes in front of the planet) */}
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
