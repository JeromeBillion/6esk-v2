const path = require("path");
const { securityHeaderRules } = require("../../packages/security-headers");

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  output: "standalone",
  outputFileTracingRoot: path.join(__dirname, "../.."),
  serverExternalPackages: ["@elizaos/core", "pg"],
  transpilePackages: ["@6esk/auth", "@6esk/database", "@6esk/types", "@6esk/ui"],
  async headers() {
    return securityHeaderRules();
  }
};

module.exports = nextConfig;
