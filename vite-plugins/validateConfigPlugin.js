import fs from "fs";
import { validateConfig } from "../src/validateConfig.js";

function readAndValidateConfig(configPath) {
  const config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
  validateConfig(config);
  return config;
}

export function validateConfigPlugin(configPath) {
  return {
    name: "validate-config",
    buildStart() {
      // Throws on an invalid config.json, failing the build (or surfacing
      // in the dev server's error overlay on startup).
      readAndValidateConfig(configPath);
    },
    handleHotUpdate({ file, server }) {
      if (file === configPath) {
        try {
          readAndValidateConfig(configPath);
        } catch (err) {
          server.ws.send({
            type: "error",
            err: {
              message: err.message,
              stack: err.stack ?? "",
              plugin: "validate-config",
              id: configPath,
            },
          });
        }
      }
    },
  };
}
