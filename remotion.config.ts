import { Config } from "@remotion/cli/config";

// Deterministic, phone-friendly defaults. Final encoding settings live in src/render.
Config.setVideoImageFormat("jpeg");
Config.setOverwriteOutput(true);
Config.setEntryPoint("src/index.ts");
