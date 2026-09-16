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
        source: "/properties/2bhk-house-rent-biddapur-colony",
        destination: "/properties/1bhk-house-rent-biddapur-colony",
        permanent: true,
      },
      ...[
        "1bhk-flat-rent-station-area",
        "1bhk-flat-rent-super-market",
        "1bhk-house-rent-shahbazar",
        "2bhk-flat-rent-azadpur",
        "2bhk-flat-rent-sedam-road",
        "2bhk-flat-rent-university-area",
        "2bhk-house-rent-court-road",
        "2bhk-house-rent-jewargi-road",
        "2bhk-house-sale-biddapur-colony",
        "3bhk-flat-rent-msk-mill-road",
        "3bhk-flat-rent-timmapuri",
        "3bhk-house-rent-aiwan-e-shahi",
        "3bhk-house-sale-azadpur",
        "4bhk-villa-sale-sedam-road",
        "pg-rent-university-area",
        "residential-plot-sale-aland-road",
        "residential-plot-sale-jewargi-road",
        "residential-plot-sale-kalnoor",
        "residential-plot-sale-kusnoor",
        "residential-plot-sale-ring-road",
        "residential-plot-sale-sedam-road",
      ].map((slug) => ({
        source: `/properties/${slug}`,
        destination: "/properties",
        permanent: true,
      })),
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
