/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_EHR_CONSOLE_URL?: string;
}

declare module "*.less" {
  const classes: { [key: string]: string };
  export default classes;
}
