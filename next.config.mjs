/** @type {import('next').NextConfig} */
const nextConfig = {
  poweredByHeader: false,
  compress: true,
  trailingSlash: false,
  images: {
    formats: ["image/avif", "image/webp"],
    deviceSizes: [640, 750, 828, 1080, 1200, 1920],
    imageSizes: [16, 32, 48, 64, 96, 128, 256, 384],
    minimumCacheTTL: 60 * 60 * 24 * 30,
  },
  async redirects() {
    return [
      { source: "/admin", destination: "/admin/index.html", permanent: false },
      { source: "/admin/", destination: "/admin/index.html", permanent: false },
      {
        source: "/:path+/",
        destination: "/:path+",
        permanent: true,
      },
      {
        source: "/:path*",
        has: [{ type: "host", value: "www.gulbargahomes.com" }],
        destination: "https://gulbargahomes.com/:path*",
        permanent: true,
      },
      {
        source: "/:path*",
        has: [{ type: "host", value: "gulbarga.netlify.app" }],
        destination: "https://gulbargahomes.com/:path*",
        permanent: true,
      },
    ];
  },
};

export default nextConfig;
