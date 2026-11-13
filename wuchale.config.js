import { defineConfig } from "wuchale";
import { adapter as vanilla } from "wuchale/adapter-vanilla";

export default defineConfig({
  locales: ["en", "es", "ar"],
  localesDir: "src/locales",
  adapters: {
    main: vanilla({
      sourceLocale: "en",
      loader: "vite",
      files: { include: ".wuchale-build/i18n.ts" },
    }),
  },
});
