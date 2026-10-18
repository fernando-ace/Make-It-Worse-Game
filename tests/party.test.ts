import { describe, expect, it } from "vitest";
import { assertLocalPartySafety, buildLocalPartyManifest, buildPartyRuntimeConfig, detectLanAddress, isLanAddress, supabaseLanUrl } from "../scripts/party.mjs";

describe("Local Party Lab networking", () => {
  it("accepts only RFC1918 IPv4 addresses as advertised hosts", () => {
    expect(isLanAddress("192.168.1.50")).toBe(true);
    expect(isLanAddress("10.0.0.4")).toBe(true);
    expect(isLanAddress("172.31.2.7")).toBe(true);
    expect(isLanAddress("8.8.8.8")).toBe(false);
    expect(isLanAddress("127.0.0.1")).toBe(false);
    expect(isLanAddress("172.32.0.1")).toBe(false);
  });

  it("prefers a Wi-Fi interface and excludes common Docker/VM adapters", () => {
    const result = detectLanAddress({
      "vEthernet (Docker)": [{ family: "IPv4", address: "172.20.0.1", internal: false, netmask: "255.255.255.0", mac: "00:00:00:00:00:01", cidr: "172.20.0.1/24" }],
      "Ethernet": [{ family: "IPv4", address: "192.168.1.4", internal: false, netmask: "255.255.255.0", mac: "00:00:00:00:00:02", cidr: "192.168.1.4/24" }],
      "Wi-Fi": [{ family: "IPv4", address: "192.168.1.50", internal: false, netmask: "255.255.255.0", mac: "00:00:00:00:00:03", cidr: "192.168.1.50/24" }],
    });
    expect(result.selected?.address).toBe("192.168.1.50");
    expect(result.candidates.find((candidate) => candidate.name.startsWith("vEthernet"))?.virtual).toBe(true);
  });

  it("rewrites the local Supabase API host and preserves the port and path", () => {
    expect(supabaseLanUrl("http://127.0.0.1:54321", "192.168.1.50")).toBe("http://192.168.1.50:54321");
    expect(() => supabaseLanUrl("https://unknown-project.supabase.co", "192.168.1.50")).toThrow(/unexpected API host/);
    expect(() => supabaseLanUrl("http://127.0.0.1:54321", "8.8.8.8")).toThrow(/private IPv4/);
  });

  it("generates the advertised game and Supabase URLs and binds Next externally", () => {
    expect(buildPartyRuntimeConfig("192.168.1.50", 3000, "http://127.0.0.1:54321")).toEqual({
      gameUrl: "http://192.168.1.50:3000",
      supabaseUrl: "http://192.168.1.50:54321",
      nextArgs: ["dev", "--hostname", "0.0.0.0", "--port", "3000"],
    });
  });

  it("allows local operations only for the explicit local-party mode and refuses Production or unknown remote targets", () => {
    const local = {
      NODE_ENV: "development",
      NEXT_PUBLIC_DEPLOYMENT_CLASS: "development",
      LOCAL_PARTY_MODE: "true",
      NEXT_PUBLIC_LOCAL_PARTY_MODE: "true",
      NEXT_PUBLIC_SUPABASE_URL: "http://192.168.1.50:54321",
      SUPABASE_PROJECT_REF: "local",
    };
    expect(assertLocalPartySafety(local).backendClass).toBe("local");
    expect(() => assertLocalPartySafety({ ...local, NEXT_PUBLIC_SUPABASE_URL: "https://jfosecuafntktpudjhyj.supabase.co" }, "reset")).toThrow(/refusing reset/i);
    expect(() => assertLocalPartySafety({ ...local, NEXT_PUBLIC_SUPABASE_URL: "https://other-project.supabase.co" }, "export")).toThrow(/refusing export/i);
    expect(() => assertLocalPartySafety({ ...local, VERCEL_ENV: "production" }, "reset")).toThrow(/refusing reset/i);
  });

  it("builds a privacy-safe local manifest with only opaque session ids and operator notes", () => {
    const manifest = buildLocalPartyManifest({
      events: [{ session_key: "a".repeat(64), player_count: 4, access_token: "never-copy" }],
      metrics: [{ sessionKey: "b".repeat(64), playerCount: 2, privateObjective: "never-copy" }],
    }, { label: "Friday", players: 4, devices: "iPhone/Safari + Android/Chrome", group: "mixed" });
    expect(manifest.sessions).toEqual([
      { sessionId: "a".repeat(64), playerCount: 4 },
      { sessionId: "b".repeat(64), playerCount: 2 },
    ]);
    expect(manifest).not.toHaveProperty("access_token");
    expect(manifest).not.toHaveProperty("privateObjective");
    expect(manifest).toMatchObject({ testLabel: "Friday", playerCount: 4, groupType: "mixed" });
    expect(buildLocalPartyManifest({ events: [{ session_key: "not-opaque", player_count: 99 }] }).sessions).toEqual([]);
  });
});
