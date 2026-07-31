import fs from "fs";

export function injectDataPreloads(configPath) {
  return {
    name: "inject-data-preloads",
    transformIndexHtml(html) {
      const config = JSON.parse(fs.readFileSync(configPath, "utf-8"));

      const preloads = [config.PROGRAM_DATA_URL, config.PEOPLE_DATA_URL]
        .filter(Boolean)
        .map((url) => ({
          tag: "link",
          attrs: {
            rel: "preload",
            href: url,
            as: "fetch",
            crossorigin: "anonymous",
          },
        }));

      return preloads;
    },
  };
}
