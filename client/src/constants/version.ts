// Von Vite zur Build-Zeit injiziert (siehe vite.config.ts → define).
declare const __APP_VERSION__: string;

export const APP_VERSION: string =
  typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '0.0.0';
