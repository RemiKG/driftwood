/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // The Splunk session client and google-auth-library run only on the server.
  serverExternalPackages: ["google-auth-library"],
};

export default nextConfig;
