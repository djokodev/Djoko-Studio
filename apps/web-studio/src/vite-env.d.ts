/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_BASE_URL?: string;
  readonly VITE_SIGNALING_BASE_URL?: string;
  readonly VITE_UPLOAD_BASE_URL?: string;
  readonly VITE_RTC_ICE_SERVERS_JSON?: string;
}
