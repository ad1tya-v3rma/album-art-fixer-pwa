
import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
    plugins: [
        VitePWA({
            registerType: "autoUpdate",
            manifest: {
                name: "Album Art Fixer",
                short_name: "Art Fixer",
                description: "Inspect and normalize embedded music artwork",
                theme_color: "#111827",
                background_color: "#111827",
                display: "standalone",
                start_url: "/",
                icons: []
            },
            workbox: {
                navigateFallback: "index.html"
            }
        })
    ]
});
