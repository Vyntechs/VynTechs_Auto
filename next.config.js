/** @type {import('next').NextConfig} */
const nextConfig = {
  allowedDevOrigins: ['192.168.1.36'],
  async redirects() {
    return [
      {
        source: '/billing',
        destination: '/settings/billing',
        permanent: true,
      },
    ]
  },
}

export default nextConfig
