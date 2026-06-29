const path = require("path");
const { securityHeaderRules } = require("./packages/security-headers");

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  output: "standalone",
  serverExternalPackages: ["@elizaos/core"],
  outputFileTracingRoot: path.join(__dirname),
  async headers() {
    return securityHeaderRules();
  }
};

module.exports = nextConfig;
