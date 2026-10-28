import { describe, expect, it } from "vitest";
import { toDockerHostUrl } from "../../scripts/configure-cron";

describe("toDockerHostUrl", () => {
  it("points localhost URLs at the Docker host, keeping port and path", () => {
    expect(toDockerHostUrl("http://localhost:3000/api/worker")).toBe("http://host.docker.internal:3000/api/worker");
    expect(toDockerHostUrl("http://127.0.0.1:3000/api/worker")).toBe("http://host.docker.internal:3000/api/worker");
  });

  it("leaves real hostnames alone (for example a deployed app)", () => {
    expect(toDockerHostUrl("https://app.example.com/api/worker")).toBe("https://app.example.com/api/worker");
  });
});
