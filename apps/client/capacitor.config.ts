import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.codexuilite.app",
  appName: "Codex 项目终端",
  webDir: "dist",
  server: {
    androidScheme: "https"
  }
};

export default config;
