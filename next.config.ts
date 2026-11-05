import type { NextConfig } from "next";
const config: NextConfig = {
  async headers() {
    return [{ source: "/t.js", headers: [{ key: "Cache-Control", value: "public, max-age=3600" }, { key: "Access-Control-Allow-Origin", value: "*" }] }];
  },
};
export default config;
