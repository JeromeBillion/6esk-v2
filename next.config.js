const path = require("path");

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  output: "standalone",
  serverExternalPackages: ["@elizaos/core"],
  outputFileTracingRoot: path.join(__dirname)
};

module.exports = nextConfig;
