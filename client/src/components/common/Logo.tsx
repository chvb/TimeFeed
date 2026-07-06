import React from 'react';
import { BRAND_NAME, LOGO_INNER_SVG, LOGO_VIEWBOX } from './brand';

interface LogoProps {
  className?: string;
  size?: 'small' | 'default' | 'large' | 'xlarge' | 'sidebar';
  /** Nur das Icon ohne Wortmarke rendern */
  iconOnly?: boolean;
  /** Helle Variante für dunkle/orangefarbene Hintergründe (weiße Wortmarke + Icon-Badge) */
  light?: boolean;
}

const SIZES: Record<NonNullable<LogoProps['size']>, { icon: string; text: string }> = {
  small: { icon: 'h-8 w-8', text: 'text-lg' },
  default: { icon: 'h-10 w-10', text: 'text-xl' },
  large: { icon: 'h-12 w-12', text: 'text-2xl' },
  xlarge: { icon: 'h-16 w-16', text: 'text-3xl' },
  sidebar: { icon: 'h-12 w-12', text: 'text-2xl' },
};

/**
 * TimeFeed-Logo. Das Icon-Markup stammt zentral aus brand.ts (LOGO_INNER_SVG),
 * damit Logo, Print- und PDF-Ausgaben dieselbe Quelle verwenden.
 */
const Logo: React.FC<LogoProps> = ({ className = '', size = 'default', iconOnly = false, light = false }) => {
  const s = SIZES[size];
  return (
    <div className={`flex items-center gap-2.5 ${className}`}>
      <span className={light ? 'flex rounded-2xl bg-white p-1 shadow-sm' : 'flex'}>
        <svg
          className={`${s.icon} flex-shrink-0`}
          viewBox={LOGO_VIEWBOX}
          xmlns="http://www.w3.org/2000/svg"
          aria-label={BRAND_NAME}
          dangerouslySetInnerHTML={{ __html: LOGO_INNER_SVG }}
        />
      </span>
      {!iconOnly && (
        <span className={`font-bold tracking-tight ${s.text} leading-none`}>
          {light ? (
            <span className="text-white">{BRAND_NAME}</span>
          ) : (
            <><span className="text-slate-900">Time</span><span className="text-primary-600">Feed</span></>
          )}
        </span>
      )}
    </div>
  );
};

export default Logo;
