const DEFAULT_DIRECTIVES = {
  "default-src": ["'self'"],
  "base-uri": ["'self'"],
  "object-src": ["'none'"],
  "frame-ancestors": ["'none'"],
  "form-action": ["'self'"],
  "img-src": ["'self'", "data:", "blob:", "https:"],
  "font-src": ["'self'", "data:"],
  "style-src": ["'self'", "'unsafe-inline'"],
  "script-src": ["'self'", "'unsafe-inline'"],
  "connect-src": ["'self'", "https:", "wss:"],
  "media-src": ["'self'", "blob:", "data:", "https:"],
  "worker-src": ["'self'", "blob:"],
  "manifest-src": ["'self'"],
  "upgrade-insecure-requests": []
};

function serializeContentSecurityPolicy(directives = DEFAULT_DIRECTIVES) {
  return Object.entries(directives)
    .map(([name, values]) => (values.length > 0 ? `${name} ${values.join(" ")}` : name))
    .join("; ");
}

function buildSecurityHeaders(options = {}) {
  const includeHsts = options.includeHsts ?? process.env.NODE_ENV === "production";
  const headers = [
    {
      key: "Content-Security-Policy",
      value: serializeContentSecurityPolicy(options.directives)
    },
    {
      key: "Referrer-Policy",
      value: "strict-origin-when-cross-origin"
    },
    {
      key: "X-Content-Type-Options",
      value: "nosniff"
    },
    {
      key: "X-Frame-Options",
      value: "DENY"
    },
    {
      key: "Permissions-Policy",
      value: "camera=(), microphone=(self), geolocation=(), payment=(), usb=(), serial=()"
    }
  ];

  if (includeHsts) {
    headers.push({
      key: "Strict-Transport-Security",
      value: "max-age=63072000; includeSubDomains; preload"
    });
  }

  return headers;
}

function securityHeaderRules(options = {}) {
  return [
    {
      source: "/:path*",
      headers: buildSecurityHeaders(options)
    }
  ];
}

module.exports = {
  buildSecurityHeaders,
  securityHeaderRules,
  serializeContentSecurityPolicy
};
