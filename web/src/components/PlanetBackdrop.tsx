import type { FC } from 'react';

interface PlanetBackdropProps {
  routeTab?: 'home' | 'circle' | 'create';
}

/**
 * PlanetBackdrop renders an architectural, pure-CSS Saturn backdrop with:
 * - 3D spherical lighting in greys and chalk
 * - Slowly drifting horizontal cloud bands
 * - 72deg tilted concentric ring with Cassini division and rotating speckle (90s per turn)
 * - Dual-layer depth clipping (back ring passes behind, front ring passes in front)
 * - Responsive placement and contrast-safe opacity
 */
export const PlanetBackdrop: FC<PlanetBackdropProps> = ({ routeTab = 'home' }) => {
  const isHome = routeTab === 'home';

  return (
    <div
      className={`planet-backdrop-root ${isHome ? 'planet-backdrop-home' : 'planet-backdrop-subpage'}`}
      aria-hidden="true"
    >
      <div className="saturn-system">
        {/* Layer 1: Back Ring (Clipped to upper/back half, passes behind the planet) */}
        <div className="saturn-ring-container ring-back">
          <div className="saturn-ring-tilt">
            <div className="saturn-ring-surface">
              <div className="saturn-ring-speckle" />
            </div>
          </div>
          {/* Planet's shadow on the back ring */}
          <div className="saturn-planet-shadow-on-ring" />
        </div>

        {/* Layer 2: Planet Body (Spherical Shading + Drifting Cloud Bands) */}
        <div className="saturn-planet-body">
          {/* Horizontal drifting cloud bands */}
          <div className="saturn-clouds-strip" />

          {/* 3D Spherical shading (upper-left light, lower-right dark limb) */}
          <div className="saturn-sphere-shading" />

          {/* Subtle curved ring shadow cast onto the planet's equator */}
          <div className="saturn-ring-shadow-on-planet" />
        </div>

        {/* Layer 3: Front Ring (Clipped to lower/front half, passes in front of the planet) */}
        <div className="saturn-ring-container ring-front">
          <div className="saturn-ring-tilt">
            <div className="saturn-ring-surface">
              <div className="saturn-ring-speckle" />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
